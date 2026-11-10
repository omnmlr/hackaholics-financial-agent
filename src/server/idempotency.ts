import { randomUUID } from "node:crypto";
import { instructionHash } from "./approvals";
import type { Sql } from "./sql";
import { invariant } from "./errors";
export function idempotencyKey(req: Request) {
  const key = req.headers.get("idempotency-key") ?? "";
  invariant(
    /^[a-zA-Z0-9_.:-]{8,128}$/.test(key),
    "IDEMPOTENCY_KEY_REQUIRED",
    400,
  );
  return key;
}
export async function operation(
  sql: Sql,
  owner: string,
  kind: string,
  key: string,
  input: unknown,
) {
  const hash = instructionHash(input),
    proposed = randomUUID();
  const inserted = await sql.query(
    "INSERT INTO agus_api_operations(owner,kind,idempotency_key,request_hash,resource_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING resource_id",
    [owner, kind, key, hash, proposed],
  );
  const row = (
    await sql.query(
      "SELECT request_hash,resource_id FROM agus_api_operations WHERE owner=$1 AND kind=$2 AND idempotency_key=$3 FOR UPDATE",
      [owner, kind, key],
    )
  ).rows[0];
  invariant(row.request_hash === hash, "IDEMPOTENCY_CONFLICT");
  return { id: row.resource_id as string, created: inserted.rows.length === 1 };
}
