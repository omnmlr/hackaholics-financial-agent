import { createHash } from "node:crypto";
import { type FinancialTransaction } from "../types";

export function computeFileHash(bufferOrString: Buffer | string): string {
  return createHash("sha256").update(bufferOrString).digest("hex");
}

export function computeTransactionFingerprint(tx: {
  accountId: string;
  postedAt: string;
  amountAtoms: bigint;
  cleanDescription: string;
  reference?: string;
}): string {
  const parts = [
    tx.accountId,
    tx.postedAt.slice(0, 10), // Date part is most stable across bank statement revisions
    tx.amountAtoms.toString(),
    tx.cleanDescription.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim(),
    tx.reference ? tx.reference.trim() : "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export interface IngestionAuditRecord {
  importId: string;
  fileHash: string;
  fileName: string;
  accountId: string;
  ownerId: string;
  importedAt: string;
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  skippedCount: number;
  warnings: string[];
}

export interface DeduplicationResult {
  acceptedTransactions: FinancialTransaction[];
  duplicateTransactions: FinancialTransaction[];
  duplicateCount: number;
}

/**
 * Filter out duplicate transactions against existing account transactions using fingerprints.
 */
export function deduplicateTransactions(
  incoming: FinancialTransaction[],
  existing: FinancialTransaction[],
): DeduplicationResult {
  const existingFingerprints = new Set(
    existing.map((t) => computeTransactionFingerprint(t)),
  );

  const seenInBatch = new Set<string>();
  const acceptedTransactions: FinancialTransaction[] = [];
  const duplicateTransactions: FinancialTransaction[] = [];

  for (const tx of incoming) {
    const fp = computeTransactionFingerprint(tx);

    if (existingFingerprints.has(fp) || seenInBatch.has(fp)) {
      duplicateTransactions.push({
        ...tx,
        status: "duplicate",
      });
    } else {
      seenInBatch.add(fp);
      acceptedTransactions.push(tx);
    }
  }

  return {
    acceptedTransactions,
    duplicateTransactions,
    duplicateCount: duplicateTransactions.length,
  };
}
