import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { MultiAccountFinancialIntelligenceService } from "../../src/lib/financial-intelligence/service";
import { FinancialIntelligenceRepository } from "../../src/lib/financial-intelligence/repository";
import {
  toAgentAccountSummary,
  toAgentEvidenceView,
  toAgentTransactionView,
} from "../../src/lib/financial-intelligence/agent-adapter";
import {
  AccountSummarySchema,
  EvidenceViewSchema,
  TransactionViewSchema,
} from "../../src/lib/financial-data/contracts";
import type { Sql } from "../../src/server/sql";

describe("Financial Intelligence — Realistic End-to-End 13-Step Integration Harness", () => {
  let pglite: PGlite;
  let sqlAdapter: Sql;

  beforeAll(async () => {
    pglite = new PGlite();

    const sqlScript = readFileSync(
      resolve(process.cwd(), "migrations/0018_financial_intelligence.sql"),
      "utf8",
    );
    await pglite.exec(sqlScript);

    sqlAdapter = {
      exec: async (text: string) => pglite.exec(text),
      query: async (text: string, values?: unknown[]) => pglite.query(text, values),
    };
  });

  afterAll(async () => {
    if (pglite) {
      await pglite.close();
    }
  });

  it("successfully completes the 13-step autonomous financial intelligence lifecycle", async () => {
    // -------------------------------------------------------------
    // STEP 1: Authenticate user & establish security context
    // -------------------------------------------------------------
    const user1 = "user_e2e_gerald";
    const tenant1 = "tenant_agus_production";
    const repo1 = new FinancialIntelligenceRepository(sqlAdapter);
    const service = new MultiAccountFinancialIntelligenceService(repo1);

    // -------------------------------------------------------------
    // STEP 2: Register multiple financial accounts
    // -------------------------------------------------------------
    const gtbAcc = await service.registerAccount({
      ownerId: user1,
      tenantId: tenant1,
      institution: { code: "058", name: "Guaranty Trust Bank", type: "commercial_bank" },
      accountNumberMasked: "******1234",
      accountName: "Gerald GTB Main Checking",
      currency: "NGN",
      accountType: "checking",
    });

    const kudaAcc = await service.registerAccount({
      ownerId: user1,
      tenantId: tenant1,
      institution: { code: "090267", name: "Kuda Microfinance Bank", type: "microfinance" },
      accountNumberMasked: "******5678",
      accountName: "Gerald Kuda Daily Spend",
      currency: "NGN",
      accountType: "wallet",
    });

    const mercuryAcc = await service.registerAccount({
      ownerId: user1,
      tenantId: tenant1,
      institution: { code: "MERCURY", name: "Mercury Bank", type: "commercial_bank" },
      accountNumberMasked: "******9012",
      accountName: "Gerald Mercury Treasury",
      currency: "USD",
      accountType: "checking",
    });

    const phantomAcc = await service.registerAccount({
      ownerId: user1,
      tenantId: tenant1,
      institution: { code: "SOLANA", name: "Phantom Solana Wallet", type: "crypto_wallet" },
      accountNumberMasked: "7xK...9mP",
      accountName: "Gerald Phantom USDC",
      currency: "USDC",
      accountType: "wallet",
    });

    const initialAccounts = await service.getAccounts(user1, tenant1);
    expect(initialAccounts.length).toBe(4);

    // -------------------------------------------------------------
    // STEP 3: Ingest multi-format statements
    // -------------------------------------------------------------
    // GTBank Statement with transfer out, charges, and groceries
    const gtbCsv = `
Trans Date,Value Date,Reference,Debits,Credits,Balance,Remarks
01-Nov-2026,01-Nov-2026,GTB-OPENING,,,250000.00,OPENING BALANCE
02-Nov-2026,02-Nov-2026,GTB-NIP-202611-998877,100000.00,,150000.00,TRF TO KUDA / GERALD / NIP:GTB-NIP-202611-998877
02-Nov-2026,02-Nov-2026,EMTL-001,50.00,,149950.00,ELECTRONIC MONEY TRANSFER LEVY (EMTL)
02-Nov-2026,02-Nov-2026,SMS-001,4.00,,149946.00,SMS NOTIFICATION CHARGE
03-Nov-2026,03-Nov-2026,MAINT-001,150.00,,149796.00,MONTHLY ACCOUNT MAINTENANCE CHARGE
04-Nov-2026,04-Nov-2026,SPAR-001,15000.00,,134796.00,POS PAYMENT SPAR SUPERMARKET LEKKI
`.trim();

    // Kuda Statement receiving the transfer from GTBank
    const kudaCsv = `
Date,Description,Amount,Type,Balance,Reference
01-Oct-2026,Opening Balance,20000.00,credit,20000.00,KUDA-OPEN
05-Oct-2026,SPOTIFY NIGERIA SUBSCRIPTION,1200.00,debit,18800.00,SPOTIFY-00
02-Nov-2026,NIP/GTB-NIP-202611-998877/GERALD/GTB,100000.00,credit,118800.00,GTB-NIP-202611-998877
05-Nov-2026,SPOTIFY NIGERIA SUBSCRIPTION,1200.00,debit,117600.00,SPOTIFY-01
`.trim();

    // Mercury USD Statement
    const mercuryCsv = `
Date,Description,Amount,Type,Balance
01-Nov-2026,STRIPE PAYOUT CLIENT RETAINER,5000.00,credit,5000.00
03-Nov-2026,AWS CLOUD INFRASTRUCTURE,250.00,debit,4750.00
`.trim();

    // Phantom USDC Wallet Statement
    const phantomCsv = `
Date,Description,Amount,Type,Balance
02-Nov-2026,USDC DEVNET AIRDROP,100.000000,credit,100.000000
`.trim();

    const gtbIngest = await service.ingestStatement(user1, gtbAcc.id, gtbCsv, "gtb_statement.csv", tenant1);
    const kudaIngest = await service.ingestStatement(user1, kudaAcc.id, kudaCsv, "kuda_statement.csv", tenant1);
    const mercuryIngest = await service.ingestStatement(user1, mercuryAcc.id, mercuryCsv, "mercury.csv", tenant1);
    const phantomIngest = await service.ingestStatement(user1, phantomAcc.id, phantomCsv, "phantom.csv", tenant1);

    expect(gtbIngest.importedTransactions.length).toBe(5); // 5 posted txs (ignoring zero-amount opening row)
    expect(kudaIngest.importedTransactions.length).toBe(4);
    expect(mercuryIngest.importedTransactions.length).toBe(2);
    expect(phantomIngest.importedTransactions.length).toBe(1);

    // -------------------------------------------------------------
    // STEP 4: Persist records to PGlite
    // -------------------------------------------------------------
    const allTxs = await service.queryTransactions(user1, {}, tenant1);
    expect(allTxs.totalCount).toBe(12);

    // -------------------------------------------------------------
    // STEP 5: Reconcile transfers and verify isolation
    // -------------------------------------------------------------
    const gtbDebit = allTxs.items.find((t) => t.rawDescription.includes("TRF TO KUDA"))!;
    const kudaCredit = allTxs.items.find((t) => t.rawDescription.includes("NIP/GTB-NIP-202611-998877"))!;

    expect(gtbDebit.internalTransferMetadata?.isInternalTransfer).toBe(true);
    expect(gtbDebit.internalTransferMetadata?.confidence).toBe("confirmed");
    expect(gtbDebit.internalTransferMetadata?.counterpartTransactionId).toBe(kudaCredit.id);
    expect(gtbDebit.internalTransferMetadata?.counterpartAccountId).toBe(kudaAcc.id);

    expect(kudaCredit.internalTransferMetadata?.isInternalTransfer).toBe(true);
    expect(kudaCredit.internalTransferMetadata?.confidence).toBe("confirmed");
    expect(kudaCredit.internalTransferMetadata?.counterpartTransactionId).toBe(gtbDebit.id);

    // Verify USD and USDC were NEVER cross-matched
    const usdTx = allTxs.items.find((t) => t.currency === "USD")!;
    expect(usdTx.internalTransferMetadata?.isInternalTransfer).toBeFalsy();

    // -------------------------------------------------------------
    // STEP 6: Compute evidence-based balances
    // -------------------------------------------------------------
    const overview = await service.getFinancialOverview(user1, "NGN", tenant1);

    // GTB closing balance on Nov 4 = ₦134,796.00 (13,479,600 kobo)
    const gtbSnap = overview.balances.currencySummaries.NGN.accounts.find((a) => a.accountId === gtbAcc.id)!;
    expect(gtbSnap.availableAtoms).toBe(13479600n);
    expect(gtbSnap.confidence).toBe("verified");
    expect(gtbSnap.formattedAvailable).toBe("₦134,796.00");

    // Kuda closing balance on Nov 5 = ₦117,600.00 (11,760,000 kobo)
    const kudaSnap = overview.balances.currencySummaries.NGN.accounts.find((a) => a.accountId === kudaAcc.id)!;
    expect(kudaSnap.availableAtoms).toBe(11760000n);
    expect(kudaSnap.confidence).toBe("verified");
    expect(kudaSnap.formattedAvailable).toBe("₦117,600.00");

    // Total verified available NGN = ₦134,796 + ₦117,600 = ₦252,396.00
    expect(overview.balances.currencySummaries.NGN.verifiedAvailableAtoms).toBe(25239600n);
    expect(overview.balances.currencySummaries.NGN.formattedVerifiedAvailable).toBe("₦252,396.00");

    // Mercury USD balance = $4,750.00 (475,000 cents)
    const mercurySnap = overview.balances.currencySummaries.USD.accounts.find((a) => a.accountId === mercuryAcc.id)!;
    expect(mercurySnap.availableAtoms).toBe(475000n);
    expect(mercurySnap.formattedAvailable).toBe("$4,750.00");

    // -------------------------------------------------------------
    // STEP 7: Compute cash flow, bank charges, and recurring commitments
    // -------------------------------------------------------------
    // Cash flow strictly excludes internal transfers (₦100,000)
    // External expenses: EMTL (₦50) + SMS (₦4) + Maint (₦150) + SPAR (₦15,000) + Spotify x2 (₦2,400) = ₦17,604.00
    expect(overview.cashFlow.overall.grossSpendingAtoms).toBe(1760400n);
    expect(overview.cashFlow.overall.formattedSpending).toBe("₦17,604.00");

    // Bank charges breakdown
    const charges = overview.spending.bankCharges;
    expect(charges.totalBankChargesAtoms).toBe(20400n); // ₦204.00
    const emtl = charges.breakdown.find((b) => b.chargeType === "stamp_duty_emtl")!;
    expect(emtl.totalAtoms).toBe(5000n); // ₦50.00
    const sms = charges.breakdown.find((b) => b.chargeType === "sms_alert")!;
    expect(sms.totalAtoms).toBe(400n); // ₦4.00
    const maint = charges.breakdown.find((b) => b.chargeType === "card_maintenance")!;
    expect(maint.totalAtoms).toBe(15000n); // ₦150.00

    // Recurring subscriptions: Spotify detected
    const spotifySub = overview.recurringCommitments.find((r) => r.merchantName.includes("Spotify"));
    expect(spotifySub).toBeDefined();
    expect(spotifySub?.category).toBe("entertainment");

    // -------------------------------------------------------------
    // STEP 8: Apply durable user classification overrides
    // -------------------------------------------------------------
    const sparTx = allTxs.items.find((t) => t.rawDescription.includes("SPAR SUPERMARKET"))!;
    await service.applyUserOverride(
      user1,
      sparTx.id,
      {
        category: "groceries",
        notes: "Family bulk pantry provisions",
        updatedAt: new Date().toISOString(),
      },
      tenant1,
    );

    // -------------------------------------------------------------
    // STEP 9: Simulate full database disconnect and service restart
    // -------------------------------------------------------------
    // Discard old service and create a new service from scratch over the existing database
    const freshRepo = new FinancialIntelligenceRepository(sqlAdapter);
    const restartedService = new MultiAccountFinancialIntelligenceService(freshRepo);

    // -------------------------------------------------------------
    // STEP 10: Verify data and overrides survive restart
    // -------------------------------------------------------------
    const restoredAccounts = await restartedService.getAccounts(user1, tenant1);
    expect(restoredAccounts.length).toBe(4);

    const restoredTxs = await restartedService.queryTransactions(user1, {}, tenant1);
    expect(restoredTxs.totalCount).toBe(12);

    const restoredSpar = restoredTxs.items.find((t) => t.id === sparTx.id)!;
    expect(restoredSpar.userOverride?.notes).toBe("Family bulk pantry provisions");
    expect(restoredSpar.category).toBe("groceries");

    // Reconciled internal transfer remains linked after restart
    const restoredDebit = restoredTxs.items.find((t) => t.id === gtbDebit.id)!;
    expect(restoredDebit.internalTransferMetadata?.isInternalTransfer).toBe(true);
    expect(restoredDebit.internalTransferMetadata?.counterpartAccountId).toBe(kudaAcc.id);

    // -------------------------------------------------------------
    // STEP 11: Verify multi-user isolation
    // -------------------------------------------------------------
    const user2 = "user_e2e_ada";
    const user2Accounts = await restartedService.getAccounts(user2, tenant1);
    expect(user2Accounts.length).toBe(0);

    const user2Txs = await restartedService.queryTransactions(user2, {}, tenant1);
    expect(user2Txs.totalCount).toBe(0);

    // -------------------------------------------------------------
    // STEP 12: Verify idempotency on re-import
    // -------------------------------------------------------------
    const reimportResult = await restartedService.ingestStatement(
      user1,
      gtbAcc.id,
      gtbCsv,
      "gtb_statement.csv",
      tenant1,
    );
    expect(reimportResult.audit.duplicateCount).toBe(5);
    expect(reimportResult.importedTransactions.length).toBe(0);

    const txsAfterReimport = await restartedService.queryTransactions(user1, {}, tenant1);
    expect(txsAfterReimport.totalCount).toBe(12); // Zero inflation!

    // User override on SPAR preserved
    const sparAfterReimport = txsAfterReimport.items.find((t) => t.id === sparTx.id)!;
    expect(sparAfterReimport.userOverride?.notes).toBe("Family bulk pantry provisions");

    // -------------------------------------------------------------
    // STEP 13: Format financial evidence for AGUS personal agent contracts
    // -------------------------------------------------------------
    // 13a: AccountSummary contract validation
    const gtbAgentSummary = toAgentAccountSummary(
      gtbAcc,
      overview.balances.snapshots.find((s) => s.accountId === gtbAcc.id)!,
    );
    expect(AccountSummarySchema.safeParse(gtbAgentSummary).success).toBe(true);
    expect(gtbAgentSummary.accountId).toBe(gtbAcc.id);
    expect(gtbAgentSummary.availableKobo).toBe(13479600);
    expect(gtbAgentSummary.currency).toBe("NGN");

    // 13b: TransactionView contract validation
    const transferView = toAgentTransactionView(restoredDebit, gtbAcc.accountName);
    expect(TransactionViewSchema.safeParse(transferView).success).toBe(true);
    expect(transferView.id).toBe(restoredDebit.id);
    expect(transferView.amountKobo).toBe(10000000);
    expect(transferView.direction).toBe("debit");

    // 13c: EvidenceView contract validation
    const evidenceView = toAgentEvidenceView(restoredDebit);
    expect(EvidenceViewSchema.safeParse(evidenceView).success).toBe(true);
    expect(evidenceView.kind).toBe("transfer_verification");
    expect(evidenceView.sourceReference).toContain("GTB-NIP-202611-998877");
  });
});
