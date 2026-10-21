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
import { createGeminiToolModel } from "../model-led-agent/model";

export const ConversationInput = z.strictObject({
  conversationId: IdSchema,
  text: z.string().trim().min(1).max(4000),
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
  const capability = await authorizedFinancialAccess(req);
  const clock = () => new Date().toISOString();
  const parsed = ConversationInput.parse(input);
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
      ? createModelLedAgent({ ...options, model: createGeminiToolModel() })
      : createFinancialAgent({
          ...options,
          model: model ?? createConfiguredModel(),
        });
  return agent.turn({
    ...parsed,
    ctx: capability.context,
    // Requested IDs confer no permission. B checks ownership, consent and source
    // revisions before planning/reads; education never resolves account grants.
  });
}
