import {
  type FinancialTransaction,
  type SupportedCurrency,
  formatMonetaryAmount,
} from "../types";

export type RecurringCadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual" | "irregular";

export interface RecurringCommitment {
  id: string;
  merchantName: string;
  category: string;
  currency: SupportedCurrency;
  cadence: RecurringCadence;
  averageAmountAtoms: bigint;
  formattedAverageAmount: string;
  latestAmountAtoms: bigint;
  formattedLatestAmount: string;
  direction: "inflow" | "outflow";
  isFixedAmount: boolean;
  occurrenceCount: number;
  firstObservedAt: string;
  latestObservedAt: string;
  predictedNextAt?: string;
  transactionIds: string[];
}

export function detectRecurringTransactions(
  transactions: FinancialTransaction[],
  currency: SupportedCurrency = "NGN",
): RecurringCommitment[] {
  // Filter posted, non-reversed, non-internal transactions
  const validTxs = transactions.filter((tx) => {
    if (tx.currency !== currency) return false;
    if (tx.status !== "posted") return false;
    if (tx.reversalOfId) return false;
    if (tx.internalTransferMetadata?.isInternalTransfer) return false;
    return true;
  });

  // Group by clean counterparty name or normalized cleanDescription
  const groups = new Map<string, FinancialTransaction[]>();

  for (const tx of validTxs) {
    const key = (tx.counterparty.name || tx.cleanDescription)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!key || key.length < 3) continue;

    let list = groups.get(key);
    if (!list) {
      list = [];
      groups.set(key, list);
    }
    list.push(tx);
  }

  const results: RecurringCommitment[] = [];

  for (const [key, groupTxs] of groups.entries()) {
    if (groupTxs.length < 2) continue; // Need at least 2 occurrences to establish recurrence

    // Sort chronologically
    groupTxs.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));

    // Calculate intervals in days
    const intervalsDays: number[] = [];
    for (let i = 1; i < groupTxs.length; i++) {
      const diffMs = Date.parse(groupTxs[i].postedAt) - Date.parse(groupTxs[i - 1].postedAt);
      const days = diffMs / (86400 * 1000);
      intervalsDays.push(days);
    }

    const avgInterval = intervalsDays.reduce((a, b) => a + b, 0) / intervalsDays.length;

    let cadence: RecurringCadence = "irregular";
    if (avgInterval >= 5 && avgInterval <= 9) cadence = "weekly";
    else if (avgInterval >= 12 && avgInterval <= 16) cadence = "biweekly";
    else if (avgInterval >= 25 && avgInterval <= 35) cadence = "monthly";
    else if (avgInterval >= 80 && avgInterval <= 100) cadence = "quarterly";
    else if (avgInterval >= 350 && avgInterval <= 380) cadence = "annual";

    // Only accept if cadence is recognized or if at least 3 occurrences with consistent interval
    if (cadence === "irregular" && groupTxs.length < 3) {
      continue;
    }

    // Amounts analysis
    const absAmounts = groupTxs.map((t) => (t.amountAtoms < 0n ? -t.amountAtoms : t.amountAtoms));
    const totalAmount = absAmounts.reduce((a, b) => a + b, 0n);
    const avgAmount = totalAmount / BigInt(absAmounts.length);
    const latestTx = groupTxs[groupTxs.length - 1];
    const latestAmount = latestTx.amountAtoms < 0n ? -latestTx.amountAtoms : latestTx.amountAtoms;

    const isFixed = absAmounts.every((amt) => {
      const diff = amt > avgAmount ? amt - avgAmount : avgAmount - amt;
      return diff <= (avgAmount * 5n) / 100n; // within 5% tolerance
    });

    // Predict next date
    let predictedNextAt: string | undefined;
    if (cadence !== "irregular") {
      const latestMs = Date.parse(latestTx.postedAt);
      const cadenceDays = cadence === "weekly" ? 7 : cadence === "biweekly" ? 14 : cadence === "monthly" ? 30 : 365;
      predictedNextAt = new Date(latestMs + cadenceDays * 86400 * 1000).toISOString();
    }

    const displayName = groupTxs[0].counterparty.name || groupTxs[0].cleanDescription;

    results.push({
      id: `rec_${key.replace(/\s+/g, "_")}`,
      merchantName: displayName,
      category: groupTxs[0].category,
      currency,
      cadence,
      averageAmountAtoms: avgAmount,
      formattedAverageAmount: formatMonetaryAmount(avgAmount, currency),
      latestAmountAtoms: latestAmount,
      formattedLatestAmount: formatMonetaryAmount(latestAmount, currency),
      direction: groupTxs[0].amountAtoms > 0n ? "inflow" : "outflow",
      isFixedAmount: isFixed,
      occurrenceCount: groupTxs.length,
      firstObservedAt: groupTxs[0].postedAt,
      latestObservedAt: latestTx.postedAt,
      predictedNextAt,
      transactionIds: groupTxs.map((t) => t.id),
    });
  }

  // Sort by highest average amount
  results.sort((a, b) => (b.averageAmountAtoms > a.averageAmountAtoms ? 1 : -1));

  return results;
}
