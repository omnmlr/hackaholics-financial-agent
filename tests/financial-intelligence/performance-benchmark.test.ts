import { describe, expect, it } from "vitest";
import {
  type FinancialAccount,
  type FinancialTransaction,
} from "../../src/lib/financial-intelligence/types";
import { reconcileCrossAccountTransfers } from "../../src/lib/financial-intelligence/reconciliation/matcher";
import { computeAccountBalances } from "../../src/lib/financial-intelligence/analytics/balances";
import { computeCashFlow } from "../../src/lib/financial-intelligence/analytics/cash-flow";
import { computeSpendingBreakdown } from "../../src/lib/financial-intelligence/analytics/categories";
import { detectRecurringTransactions } from "../../src/lib/financial-intelligence/analytics/recurring";
import { evaluateDataQuality } from "../../src/lib/financial-intelligence/analytics/data-quality";
import { exportTransactionsToCsv } from "../../src/lib/financial-intelligence/export/csv-export";

describe("Financial Intelligence — Performance & Scalability Benchmarks (5,000+ Transactions)", () => {
  const accounts: FinancialAccount[] = [
    {
      id: "bench_gtb",
      ownerId: "user_bench",
      tenantId: "default",
      institution: { code: "058", name: "Guaranty Trust Bank", type: "commercial_bank" },
      accountNumberMasked: "******1001",
      accountName: "GTB Operations",
      currency: "NGN",
      accountType: "checking",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "bench_kuda",
      ownerId: "user_bench",
      tenantId: "default",
      institution: { code: "090267", name: "Kuda Microfinance Bank", type: "microfinance" },
      accountNumberMasked: "******1002",
      accountName: "Kuda Reserve",
      currency: "NGN",
      accountType: "wallet",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "bench_zenith",
      ownerId: "user_bench",
      tenantId: "default",
      institution: { code: "057", name: "Zenith Bank", type: "commercial_bank" },
      accountNumberMasked: "******1003",
      accountName: "Zenith Payroll",
      currency: "NGN",
      accountType: "checking",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "bench_access",
      ownerId: "user_bench",
      tenantId: "default",
      institution: { code: "044", name: "Access Bank", type: "commercial_bank" },
      accountNumberMasked: "******1004",
      accountName: "Access Savings",
      currency: "NGN",
      accountType: "savings",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "bench_moniepoint",
      ownerId: "user_bench",
      tenantId: "default",
      institution: { code: "090405", name: "Moniepoint MFB", type: "microfinance" },
      accountNumberMasked: "******1005",
      accountName: "Moniepoint POS",
      currency: "NGN",
      accountType: "wallet",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ];

  function generateBenchmarkDataset(totalCount = 5000): {
    transactions: FinancialTransaction[];
    expectedTransfersCount: number;
  } {
    const transactions: FinancialTransaction[] = [];
    const baseDate = new Date("2026-01-01T00:00:00Z").getTime();
    let transferPairs = 0;

    // 1. Generate 500 paired internal transfers (1,000 transactions)
    for (let i = 0; i < 500; i++) {
      const sourceAcc = accounts[i % accounts.length];
      const targetAcc = accounts[(i + 1) % accounts.length];
      const amountKobo = BigInt((i + 1) * 10000); // ₦100 to ₦50,000
      const ref = `BENCH-TRF-REF-${i.toString().padStart(6, "0")}`;
      const timeMs = baseDate + i * 3600 * 1000;
      const debitTime = new Date(timeMs).toISOString();
      const creditTime = new Date(timeMs + 120 * 1000).toISOString(); // 2 minutes later

      transactions.push({
        id: `bench_tx_d_${i}`,
        accountId: sourceAcc.id,
        ownerId: "user_bench",
        tenantId: "default",
        postedAt: debitTime,
        amountAtoms: -amountKobo,
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: `TRF TO ${targetAcc.institution.name.toUpperCase()} / REF:${ref}`,
        cleanDescription: `Transfer to ${targetAcc.institution.name}`,
        counterparty: { institution: targetAcc.institution.name },
        category: "transfer",
        reference: ref,
        provenance: { importId: "bench_imp", fileHash: "bench_hash", rowNumber: i * 2 + 1, importedAt: "" },
      });

      transactions.push({
        id: `bench_tx_c_${i}`,
        accountId: targetAcc.id,
        ownerId: "user_bench",
        tenantId: "default",
        postedAt: creditTime,
        amountAtoms: amountKobo,
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: `INWARD TRF FROM ${sourceAcc.institution.name.toUpperCase()} / REF:${ref}`,
        cleanDescription: `Transfer from ${sourceAcc.institution.name}`,
        counterparty: { institution: sourceAcc.institution.name },
        category: "transfer",
        reference: ref,
        provenance: { importId: "bench_imp", fileHash: "bench_hash", rowNumber: i * 2 + 2, importedAt: "" },
      });

      transferPairs++;
    }

    // 2. Generate remaining 4,000 standard transactions (groceries, bills, charges, income)
    const categories = [
      { name: "Supermarket Groceries", cat: "groceries" as const, amount: -850000n },
      { name: "Electronic Money Transfer Levy (EMTL)", cat: "bank_charges" as const, amount: -5000n },
      { name: "SMS Notification Charge", cat: "bank_charges" as const, amount: -400n },
      { name: "Monthly Account Maintenance Charge", cat: "bank_charges" as const, amount: -15000n },
      { name: "Electricity Utility Bill", cat: "utilities" as const, amount: -1200000n },
      { name: "Client Retainer Payment", cat: "income" as const, amount: 25000000n },
      { name: "Spotify Subscription", cat: "entertainment" as const, amount: -120000n },
      { name: "Domino's Pizza Delivery", cat: "groceries" as const, amount: -950000n },
    ];

    for (let i = 1000; i < totalCount; i++) {
      const acc = accounts[i % accounts.length];
      const template = categories[i % categories.length];
      const timeMs = baseDate + i * 1800 * 1000;
      const postedAt = new Date(timeMs).toISOString();

      transactions.push({
        id: `bench_tx_std_${i}`,
        accountId: acc.id,
        ownerId: "user_bench",
        tenantId: "default",
        postedAt,
        amountAtoms: template.amount,
        currency: "NGN",
        scale: 2,
        status: "posted",
        rawDescription: template.name.toUpperCase(),
        cleanDescription: template.name,
        counterparty: {},
        category: template.cat,
        statementBalanceAtoms: 50000000n + BigInt(i * 1000),
        provenance: { importId: "bench_imp", fileHash: "bench_hash", rowNumber: i + 1, importedAt: "" },
      });
    }

    return {
      transactions,
      expectedTransfersCount: transferPairs * 2,
    };
  }

  it("benchmarks reconciliation search complexity on 5,000 transactions under sub-second threshold", () => {
    const { transactions, expectedTransfersCount } = generateBenchmarkDataset(5000);
    expect(transactions.length).toBe(5000);

    const start = performance.now();
    const result = reconcileCrossAccountTransfers({
      accounts,
      transactions,
    });
    const durationMs = performance.now() - start;

    // Sub-second execution target for 5,000 transactions
    expect(durationMs).toBeLessThan(1000);
    expect(result.confirmedTransfersCount).toBe(expectedTransfersCount);
    expect(result.transactions.length).toBe(5000);
  });

  it("benchmarks full deterministic analytics computation over 5,000 transactions in < 500ms", () => {
    const { transactions } = generateBenchmarkDataset(5000);

    const start = performance.now();
    const balances = computeAccountBalances(accounts, transactions);
    const cashFlow = computeCashFlow({ transactions, currency: "NGN" });
    const spending = computeSpendingBreakdown(transactions, "NGN");
    const recurring = detectRecurringTransactions(transactions, "NGN");
    const quality = evaluateDataQuality(accounts, transactions);
    const durationMs = performance.now() - start;

    expect(durationMs).toBeLessThan(500);
    expect(balances.snapshots.length).toBe(5);
    expect(cashFlow.overall.grossSpendingAtoms).toBeGreaterThan(0n);
    expect(spending.categories.length).toBeGreaterThan(0);
    expect(recurring.length).toBeGreaterThan(0);
    expect(quality.totalAccountsTracked).toBe(5);
  });

  it("benchmarks CSV export throughput (> 10,000 transactions/second)", () => {
    const { transactions } = generateBenchmarkDataset(5000);

    const start = performance.now();
    const csvOutput = exportTransactionsToCsv(transactions);
    const durationMs = performance.now() - start;

    // 5,000 rows in < 500ms => > 10,000 tx/sec throughput
    expect(durationMs).toBeLessThan(500);
    expect(csvOutput.length).toBeGreaterThan(100_000);
  });
});
