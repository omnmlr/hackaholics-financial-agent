import { randomUUID } from "node:crypto";
import { database, transaction, type Sql } from "./sql";
import { invariant } from "./errors";
export type Job = {
  id: string;
  owner: string;
  kind: string;
  effect_key: string;
  payload: Record<string, unknown>;
  fence: string;
  lease_owner: string;
  attempts: number;
};
export async function enqueue(
  sql: Sql,
  owner: string,
  kind: string,
  effectKey: string,
  payload: Record<string, unknown>,
) {
  const r = await sql.query(
    "INSERT INTO agus_jobs(id,owner,kind,effect_key,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT(effect_key) DO NOTHING RETURNING id",
    [randomUUID(), owner, kind, effectKey, JSON.stringify(payload)],
  );
  return r.rows[0]?.id ?? null;
}
export async function claim(
  worker: string,
  leaseSeconds = 30,
  kind?: string,
): Promise<Job | null> {
  invariant(leaseSeconds >= 1 && leaseSeconds <= 300, "INVALID_LEASE", 400);
  return transaction(async (sql) => {
    const r = await sql.query<Job>(
      `WITH candidate AS (
      SELECT id FROM agus_jobs WHERE ((state='ready' AND available_at<=now()) OR (state='leased' AND lease_until<=now())) AND ($3::text IS NULL OR kind=$3) ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE agus_jobs SET state='leased',lease_owner=$1,lease_until=now()+$2*interval '1 second',fence=fence+1,attempts=attempts+1
      WHERE id=(SELECT id FROM candidate) RETURNING *`,
      [worker, leaseSeconds, kind ?? null],
    );
    return r.rows[0] ?? null;
  });
}
export async function finish(sql: Sql, job: Job) {
  const r = await sql.query(
    "UPDATE agus_jobs SET state='done',lease_until=NULL WHERE id=$1 AND state='leased' AND lease_owner=$2 AND fence=$3 AND lease_until>now() RETURNING id",
    [job.id, job.lease_owner, job.fence],
  );
  invariant(r.rows.length === 1, "JOB_FENCE_REJECTED");
}
export async function retry(job: Job, code: string) {
  invariant(/^[A-Z_]{1,80}$/.test(code), "INVALID_ERROR_CODE", 400);
  await (
    await database()
  ).query(
    "UPDATE agus_jobs SET state=CASE WHEN attempts>=8 THEN 'dead' ELSE 'ready' END,available_at=now()+least(3600,power(2,attempts)::integer)*interval '1 second',lease_until=NULL,last_error=$4 WHERE id=$1 AND lease_owner=$2 AND fence=$3 AND state='leased' AND lease_until>now()",
    [job.id, job.lease_owner, job.fence, code],
  );
}
export async function deliverNotification(job: Job) {
  await transaction(async (sql) => {
    await finish(sql, job);
    await sql.query(
      "INSERT INTO agus_notifications(owner,id,effect_key,resource_type,resource_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(effect_key) DO NOTHING",
      [
        job.owner,
        randomUUID(),
        job.effect_key,
        job.payload.resourceType,
        job.payload.resourceId,
      ],
    );
  });
}
export async function jobMetrics() {
  return (
    await (
      await database()
    ).query(
      "SELECT state,count(*)::integer AS count FROM agus_jobs GROUP BY state",
    )
  ).rows;
}
