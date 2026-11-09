import { z } from "zod";
import { operator, sameOrigin, checkPassword } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { service } from "@/lib/solana";
import { SolanaError } from "@/lib/solana/contracts";
import {
  workspaceBody,
  workspaceError,
  workspaceResponse,
} from "@/lib/agent-workspace/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const key = z.string().min(32).max(44);
const Input = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("discover"), wallet: key }),
  z.strictObject({
    action: z.literal("prepare"),
    sender: key,
    recipient: key,
    asset: z.enum(["SOL", "SPL"]),
    amount: z.string().min(1).max(40),
    mint: key.optional(),
  }),
  z.strictObject({
    action: z.literal("approve"),
    id: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    acknowledged: z.literal(true),
    password: z.string().min(1).max(256),
  }),
  z.strictObject({
    action: z.literal("submit"),
    id: z.uuid(),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    signedTransactionBase64: z.string().min(1).max(4096),
  }),
  z.strictObject({ action: z.enum(["reconcile", "cancel"]), id: z.uuid() }),
]);
function failure(error: unknown) {
  return error instanceof SolanaError
    ? workspaceResponse(
        { error: error.message, code: error.code },
        error.status,
      )
    : workspaceError(error);
}
export async function GET(req: Request) {
  try {
    return workspaceResponse({
      drafts: await service().list(await operator(req)),
    });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const owner = await operator(req);
    const input = Input.parse(await workspaceBody(req));
    const solana = service();
    let result: unknown;
    if (input.action === "discover")
      result = await solana.discoverWallet(owner, input.wallet);
    else if (input.action === "prepare") {
      const { action: ignored, ...args } = input;
      void ignored;
      result = await solana.prepare(owner, args);
    } else if (input.action === "approve") {
      // Reuse existing password verification. Model tools never expose this action.
      const stored = process.env.OPERATOR_PASSWORD_HASH;
      if (!stored || !checkPassword(input.password, stored))
        throw new AppError("Approval password rejected", 403);
      result = await solana.approve(owner, input.id, {
        digest: input.digest,
        acknowledged: true,
      });
    } else if (input.action === "submit")
      result = await solana.submitSigned(owner, input.id, {
        digest: input.digest,
        signedTransactionBase64: input.signedTransactionBase64,
      });
    else if (input.action === "reconcile")
      result = await solana.reconcile(owner, input.id);
    else result = await solana.cancel(owner, input.id);
    return workspaceResponse({ result });
  } catch (error) {
    return failure(error);
  }
}
