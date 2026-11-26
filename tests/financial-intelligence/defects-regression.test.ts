import { describe, expect, it } from "vitest";
import {
  type FinancialAccount,
  type FinancialTransaction,
} from "../../src/lib/financial-intelligence/types";
import { reconcileCrossAccountTransfers } from "../../src/lib/financial-intelligence/reconciliation/matcher";
import { computeAccountBalances } from "../../src/lib/financial-intelligence/analytics/balances";

describe("Defect Regression Tests — Identifying Original Flaws", () => {
  describe("Defect C: Cross-Currency Transfer Matching Vulnerability", () => {
    it("MUST NOT match transactions with different currencies even if numerical amounts match exactly", () => {
      const accounts: FinancialAccount[] = [
        {
          id: "acc_usd",
          ownerId: "user_multi",
          tenantId: "default",
          institution: { code: "MERC", name: "Mercury", type: "commercial_bank" },
          accountNumberMasked: "******1111",
          accountName: "USD Account",
          currency: "USD",
          accountType: "checking",
          createdAt: "2026-11-01T00:00:00Z",
          updatedAt: "2026-11-01T00:00:00Z",
        },
        {
          id: "acc_ngn",
          ownerId: "user_multi",
          tenantId: "default",
          institution: { code: "058", name: "GTBank", type: "commercial_bank" },
          accountNumberMasked: "******2222",
          accountName: "NGN Account",
          currency: "NGN",
          accountType: "checking",
          createdAt: "2026-11-01T00:00:00Z",
          updatedAt: "2026-11-01T00:00:00Z",
        },
      ];

      // Numerical amount 100.00 in USD (10000 cents) vs 100.00 in NGN (10000 kobo)
      const transactions: FinancialTransaction[] = [
        {
          id: "tx_usd_out",
          accountId: "acc_usd",
          ownerId: "user_multi",
          tenantId: "default",
          postedAt: "2026-11-02T10:00:00Z",
          amountAtoms: -10000n, // -100.00 USD
          currency: "USD",
          scale: 2,
          status: "posted",
          rawDescription: "Payment for Cloud Services",
          cleanDescription: "Cloud Services",
          counterparty: {},
          category: "bills",
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
        },
        {
          id: "tx_ngn_in",
          accountId: "acc_ngn",
          ownerId: "user_multi",
          tenantId: "default",
          postedAt: "2026-11-02T10:05:00Z",
          amountAtoms: 10000n, // +100.00 NGN
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "Refund from merchant",
          cleanDescription: "Merchant Refund",
          counterparty: {},
          category: "other",
          provenance: { importId: "imp_2", fileHash: "h2", rowNumber: 1, importedAt: "" },
        },
      ];

      const result = reconcileCrossAccountTransfers({
        accounts,
        transactions,
      });

      const txUsd = result.transactions.find((t) => t.id === "tx_usd_out")!;
      const txNgn = result.transactions.find((t) => t.id === "tx_ngn_in")!;

      // MUST NOT be classified as internal transfer!
      expect(txUsd.internalTransferMetadata?.isInternalTransfer ?? false).toBe(false);
      expect(txNgn.internalTransferMetadata?.isInternalTransfer ?? false).toBe(false);
      expect(result.confirmedTransfersCount).toBe(0);
      expect(result.probableTransfersCount).toBe(0);
    });

    it("MUST NOT match transactions across different tenants or owners", () => {
      const accounts: FinancialAccount[] = [
        {
          id: "acc_user1",
          ownerId: "user_1",
          tenantId: "tenant_alpha",
          institution: { code: "058", name: "GTBank", type: "commercial_bank" },
          accountNumberMasked: "******1111",
          accountName: "User 1 Account",
          currency: "NGN",
          accountType: "checking",
          createdAt: "2026-11-01T00:00:00Z",
          updatedAt: "2026-11-01T00:00:00Z",
        },
        {
          id: "acc_user2",
          ownerId: "user_2",
          tenantId: "tenant_alpha",
          institution: { code: "044", name: "Access Bank", type: "commercial_bank" },
          accountNumberMasked: "******2222",
          accountName: "User 2 Account",
          currency: "NGN",
          accountType: "checking",
          createdAt: "2026-11-01T00:00:00Z",
          updatedAt: "2026-11-01T00:00:00Z",
        },
      ];

      const transactions: FinancialTransaction[] = [
        {
          id: "tx_user1_out",
          accountId: "acc_user1",
          ownerId: "user_1",
          tenantId: "tenant_alpha",
          postedAt: "2026-11-02T10:00:00Z",
          amountAtoms: -5000000n, // -₦50,000
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "Payment to Vendor",
          cleanDescription: "Payment",
          counterparty: {},
          category: "bills",
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
        },
        {
          id: "tx_user2_in",
          accountId: "acc_user2",
          ownerId: "user_2",
          tenantId: "tenant_alpha",
          postedAt: "2026-11-02T10:05:00Z",
          amountAtoms: 5000000n, // +₦50,000
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "Client Deposit",
          cleanDescription: "Deposit",
          counterparty: {},
          category: "income",
          provenance: { importId: "imp_2", fileHash: "h2", rowNumber: 1, importedAt: "" },
        },
      ];

      const result = reconcileCrossAccountTransfers({
        accounts,
        transactions,
      });

      expect(result.confirmedTransfersCount).toBe(0);
      expect(result.probableTransfersCount).toBe(0);
      const tx1 = result.transactions.find((t) => t.id === "tx_user1_out")!;
      expect(tx1.internalTransferMetadata?.isInternalTransfer ?? false).toBe(false);
    });
  });

  describe("Defect B: Incorrect Balance Calculation Starting at Zero", () => {
    it("respects verified statement row balance observation and does not calculate from zero", () => {
      const account: FinancialAccount = {
        id: "acc_gtb_balance",
        ownerId: "user_bal",
        tenantId: "default",
        institution: { code: "058", name: "GTBank", type: "commercial_bank" },
        accountNumberMasked: "******3333",
        accountName: "Main Savings",
        currency: "NGN",
        accountType: "savings",
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
      };

      // Bank statement where bank recorded balance on each row:
      // Row 1: Opening/Previous balance with withdrawal: Debit ₦50,000, Row Balance ₦450,000.00
      // Row 2: Subsequent deposit: Credit ₦20,000, Row Balance ₦470,000.00
      const transactions: FinancialTransaction[] = [
        {
          id: "tx_1",
          accountId: "acc_gtb_balance",
          ownerId: "user_bal",
          tenantId: "default",
          postedAt: "2026-11-05T12:00:00Z",
          amountAtoms: -5000000n, // -₦50,000
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "DOMINOS PIZZA IKEJA",
          cleanDescription: "Domino's Pizza",
          counterparty: { name: "Domino's Pizza" },
          category: "groceries",
          statementBalanceAtoms: 45000000n, // ₦450,000.00
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
        },
        {
          id: "tx_2",
          accountId: "acc_gtb_balance",
          ownerId: "user_bal",
          tenantId: "default",
          postedAt: "2026-11-06T14:00:00Z",
          amountAtoms: 2000000n, // +₦20,000
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "INWARD TRANSFER",
          cleanDescription: "Transfer",
          counterparty: {},
          category: "income",
          statementBalanceAtoms: 47000000n, // ₦470,000.00
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 2, importedAt: "" },
        },
      ];

      const res = computeAccountBalances([account], transactions);
      const ngnSummary = res.currencySummaries.NGN;

      // The verified balance should be ₦470,000.00 (NOT -₦30,000.00 from naive zero-sum!)
      expect(ngnSummary.totalAtoms).toBe(47000000n);
      expect(ngnSummary.formatted).toBe("₦470,000.00");
      expect(res.snapshots[0].confidence).toBe("verified");
      expect(res.snapshots[0].availableAtoms).toBe(47000000n);
      expect(res.snapshots[0].evidenceProvenance?.sourceType).toBe("statement_row_balance");
      expect(res.snapshots[0].evidenceProvenance?.transactionId).toBe("tx_2");
    });

    it("NEVER labels an unanchored transaction delta estimate as verified available funds", () => {
      const account: FinancialAccount = {
        id: "acc_unanchored",
        ownerId: "user_bal",
        tenantId: "default",
        institution: { code: "058", name: "GTBank", type: "commercial_bank" },
        accountNumberMasked: "******4444",
        accountName: "Unanchored",
        currency: "NGN",
        accountType: "checking",
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
      };

      // Transactions WITHOUT any statement balance column
      const transactions: FinancialTransaction[] = [
        {
          id: "tx_delta",
          accountId: "acc_unanchored",
          ownerId: "user_bal",
          tenantId: "default",
          postedAt: "2026-11-05T12:00:00Z",
          amountAtoms: 5000000n, // +₦50,000
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "STIPEND",
          cleanDescription: "Stipend",
          counterparty: {},
          category: "income",
          // statementBalanceAtoms is undefined
          provenance: { importId: "imp_2", fileHash: "h2", rowNumber: 1, importedAt: "" },
        },
      ];

      const res = computeAccountBalances([account], transactions);
      const snap = res.snapshots[0];

      expect(snap.confidence).toBe("reconstructed_estimate");
      // MUST be null: Never label an estimate as available funds!
      expect(snap.availableAtoms).toBeNull();
      expect(snap.currentAtoms).toBe(5000000n);
      expect(res.hasUnverifiedEstimates).toBe(true);
      expect(res.currencySummaries.NGN.hasUnverifiedEstimates).toBe(true);
      expect(res.currencySummaries.NGN.isComplete).toBe(false);
      // Verified available funds must be 0n (NOT 50,000)!
      expect(res.currencySummaries.NGN.verifiedAvailableAtoms).toBe(0n);
      expect(res.currencySummaries.NGN.totalAtoms).toBe(5000000n);
    });
  });
});
