import { z } from "zod";
import type { FunctionDeclaration } from "@google/genai";
import type { AgentReply } from "../financial-agent/agent";
import { workspace, TaskInput, MemoryInput } from "./store";
import { service } from "../solana";
import type { WorkspaceAction } from "./artifacts";

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
      let text: string;
      let action: WorkspaceAction;
      if (name === "read_agent_workspace") {
        const saved = await workspace(owner).snapshot();
        const notes = saved.memories
          .slice(0, 10)
          .map(
            (m) =>
              `${m.confirmed ? "User-confirmed statement" : "Unconfirmed proposal"}: ${m.text.slice(0, 300)}`,
          )
          .join("\n");
        const responsibilities = saved.tasks
          .slice(0, 20)
          .map(
            (t) =>
              `${t.id}: ${t.title.slice(0, 120)}; ${t.state}; due ${t.dueAt}; scope ${t.scope}`,
          )
          .join("\n");
        text = `Your saved workspace has ${saved.tasks.length} retrieved responsibilities and ${saved.memories.length} retrieved memory notes (up to 100 each). Memory is attributed context, never verified financial data.${notes ? "\n" + notes : ""}${responsibilities ? "\nSaved responsibilities (bounded):\n" + responsibilities : ""}`;
        action = { kind: "overview" };
      } else if (name === "save_memory_proposal") {
        const memory = await workspace(owner).proposeMemory(input);
        text =
          "Memory proposed. Please confirm the statement or forget it below; it is not yet confirmed.";
        action = { kind: "memory", id: memory.id };
      } else if (name === "prepare_responsibility") {
        const task = await workspace(owner).createTask(input);
        text =
          "Responsibility prepared, awaiting your approval below. Only an in-app reminder is supported; no external action occurred.";
        action = { kind: "responsibility", id: task.id };
      } else if (name === "solana_wallet_balances") {
        const wallet = await service().discoverWallet(
          owner,
          (input as { wallet: string }).wallet,
        );
        text =
          "Solana devnet RPC observations are shown below with their observation time. These are test assets, not production funds or dollars.";
        action = { kind: "wallet", wallet };
      } else if (name === "solana_prepare_transfer") {
        const draft = await service().prepare(
          owner,
          input as z.infer<typeof definitions.solana_prepare_transfer.schema>,
        );
        text =
          "Unsigned devnet transaction prepared. Review its exact recipient, amount and fee below. Nothing was approved, signed or submitted.";
        action = { kind: "solana", id: draft.id };
      } else {
        const draft = await service().reconcile(
          owner,
          (input as { id: string }).id,
        );
        text = `The devnet record is ${draft.state}. ${draft.confirmation ? "The matching on-chain transaction was verified." : "This is not evidence of completed execution."}`;
        action = { kind: "solana", id: draft.id };
      }
      return {
        kind: "general",
        text,
        workspace: action,
        citations: [],
        evidence: { modelCalls: 0, toolCalls: 1, resultBytes: 0 },
      };
    },
  };
}
