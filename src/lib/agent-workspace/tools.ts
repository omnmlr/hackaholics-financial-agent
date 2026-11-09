import { z } from "zod";
import type { FunctionDeclaration } from "@google/genai";
import type { AgentReply } from "../financial-agent/agent";
import { workspace, TaskInput, MemoryInput } from "./store";
import { service } from "../solana";

const definitions = {
  read_agent_workspace: {
    description:
      "Read owned saved responsibilities and attributed memory. Pending memory is unconfirmed; no memory is current bank evidence. No external actions.",
    schema: z.strictObject({}),
  },
  save_memory_proposal: {
    description:
      "Propose a personal note, preference, commitment or agreement explicitly requested by the user. It remains unconfirmed until the user confirms it in the workspace. Never save secrets or assert bank truth.",
    schema: MemoryInput,
  },
  prepare_responsibility: {
    description:
      "Prepare an in-app reminder or recurring follow-up. dueAt is an explicit ISO8601 timestamp; clarify missing dates, do not invent deadlines. The user must approve activation in the workspace. No calls, purchases, bank reads or external messages are scheduled.",
    schema: TaskInput,
  },
  solana_wallet_balances: {
    description:
      "Read real Solana DEVNET RPC SOL and supported test-token balances for the user's supplied public address. These tokens have no asserted USD/NGN value. Never request private keys or seed words.",
    schema: z.strictObject({ wallet: z.string().min(32).max(44) }),
  },
  solana_prepare_transfer: {
    description:
      "Prepare an unsigned Solana DEVNET transfer from the exact user-supplied sender to recipient for exact decimal-string amount, SOL or classic SPL mint. No signing or submission. Human review, server approval and user-controlled wallet signature remain required.",
    schema: z.strictObject({
      sender: z.string().min(32).max(44),
      recipient: z.string().min(32).max(44),
      amount: z.string().min(1).max(40),
      asset: z.enum(["SOL", "SPL"]),
      mint: z.string().min(32).max(44).optional(),
    }),
  },
  solana_transaction_status: {
    description:
      "Reconcile an owned prepared devnet transaction by draft ID. Read-only; unknown/pending never means success. Does not resend or sign.",
    schema: z.strictObject({ id: z.uuid() }),
  },
};
export function personalTools(owner: string) {
  const enabled = Object.entries(definitions).filter(([name]) =>
    name.startsWith("solana_")
      ? process.env.AGUS_SOLANA_DEVNET_ENABLED === "true"
      : process.env.AGUS_WORKSPACE_ENABLED === "true",
  );
  if (!enabled.length) return undefined;
  const declarations = enabled.map(
    ([name, definition]): FunctionDeclaration => {
      const { $schema: ignored, ...parametersJsonSchema } = z.toJSONSchema(
        definition.schema,
      );
      void ignored;
      return {
        name,
        description: definition.description,
        parametersJsonSchema,
      };
    },
  );
  return {
    declarations,
    async execute(name: string, args: unknown): Promise<AgentReply> {
      const definition = enabled.find(([key]) => key === name)?.[1];
      if (!definition) throw new Error("Tool unavailable");
      const input = definition.schema.parse(args);
      let data: unknown, text: string;
      if (name === "read_agent_workspace") {
        data = await workspace(owner).snapshot();
        text =
          "Saved workspace; memory is attributed context, not verified financial data.";
      } else if (name === "save_memory_proposal") {
        data = await workspace(owner).proposeMemory(input);
        text =
          "Memory proposed. Confirm or forget it in /responsibilities. It is not yet confirmed.";
      } else if (name === "prepare_responsibility") {
        data = await workspace(owner).createTask(input);
        text =
          "Responsibility prepared, awaiting your approval in /responsibilities. Only an in-app reminder is supported; no external action occurred.";
      } else if (name === "solana_wallet_balances") {
        data = await service().discoverWallet(
          owner,
          (input as { wallet: string }).wallet,
        );
        text =
          "Solana devnet RPC observations; not production funds, dollars or a fiat conversion.";
      } else if (name === "solana_prepare_transfer") {
        data = await service().prepare(
          owner,
          input as z.infer<typeof definitions.solana_prepare_transfer.schema>,
        );
        text =
          "Unsigned devnet transaction prepared. Review exact recipient, amount and fee at /devnet. Nothing was approved, signed or submitted.";
      } else {
        data = await service().reconcile(owner, (input as { id: string }).id);
        text =
          "Current devnet transaction record; unresolved status is not confirmation.";
      }
      return {
        kind: "general",
        text: `${text}\n${JSON.stringify(data)}`,
        citations: [],
        evidence: { modelCalls: 0, toolCalls: 1, resultBytes: 0 },
      };
    },
  };
}
