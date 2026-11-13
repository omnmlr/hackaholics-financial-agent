import { z } from "zod";
import { operator, sameOrigin } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import {
  workspaceBody,
  workspaceError,
  workspaceResponse,
} from "@/lib/agent-workspace/http";
import { runJournal } from "@/lib/personal-agent/journal";
import { report } from "@/lib/personal-agent/contracts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const Control = z.strictObject({
  action: z.enum(["pause", "cancel", "resume"]),
  id: z.uuid(),
  version: z.number().int().nonnegative(),
  acknowledged: z.literal(true),
});
export async function GET(req: Request) {
  try {
    if (req.headers.has("origin")) sameOrigin(req);
    if (req.headers.get("sec-fetch-site") === "cross-site")
      throw new AppError("Origin rejected", 403);
    const journal = runJournal(await operator(req));
    const params = new URL(req.url).searchParams;
    if (
      [...params.keys()].some((k) => k !== "id" && k !== "conversationId") ||
      params.getAll("id").length > 1 ||
      params.getAll("conversationId").length > 1
    )
      throw new AppError("Invalid query", 400);
    const id = params.get("id");
    const runs = id
      ? [await journal.read(id)]
      : await journal.list(params.get("conversationId") ?? undefined);
    return workspaceResponse({
      runs: runs.map((r) => ({
        conversationId: r.conversationId,
        version: r.version,
        goal: r.goal,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        ...report(r),
      })),
    });
  } catch (error) {
    return workspaceError(error);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const owner = await operator(req);
    const input = Control.parse(await workspaceBody(req));
    const journal = runJournal(owner);
    if (input.action !== "resume")
      return workspaceResponse({
        run: report(
          await journal.control(input.id, input.version, input.action),
        ),
      });
    const run = await journal.read(input.id);
    if (run.version !== input.version)
      throw new AppError("Run changed; refresh", 409);
    if (!["paused", "interrupted"].includes(run.state))
      throw new AppError("Only paused or interrupted work can resume", 409);
    const { POST: resumeConversation } = await import("../conversation/route");
    return resumeConversation(
      new Request(new URL("/api/conversation", req.url), {
        method: "POST",
        headers: req.headers,
        signal: req.signal,
        body: JSON.stringify({
          conversationId: run.conversationId,
          text: run.goal,
          accountIds: run.accountIds,
          resumeRunId: run.id,
          ...(run.privacyMode ? { privacyMode: true } : {}),
        }),
      }),
    );
  } catch (error) {
    return workspaceError(error);
  }
}
