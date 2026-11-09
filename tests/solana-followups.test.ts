/** Durable SQL workflow tests with a controlled reconciliation capability; no network/funds. */
import { randomUUID } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import {
  prepareSolanaFollowup,
  runSolanaFollowups,
} from "../src/lib/agent-workspace/solana-followups";
import {
  initializeWorkspace,
  workspace,
} from "../src/lib/agent-workspace/store";
import type { SolanaDraft } from "../src/lib/solana/contracts";

const now = new Date("2026-11-09T18:00:00Z");
beforeAll(async () => {
  process.env.DATABASE_URL = "pglite://:memory:";
  process.env.PAYMENT_MODE = "fixture";
  process.env.AGUS_WORKSPACE_ENABLED = "true";
  process.env.AGUS_SOLANA_DEVNET_ENABLED = "true";
  await initializeWorkspace();
});
function source(
  owner: string,
  id = randomUUID(),
  state: SolanaDraft["state"] = "unknown",
): SolanaDraft {
  // Only the fields consumed by the follow-up contract. Core RPC/cryptographic
  // verification is separately covered by solana-core/solana-rpc tests.
  return {
    id,
    owner,
    network: "devnet",
    state,
    submission: {
      claimId: "fixture-only",
      claimedAt: now.toISOString(),
      signature: "fixture-only-signature",
    },
    confirmation: null,
  } as SolanaDraft;
}
async function proposed(owner: string) {
  const draft = source(owner);
  const get = vi.fn(async () => draft);
  const task = await prepareSolanaFollowup(owner, { id: draft.id }, get, now);
  return { draft, get, task, store: workspace(owner) };
}
function confirmed(draft: SolanaDraft): SolanaDraft {
  return {
    ...draft,
    state: "confirmed",
    confirmation: {
      at: now.toISOString(),
      slot: 123,
      commitment: "confirmed",
      feeLamports: "5000",
    },
  };
}
it("proposes one responsibility per owned submitted draft without activating it or scheduling financial execution", async () => {
  const s = await proposed("propose");
  expect(s.task).toMatchObject({
    state: "awaiting_approval",
    scope: "solana_devnet_reconciliation_only",
    watch: { attempts: 0 },
  });
  const again = await prepareSolanaFollowup(
    "propose",
    { id: s.draft.id },
    s.get,
    new Date(now.getTime() + 100),
  );
  expect(again).toEqual(s.task);
  const reconcile = vi.fn(async () => confirmed(s.draft));
  expect((await runSolanaFollowups("propose", reconcile, now)).checked).toBe(0);
  expect(reconcile).not.toHaveBeenCalled();
  expect((await s.store.snapshot()).tasks).toHaveLength(1);
});
it("rejects unsubmitted/settled/foreign records and arbitrary authorization fields", async () => {
  const draft = source("eligibility");
  for (const invalid of [
    { ...draft, submission: null },
    { ...draft, owner: "other" },
    { ...draft, state: "confirmed" as const },
    { ...draft, network: "mainnet" as never },
  ]) {
    await expect(
      prepareSolanaFollowup(
        "eligibility",
        { id: draft.id },
        async () => invalid,
        now,
      ),
    ).rejects.toMatchObject({ status: 409 });
  }
  await expect(
    prepareSolanaFollowup(
      "eligibility",
      { id: draft.id, approved: true },
      async () => draft,
      now,
    ),
  ).rejects.toThrow();
  expect((await workspace("eligibility").snapshot()).tasks).toHaveLength(0);
});
it("reminder delivery cannot complete a status follow-up or fabricate evidence", async () => {
  const s = await proposed("no-reminder-confusion");
  await s.store.transition(s.task.id, 0, "approve");
  expect((await s.store.runDue(now)).delivered).toBe(0);
  const snapshot = await s.store.snapshot();
  expect(snapshot.notifications).toHaveLength(0);
  expect(snapshot.tasks[0].state).toBe("active");
});
it("requires human activation, isolates owners and writes one verified in-app result with durable evidence", async () => {
  const s = await proposed("verified");
  await expect(
    workspace("foreign").transition(s.task.id, 0, "approve"),
  ).rejects.toMatchObject({ status: 404 });
  await s.store.transition(s.task.id, 0, "approve");
  const reconcile = vi.fn(async () => confirmed(s.draft));
  expect((await runSolanaFollowups("foreign", reconcile, now)).checked).toBe(0);
  expect(await runSolanaFollowups("verified", reconcile, now)).toMatchObject({
    checked: 1,
    notified: 1,
    financialExecutions: 0,
    externalMessages: 0,
  });
  const saved = await workspace("verified").snapshot();
  expect(saved.tasks[0]).toMatchObject({
    state: "completed",
    watch: {
      observedState: "confirmed",
      confirmation: { slot: 123 },
      signature: "fixture-only-signature",
    },
  });
  expect(saved.notifications[0]).toMatchObject({
    confirmation: { slot: 123 },
    text: expect.stringContaining("test-network evidence"),
  });
  expect((await runSolanaFollowups("verified", reconcile, now)).notified).toBe(
    0,
  );
  expect(reconcile).toHaveBeenCalledTimes(1);
  const noReread = vi.fn(async () => {
    throw new Error("must not reopen completed work");
  });
  expect(
    (await prepareSolanaFollowup("verified", { id: s.draft.id }, noReread, now))
      .state,
  ).toBe("completed");
  expect(noReread).not.toHaveBeenCalled();
});
it("deduplicates overlapping workers using the persisted lease/version", async () => {
  const s = await proposed("overlap");
  await s.store.transition(s.task.id, 0, "approve");
  const reconcile = vi.fn(async () => confirmed(s.draft));
  const results = await Promise.all([
    runSolanaFollowups("overlap", reconcile, now),
    runSolanaFollowups("overlap", reconcile, now),
  ]);
  expect(results.reduce((n, r) => n + r.notified, 0)).toBe(1);
  expect(reconcile).toHaveBeenCalledTimes(1);
});
it("defers outages and unknown outcomes with bounded backoff, never declaring success or resending", async () => {
  const s = await proposed("retry");
  await s.store.transition(s.task.id, 0, "approve");
  const failing = vi.fn(async () => {
    throw new Error("credential-bearing provider body must never be stored");
  });
  expect(await runSolanaFollowups("retry", failing, now)).toMatchObject({
    deferred: 1,
    notified: 0,
  });
  const first = (await s.store.snapshot()).tasks[0];
  expect(first).toMatchObject({
    state: "active",
    watch: { attempts: 1, failureCode: "RECONCILIATION_UNAVAILABLE" },
  });
  expect(first.dueAt).toBe("2026-11-09T18:00:30.000Z");
  expect(JSON.stringify(first)).not.toContain("credential-bearing");
  const unknown = vi.fn(async () => s.draft);
  expect(
    (
      await runSolanaFollowups(
        "retry",
        unknown,
        new Date("2026-11-09T18:00:29Z"),
      )
    ).checked,
  ).toBe(0);
  expect(
    (await runSolanaFollowups("retry", unknown, new Date(first.dueAt)))
      .notified,
  ).toBe(0);
  expect((await s.store.snapshot()).notifications).toHaveLength(0);
});
it("pause and cancellation win a completion race and suppress result notifications", async () => {
  for (const action of ["pause", "cancel"] as const) {
    const owner = `race-${action}`;
    const s = await proposed(owner);
    await s.store.transition(s.task.id, 0, "approve");
    await runSolanaFollowups(
      owner,
      async () => {
        const claimed = (await s.store.snapshot()).tasks[0];
        await s.store.transition(claimed.id, claimed.version, action);
        return confirmed(s.draft);
      },
      now,
    );
    const saved = await s.store.snapshot();
    expect(saved.tasks[0].state).toBe(
      action === "pause" ? "paused" : "cancelled",
    );
    expect(saved.notifications).toHaveLength(0);
  }
});
it("reclaims an interrupted worker's expired lease without a duplicate notification", async () => {
  const s = await proposed("crash");
  const active = await s.store.transition(s.task.id, 0, "approve");
  const leased = {
    ...active,
    version: active.version + 1,
    dueAt: "2026-11-09T18:02:00.000Z",
    watch: { ...active.watch!, attempts: 1 },
  };
  await (
    await initializeWorkspace()
  ).execute(
    sql`UPDATE agus2_tasks SET version=${leased.version},due_at=${leased.dueAt}::timestamptz,payload=${JSON.stringify(leased)}::jsonb WHERE owner='crash' AND id=${leased.id}`,
  );
  const reconcile = vi.fn(async () => confirmed(s.draft));
  expect((await runSolanaFollowups("crash", reconcile, now)).checked).toBe(0);
  expect(
    (await runSolanaFollowups("crash", reconcile, new Date(leased.dueAt)))
      .notified,
  ).toBe(1);
  expect((await s.store.snapshot()).notifications).toHaveLength(1);
});
it("closes the bounded window as unresolved without another RPC read", async () => {
  const s = await proposed("expiry");
  await s.store.transition(s.task.id, 0, "approve");
  const reconcile = vi.fn(async () => confirmed(s.draft));
  expect(
    (
      await runSolanaFollowups(
        "expiry",
        reconcile,
        new Date("2026-11-10T18:00:00Z"),
      )
    ).notified,
  ).toBe(1);
  expect(reconcile).not.toHaveBeenCalled();
  const saved = await s.store.snapshot();
  expect(saved.tasks[0].watch?.failureCode).toBe("FOLLOWUP_LIMIT_REACHED");
  expect(saved.tasks[0].watch?.confirmation).toBeUndefined();
  expect(saved.notifications[0]).toMatchObject({
    text: expect.stringContaining("without a verified outcome"),
  });
});
it("fails closed on disabled devnet and live payment configuration", async () => {
  const reconcile = vi.fn(async () => source("disabled"));
  process.env.AGUS_SOLANA_DEVNET_ENABLED = "false";
  await expect(
    runSolanaFollowups("disabled", reconcile, now),
  ).rejects.toMatchObject({ code: "DEVNET_DISABLED" });
  process.env.AGUS_SOLANA_DEVNET_ENABLED = "true";
  process.env.PAYMENT_MODE = "live";
  await expect(
    runSolanaFollowups("disabled", reconcile, now),
  ).rejects.toMatchObject({ code: "LIVE_FORBIDDEN" });
  process.env.PAYMENT_MODE = "fixture";
  expect(reconcile).not.toHaveBeenCalled();
});

it("records chain failure separately from success and defers mismatched reconciliation scope", async () => {
  const failed = await proposed("chain-failed");
  await failed.store.transition(failed.task.id, 0, "approve");
  await runSolanaFollowups(
    "chain-failed",
    async () => ({
      ...failed.draft,
      state: "failed",
      failureCode: "ON_CHAIN_FAILURE",
    }),
    now,
  );
  const result = await failed.store.snapshot();
  expect(result.notifications[0]).toMatchObject({
    text: expect.stringContaining("on-chain failure"),
    confirmation: null,
  });
  const mismatched = await proposed("mismatch");
  await mismatched.store.transition(mismatched.task.id, 0, "approve");
  await runSolanaFollowups(
    "mismatch",
    async () => confirmed({ ...mismatched.draft, owner: "other" }),
    now,
  );
  expect((await mismatched.store.snapshot()).notifications).toHaveLength(0);
  expect((await mismatched.store.snapshot()).tasks[0].watch?.failureCode).toBe(
    "RECONCILIATION_UNAVAILABLE",
  );
});
