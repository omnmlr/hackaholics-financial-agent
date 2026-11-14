import { z } from "zod";
import { createHash } from "node:crypto";
import type { FunctionDeclaration } from "@google/genai";
import { operator } from "../auth";
import { AppError } from "../domain";
import { config } from "../config";
import {
  personalTools,
  personalToolDefinitions,
} from "../agent-workspace/tools";
import { workspace } from "../agent-workspace/store";
import { chatHistory } from "../chat-history/store";
import { CalculateArgs, calculate } from "../model-led-agent/calculate";
import {
  createGeminiToolModel,
  type ToolModel,
} from "../model-led-agent/model";
import { AgentError } from "../financial-agent/protocol";
import { redactAgentText, privateAgentText, privateModelData } from "./privacy";
import {
  financialConversationTurn,
  type ConversationInput,
} from "../financial-integration/conversation";
import { authorizedFinancialAccess } from "../financial-integration/access";
import { createRepositoryAccess } from "../financial-agent/access";
import { createDurableRepository } from "../financial-integration/storage";
import { runJournal } from "./journal";
import { createPersonalAgent, ENGINE_LIMITS } from "./engine";
import {
  report,
  ToolFailure,
  type AgentTool,
  type ToolResult,
} from "./contracts";

function declaration(
  name: string,
  description: string,
  schema: z.ZodType,
): FunctionDeclaration {
  const { $schema: ignored, ...parametersJsonSchema } = z.toJSONSchema(schema);
  void ignored;
  return { name, description, parametersJsonSchema };
}
export async function runPersonalConversation(
  req: Request,
  input: z.infer<typeof ConversationInput>,
  model: ToolModel = createGeminiToolModel(),
) {
  input = {
    ...input,
    privacyMode:
      !!input.privacyMode ||
      /\b(?:private|privately|shielded|privacy mode)\b/i.test(input.text),
  };
  const owner = await operator(req);
  const journal = runJournal(owner);
  const run = input.resumeRunId
    ? await journal.read(input.resumeRunId)
    : await journal.create({
        id: input.requestId,
        conversationId: input.conversationId,
        goal: input.text,
        accountIds: input.accountIds,
        privacyMode: input.privacyMode,
      });
  if (
    run.conversationId !== input.conversationId ||
    run.goal !==
      (input.privacyMode
        ? privateAgentText(input.text)
        : redactAgentText(input.text)) ||
    Boolean(run.privacyMode) !== Boolean(input.privacyMode) ||
    JSON.stringify(run.accountIds) !== JSON.stringify(input.accountIds)
  )
    throw new AppError("Resume instructions do not match the saved run", 409);
  let modelCalls = 0;
  const budgeted: ToolModel = {
    provider: model.provider,
    model: model.model,
    generate: async (args) => {
      if (modelCalls >= ENGINE_LIMITS.models)
        throw new AgentError("MODEL_LIMIT");
      modelCalls++;
      return model.generate(
        input.privacyMode
          ? {
              ...args,
              contents: privateModelData(args.contents) as typeof args.contents,
            }
          : args,
      );
    },
  };
  const personal = personalTools(owner);
  const ResponsibilitySchema =
    personalToolDefinitions.prepare_responsibility.schema.omit({
      requestId: true,
    });
  const tools: AgentTool[] = (
    input.privacyMode ? [] : (personal?.declarations ?? [])
  ).map((d) => ({
    declaration:
      d.name === "prepare_responsibility"
        ? declaration(d.name, d.description ?? "", ResponsibilitySchema)
        : d,
    schema:
      d.name === "prepare_responsibility"
        ? ResponsibilitySchema
        : personalToolDefinitions[
            d.name as keyof typeof personalToolDefinitions
          ].schema,
    effect:
      d.name?.startsWith("read_") ||
      d.name === "solana_wallet_balances" ||
      d.name === "solana_transaction_status"
        ? "read"
        : "proposal",
    idempotent: true,
    async execute(args, ctx) {
      ctx.signal.throwIfAborted();
      let result;
      try {
        result = await personal!.execute(d.name!, args, ctx.key);
      } catch (error) {
        if (
          error instanceof Error &&
          "status" in error &&
          typeof error.status === "number" &&
          error.status < 500
        ) {
          const code =
            "code" in error && /^[A-Z][A-Z0-9_]{1,63}$/.test(String(error.code))
              ? String(error.code)
              : "REQUEST_REJECTED";
          throw new ToolFailure(code, "rejected");
        }
        throw error;
      }
      const { toolData, awaitingUser, ...reply } = result;
      return { summary: reply.text, data: toolData, reply, awaitingUser };
    },
  }));
  tools.push({
    declaration: declaration(
      "calculate",
      "Evaluate arithmetic using the existing exact decimal calculator, with units and stated assumptions. No account access or approval needed; this verifies evaluation, not invented source figures.",
      CalculateArgs,
    ),
    schema: CalculateArgs,
    effect: "read",
    async execute(args) {
      const result = calculate(args, "calculation");
      return {
        summary: `Calculated ${result.displayValue} ${result.unit}.`,
        data: result,
      };
    },
  });
  const Empty = z.strictObject({});
  tools.push({
    declaration: declaration(
      "read_agus_financial_snapshot",
      "Read the signed-in user's imported statement balances, income/spending with internal transfers excluded, open invoices and independently verified testnet payment states. Use for money owed, received payments, obligations, imported accounts or what to do next. Statements are user-provided historical records, not live bank balances; invoices are not cash. Currencies stay separate. Never infer Zcash receipt from a public transaction ID. This tool cannot move money, approve or settle anything.",
      Empty,
    ),
    schema: Empty,
    effect: "read",
    volatile: true,
    async execute() {
      const { productSnapshot } = await import("../web-product/service");
      const snapshot = await productSnapshot(owner);
      const { listPaymentPlans } =
        await import("../web-product/conversational-payments");
      const outgoing = await listPaymentPlans(owner);
      return {
        summary:
          "Read user-owned imported financial records and evidence-based invoice states.",
        data: input.privacyMode
          ? {
              privacyMode: true,
              asOf: snapshot.asOf,
              openObligationCount: snapshot.invoices.filter(
                (i) => i.state === "open",
              ).length,
              pendingPaymentCount:
                snapshot.requests.filter((r) => r.state === "pending").length +
                outgoing.filter((p) =>
                  ["submitting", "pending", "unknown"].includes(p.state),
                ).length,
              disclosure:
                "Recipient addresses, invoice counterparties/amounts, balances, statement records and wallet metadata are withheld from the model in Privacy Mode. Details remain available in the authenticated owner UI. Information typed by the user into this chat is still model-visible after key redaction.",
            }
          : {
              asOf: snapshot.asOf,
              intelligence: snapshot.intelligence,
              accounts: snapshot.accounts,
              invoices: snapshot.invoices
                .slice(0, 30)
                .map(
                  ({
                    title,
                    counterparty,
                    direction,
                    currency,
                    amount,
                    dueAt,
                    state,
                  }) => ({
                    title,
                    counterparty,
                    direction,
                    currency,
                    amount,
                    dueAt,
                    state,
                  }),
                ),
              payments: snapshot.requests
                .slice(0, 30)
                .map(({ asset, amount, network, state, evidence }) => ({
                  asset,
                  amount,
                  network,
                  state,
                  verified: !!evidence,
                  source: evidence?.source,
                })),
              bankConnection: "Coming soon; no authorized live bank connection",
              outgoingPayments: outgoing.slice(0, 20).map((p) =>
                p.privacy
                  ? { privacy: true, state: p.state, detailsWithheld: true }
                  : {
                      asset: p.asset,
                      amount: p.amount,
                      recipientLabel: p.recipientLabel,
                      state: p.state,
                      verified: !!p.evidence,
                    },
              ),
            },
      };
    },
  });
  // Model-selected proposals only. Exact addresses, credentials, approval and
  // signing remain in the authenticated owner/provider boundary.
  const {
    listPaymentPlans,
    getPaymentPlan,
    preparePaymentIntent,
    updatePaymentPlan,
    verifyOutgoingPayment,
  } = await import("../web-product/conversational-payments");
  const paymentContext = (await listPaymentPlans(owner))
    .filter((plan) => plan.conversationId === input.conversationId)
    .slice(0, 5)
    .map(({ id, recipientLabel, amount, asset, privacy, state }) => ({
      id,
      recipientLabel,
      amount,
      asset,
      privacy,
      state,
    }));
  let preparedPaymentPlanId: string | undefined;
  let preparedZcashInvoiceId: string | undefined;
  const PrepareDigital = z.strictObject({
    recipientLabel: z.string().trim().min(1).max(100).optional(),
    amount: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/)
      .optional(),
    asset: z
      .enum(["USDC", "ZEC", "BTC", "ETH", "SOL", "NGN", "USD"])
      .optional(),
    privacy: z.boolean().optional(),
    paymentPlanId: z.uuid().optional(),
  });
  tools.push({
    declaration: declaration(
      "read_digital_payment_capabilities",
      "Discover actual Pollar standard and Zcash private payment support before preparing a digital payment. Includes unavailable prerequisites. Never implies mainnet access or a cross-chain bridge.",
      Empty,
    ),
    schema: Empty,
    effect: "read",
    idempotent: true,
    async execute() {
      const { pollarConfiguration } = await import("../web-product/rails");
      return {
        summary:
          "Testnet payment capabilities. Only an owner-approved wallet can sign; no model spending tool exists.",
        data: {
          network: "testnet",
          pollar: {
            asset: "USDC",
            configured: pollarConfiguration().configured,
            standard: true,
            shielded: false,
          },
          zcash: {
            asset: "ZEC",
            shieldedRequests: true,
            supportedReceivingAddresses: [
              "Sapling testnet",
              "ZIP316 Unified testnet with Orchard/Sapling receivers",
            ],
            unifiedReceiptVerification:
              !!process.env.ZCASH_RECEIVE_SERVICE_URL &&
              !!process.env.ZCASH_RECEIVE_TOKEN,
            managedWalletAvailable:
              !!process.env.ZCASH_RECEIVE_SERVICE_URL &&
              !!process.env.ZCASH_RECEIVE_TOKEN,
            shieldedSending: false,
            receivingVerificationConfigured:
              !!process.env.ZCASH_WALLET_RPC_URL ||
              (!!process.env.ZCASH_RECEIVE_SERVICE_URL &&
                !!process.env.ZCASH_RECEIVE_TOKEN),
          },
          bankLinking: false,
          mainnet: false,
        },
      };
    },
  });
  const ReceiveZec = z.strictObject({
    title: z.string().trim().min(1).max(80),
    counterparty: z.string().trim().min(1).max(80),
    amount: z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/),
  });
  tools.push({
    declaration: declaration(
      "create_private_zec_invoice",
      "Create a private Testnet ZEC RECEIVING invoice for money owed to the user, with a fresh native-wallet-controlled Orchard Unified receiver and QR in the authenticated UI. This only requests payment and creates a reminder awaiting owner approval; it does not spend, sign, notify anyone or mark paid. Never ask for keys or invent an address. Requires title, counterparty and exact positive ZEC amount. Use for 'invoice', 'request payment', or 'make invoice' in English/Pidgin, not outgoing payments.",
      ReceiveZec,
    ),
    schema: ReceiveZec,
    effect: "proposal",
    idempotent: true,
    async execute(args, ctx) {
      const { createManagedInvoice } =
        await import("../zcash/managed-invoices");
      const h = createHash("sha256").update(ctx.key).digest("hex");
      const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
      const dueAt = new Date(
        new Date().toISOString().slice(0, 10) + "T12:00:00Z",
      );
      dueAt.setUTCDate(dueAt.getUTCDate() + 7);
      const saved = await createManagedInvoice(owner, {
        id,
        ...ReceiveZec.parse(args),
        direction: "receivable",
        currency: "ZEC",
        dueAt: dueAt.toISOString(),
        note: "",
      });
      preparedZcashInvoiceId = saved.invoice.id;
      return {
        summary:
          "Private ZEC invoice saved. Unpaid until the native receiving wallet independently verifies the exact amount and 3 confirmations. Address and QR are available only in the owner UI.",
        data: {
          invoiceId: saved.invoice.id,
          amount: saved.invoice.amount,
          currency: "ZEC",
          state: saved.invoice.state,
          receivingState: saved.request.state,
          reminderNeedsApproval: true,
        },
      };
    },
  });
  tools.push({
    declaration: declaration(
      "read_digital_payment_status",
      "Read the owner's saved digital payment status. For submitted payments, independently check network evidence. Prepared and approved states are not sent. No signing, retries or spending. IDs and sanitized terms are available in conversationPaymentReviews.",
      z.strictObject({ paymentPlanId: z.uuid() }),
    ),
    schema: z.strictObject({ paymentPlanId: z.uuid() }),
    effect: "read",
    idempotent: true,
    async execute(rawArgs) {
      const args = z.strictObject({ paymentPlanId: z.uuid() }).parse(rawArgs);
      let plan = await getPaymentPlan(owner, args.paymentPlanId);
      let verification = "No submitted transaction to check.";
      if (["submitting", "pending", "unknown"].includes(plan.state)) {
        try {
          plan = await verifyOutgoingPayment(owner, plan.id);
          verification =
            plan.state === "confirmed"
              ? "Independently verified on Stellar testnet."
              : "Not confirmed.";
        } catch {
          verification =
            "Independent confirmation is unavailable or pending. Do not resend.";
        }
      }
      return {
        summary: verification,
        data: {
          paymentPlanId: plan.id,
          state: plan.state,
          recipientLabel: plan.recipientLabel,
          amount: plan.amount,
          asset: plan.asset,
          privacy: plan.privacy,
          network: "testnet",
          confirmed: plan.state === "confirmed",
          blockers: plan.blockers,
        },
      };
    },
  });
  tools.push({
    declaration: declaration(
      "prepare_digital_payment",
      "Prepare a Pollar USDC standard payment or Zcash ZEC shielded review. Interpret English/Pidgin, typos and contextual revisions into structured recipientLabel, amount, asset and privacy. Do not guess ambiguous currencies or recipients: ask. For a correction, use paymentPlanId from conversationPaymentReviews; this invalidates prior quotes and approval. No execution, approval, wallet address or credential arguments. Never claim a request URI sends funds. Empty arguments retain the legacy extraction fallback only.",
      PrepareDigital,
    ),
    schema: PrepareDigital,
    effect: "proposal",
    idempotent: true,
    async execute(rawArgs, ctx) {
      const args = PrepareDigital.parse(rawArgs);
      const hash = createHash("sha256")
        .update(`${owner}:${ctx.key}`)
        .digest("hex");
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      let plan;
      if (args.paymentPlanId) {
        const previous = await getPaymentPlan(owner, args.paymentPlanId);
        if (previous.conversationId !== input.conversationId)
          throw new AppError(
            "Choose a payment in this conversation before revising it.",
            409,
          );
        const sameRecipient =
          (!args.recipientLabel ||
            args.recipientLabel === previous.recipientLabel) &&
          (!args.asset || args.asset === previous.asset);
        plan = await updatePaymentPlan(owner, previous.id, {
          recipientLabel: args.recipientLabel ?? previous.recipientLabel,
          recipientAddress: sameRecipient
            ? (previous.recipientAddress ?? "")
            : "",
          amount: args.amount ?? previous.amount ?? "",
          asset: args.asset ?? previous.asset ?? "UNSPECIFIED",
          privacy: !!input.privacyMode || (args.privacy ?? previous.privacy),
          saveContact: false,
        });
      } else {
        const structured = args.recipientLabel || args.amount || args.asset;
        const text = structured
          ? `Send ${args.recipientLabel ?? ""} ${args.amount ?? ""} ${args.asset ?? ""}${args.privacy || input.privacyMode ? " privately" : ""}${/\bmainnet\b/i.test(input.text) ? " on mainnet" : ""}`
          : input.text;
        plan = await preparePaymentIntent(
          owner,
          { id, text, privacyMode: !!input.privacyMode },
          "agent-prepared",
          input.conversationId,
        );
      }
      preparedPaymentPlanId = plan.id;
      return {
        summary:
          "A saved payment review is ready. No approval, signing or payment occurred.",
        data: {
          paymentPlanId: plan.id,
          state: plan.state,
          asset: plan.asset,
          privacy: plan.privacy,
          blockers: plan.blockers,
          recipientLabel: plan.recipientLabel,
          amount: plan.amount,
        },
        awaitingUser: true,
      };
    },
  });
  const financialReady = () =>
    process.env.FINANCIAL_DEMO_ENABLED === "true" &&
    config().mode === "fixture";
  const financial = async (
    signal: AbortSignal,
    preparation = false,
    focus?: string,
  ): Promise<ToolResult> => {
    if (input.privacyMode || !financialReady())
      return {
        summary:
          "Authorized personal-bank access is not configured. Ordinary planning and user-stated calculations remain available.",
        data: {
          state: "blocked",
          code: "BANK_PROVIDER_NOT_AUTHORIZED",
          requirement:
            "Authorized existing Nigerian personal SOURCE accounts, balance/history, and bank-controlled beneficiary payment initiation. No merchant-funded substitute or new wallet connection is claimed.",
        },
        awaitingUser: false,
      };
    const freshRequest = new Request(req.url, { headers: req.headers, signal });
    const capability = await authorizedFinancialAccess(freshRequest);
    const access = createRepositoryAccess(createDurableRepository(), () =>
      new Date().toISOString(),
    );
    const stamp = input.accountIds.length
      ? await access.check(capability.context, input.accountIds, [])
      : null;
    const focusedText = focus
      ? `${input.text}\nFinancial subtask selected by the coordinator (context, not new user facts): ${focus}`
      : input.text;
    if (focusedText.length > 4000)
      throw new ToolFailure("FOCUS_CONTEXT_LIMIT", "rejected");
    const reply = await financialConversationTurn(
      freshRequest,
      { ...input, text: focusedText },
      undefined,
      budgeted,
      !preparation,
    );
    const after = input.accountIds.length
      ? await access.check(capability.context, input.accountIds, [])
      : null;
    if (stamp?.version !== after?.version)
      throw new AgentError("ACCESS_CHANGED");
    return {
      summary: reply.handoff
        ? "Editable fixture payment preparation requested; human verification, approval and submission are separate."
        : "Financial specialist returned an answer; source fields and caveats are retained.",
      data: {
        kind: reply.kind,
        text: reply.text,
        citations: reply.citations,
        savings: reply.savings,
        simulated: true,
        accountAction: reply.accountAction,
        preparedOnly: !!reply.handoff,
      },
      reply,
      validation: stamp,
      awaitingUser:
        !!reply.handoff || !!reply.accountAction || reply.kind === "clarify",
    };
  };
  const validateFinancial = async (result: ToolResult) => {
    if (!result.validation) return;
    if (!financialReady()) throw new AgentError("FRESH_AUTHORIZATION_REQUIRED");
    const capability = await authorizedFinancialAccess(req);
    const current = await createRepositoryAccess(
      createDurableRepository(),
      () => new Date().toISOString(),
    ).check(capability.context, input.accountIds, []);
    if (current.version !== (result.validation as { version: string }).version)
      throw new AgentError("ACCESS_CHANGED");
  };
  const FinancialFocus = z.strictObject({
    focus: z.string().trim().min(1).max(1000).optional(),
  });
  tools.push({
    declaration: declaration(
      "analyze_finances",
      "Ask the existing secure financial specialist to handle the financial part of this user's current objective: authorized records, source-backed spending/transactions, savings and grounded financial calculations. It receives the original request, current server-selected accounts and fresh permissions, never model-invented identities. No bank provider is currently authorized; optional financial-demo records are explicitly fixtures. Read-only: cannot prepare or execute a payment. Optional focus selects a financial subquestion so several analyses can be composed; the original user objective is always supplied. Do not invent or restate amounts, identities or permissions in the focus.",
      FinancialFocus,
    ),
    schema: FinancialFocus,
    effect: "read",
    volatile: true,
    validate: validateFinancial,
    execute: (args, ctx) =>
      financial(ctx.signal, false, FinancialFocus.parse(args).focus),
  });
  if (financialReady())
    tools.push({
      declaration: declaration(
        "prepare_payment_draft",
        "Use the existing human-controlled fixture payment preparation/editing workflow for the original current user request. This creates no live bank connection, authorization or execution. Never substitute a provider wallet for a personal bank account.",
        Empty,
      ),
      schema: Empty,
      effect: "proposal",
      idempotent: false,
      volatile: true,
      validate: validateFinancial,
      execute: (_args, ctx) => financial(ctx.signal, true),
    });
  tools.push({
    declaration: declaration(
      "list_saved_runs",
      "Retrieve owner-scoped recent plans and execution progress across conversations. This retrieves status, never grants permission or proves an external outcome.",
      Empty,
    ),
    schema: Empty,
    effect: "read",
    async execute() {
      return {
        summary: "Recent saved work retrieved.",
        data: (await journal.list()).slice(0, 8).map((r) => ({
          goal: r.goal,
          conversationId: r.conversationId,
          ...report(r),
        })),
      };
    },
  });
  const [turns, saved] = await Promise.all([
    chatHistory(owner)
      .read(input.conversationId, 8)
      .catch((e) => {
        if (e instanceof AppError && e.status === 404) return [];
        throw e;
      }),
    workspace(owner).snapshot(),
  ]);
  const history = turns.flatMap((t) => [
    { role: "user" as const, text: t.text },
    {
      role: "assistant" as const,
      text:
        t.reply.kind === "financial" ||
        t.reply.presentation ||
        t.reply.payments ||
        t.reply.citations.length > 0 ||
        t.reply.savings?.source
          ? "[Historical financial reply; read current sources before using its facts.]"
          : t.reply.text,
    },
  ]);
  const context = {
    conversationPaymentReviews: paymentContext,
    confirmedUserStatements: saved.memories
      .filter((m) => m.confirmed)
      .slice(-8),
    unconfirmedProposals: saved.memories
      .filter((m) => !m.confirmed)
      .slice(-4)
      .map((m) => ({ id: m.id, category: m.category, confirmed: false })),
    responsibilities: saved.tasks
      .filter((t) => !["cancelled", "completed"].includes(t.state))
      .slice(0, 12)
      .map(({ id, title, objective, state, dueAt, scope }) => ({
        id,
        title,
        objective: objective.slice(0, 400),
        state,
        dueAt,
        scope,
      })),
    banking: {
      authorizedProviderConfigured: false,
      fixtureToolsAvailable: financialReady(),
    },
    externalActions: {
      communications: false,
      shopping: false,
      browsing: false,
    },
    selectedFinancialAccountIds: input.accountIds,
  };
  const reply = await createPersonalAgent({
    model: budgeted,
    journal,
    history: input.privacyMode ? [] : history,
    context: input.privacyMode
      ? {
          privacyMode: true,
          conversationPaymentReviews: paymentContext,
          disclosure:
            "Private mode omits saved conversation history, account details, memory and responsibility metadata. Only the current message, minimal pending terms for this conversation and minimized tool responses are provided. Wallet signing and approval remain outside the model. Zcash does not make Bitcoin private.",
        }
      : context,
    tools: input.privacyMode
      ? tools.filter((tool) =>
          [
            "calculate",
            "read_agus_financial_snapshot",
            "prepare_digital_payment",
            "read_digital_payment_capabilities",
            "read_digital_payment_status",
            "create_private_zec_invoice",
          ].includes(tool.declaration.name ?? ""),
        )
      : tools,
    signal: req.signal,
  }).run({ id: run.id, resume: !!input.resumeRunId });
  return {
    ...reply,
    ...(preparedZcashInvoiceId
      ? { zcashInvoiceId: preparedZcashInvoiceId }
      : {}),
    ...(preparedPaymentPlanId && reply.execution?.reason
      ? {
          text: "Your payment review is saved. Chat couldn’t finish the reply; please try again later.",
        }
      : {}),
    ...(preparedPaymentPlanId
      ? { digitalPaymentPlanId: preparedPaymentPlanId }
      : {}),
    evidence: { ...reply.evidence, modelCalls },
  };
}
