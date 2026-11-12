import { describe, expect, it } from "vitest";
import {
  type FinancialAccount,
  type FinancialTransaction,
  formatMonetaryAmount,
} from "../../src/lib/financial-intelligence/types";
import {
  isValidTransferReference,
  reconcileCrossAccountTransfers,
} from "../../src/lib/financial-intelligence/reconciliation/matcher";
import {
  exportTransactionsToCsv,
  formatAtomsToDecimal,
  sanitizeFieldForCsvExport,
} from "../../src/lib/financial-intelligence/export/csv-export";
import { parseMonetaryAtoms, parseStatementDate } from "../../src/lib/financial-intelligence/ingestion/normalizer";
import { deduplicateTransactions } from "../../src/lib/financial-intelligence/ingestion/idempotency";
import { computeAccountBalances } from "../../src/lib/financial-intelligence/analytics/balances";

describe("Financial Intelligence — Adversarial Financial Correctness & Boundary Audit", () => {
  const accountA: FinancialAccount = {
    id: "acc_bank_a",
    ownerId: "user_audit",
    tenantId: "default",
    institution: { code: "058", name: "Guaranty Trust Bank", type: "commercial_bank" },
    accountNumberMasked: "******1111",
    accountName: "GTB Primary",
    currency: "NGN",
    accountType: "checking",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };

  const accountB: FinancialAccount = {
    id: "acc_bank_b",
    ownerId: "user_audit",
    tenantId: "default",
    institution: { code: "090267", name: "Kuda Microfinance Bank", type: "microfinance" },
    accountNumberMasked: "******2222",
    accountName: "Kuda Spend",
    currency: "NGN",
    accountType: "wallet",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  };

  describe("1. Transfer Reference Hardening & Collision Resistance", () => {
    it("rejects generic placeholder references, short tokens, and repeating patterns", () => {
      // Common bank placeholder tokens that must NEVER trigger Pass 1 transfer matches
      const genericPlaceholders = [
        "N/A",
        "n/a",
        "NONE",
        "none",
        "NULL",
        "null",
        "REF",
        "ref",
        "TRF",
        "TRX",
        "TXN",
        "TRANSFER",
        "0",
        "000000",
        "111111",
        "------",
        "xxxxxx",
        "   ",
        "A1",
        "123",
      ];

      for (const placeholder of genericPlaceholders) {
        expect(isValidTransferReference(placeholder)).toBe(false);
      }

      // Valid references with sufficient entropy and specificity
      expect(isValidTransferReference("9988776655")).toBe(true);
      expect(isValidTransferReference("NIP/090267/38492019")).toBe(true);
      expect(isValidTransferReference("GTB-TX-202611-8492")).toBe(true);
      expect(isValidTransferReference("REF-94021A")).toBe(true);
    });

    it("prevents false cross-account transfer correlation when two unrelated transactions share generic references", () => {
      const txs: FinancialTransaction[] = [
        {
          id: "tx_generic_debit",
          accountId: "acc_bank_a",
          ownerId: "user_audit",
          tenantId: "default",
          postedAt: "2026-11-02T10:00:00Z",
          amountAtoms: -750000n, // -₦7,500
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "POS GROCERY PURCHASE",
          cleanDescription: "POS Grocery Purchase",
          counterparty: {},
          category: "groceries",
          reference: "N/A", // Bank populated generic "N/A"
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
        },
        {
          id: "tx_generic_credit",
          accountId: "acc_bank_b",
          ownerId: "user_audit",
          tenantId: "default",
          postedAt: "2026-11-02T10:05:00Z",
          amountAtoms: 820000n, // +₦8,200 (different amount, so Pass 2 will not match)
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "FREELANCE DESIGN GIG PAYMENT",
          cleanDescription: "Freelance Design Gig Payment",
          counterparty: {},
          category: "income",
          reference: "N/A", // Also generic "N/A"
          provenance: { importId: "imp_2", fileHash: "h2", rowNumber: 1, importedAt: "" },
        },
      ];

      const result = reconcileCrossAccountTransfers({
        accounts: [accountA, accountB],
        transactions: txs,
      });

      // Pass 1 must NOT match them because "N/A" is an invalid reference!
      const debit = result.transactions.find((t) => t.id === "tx_generic_debit")!;
      const credit = result.transactions.find((t) => t.id === "tx_generic_credit")!;

      expect(debit.internalTransferMetadata?.isInternalTransfer).toBeUndefined();
      expect(credit.internalTransferMetadata?.isInternalTransfer).toBeUndefined();
      expect(result.confirmedTransfersCount).toBe(0);
      expect(result.probableTransfersCount).toBe(0);
    });
  });

  describe("2. CSV Export Sanitization vs Ingestion Fidelity", () => {
    it("disarms malicious formula injection prefixes when exporting to CSV", () => {
      // Attacks targeting Excel DDE, LibreOffice Calc, Google Sheets
      const injectionPayloads = [
        "=cmd|' /C calc'!A0",
        "+SUM(A1:A10)",
        "-2+3+cmd|' /C calc'!A0",
        "@SUM(B1:B10)",
        "\t=2+5",
        "\r=1+1",
        "%COMSPEC%",
        "|whoami",
      ];

      for (const payload of injectionPayloads) {
        const sanitized = sanitizeFieldForCsvExport(payload, true);
        // Must either start with quote or have quotes disarming it
        expect(
          sanitized.startsWith("'") ||
          sanitized.startsWith("\"'") ||
          sanitized.startsWith("\"")
        ).toBe(true);
      }
    });

    it("does NOT disarm legitimate negative or positive financial numbers during export", () => {
      // Financial amounts like -1500.50 or +250.00 must remain valid numbers for spreadsheets
      expect(sanitizeFieldForCsvExport("-1500.50", true)).toBe("-1500.50");
      expect(sanitizeFieldForCsvExport("+250.00", true)).toBe("+250.00");
      expect(sanitizeFieldForCsvExport("0.00", true)).toBe("0.00");
    });

    it("formats atoms to exact decimal strings without IEEE 754 precision loss or scientific notation", () => {
      // 50,000,000 NGN kobo = ₦500,000.00
      expect(formatAtomsToDecimal(50000000n, 2)).toBe("500000.00");
      // -12540 kobo = -125.40
      expect(formatAtomsToDecimal(-12540n, 2)).toBe("-125.40");
      // Micro-unit USDC (scale 6)
      expect(formatAtomsToDecimal(1500000n, 6)).toBe("1.500000");
      // Zero
      expect(formatAtomsToDecimal(0n, 2)).toBe("0.00");
      // Smallest unit
      expect(formatAtomsToDecimal(1n, 2)).toBe("0.01");
      expect(formatAtomsToDecimal(-1n, 2)).toBe("-0.01");
      // Huge trillion kobo value
      const oneTrillionKobo = 100000000000000n; // ₦1,000,000,000,000.00
      expect(formatAtomsToDecimal(oneTrillionKobo, 2)).toBe("1000000000000.00");
    });

    it("exports complete transaction table adhering to RFC 4180 with headers and escaped fields", () => {
      const txs: FinancialTransaction[] = [
        {
          id: "tx_exp_1",
          accountId: "acc_bank_a",
          ownerId: "user_audit",
          tenantId: "default",
          postedAt: "2026-11-04T12:00:00Z",
          amountAtoms: -1250000n,
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "AIRTIME MTN, LAGOS",
          cleanDescription: "Airtime / Mobile Data (MTN)",
          counterparty: { name: "MTN Nigeria", institution: "MTN" },
          category: "utilities",
          reference: "MTN9402819",
          statementBalanceAtoms: 8750000n,
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
        },
        {
          id: "tx_exp_danger",
          accountId: "acc_bank_a",
          ownerId: "user_audit",
          tenantId: "default",
          postedAt: "2026-11-04T13:00:00Z",
          amountAtoms: -50000n,
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "=SUM(A1:A10)", // Malicious user description
          cleanDescription: "=SUM(A1:A10)",
          counterparty: {},
          category: "other",
          statementBalanceAtoms: 8700000n,
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 2, importedAt: "" },
        },
      ];

      const csvOutput = exportTransactionsToCsv(txs);
      expect(csvOutput).toContain("Transaction ID,Account ID,Posted At");
      expect(csvOutput).toContain("tx_exp_1,acc_bank_a");
      expect(csvOutput).toContain("-12500.00");
      expect(csvOutput).toContain("87500.00");
      // The malicious description must be neutralized with a single quote
      expect(csvOutput).toContain("'=SUM(A1:A10)");
    });
  });

  describe("3. Extreme Numerical Values & BigInt Scale Bounds", () => {
    it("safely handles multi-trillion minor-unit transactions without overflow", () => {
      // 500 Trillion Kobo = ₦5 Trillion
      const massiveAmountStr = "5000000000000.00";
      const atoms = parseMonetaryAtoms(massiveAmountStr, "NGN");
      expect(atoms).toBe(500000000000000n);

      const formatted = formatMonetaryAmount(atoms, "NGN");
      expect(formatted).toBe("₦5,000,000,000,000.00");

      // Negative massive amount
      const negativeAtoms = parseMonetaryAtoms("-5000000000000.00", "NGN");
      expect(negativeAtoms).toBe(-500000000000000n);
      expect(formatMonetaryAmount(negativeAtoms, "NGN")).toBe("-₦5,000,000,000,000.00");
    });
  });

  describe("4. Malformed Dates & Timezone Ingestion Robustness", () => {
    it("accurately parses dates across WAT, UTC, UK/NG format, and ISO strings", () => {
      // Standard Nigerian DD-Mon-YYYY with WAT (UTC+1) assumption
      const parsed1 = parseStatementDate("12-Nov-2026");
      expect(parsed1).toBe("2026-11-12T11:00:00.000Z"); // 12:00 WAT - 1 hr = 11:00 UTC

      // DD/MM/YYYY
      const parsed2 = parseStatementDate("05/11/2026");
      expect(parsed2).toBe("2026-11-05T11:00:00.000Z");

      // ISO 8601 with explicit UTC Z
      const parsedIso = parseStatementDate("2026-11-10T15:30:00.000Z");
      expect(parsedIso).toBe("2026-11-10T15:30:00.000Z");
    });

    it("throws a descriptive error on completely invalid non-date strings", () => {
      expect(() => parseStatementDate("not_a_date")).toThrow("Unable to parse statement date");
      expect(() => parseStatementDate("")).toThrow("Invalid date string");
    });
  });

  describe("5. Out-of-Order Transactions & Chronological Balance Anchoring", () => {
    it("anchors on the chronologically latest statement balance regardless of ingestion input order", () => {
      // Transactions imported in reverse order
      const outOfOrderTxs: FinancialTransaction[] = [
        {
          id: "tx_late_posted",
          accountId: "acc_bank_a",
          ownerId: "user_audit",
          tenantId: "default",
          postedAt: "2026-11-10T12:00:00Z", // Latest date
          amountAtoms: -200000n, // -₦2,000
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "LATE TX",
          cleanDescription: "Late Tx",
          counterparty: {},
          category: "other",
          statementBalanceAtoms: 9800000n, // ₦98,000 closing balance on Nov 10
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
        },
        {
          id: "tx_early_posted",
          accountId: "acc_bank_a",
          ownerId: "user_audit",
          tenantId: "default",
          postedAt: "2026-11-01T10:00:00Z", // Early date
          amountAtoms: 10000000n, // +₦100,000
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "EARLY OPENING DEPOSIT",
          cleanDescription: "Early Opening Deposit",
          counterparty: {},
          category: "income",
          statementBalanceAtoms: 10000000n, // ₦100,000 opening balance on Nov 1
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 2, importedAt: "" },
        },
      ];

      const balanceResult = computeAccountBalances([accountA], outOfOrderTxs);
      const accDetail = balanceResult.currencySummaries.NGN.accounts[0];

      // Must anchor on the Nov 10 balance (₦98,000), not the Nov 1 balance (₦100,000)
      expect(accDetail.availableAtoms).toBe(9800000n);
      expect(accDetail.formattedAvailable).toBe("₦98,000.00");
      expect(accDetail.confidence).toBe("verified");
      expect(accDetail.evidenceProvenance?.transactionId).toBe("tx_late_posted");
    });
  });

  describe("6. Overlapping Partial Statement Deduplication & Inflation Defense", () => {
    it("deduplicates overlapping transactions and prevents balance or spending inflation", () => {
      const existingTxs: FinancialTransaction[] = [
        {
          id: "tx_overlap_1",
          accountId: "acc_bank_a",
          ownerId: "user_audit",
          tenantId: "default",
          postedAt: "2026-11-05T12:00:00Z",
          amountAtoms: -500000n,
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "SUPERMARKET SHOPPING",
          cleanDescription: "Supermarket Shopping",
          counterparty: {},
          category: "groceries",
          reference: "REF-992019",
          provenance: { importId: "imp_part1", fileHash: "h_part1", rowNumber: 1, importedAt: "" },
        },
      ];

      // Second file imports overlapping transaction with identical account, date, amount, description, reference
      const incomingTxs: FinancialTransaction[] = [
        {
          id: "tx_overlap_duplicate",
          accountId: "acc_bank_a",
          ownerId: "user_audit",
          tenantId: "default",
          postedAt: "2026-11-05T12:00:00Z",
          amountAtoms: -500000n,
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "SUPERMARKET SHOPPING",
          cleanDescription: "Supermarket Shopping",
          counterparty: {},
          category: "groceries",
          reference: "REF-992019",
          provenance: { importId: "imp_part2", fileHash: "h_part2", rowNumber: 1, importedAt: "" },
        },
        {
          id: "tx_new_row",
          accountId: "acc_bank_a",
          ownerId: "user_audit",
          tenantId: "default",
          postedAt: "2026-11-06T14:00:00Z",
          amountAtoms: -150000n,
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "CAFE COFFEE",
          cleanDescription: "Cafe Coffee",
          counterparty: {},
          category: "groceries",
          reference: "REF-992020",
          provenance: { importId: "imp_part2", fileHash: "h_part2", rowNumber: 2, importedAt: "" },
        },
      ];

      const dedup = deduplicateTransactions(incomingTxs, existingTxs);

      expect(dedup.duplicateCount).toBe(1);
      expect(dedup.duplicateTransactions[0].status).toBe("duplicate");
      expect(dedup.acceptedTransactions.length).toBe(1);
      expect(dedup.acceptedTransactions[0].id).toBe("tx_new_row");
    });
  });
});
