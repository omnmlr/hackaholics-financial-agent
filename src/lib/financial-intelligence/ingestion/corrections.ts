import { type FinancialTransaction } from "../types";

export interface ReversalPair {
  originalTransactionId: string;
  reversalTransactionId: string;
  amountAtoms: bigint;
  detectedAt: string;
}

/**
 * Identify and link reversal and correction transactions.
 * Scans for credit transactions that mirror an earlier debit (or vice versa)
 * with matching amounts and reversal narrations or matching references.
 */
export function linkReversals(
  transactions: FinancialTransaction[],
): {
  reconciledTransactions: FinancialTransaction[];
  reversalPairs: ReversalPair[];
} {
  const txList = transactions.map((t) => ({ ...t }));
  const reversalPairs: ReversalPair[] = [];

  // Sort by postedAt ascending
  txList.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));

  for (let i = 0; i < txList.length; i++) {
    const current = txList[i];

    // Check if current is a credit that indicates reversal
    const descUpper = current.rawDescription.toUpperCase();
    const isReversalNarrative =
      descUpper.includes("REVERSAL") ||
      descUpper.includes("REFUND") ||
      descUpper.includes("RETRACTED") ||
      descUpper.includes("FAILED NIP") ||
      descUpper.includes("RETURNED");

    if (current.amountAtoms > 0n && isReversalNarrative) {
      // Look back for a corresponding debit with identical absolute amount on the same account
      for (let j = i - 1; j >= 0; j--) {
        const candidate = txList[j];

        if (
          candidate.accountId === current.accountId &&
          candidate.amountAtoms === -current.amountAtoms &&
          candidate.status !== "reversed"
        ) {
          // Check reference match or narrative correlation or within reasonable time window (e.g. 7 days)
          const timeDiffMs = Math.abs(Date.parse(current.postedAt) - Date.parse(candidate.postedAt));
          const withinWindow = timeDiffMs <= 7 * 86400000;

          const refMatch =
            current.reference &&
            candidate.reference &&
            current.reference === candidate.reference;

          if (refMatch || withinWindow) {
            candidate.status = "reversed";
            current.status = "reversed";
            current.reversalOfId = candidate.id;

            reversalPairs.push({
              originalTransactionId: candidate.id,
              reversalTransactionId: current.id,
              amountAtoms: current.amountAtoms,
              detectedAt: new Date().toISOString(),
            });
            break;
          }
        }
      }
    }
  }

  return {
    reconciledTransactions: txList,
    reversalPairs,
  };
}
