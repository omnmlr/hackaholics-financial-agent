import { describe, expect, it } from "vitest";
import {
  parseCsv,
  sanitizeCsvField,
} from "../../src/lib/financial-intelligence/ingestion/csv-parser";
import {
  detectStatementFormat,
} from "../../src/lib/financial-intelligence/ingestion/format-detector";
import {
  parseStatementDate,
  parseMonetaryAtoms,
  analyzeNarration,
} from "../../src/lib/financial-intelligence/ingestion/normalizer";
import {
  computeTransactionFingerprint,
  deduplicateTransactions,
} from "../../src/lib/financial-intelligence/ingestion/idempotency";
import { linkReversals } from "../../src/lib/financial-intelligence/ingestion/corrections";
import { type FinancialTransaction } from "../../src/lib/financial-intelligence/types";

describe("Financial Intelligence - Safe CSV Parser & Ingestion Engine", () => {
  describe("CSV Formula Injection Protection", () => {
    it("disarms dangerous formula injection payloads starting with =, +, -, @", () => {
      expect(sanitizeCsvField("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
      expect(sanitizeCsvField("=1+1")).toBe("'=1+1");
      expect(sanitizeCsvField("@SUM(B2:B5)")).toBe("'@SUM(B2:B5)");
      expect(sanitizeCsvField("+cmd|'/C calc'!A0")).toBe("'+cmd|'/C calc'!A0");
      expect(sanitizeCsvField("-cmd|'/C calc'!A0")).toBe("'-cmd|'/C calc'!A0");
    });

    it("disarms tab and carriage return injection characters", () => {
      expect(sanitizeCsvField("\t=HYPERLINK()")).toBe("'=HYPERLINK()");
      expect(sanitizeCsvField("hello\tworld\rtest")).toBe("hello world test");
    });

    it("preserves genuine numeric literals (including negative amounts)", () => {
      expect(sanitizeCsvField("-1500.50")).toBe("-1500.50");
      expect(sanitizeCsvField("+25000")).toBe("+25000");
      expect(sanitizeCsvField("100.00")).toBe("100.00");
      expect(sanitizeCsvField("0")).toBe("0");
    });
  });

  describe("RFC 4180 Parsing Compliance", () => {
    it("handles quoted fields with commas and escaped quotes", () => {
      const csv = `Date,Description,Amount\n"2026-11-01","Payment to ""Dominos, Pizza""",1500.00`;
      const rows = parseCsv(csv);
      expect(rows.length).toBe(2);
      expect(rows[1][1]).toBe('Payment to "Dominos, Pizza"');
      expect(rows[1][2]).toBe("1500.00");
    });

    it("handles multiline quoted fields", () => {
      const csv = `"Date","Description","Amount"\n"2026-11-01","Line 1\nLine 2",500.00`;
      const rows = parseCsv(csv);
      expect(rows.length).toBe(2);
      expect(rows[1][1]).toContain("Line 1");
      expect(rows[1][1]).toContain("Line 2");
    });

    it("strips UTF-8 BOM automatically", () => {
      const csvWithBom = `\uFEFFDate,Description,Amount\n2026-11-01,Test,100`;
      const rows = parseCsv(csvWithBom);
      expect(rows[0][0]).toBe("Date");
    });

    it("enforces maximum row limits against memory exhaustion DOS", () => {
      const longCsv = "Date,Amount\n" + "2026-11-01,100\n".repeat(50);
      expect(() => parseCsv(longCsv, { maxRows: 20 })).toThrow(/exceeded maximum allowed rows limit/);
    });
  });

  describe("Statement Format Detection", () => {
    it("detects GTBank format", () => {
      const sample = [
        ["Trans Date", "Value Date", "Reference", "Debits", "Credits", "Balance", "Remarks"],
        ["01-Nov-2026", "01-Nov-2026", "REF12345", "1,500.00", "", "98,500.00", "POS PURCHASE"],
      ];
      const result = detectStatementFormat(sample);
      expect(result.format).toBe("gtbank");
      expect(result.columnIndices.debit).toBe(3);
      expect(result.columnIndices.credit).toBe(4);
      expect(result.columnIndices.description).toBe(6);
    });

    it("detects Access Bank format", () => {
      const sample = [
        ["Trans. Date", "Value Date", "Description", "Debit", "Credit", "Balance"],
        ["01/11/2026", "01/11/2026", "TRF VIA MOBILE", "2,000.00", "", "50,000.00"],
      ];
      const result = detectStatementFormat(sample);
      expect(result.format).toBe("access_bank");
      expect(result.columnIndices.date).toBe(0);
      expect(result.columnIndices.debit).toBe(3);
      expect(result.columnIndices.credit).toBe(4);
    });

    it("detects Kuda format", () => {
      const sample = [
        ["Date", "Description", "Amount", "Balance", "Type"],
        ["2026-11-01", "Airtime Purchase", "500.00", "15,000.00", "Debit"],
      ];
      const result = detectStatementFormat(sample);
      expect(result.format).toBe("kuda");
      expect(result.columnIndices.type).toBe(4);
    });

    it("detects Moniepoint format", () => {
      const sample = [
        ["Date & Time", "Transaction Type", "Amount", "Fee", "Beneficiary/Sender", "Status", "Session ID"],
        ["01-Nov-2026 14:20:00", "Transfer", "10,000.00", "10.00", "John Doe", "Successful", "10000423456789"],
      ];
      const result = detectStatementFormat(sample);
      expect(result.format).toBe("moniepoint");
      expect(result.columnIndices.fee).toBe(3);
      expect(result.columnIndices.reference).toBe(6);
    });
  });

  describe("Date & Amount Normalization", () => {
    it("parses Nigerian DD/MM/YYYY date format to UTC ISO", () => {
      const iso = parseStatementDate("05/11/2026");
      expect(iso).toMatch(/^2026-11-05T/);
    });

    it("parses DD-Mon-YYYY format to UTC ISO", () => {
      const iso = parseStatementDate("12-Nov-2026");
      expect(iso).toMatch(/^2026-11-12T/);
    });

    it("converts amounts to integer kobo (atoms) with exact precision", () => {
      expect(parseMonetaryAtoms("1,250.75", "NGN")).toBe(125075n);
      expect(parseMonetaryAtoms("₦50,000.00", "NGN")).toBe(5000000n);
      expect(parseMonetaryAtoms("-2,400.50", "NGN")).toBe(-240050n);
      expect(parseMonetaryAtoms("0.05", "NGN")).toBe(5n);
    });

    it("converts USDC amounts with 6 decimal places", () => {
      expect(parseMonetaryAtoms("100.50", "USDC")).toBe(100500000n);
      expect(parseMonetaryAtoms("1.000001", "USDC")).toBe(1000001n);
    });
  });

  describe("Narration Categorization", () => {
    it("identifies bank stamp duties (EMTL)", () => {
      const a = analyzeNarration("ELECTRONIC MONEY TRANSFER LEVY FOR TRF 00123");
      expect(a.isBankCharge).toBe(true);
      expect(a.category).toBe("bank_charges");
      expect(a.cleanDescription).toContain("Stamp Duty");
    });

    it("identifies bank SMS charges", () => {
      const a = analyzeNarration("SMS ALERT CHARGE FOR OCT 2026");
      expect(a.isBankCharge).toBe(true);
      expect(a.category).toBe("bank_charges");
    });

    it("identifies subscriptions like Netflix and Spotify", () => {
      const netflix = analyzeNarration("POS/WEB/NETFLIX.COM AMSTERDAM NL");
      expect(netflix.cleanDescription).toContain("Netflix");
      expect(netflix.category).toBe("entertainment");

      const spotify = analyzeNarration("SPOTIFY AB STOCKHOLM SE");
      expect(spotify.cleanDescription).toContain("Spotify");
    });
  });

  describe("Idempotency & Reversals", () => {
    it("generates stable transaction fingerprints", () => {
      const fp1 = computeTransactionFingerprint({
        accountId: "acc_1",
        postedAt: "2026-11-01T12:00:00Z",
        amountAtoms: 10000n,
        cleanDescription: "Payment for groceries",
        reference: "REF123",
      });
      const fp2 = computeTransactionFingerprint({
        accountId: "acc_1",
        postedAt: "2026-11-01T14:30:00Z", // same day
        amountAtoms: 10000n,
        cleanDescription: "payment for groceries ",
        reference: "REF123",
      });
      expect(fp1).toBe(fp2);
    });

    it("deduplicates transactions accurately", () => {
      const existing: FinancialTransaction[] = [
        {
          id: "tx_1",
          accountId: "acc_1",
          ownerId: "u_1",
          tenantId: "default",
          postedAt: "2026-11-01T10:00:00Z",
          amountAtoms: 500000n,
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "Income",
          cleanDescription: "Income",
          counterparty: {},
          category: "income",
          reference: "REF_001",
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
        },
      ];

      const incoming: FinancialTransaction[] = [
        existing[0], // Duplicate
        {
          id: "tx_2",
          accountId: "acc_1",
          ownerId: "u_1",
          tenantId: "default",
          postedAt: "2026-11-02T10:00:00Z",
          amountAtoms: -100000n,
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "Groceries",
          cleanDescription: "Groceries",
          counterparty: {},
          category: "groceries",
          reference: "REF_002",
          provenance: { importId: "imp_2", fileHash: "h2", rowNumber: 2, importedAt: "" },
        },
      ];

      const res = deduplicateTransactions(incoming, existing);
      expect(res.duplicateCount).toBe(1);
      expect(res.acceptedTransactions.length).toBe(1);
      expect(res.acceptedTransactions[0].id).toBe("tx_2");
    });

    it("detects and links reversal pairs", () => {
      const txs: FinancialTransaction[] = [
        {
          id: "tx_debit",
          accountId: "acc_1",
          ownerId: "u_1",
          tenantId: "default",
          postedAt: "2026-11-01T10:00:00Z",
          amountAtoms: -2500000n, // ₦25,000 debit
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "TRF TO ADE / REF 999",
          cleanDescription: "Transfer",
          counterparty: {},
          category: "transfer",
          reference: "999",
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 1, importedAt: "" },
        },
        {
          id: "tx_reversal",
          accountId: "acc_1",
          ownerId: "u_1",
          tenantId: "default",
          postedAt: "2026-11-01T12:00:00Z",
          amountAtoms: 2500000n, // ₦25,000 credit
          currency: "NGN",
          scale: 2,
          status: "posted",
          rawDescription: "FAILED NIP REVERSAL / REF 999",
          cleanDescription: "Reversal",
          counterparty: {},
          category: "transfer",
          reference: "999",
          provenance: { importId: "imp_1", fileHash: "h1", rowNumber: 2, importedAt: "" },
        },
      ];

      const { reconciledTransactions, reversalPairs } = linkReversals(txs);
      expect(reversalPairs.length).toBe(1);
      expect(reversalPairs[0].originalTransactionId).toBe("tx_debit");
      expect(reversalPairs[0].reversalTransactionId).toBe("tx_reversal");

      const debit = reconciledTransactions.find((t) => t.id === "tx_debit")!;
      const reversal = reconciledTransactions.find((t) => t.id === "tx_reversal")!;

      expect(debit.status).toBe("reversed");
      expect(reversal.status).toBe("reversed");
      expect(reversal.reversalOfId).toBe("tx_debit");
    });
  });
});
