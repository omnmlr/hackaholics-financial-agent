import { randomUUID, createHash } from "node:crypto";
import { identity, type Principal } from "./auth";
import { database, type Sql } from "./sql";
import { invariant } from "./errors";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const instructionHash = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
export async function issueStepUp(
  p: Principal,
  headers: Headers,
  action: string,
  digest: string,
  password: string,
  code: string,
) {
  invariant(p.twoFactorEnabled, "TOTP_ENROLLMENT_REQUIRED", 403);
  const sql = await database();
  // Persist the attempt budget before performing expensive authentication. New
  // sessions and process restarts cannot reset this per-user budget.
  const budget = await sql.query(
    "INSERT INTO auth_attempts(key,attempts,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.reset_at<=now() THEN 1 ELSE auth_attempts.attempts+1 END, reset_at=CASE WHEN auth_attempts.reset_at<=now() THEN now()+interval '15 minutes' ELSE auth_attempts.reset_at END RETURNING attempts",
    [`v1-step-up:${p.id}`],
  );
  invariant(budget.rows[0].attempts <= 10, "STEP_UP_THROTTLED", 429);
  try {
    const auth = await identity();
    await auth.api.verifyPassword({ headers, body: { password } });
    await auth.api.verifyTOTP({ headers, body: { code, trustDevice: false } });
  } catch {
    invariant(false, "STEP_UP_REJECTED", 403);
  }
  // TOTP endpoint success is an authentication observation. The separate
  // one-use capability below binds the exact action/instruction and session.
  const id = randomUUID();
  await sql.query(
    "INSERT INTO agus_step_up(id,owner,session_id,action,digest,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '2 minutes')",
    [id, p.id, p.sessionId, action, digest],
  );
  await sql.query("DELETE FROM auth_attempts WHERE key=$1", [
    `v1-step-up:${p.id}`,
  ]);
  return { id, action, digest, expiresInSeconds: 120 };
}
export async function consumeStepUp(
  sql: Sql,
  p: Principal,
  id: string,
  action: string,
  digest: string,
) {
  const r = await sql.query(
    "UPDATE agus_step_up SET consumed_at=now() WHERE id=$1 AND owner=$2 AND session_id=$3 AND action=$4 AND digest=$5 AND consumed_at IS NULL AND expires_at>now() AND EXISTS(SELECT 1 FROM agus_sessions WHERE id=$3 AND user_id=$2 AND expires_at>now()) RETURNING id",
    [id, p.id, p.sessionId, action, digest],
  );
  invariant(r.rows.length === 1, "APPROVAL_INVALID", 403);
}
