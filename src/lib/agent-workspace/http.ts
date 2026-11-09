import { z } from "zod";
import { AppError } from "../domain";
export const workspaceResponse = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      Vary: "Cookie, Origin",
    },
  });
export function workspaceError(error: unknown) {
  return workspaceResponse(
    {
      error:
        error instanceof AppError
          ? error.message
          : error instanceof z.ZodError || error instanceof SyntaxError
            ? "Invalid request"
            : "Workspace unavailable",
    },
    error instanceof AppError
      ? error.status
      : error instanceof z.ZodError || error instanceof SyntaxError
        ? 400
        : 503,
  );
}
export async function workspaceBody(req: Request): Promise<unknown> {
  if (
    req.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
  )
    throw new AppError("JSON required", 415);
  const reader = req.body?.getReader();
  if (!reader) throw new SyntaxError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16384) {
      await reader.cancel();
      throw new AppError("Request too large", 413);
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
