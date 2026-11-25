import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../lib/domain";
import { SolanaError } from "../lib/solana/contracts";
import { operationalEvent } from "./observability";
export class DomainError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public retryable = false,
  ) {
    super(code);
  }
}
export function invariant(
  value: unknown,
  code: string,
  status = 409,
): asserts value {
  if (!value) throw new DomainError(code, status);
}
export function reply(
  data: unknown,
  status = 200,
  correlationId = randomUUID(),
) {
  return Response.json(data, {
    status,
    headers: {
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "x-correlation-id": correlationId,
      vary: "Cookie, Origin",
    },
  });
}
export async function endpoint(fn: () => Promise<unknown>) {
  const correlationId = randomUUID();
  const started = Date.now();
  try {
    const result = await fn();
    operationalEvent("api.completed", {
      correlationId,
      durationMs: Date.now() - started,
    });
    if (result instanceof Response) {
      const headers = new Headers(result.headers);
      headers.set("x-correlation-id", correlationId);
      return new Response(result.body, { status: result.status, headers });
    }
    return reply(result, 200, correlationId);
  } catch (error) {
    const known = error instanceof DomainError || error instanceof SolanaError;
    const legacy = error instanceof AppError;
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    operationalEvent("api.rejected", {
      correlationId,
      code: known
        ? error.code
        : invalid
          ? "INVALID_REQUEST"
          : "ACTION_UNAVAILABLE",
      durationMs: Date.now() - started,
    });
    return reply(
      {
        error: {
          code: known
            ? error.code
            : legacy
              ? error.status === 404
                ? "NOT_FOUND"
                : error.status === 409
                  ? "REVISION_CONFLICT"
                  : "ACTION_REJECTED"
              : invalid
                ? "INVALID_REQUEST"
                : "SERVICE_UNAVAILABLE",
          retryable:
            error instanceof DomainError
              ? error.retryable
              : !known && !legacy && !invalid,
          correlationId,
        },
      },
      known || legacy ? error.status : invalid ? 400 : 503,
      correlationId,
    );
  }
}
export async function requestBytes(req: Request, maxBytes: number) {
  invariant(req.body, "BODY_REQUIRED", 400);
  if (Number(req.headers.get("content-length")) > maxBytes)
    throw new DomainError("BODY_TOO_LARGE", 413);
  const reader = req.body.getReader(),
    chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new DomainError("BODY_TOO_LARGE", 413);
    }
    chunks.push(part.value);
  }
  return Buffer.concat(chunks);
}
export async function jsonText(req: Request) {
  invariant(
    req.headers.get("content-type")?.split(";")[0] === "application/json",
    "JSON_REQUIRED",
    415,
  );
  return (await requestBytes(req, 16_384)).toString("utf8");
}
export async function body(req: Request) {
  return JSON.parse(await jsonText(req));
}
