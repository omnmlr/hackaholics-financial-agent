import { createHash, randomUUID } from "node:crypto";
import { type State, type Batch, seedState } from "../lib/domain";
import type { Sql } from "./sql";

export async function writeLegacyFinancialState(sql: Sql, state: State) {
  for (const [batchOrdinal, batch] of state.batches.entries()) {
    const { payments, ...header } = batch;
    await sql.query(
      "INSERT INTO agus_legacy_batches(owner,id,status,revision,payload,ordinal) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner,id) DO UPDATE SET status=excluded.status,revision=excluded.revision,payload=excluded.payload,ordinal=excluded.ordinal WHERE agus_legacy_batches.payload IS DISTINCT FROM excluded.payload OR agus_legacy_batches.ordinal<>excluded.ordinal",
      [
        batch.owner,
        batch.id,
        batch.status,
        batch.version,
        JSON.stringify(header),
        batchOrdinal,
      ],
    );
    for (const [ordinal, payment] of payments.entries())
      await sql.query(
        "INSERT INTO agus_legacy_payments(owner,batch_id,id,reference,status,payload,ordinal) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner,id) DO UPDATE SET status=excluded.status,payload=excluded.payload,ordinal=excluded.ordinal WHERE agus_legacy_payments.payload IS DISTINCT FROM excluded.payload OR agus_legacy_payments.ordinal<>excluded.ordinal",
        [
          batch.owner,
          batch.id,
          payment.id,
          payment.reference,
          payment.status,
          JSON.stringify(payment),
          ordinal,
        ],
      );
    if (batch.approval?.consumedAt)
      await sql.query(
        "INSERT INTO agus_legacy_authority(owner,batch_id,digest,consumed_at,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          batch.owner,
          batch.id,
          batch.approval.digest,
          batch.approval.consumedAt,
          JSON.stringify(batch.approval),
        ],
      );
  }
  for (const [ordinal, entry] of state.audit.entries())
    await sql.query(
      "INSERT INTO agus_legacy_audit(id,actor,batch_id,ordinal,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [
        entry.id,
        entry.actor,
        entry.batchId ?? null,
        ordinal,
        JSON.stringify(entry),
      ],
    );
}
export async function hydrateLegacyFinancialState(
  sql: Sql,
  state: State,
): Promise<State> {
  const batches = await sql.query(
    "SELECT payload FROM agus_legacy_batches ORDER BY ordinal,id",
  );
  const payments = await sql.query(
    "SELECT owner,batch_id,payload FROM agus_legacy_payments ORDER BY batch_id,ordinal,id",
  );
  const audit = await sql.query(
    "SELECT payload FROM agus_legacy_audit ORDER BY ordinal,id",
  );
  return {
    ...state,
    batches: batches.rows.map(
      (r) =>
        ({
          ...r.payload,
          payments: payments.rows
            .filter(
              (p) => p.owner === r.payload.owner && p.batch_id === r.payload.id,
            )
            .map((p) => p.payload),
        }) as Batch,
    ),
    audit: audit.rows.map((r) => r.payload),
  };
}
/** One-time, transactional cutover. Archive is immutable application evidence;
 * unconsumed legacy approvals lose authority, submitted/unknown records do not. */
export async function normalizeLegacy(sql: Sql) {
  await sql.query("BEGIN");
  try {
    const archived = await sql.query(
      "SELECT id FROM agus_legacy_archive WHERE id='workflow_state:1'",
    );
    if (archived.rows.length) {
      await sql.query("COMMIT");
      return;
    }
    await sql.query(
      "INSERT INTO workflow_state(id,revision,payload) VALUES(1,0,$1) ON CONFLICT DO NOTHING",
      [JSON.stringify(seedState())],
    );
    const row = (
      await sql.query(
        "SELECT revision,payload FROM workflow_state WHERE id=1 FOR UPDATE",
      )
    ).rows[0];
    const original = row.payload as State,
      next = structuredClone(original);
    await sql.query(
      "INSERT INTO agus_legacy_archive(id,revision,payload,checksum) VALUES('workflow_state:1',$1,$2,$3)",
      [
        row.revision,
        JSON.stringify(original),
        createHash("sha256").update(JSON.stringify(original)).digest("hex"),
      ],
    );
    for (const batch of next.batches) {
      if (batch.approval && !batch.approval.consumedAt) {
        delete batch.approval;
        for (const payment of batch.payments)
          if (payment.status === "approved")
            payment.status = "awaiting_user_approval";
        if (batch.status === "approved")
          batch.status = "awaiting_user_approval";
        batch.version++;
      }
    }
    await writeLegacyFinancialState(sql, next);
    const drafts = await sql.query(
      "SELECT owner,id,payload FROM agus_solana_drafts WHERE state='approved' AND signature IS NULL AND payload->>'submission' IS NULL FOR UPDATE",
    );
    for (const row of drafts.rows) {
      const payload = {
        ...row.payload,
        state: "prepared",
        revision: row.payload.revision + 1,
        approval: null,
      };
      await sql.query(
        "UPDATE agus_solana_drafts SET state='prepared',revision=$3,payload=$4 WHERE owner=$1 AND id=$2",
        [row.owner, row.id, payload.revision, JSON.stringify(payload)],
      );
      await sql.query(
        "INSERT INTO agus_solana_events(id,owner,draft_id,action,at,details) VALUES($1,$2,$3,'legacy_approval_invalidated',now(),$4)",
        [
          randomUUID(),
          row.owner,
          row.id,
          JSON.stringify({ reason: "identity_storage_cutover" }),
        ],
      );
    }
    await sql.query(
      "UPDATE workflow_state SET payload=$1,revision=revision+1 WHERE id=1",
      [JSON.stringify({ ...next, batches: [], audit: [] })],
    );
    await sql.query("COMMIT");
  } catch (error) {
    await sql.query("ROLLBACK");
    throw error;
  }
}
