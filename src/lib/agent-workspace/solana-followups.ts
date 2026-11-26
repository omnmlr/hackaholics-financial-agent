import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../domain";
import { service } from "../solana";
import { requireDevnet, type SolanaDraft } from "../solana/contracts";
import { initializeWorkspace, workspace, type Responsibility } from "./store";

export const FollowupInput = z.strictObject({ id: z.uuid() });
const pending = new Set(["submitting", "submitted", "unknown"]);
const scope = "solana_devnet_reconciliation_only";
type Reconcile = (owner: string, id: string) => Promise<SolanaDraft>;

/** Proposes only a read-only responsibility for an already signed/submitted owned draft. */
export async function prepareSolanaFollowup(
  owner: string,
  raw: unknown,
  get = service().get,
  now = new Date(),
) {
  requireDevnet();
  workspace(owner); // Authenticate the owner shape before reading or storing anything.
  const { id } = FollowupInput.parse(raw);
  const d = await initializeWorkspace();
  const saved = await d.execute(
    sql`SELECT payload FROM agus2_tasks WHERE owner=${owner} AND id=${id}`,
  );
  const existingTask = saved.rows[0]?.payload as Responsibility | undefined;
  if (existingTask) {
    if (existingTask.scope !== scope || existingTask.watch?.draftId !== id)
      throw new AppError("Request identity is already in use", 409);
    return existingTask; // Retry cannot reopen or extend a completed/cancelled responsibility.
  }
  const draft = await get(owner, id);
  if (
    draft.owner !== owner ||
    draft.id !== id ||
    draft.network !== "devnet" ||
    !draft.submission ||
    !pending.has(draft.state)
  )
    throw new AppError(
      "Only your unresolved submitted devnet transaction can be followed up",
      409,
    );
  const task: Responsibility = {
    id,
    version: 0,
    state: "awaiting_approval",
    scope,
    title: "Verify devnet transaction outcome",
    objective: `Read only saved devnet draft ${id} and save an in-app status update. Never sign, submit, resend, pay or send an external message.`,
    dueAt: now.toISOString(),
    createdAt: now.toISOString(),
    watch: {
      draftId: id,
      expiresAt: new Date(now.getTime() + 86400000).toISOString(),
      attempts: 0,
    },
  };
  const inserted = await d.execute(
    sql`INSERT INTO agus2_tasks(owner,id,state,due_at,payload) VALUES (${owner},${id},${task.state},${task.dueAt}::timestamptz,${JSON.stringify(task)}::jsonb) ON CONFLICT DO NOTHING RETURNING payload`,
  );
  if (inserted.rows.length) return task;
  const existing = await d.execute(
    sql`SELECT payload FROM agus2_tasks WHERE owner=${owner} AND id=${id}`,
  );
  const original = existing.rows[0]?.payload as Responsibility | undefined;
  if (original?.scope !== scope || original.watch?.draftId !== id)
    throw new AppError("Request identity is already in use", 409);
  return original; // One responsibility per draft, including after pause/cancel/completion.
}

/** Bounded leased reads outside SQL transactions. Version CAS makes pause/cancel win races.
 * The injected capability is reconciliation only: no wallet, signing or send capability. */
export async function runSolanaFollowups(
  owner: string,
  reconcile: Reconcile = (owner, id) => service().reconcile(owner, id),
  now = new Date(),
) {
  requireDevnet();
  workspace(owner);
  const d = await initializeWorkspace();
  const result = {
    checked: 0,
    notified: 0,
    deferred: 0,
    financialExecutions: 0,
    externalMessages: 0,
  };
  const rows = await d.execute(
    sql`SELECT payload FROM agus2_tasks WHERE owner=${owner} AND state='active' AND payload->>'scope'=${scope} AND due_at <= ${now.toISOString()}::timestamptz ORDER BY due_at,id LIMIT 3`,
  );
  for (const row of rows.rows) {
    const previous = row.payload as Responsibility;
    if (!previous.watch) continue;
    const claimed: Responsibility = {
      ...previous,
      version: previous.version + 1,
      dueAt: new Date(now.getTime() + 120000).toISOString(),
      watch: { ...previous.watch, attempts: previous.watch.attempts + 1 },
    };
    const claim = await d.transaction(async (tx) => {
      const won = await tx.execute(
        sql`UPDATE agus2_tasks SET version=${claimed.version},due_at=${claimed.dueAt}::timestamptz,payload=${JSON.stringify(claimed)}::jsonb WHERE owner=${owner} AND id=${previous.id} AND version=${previous.version} AND state='active' RETURNING id`,
      );
      if (!won.rows.length) return false;
      await tx.execute(
        sql`INSERT INTO agus2_events VALUES (${owner},${randomUUID()},${previous.id},'devnet_followup_leased',${now.toISOString()}::timestamptz)`,
      );
      return true;
    });
    if (!claim) continue;
    let terminal = false;
    let evidence = "No verified completion. Devnet status remains unresolved.";
    const watch = { ...claimed.watch!, checkedAt: now.toISOString() };
    if (now.getTime() >= Date.parse(watch.expiresAt) || watch.attempts > 32) {
      terminal = true;
      watch.failureCode = "FOLLOWUP_LIMIT_REACHED";
      evidence =
        "The bounded follow-up window ended without a verified outcome. Check the saved draft manually; never resend solely because it is unresolved.";
    } else {
      try {
        result.checked++;
        const draft = await reconcile(owner, watch.draftId);
        if (
          draft.owner !== owner ||
          draft.id !== watch.draftId ||
          draft.network !== "devnet" ||
          !draft.submission
        )
          throw new Error("Invalid reconciliation scope");
        watch.observedState = draft.state;
        watch.signature = draft.submission.signature;
        delete watch.failureCode;
        if (
          (draft.state === "confirmed" || draft.state === "finalized") &&
          draft.confirmation
        ) {
          terminal = true;
          watch.confirmation = {
            slot: draft.confirmation.slot,
            commitment: draft.confirmation.commitment,
            feeLamports: draft.confirmation.feeLamports,
          };
          evidence = `Matching signed devnet transaction verified ${draft.confirmation.commitment} at slot ${draft.confirmation.slot}. This is test-network evidence, not a fiat payment.`;
        } else if (draft.state === "failed") {
          terminal = true;
          watch.failureCode = draft.failureCode ?? "ON_CHAIN_FAILURE";
          evidence =
            "The saved devnet transaction has a verified on-chain failure. It was not resent.";
        }
      } catch {
        // Never store provider error bodies/logs. A failed read cannot establish success.
        watch.failureCode = "RECONCILIATION_UNAVAILABLE";
        result.deferred++;
      }
    }
    const next: Responsibility = {
      ...claimed,
      version: claimed.version + 1,
      state: terminal ? "completed" : "active",
      dueAt: new Date(
        now.getTime() +
          Math.min(1800000, 30000 * 2 ** Math.min(watch.attempts - 1, 6)),
      ).toISOString(),
      watch,
    };
    const notified = await d.transaction(async (tx) => {
      const won = await tx.execute(
        sql`UPDATE agus2_tasks SET version=${next.version},state=${next.state},due_at=${next.dueAt}::timestamptz,payload=${JSON.stringify(next)}::jsonb WHERE owner=${owner} AND id=${claimed.id} AND version=${claimed.version} AND state='active' RETURNING id`,
      );
      if (!won.rows.length) return 0; // A concurrent pause/cancel/new lease discards this completion.
      await tx.execute(
        sql`INSERT INTO agus2_events VALUES (${owner},${randomUUID()},${next.id},${terminal ? "devnet_followup_finished" : "devnet_followup_checked"},${now.toISOString()}::timestamptz)`,
      );
      if (!terminal) return 0;
      const notification = {
        id: `${next.id}:devnet-result`,
        taskId: next.id,
        title: next.title,
        text: evidence,
        evidence,
        createdAt: now.toISOString(),
        draftId: watch.draftId,
        signature: watch.signature ?? null,
        confirmation: watch.confirmation ?? null,
      };
      const inserted = await tx.execute(
        sql`INSERT INTO agus2_notifications VALUES (${owner},${notification.id},${next.id},${JSON.stringify(notification)}::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
      );
      return inserted.rows.length;
    });
    result.notified += notified;
  }
  return result;
}
