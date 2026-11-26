import { beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db, mutate, readState } from "../src/lib/db";
import { digest } from "../src/lib/domain";
import {
  initializeFinancialStorage,
  initializeSimulation,
  createDurableRepository,
} from "../src/lib/financial-integration/storage";
import {
  createFixtureDataSource,
  fixturePrincipal,
  createFixtureDataset,
} from "../src/lib/financial-data/fixture";
import { createReadTools } from "../src/lib/financial-data/tools";
import { FixtureProvider } from "../src/lib/paystack";
import {
  preparePaymentBatch,
  verifyBeneficiaries,
  approveBatch,
  executeBatch,
  reconcileBatch,
} from "../src/lib/payments";
import {
  projectBalance,
  captureOpenings,
  projectDataset,
} from "../src/lib/financial-integration/simulation";
import { seedState, type Batch } from "../src/lib/domain";
import { MemoryFinancialRepository } from "../src/lib/financial-data/repository";

const actor = "banking-simulation-owner";
const ctx = { ...fixturePrincipal, now: "2026-10-21T10:00:00.000Z" };
const clock = () => new Date().toISOString();
const repo = createDurableRepository();
const api = new FixtureProvider();
beforeAll(async () => {
  process.env.DATABASE_URL = "pglite://:memory:";
  process.env.PAYMENT_MODE = "fixture";
  process.env.FINANCIAL_DEMO_ENABLED = "true";
  process.env.OPERATOR_ID = actor;
  await initializeFinancialStorage();
  await (
    await db()
  ).execute(
    sql`INSERT INTO fm_principals VALUES (${actor}, ${ctx.tenantId}, ${ctx.actorId})`,
  );
  await initializeSimulation(ctx);
});

it("keeps a stable usable current simulation, original snapshot, and unknown accounts", async () => {
  const tools = createReadTools({
    repository: repo,
    sources: [createFixtureDataSource({ repository: repo, clock })],
    clock,
  });
  const reply = await tools.execute(ctx, {
    protocolVersion: 1,
    callId: "balance",
    name: "get_account_summary",
    args: { accountIds: ["amina-current", "amina-savings"] },
  });
  expect(reply.data?.accounts[0]).toMatchObject({
    availableKobo: 12345678,
    currentKobo: 12445678,
    asOf: "2026-10-17T10:00:00.000Z",
    simulation: { changeCount: 0 },
  });
  expect(reply.data?.accounts[1]).toMatchObject({
    availableKobo: null,
    unavailableReason: "not_provided",
  });
  const original = await (
    await db()
  ).execute(sql`SELECT payload FROM fm_summaries`);
  expect(original.rows[0].payload).not.toHaveProperty("simulation");
  expect(
    (await repo.getAccountSummary(ctx, "amina-current"))?.availableKobo,
  ).toBe(12345678);
  expect(
    await repo.getAccountSummary(
      { ...ctx, tenantId: "other" },
      "amina-current",
    ),
  ).toBeNull();
  const denied = await tools.execute(
    { ...ctx, actorId: "fictional-tunde" },
    {
      protocolVersion: 1,
      callId: "deny",
      name: "get_account_summary",
      args: { accountIds: ["amina-current"] },
    },
  );
  expect(denied.error).not.toBeNull();
});

it("atomically reserves once, posts once on reconciliation, exposes matching history and preserves human approval", async () => {
  let b = await preparePaymentBatch(actor, [
    {
      name: "Ada",
      bankCode: "035",
      accountNumber: "0000000001",
      amountKobo: 50000,
      reason: "Fictional lunch",
    },
  ]);
  expect(b.simulationSource?.accountId).toBe("amina-current");
  await expect(executeBatch(actor, b.id, "invented", api)).rejects.toThrow();
  expect(
    (await repo.getAccountSummary(ctx, "amina-current"))?.availableKobo,
  ).toBe(12345678);
  b = await verifyBeneficiaries(actor, b.id, api);
  b = await approveBatch(actor, b.id, digest(b));
  await executeBatch(actor, b.id, b.approval!.nonce, api);
  const pending = await repo.getAccountSummary(ctx, "amina-current");
  expect(pending).toMatchObject({
    availableKobo: 12290678,
    currentKobo: 12445678,
    simulation: { changeCount: 1 },
  });
  await expect(
    executeBatch(actor, b.id, b.approval!.nonce, api),
  ).rejects.toThrow();
  await reconcileBatch(actor, b.id, api);
  const posted = await repo.getAccountSummary(ctx, "amina-current");
  const state = await readState();
  const payment = state.batches[0].payments[0];
  const debit = 50000 + (payment.providerFeeKobo ?? 0);
  expect(posted).toMatchObject({
    availableKobo: 12345678 - debit,
    currentKobo: 12445678 - debit,
    simulation: { changeCount: 1 },
  });
  await reconcileBatch(actor, b.id, api);
  expect(
    (await repo.getAccountSummary(ctx, "amina-current"))?.availableKobo,
  ).toBe(posted?.availableKobo);
  const history = await repo.listTransactions(ctx, "amina-current");
  expect(history.filter((t) => t.id === `sim-${payment.id}`)).toHaveLength(1);
  expect(history.find((t) => t.id === `sim-${payment.id}`)).toMatchObject({
    status: "posted",
    simulated: true,
    amountKobo: 50000,
    evidenceIds: [],
  });
});

it("blocks insufficient simulated funds before provider submission and respects revoked consent", async () => {
  let b = await preparePaymentBatch(actor, [
    {
      name: "Ada",
      bankCode: "035",
      accountNumber: "0000000001",
      amountKobo: 50000,
    },
  ]);
  b = await verifyBeneficiaries(actor, b.id, api);
  b = await approveBatch(actor, b.id, digest(b));
  await mutate((s) => {
    s.simulationOpenings![0].availableKobo = 100;
  });
  await expect(
    executeBatch(actor, b.id, b.approval!.nonce, api),
  ).rejects.toThrow("Insufficient fictional");
  expect(
    (await readState()).batches.find((v) => v.id === b.id)?.approval
      ?.consumedAt,
  ).toBeUndefined();
  await repo.revokeConsent(ctx, "consent-amina", clock());
  await expect(
    executeBatch(actor, b.id, b.approval!.nonce, api),
  ).rejects.toThrow();
});

it.each(["processing", "unknown", "successful", "failed", "reversed"] as const)(
  "projects %s without reconciling historical records or legacy payments",
  (status) => {
    const data = createFixtureDataset(),
      s = seedState();
    captureOpenings(s, data);
    const source = {
      tenantId: ctx.tenantId,
      ownerId: ctx.actorId,
      accountId: "amina-current",
    };
    const b = {
      id: "b",
      mode: "fixture",
      simulationSource: source,
      approval: { consumedAt: "2026-10-21T10:00:00.000Z" },
      feeReserveKobo: 5000,
      payments: [
        {
          id: "p",
          name: "Ada",
          reference: "sim-ref",
          amountKobo: 50000,
          status,
          responses: [],
        },
      ],
    } as unknown as Batch;
    s.batches.push(b, { ...b, id: "legacy", simulationSource: undefined });
    const result = projectBalance(s, s.simulationOpenings![0]);
    expect(result.availableKobo).toBe(
      status === "successful"
        ? 12295678
        : ["processing", "unknown"].includes(status)
          ? 12290678
          : 12345678,
    );
    expect(result.currentKobo).toBe(
      status === "successful" ? 12395678 : 12445678,
    );
    expect(result.simulation?.changeCount).toBe(1);
    const projected = projectDataset(data, s);
    expect(() => new MemoryFinancialRepository(projected)).not.toThrow();
    expect(data.transactions).toHaveLength(77);
    expect(projected.transactions).toHaveLength(78);
  },
);
