import { personalTools } from "../agent-workspace/tools";
import { z } from "zod";
import { IdSchema } from "../financial-data/contracts";
import {
  ContextSchema,
  createConfiguredModel,
  createFinancialAgent,
  createRepositoryAccess,
  type AgentModel,
} from "../financial-agent";
import { authorizedFinancialAccess } from "./access";
import { createContextPersistence } from "./context-persistence";
import { createDurableRepository } from "./storage";
import { chatHistory } from "../chat-history/store";
import { operator } from "../auth";
import { AppError } from "../domain";
import { createModelLedAgent } from "../model-led-agent/agent";
import {
  createGeminiToolModel,
  type ToolModel,
} from "../model-led-agent/model";
import { turnDiagnostic } from "../model-led-agent/diagnostics";
import { SavingsMemorySchema } from "../model-led-agent/savings";
import { readState } from "../db";
import { editConversationDraft } from "../conversation-edits";
import { currentPaymentStatus } from "../payment-status";
import { provider } from "../paystack";

export const ConversationInput = z.strictObject({
  conversationId: IdSchema,
  text: z.string().trim().min(1).max(4000),
  requestId: z.uuid().optional(),
  resumeRunId: z.uuid().optional(),
  privacyMode: z.boolean().optional(),
  accountIds: z
    .array(IdSchema)
    .max(5)
    .refine((v) => new Set(v).size === v.length),
});

/** The HTTP route always uses the configured provider. Model injection is a
 * server-only test seam, never a request parameter or a fixture inference mode. */
export async function conversationTurn(
  req: Request,
  input: z.infer<typeof ConversationInput>,
  model?: AgentModel,
) {
  if (
    !model &&
    process.env.AGUS_AGENT_ARCHITECTURE === "native-gemini" &&
    process.env.AGUS_WORKSPACE_ENABLED === "true"
  ) {
    const { runPersonalConversation } =
      await import("../personal-agent/conversation");
    return runPersonalConversation(req, input);
  }
  return financialConversationTurn(req, input, model);
}

export async function financialConversationTurn(
  req: Request,
  input: z.infer<typeof ConversationInput>,
  model?: AgentModel,
  specialistModel?: ToolModel,
  readOnly = false,
) {
  if (input.privacyMode)
    throw new AppError(
      "Detailed financial-source tools are withheld in Privacy Mode. Use the personal agent’s minimized snapshot or the trusted owner view.",
      403,
    );
  const capability = await authorizedFinancialAccess(req);
  const clock = () => new Date().toISOString();
  const {
    requestId: ignoredRequest,
    resumeRunId: ignoredResume,
    privacyMode: ignoredPrivacy,
    ...parsed
  } = ConversationInput.parse(input);
  void ignoredRequest;
  void ignoredResume;
  void ignoredPrivacy;
  const owner = await operator(req);
  const state = await readState();
  const messages = state.messages.filter(
    (m) => m.owner === owner && m.conversationId === parsed.conversationId,
  );
  const batchIds = new Set(messages.map((m) => m.batchId));
  if (messages.length && !readOnly) {
    const edited = await editConversationDraft(
      owner,
      parsed.text,
      {
        ...state,
        messages,
        batches: state.batches.filter(
          (b) => b.owner === owner && batchIds.has(b.id),
        ),
      },
      true,
    );
    if (edited)
      return {
        kind:
          edited.proposals.length || edited.batchId
            ? ("handoff" as const)
            : ("clarify" as const),
        text: edited.reply,
        citations: [],
        ...(edited.proposals.length || edited.batchId
          ? { handoff: { kind: "existing_payment_draft" as const } }
          : {}),
        paymentDraftId: edited.messageId,
        evidence: { modelCalls: 0, toolCalls: 0, resultBytes: 0 },
      };
  }
  // Display history can supply dialogue after the short-lived tool context
  // expires. Owner is session-derived; facts/selections are never rehydrated.
  const turns = await chatHistory(await operator(req))
    .read(parsed.conversationId, 8)
    .catch((error) => {
      if (error instanceof AppError && error.status === 404) return [];
      throw error;
    });
  const dialogue = turns.flatMap((turn) => [
    { role: "user" as const, text: turn.text },
    {
      role: "assistant" as const,
      text:
        turn.reply.kind === "general" ||
        turn.reply.kind === "product" ||
        (turn.reply.kind === "clarify" && !turn.reply.citations.length)
          ? turn.reply.text
          : `[${turn.reply.kind} response; re-read current sources for facts]`,
    },
  ]);
  const options = {
    paymentStatus: async (args: unknown) =>
      currentPaymentStatus(
        owner,
        parsed.conversationId,
        args,
        await provider().banks(),
      ),
    // Owner-scoped server history restores parameters after tool context expiry.
    // Never restore an old balance value as authority: source plans keep only
    // the account/field hint, and the next turn must read current sources.
    savingsHint: (() => {
      const saved = [...turns].reverse().find((t) => t.reply.savings)
        ?.reply.savings;
      if (!saved) return undefined;
      const parsed = SavingsMemorySchema.safeParse({
        target: saved.target,
        contribution: saved.contribution,
        cadence: saved.cadence,
        starting: saved.source
          ? {
              kind: "balance",
              accountId: saved.source.accountId,
              field: saved.source.field,
            }
          : { kind: "amount", value: saved.startingAmount },
      });
      return parsed.success ? parsed.data : undefined;
    })(),
    tools: capability.tools,
    access: createRepositoryAccess(createDurableRepository(), clock),
    store: createContextPersistence(
      capability.context,
      ContextSchema.parse,
      clock,
      { renewExpired: true },
    ),
    clock,
    dialogue,
    signal: req.signal,
  };
  // Explicit server flag keeps the repaired baseline available throughout
  // evaluation/rollback. Client input never selects a provider or architecture.
  const agent =
    !model && process.env.AGUS_AGENT_ARCHITECTURE === "native-gemini"
      ? createModelLedAgent({
          ...options,
          model: specialistModel ?? createGeminiToolModel(),
          readOnly,
          workspace: specialistModel ? undefined : personalTools(owner),
        })
      : createFinancialAgent({
          ...options,
          model: model ?? createConfiguredModel(),
        });
  const started = performance.now();
  const reply = await agent.turn({
    ...parsed,
    ctx: capability.context,
    // Requested IDs confer no permission. B checks ownership, consent and source
    // revisions before planning/reads; education never resolves account grants.
  });
  if (!model && process.env.AGUS_AGENT_ARCHITECTURE === "native-gemini")
    console.info(
      JSON.stringify(turnDiagnostic(reply, performance.now() - started)),
    );
  return reply;
}
