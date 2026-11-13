import { z } from "zod";
import { defaultPollarAdapter } from "@/lib/pollar/adapter";
import { defaultPollarService } from "@/lib/pollar/service";
import { operator, sameOrigin, reauthenticate } from "@/lib/auth";
import { workspaceBody, workspaceError, workspaceResponse } from "@/lib/agent-workspace/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Input = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("session"),
    chain: z.enum(["STELLAR", "SOLANA"]).optional(),
  }),
  z.strictObject({
    action: z.literal("balances"),
    chain: z.enum(["STELLAR", "SOLANA"]).optional(),
  }),
  z.strictObject({
    action: z.literal("prepare"),
    recipient: z.string().min(1),
    amount: z.string().min(1),
    asset: z.enum(["USDC", "XLM", "SOL"]).optional(),
    chain: z.enum(["STELLAR", "SOLANA"]).optional(),
    memo: z.string().max(100).optional(),
    reference: z.string().max(100).optional(),
  }),
  z.strictObject({
    action: z.literal("review"),
    draftId: z.string().min(1),
  }),
  z.strictObject({
    action: z.literal("approve_and_submit"),
    draftId: z.string().min(1),
    digest: z.string().min(32),
    password: z.string().min(1).optional(),
  }),
  z.strictObject({
    action: z.literal("verify"),
    hash: z.string().min(1),
    chain: z.enum(["STELLAR", "SOLANA"]).optional(),
  }),
  z.strictObject({
    action: z.literal("prerequisites"),
  }),
]);

export async function GET(req: Request) {
  try {
    const owner = await operator(req);
    const session = await defaultPollarAdapter.getWalletSession(owner);
    const balances = await defaultPollarAdapter.getBalances(owner, session.chain);
    const metadata = defaultPollarAdapter.getMetadata();
    const prerequisites = defaultPollarAdapter.getPrerequisites();

    return workspaceResponse({
      owner,
      session,
      balances,
      metadata,
      prerequisites,
    });
  } catch (error) {
    return workspaceError(error);
  }
}

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const owner = await operator(req);
    const input = Input.parse(await workspaceBody(req));

    if (input.action === "session") {
      const session = await defaultPollarAdapter.getWalletSession(owner);
      return workspaceResponse({ session });
    }

    if (input.action === "balances") {
      const balances = await defaultPollarAdapter.getBalances(owner, input.chain ?? "STELLAR");
      return workspaceResponse({ balances });
    }

    if (input.action === "prepare") {
      const result = await defaultPollarAdapter.prepareConversationalPayment(owner, {
        recipient: input.recipient,
        amount: input.amount,
        asset: input.asset,
        chain: input.chain,
        memo: input.memo,
        reference: input.reference,
      });
      return workspaceResponse(result);
    }

    if (input.action === "review") {
      const review = await defaultPollarAdapter.getReviewPayload(owner, input.draftId);
      return workspaceResponse({ review });
    }

    if (input.action === "approve_and_submit") {
      if (input.password) {
        await reauthenticate(owner, input.password);
      }
      const execution = await defaultPollarAdapter.authorizeAndExecute(
        owner,
        input.draftId,
        input.digest,
        true,
      );
      return workspaceResponse({ execution });
    }

    if (input.action === "verify") {
      const settlement = await defaultPollarAdapter.verifyPayment(input.hash, input.chain ?? "STELLAR");
      return workspaceResponse({ settlement });
    }

    if (input.action === "prerequisites") {
      return workspaceResponse(defaultPollarAdapter.getPrerequisites());
    }

    return workspaceError(new Error("Unsupported action"));
  } catch (error) {
    return workspaceError(error);
  }
}
