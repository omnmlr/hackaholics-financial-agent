import { describe, expect, it, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { FinancialIntelligenceRepository } from "../../src/lib/financial-intelligence/repository";
import { MultiAccountFinancialIntelligenceService } from "../../src/lib/financial-intelligence/service";
import type { Sql } from "../../src/server/sql";

describe("Financial Intelligence — Durable Persistence, Concurrency & Restart Recovery", () => {
  let pgliteClient: PGlite;
  let sqlAdapter: Sql;
  let repo: FinancialIntelligenceRepository;

  beforeEach(async () => {
    pgliteClient = new PGlite();
    sqlAdapter = {
      exec: async (text: string) => pgliteClient.exec(text),
      query: async (text: string, values?: unknown[]) => pgliteClient.query(text, values),
    };
    repo = new FinancialIntelligenceRepository(sqlAdapter);
    await repo.ensureSchema();
  });

  it("survives complete service reconstruction and process restart without data loss", async () => {
    // 1. Initial service instance
    const service1 = new MultiAccountFinancialIntelligenceService(repo);

    const gtb = await service1.registerAccount({
      ownerId: "user_restart",
      tenantId: "tenant_agus",
      institution: { code: "058", name: "GTBank", type: "commercial_bank" },
      accountNumberMasked: "******1234",
      accountName: "GTB Main Checking",
      currency: "NGN",
      accountType: "checking",
    });

    const kuda = await service1.registerAccount({
      ownerId: "user_restart",
      tenantId: "tenant_agus",
      institution: { code: "090267", name: "Kuda Bank", type: "microfinance" },
      accountNumberMasked: "******5678",
      accountName: "Kuda Spend Wallet",
      currency: "NGN",
      accountType: "wallet",
    });

    // Ingest GTBank statement with row balance
    const gtbCsv = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
01-Nov-2026,01-Nov-2026,GT01,,300000.00,300000.00,SALARY INFLOW
02-Nov-2026,02-Nov-2026,GT02,50000.00,,250000.00,TRF TO KUDA / 5678 / REF:999
`.trim();
    await service1.ingestStatement("user_restart", gtb.id, gtbCsv, "gtb.csv", "tenant_agus");

    // Ingest Kuda statement with row balance
    const kudaCsv = `
Date,Description,Amount,Balance,Type,Reference
2026-11-02,Transfer from GTBank,50000.00,50000.00,Credit,999
2026-11-03,Domino's Pizza,6500.00,43500.00,Debit,POS01
`.trim();
    await service1.ingestStatement("user_restart", kuda.id, kudaCsv, "kuda.csv", "tenant_agus");

    // Check transactions and apply a user classification override
    const txsBefore = await service1.queryTransactions("user_restart", { accountId: kuda.id }, "tenant_agus");
    const pizzaTx = txsBefore.items.find((t) => t.cleanDescription.includes("Domino"))!;

    await service1.applyUserOverride(
      "user_restart",
      pizzaTx.id,
      {
        category: "entertainment",
        notes: "Team celebration dinner (work entertainment)",
        updatedAt: new Date().toISOString(),
      },
      "tenant_agus",
    );

    // Initial overview
    const overview1 = await service1.getFinancialOverview("user_restart", "NGN", "tenant_agus");
    expect(overview1.balances.currencySummaries.NGN.totalAtoms).toBe(29350000n); // ₦250k + ₦43.5k = ₦293,500.00
    expect(overview1.balances.currencySummaries.NGN.formatted).toBe("₦293,500.00");

    // 2. RESTART SIMULATION:
    // Discard service1 instance completely. Re-instantiate service2 using the same underlying database.
    const service2 = new MultiAccountFinancialIntelligenceService(repo);

    // Verify accounts survived restart
    const accounts2 = await service2.getAccounts("user_restart", "tenant_agus");
    expect(accounts2.length).toBe(2);
    expect(accounts2.some((a) => a.id === gtb.id)).toBe(true);
    expect(accounts2.some((a) => a.id === kuda.id)).toBe(true);

    // Verify transactions survived restart
    const txs2 = await service2.queryTransactions("user_restart", {}, "tenant_agus");
    expect(txs2.totalCount).toBe(4);

    // Verify user override survived restart
    const pizzaTx2 = txs2.items.find((t) => t.id === pizzaTx.id)!;
    expect(pizzaTx2.category).toBe("entertainment");
    expect(pizzaTx2.userOverride?.notes).toBe("Team celebration dinner (work entertainment)");

    // Verify internal transfer reconciliation status survived restart
    const gtbTransferTx = txs2.items.find((t) => t.accountId === gtb.id && t.amountAtoms < 0n)!;
    expect(gtbTransferTx.internalTransferMetadata?.isInternalTransfer).toBe(true);
    expect(gtbTransferTx.internalTransferMetadata?.confidence).toBe("confirmed");

    // Verify financial overview and verified balances survived restart
    const overview2 = await service2.getFinancialOverview("user_restart", "NGN", "tenant_agus");
    expect(overview2.balances.currencySummaries.NGN.totalAtoms).toBe(29350000n);
    expect(overview2.cashFlow.overall.grossIncomeAtoms).toBe(30000000n); // ₦300k (excluding ₦50k internal transfer)
    expect(overview2.cashFlow.overall.grossSpendingAtoms).toBe(650000n); // ₦6,500
    expect(overview2.cashFlow.overall.netCashFlowAtoms).toBe(29350000n); // ₦293,500.00
  });

  it("enforces multi-user and multi-tenant isolation at database boundaries", async () => {
    const service = new MultiAccountFinancialIntelligenceService(repo);

    const aliceAcc = await service.registerAccount({
      ownerId: "alice",
      tenantId: "tenant_alpha",
      institution: { code: "058", name: "GTBank", type: "commercial_bank" },
      accountNumberMasked: "******1111",
      accountName: "Alice Personal",
      currency: "NGN",
      accountType: "checking",
    });

    const bobAcc = await service.registerAccount({
      ownerId: "bob",
      tenantId: "tenant_alpha",
      institution: { code: "044", name: "Access Bank", type: "commercial_bank" },
      accountNumberMasked: "******2222",
      accountName: "Bob Personal",
      currency: "NGN",
      accountType: "checking",
    });

    await service.ingestStatement(
      "alice",
      aliceAcc.id,
      `Date,Description,Amount,Type\n2026-11-01,Alice Inflow,100000.00,Credit\n`,
      "alice.csv",
      "tenant_alpha",
    );

    await service.ingestStatement(
      "bob",
      bobAcc.id,
      `Date,Description,Amount,Type\n2026-11-01,Bob Inflow,200000.00,Credit\n`,
      "bob.csv",
      "tenant_alpha",
    );

    // Alice cannot see Bob's accounts
    const aliceAccounts = await service.getAccounts("alice", "tenant_alpha");
    expect(aliceAccounts.length).toBe(1);
    expect(aliceAccounts[0].id).toBe(aliceAcc.id);

    // Alice cannot see Bob's transactions
    const aliceTxs = await service.queryTransactions("alice", {}, "tenant_alpha");
    expect(aliceTxs.totalCount).toBe(1);
    expect(aliceTxs.items[0].ownerId).toBe("alice");

    // Alice cannot ingest statement into Bob's account
    await expect(
      service.ingestStatement("alice", bobAcc.id, "Date,Description,Amount\n", "attack.csv", "tenant_alpha"),
    ).rejects.toThrow(/Account not found or access denied/);

    // Bob cannot override Alice's transaction
    await expect(
      service.applyUserOverride("bob", aliceTxs.items[0].id, { notes: "Hacked" }, "tenant_alpha"),
    ).rejects.toThrow(/Transaction not found or access denied/);
  });

  it("is idempotent: re-importing identical statements does not duplicate transactions or overwrite user overrides", async () => {
    const service = new MultiAccountFinancialIntelligenceService(repo);

    const acc = await service.registerAccount({
      ownerId: "user_idem",
      tenantId: "default",
      institution: { code: "058", name: "GTBank", type: "commercial_bank" },
      accountNumberMasked: "******9999",
      accountName: "Main",
      currency: "NGN",
      accountType: "checking",
    });

    const csvContent = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
01-Nov-2026,01-Nov-2026,REF1,,150000.00,150000.00,SALARY DEPOSIT
02-Nov-2026,02-Nov-2026,REF2,12000.00,,138000.00,SUPERMARKET SHOPPING
`.trim();

    // First import
    const res1 = await service.ingestStatement("user_idem", acc.id, csvContent, "stmt.csv");
    expect(res1.importedTransactions.length).toBe(2);
    expect(res1.duplicateTransactions.length).toBe(0);

    // User customizes category on transaction 2
    const txs1 = await service.queryTransactions("user_idem");
    const shopTx = txs1.items.find((t) => t.rawDescription.includes("SUPERMARKET"))!;

    await service.applyUserOverride("user_idem", shopTx.id, {
      category: "groceries",
      notes: "Monthly bulk grocery run",
    });

    // Re-import the EXACT same statement file
    const res2 = await service.ingestStatement("user_idem", acc.id, csvContent, "stmt.csv");

    // Must be recognized as duplicate!
    expect(res2.audit.duplicateCount).toBe(2);

    // Total transactions in DB must still be exactly 2
    const txs2 = await service.queryTransactions("user_idem");
    expect(txs2.totalCount).toBe(2);

    // User override must be completely preserved!
    const shopTx2 = txs2.items.find((t) => t.id === shopTx.id)!;
    expect(shopTx2.category).toBe("groceries");
    expect(shopTx2.userOverride?.notes).toBe("Monthly bulk grocery run");
  });
});
