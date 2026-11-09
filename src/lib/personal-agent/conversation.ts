import { z } from "zod";
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
import { redactAgentText } from "./privacy";
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
  const owner = await operator(req);
  const journal = runJournal(owner);
  const run = input.resumeRunId
    ? await journal.read(input.resumeRunId)
    : await journal.create({
        id: input.requestId,
        conversationId: input.conversationId,
        goal: input.text,
        accountIds: input.accountIds,
      });
  if (
    run.conversationId !== input.conversationId ||
    run.goal !== redactAgentText(input.text) ||
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
      return model.generate(args);
    },
  };
  const personal = personalTools(owner);
  const ResponsibilitySchema =
    personalToolDefinitions.prepare_responsibility.schema.omit({
      requestId: true,
    });
  const tools: AgentTool[] = (personal?.declarations ?? []).map((d) => ({
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
  const financialReady = () =>
    process.env.FINANCIAL_DEMO_ENABLED === "true" &&
    config().mode === "fixture";
  const financial = async (
    signal: AbortSignal,
    preparation = false,
    focus?: string,
  ): Promise<ToolResult> => {
    if (!financialReady())
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
    tools,
    history,
    context,
    signal: req.signal,
  }).run({ id: run.id, resume: !!input.resumeRunId });
  return { ...reply, evidence: { ...reply.evidence, modelCalls } };
}
