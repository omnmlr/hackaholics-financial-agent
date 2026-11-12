import { randomUUID } from "node:crypto";
import {
  type FinancialTransaction,
  type SupportedCurrency,
} from "../types";
import { parseCsv } from "./csv-parser";
import { detectStatementFormat } from "./format-detector";
import { normalizeStatementRow } from "./normalizer";
import {
  computeFileHash,
  deduplicateTransactions,
  type IngestionAuditRecord,
} from "./idempotency";
import { linkReversals } from "./corrections";

export interface IngestionOptions {
  content: string | Buffer;
  fileName: string;
  accountId: string;
  ownerId: string;
  tenantId?: string;
  currency: SupportedCurrency;
  existingTransactions?: FinancialTransaction[];
}

export interface IngestionResult {
  importId: string;
  fileHash: string;
  fileName: string;
  format: string;
  totalParsedRows: number;
  importedTransactions: FinancialTransaction[];
  duplicateTransactions: FinancialTransaction[];
  allTransactions: FinancialTransaction[];
  audit: IngestionAuditRecord;
  warnings: string[];
}

export function ingestStatementFile(options: IngestionOptions): IngestionResult {
  const {
    content,
    fileName,
    accountId,
    ownerId,
    tenantId = "default",
    currency,
    existingTransactions = [],
  } = options;

  const contentStr = typeof content === "string" ? content : content.toString("utf-8");
  const fileHash = computeFileHash(contentStr);
  const importId = `imp_${randomUUID().slice(0, 8)}`;
  const warnings: string[] = [];

  // Parse CSV securely
  const rawRows = parseCsv(contentStr);
  if (rawRows.length === 0) {
    throw new Error("Statement file is empty or contains no readable rows");
  }

  // Detect format
  const formatInfo = detectStatementFormat(rawRows);

  const candidateTransactions: FinancialTransaction[] = [];
  const startRow = formatInfo.headerRowIndex + 1;

  for (let r = startRow; r < rawRows.length; r++) {
    const row = rawRows[r];
    try {
      const tx = normalizeStatementRow({
        row,
        formatInfo,
        currency,
        accountId,
        ownerId,
        tenantId,
        importId,
        fileHash,
        rowNumber: r + 1,
      });

      if (tx) {
        candidateTransactions.push(tx);
      }
    } catch {
      // Safely skip malformed rows without breaking ingestion
      warnings.push(`Row ${r + 1} was skipped due to invalid date or unparseable amount format.`);
    }
  }

  if (candidateTransactions.length === 0) {
    warnings.push("No valid transaction rows could be normalized from the statement.");
  }

  // Deduplicate against existing account transactions
  const { acceptedTransactions, duplicateTransactions, duplicateCount } =
    deduplicateTransactions(candidateTransactions, existingTransactions);

  // Combine with existing transactions and run reversal linking
  const combined = [...existingTransactions, ...acceptedTransactions];
  const { reconciledTransactions } = linkReversals(combined);

  // Filter newly accepted from the reconciled set
  const newlyImportedIds = new Set(acceptedTransactions.map((t) => t.id));
  const newlyReconciled = reconciledTransactions.filter((t) => newlyImportedIds.has(t.id));

  const audit: IngestionAuditRecord = {
    importId,
    fileHash,
    fileName,
    accountId,
    ownerId,
    importedAt: new Date().toISOString(),
    totalRows: rawRows.length - startRow,
    importedCount: newlyReconciled.length,
    duplicateCount,
    skippedCount: warnings.length,
    warnings,
  };

  return {
    importId,
    fileHash,
    fileName,
    format: formatInfo.format,
    totalParsedRows: rawRows.length,
    importedTransactions: newlyReconciled,
    duplicateTransactions,
    allTransactions: reconciledTransactions,
    audit,
    warnings,
  };
}
