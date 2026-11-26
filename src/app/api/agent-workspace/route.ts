import { z } from "zod";
import { operator, sameOrigin } from "@/lib/auth";
import {
  workspaceBody,
  workspaceError,
  workspaceResponse,
} from "@/lib/agent-workspace/http";
import { workspace, TaskInput, MemoryInput } from "@/lib/agent-workspace/store";

import {
  FollowupInput,
  prepareSolanaFollowup,
} from "@/lib/agent-workspace/solana-followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create_task"), input: TaskInput }),
  z.strictObject({
    action: z.literal("prepare_solana_followup"),
    input: FollowupInput,
  }),
  z.strictObject({ action: z.literal("propose_memory"), input: MemoryInput }),
  z.strictObject({
    action: z.enum(["approve", "pause", "resume", "cancel"]),
    id: z.uuid(),
    version: z.number().int().min(0),
    acknowledged: z.literal(true),
  }),
  z.strictObject({
    action: z.enum(["confirm_memory", "forget_memory"]),
    id: z.uuid(),
    acknowledged: z.literal(true),
  }),
  z.strictObject({
    action: z.literal("run_due"),
    acknowledged: z.literal(true),
  }),
]);
export async function GET(req: Request) {
  try {
    return workspaceResponse(await workspace(await operator(req)).snapshot());
  } catch (error) {
    return workspaceError(error);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const owner = await operator(req);
    const store = workspace(owner);
    const input = Input.parse(await workspaceBody(req));
    let result: unknown;
    if (input.action === "create_task")
      result = await store.createTask(input.input);
    else if (input.action === "prepare_solana_followup")
      result = await prepareSolanaFollowup(owner, input.input);
    else if (input.action === "propose_memory")
      result = await store.proposeMemory(input.input);
    else if (input.action === "run_due") result = await store.runDue();
    else if (
      input.action === "confirm_memory" ||
      input.action === "forget_memory"
    )
      result = await store.memoryAction(
        input.id,
        input.action === "confirm_memory" ? "confirm" : "forget",
      );
    else if ("version" in input)
      result = await store.transition(input.id, input.version, input.action);
    return workspaceResponse({ result });
  } catch (error) {
    return workspaceError(error);
  }
}
