import { z } from "zod";
import { invariant } from "./errors";
export function pageInput(url: URL) {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .parse(url.searchParams.get("limit") ?? 25);
  const raw = url.searchParams.get("cursor");
  let after = "";
  if (raw) {
    invariant(raw.length <= 512, "INVALID_CURSOR", 400);
    try {
      after = z
        .string()
        .min(1)
        .max(200)
        .parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    } catch {
      invariant(false, "INVALID_CURSOR", 400);
    }
  }
  return { limit, after };
}
export function page<T extends { id: string }>(rows: T[], limit: number) {
  const data = rows.slice(0, limit);
  return {
    data,
    nextCursor:
      rows.length > limit
        ? Buffer.from(JSON.stringify(data.at(-1)!.id)).toString("base64url")
        : null,
  };
}
