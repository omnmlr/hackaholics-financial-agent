import {
  type FinancialAccount,
  type FinancialTransaction,
} from "../types";

export interface DataGap {
  accountId: string;
  accountLabel: string;
  gapFrom: string;
  gapTo: string;
  gapDays: number;
  reason: string;
}

export interface DataQualityReport {
  overallHealthScore: number; // 0 to 100
  totalAccountsTracked: number;
  totalTransactionsRecorded: number;
  unreconciledProbableTransfersCount: number;
  staleAccountsCount: number;
  identifiedGaps: DataGap[];
  warnings: string[];
}

export function evaluateDataQuality(
  accounts: FinancialAccount[],
  transactions: FinancialTransaction[],
  nowMs: number = Date.now(),
): DataQualityReport {
  const warnings: string[] = [];
  const gaps: DataGap[] = [];
  let staleCount = 0;
  let probableTransfers = 0;

  for (const acc of accounts) {
    const accTxs = transactions
      .filter((t) => t.accountId === acc.id && t.status === "posted")
      .sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));

    const label = `${acc.institution.name} (${acc.accountNumberMasked})`;

    if (accTxs.length === 0) {
      warnings.push(`Account ${label} has no transaction history uploaded.`);
      staleCount++;
      continue;
    }

    // Check latest activity
    const latestTxTime = Date.parse(accTxs[accTxs.length - 1].postedAt);
    const daysSinceLatest = Math.round((nowMs - latestTxTime) / (86400 * 1000));

    if (daysSinceLatest > 30) {
      staleCount++;
      warnings.push(`Account ${label} is ${daysSinceLatest} days stale. A recent statement is recommended.`);
    }

    // Detect internal statement gaps (> 45 days of silence in an active checking account)
    for (let i = 1; i < accTxs.length; i++) {
      const prevTime = Date.parse(accTxs[i - 1].postedAt);
      const currTime = Date.parse(accTxs[i].postedAt);
      const diffDays = Math.round((currTime - prevTime) / (86400 * 1000));

      if (diffDays > 45) {
        gaps.push({
          accountId: acc.id,
          accountLabel: label,
          gapFrom: accTxs[i - 1].postedAt,
          gapTo: accTxs[i].postedAt,
          gapDays: diffDays,
          reason: `Potential missing statement period of ${diffDays} days between records.`,
        });
      }
    }
  }

  // Count unconfirmed probable transfers
  for (const tx of transactions) {
    if (tx.internalTransferMetadata?.confidence === "probable") {
      probableTransfers++;
    }
  }

  if (probableTransfers > 0) {
    warnings.push(
      `${Math.ceil(probableTransfers / 2)} probable internal transfer pairs require user confirmation.`,
    );
  }

  // Calculate health score
  let score = 100;
  score -= staleCount * 15;
  score -= gaps.length * 10;
  score -= Math.min(20, Math.ceil(probableTransfers / 2) * 5);
  score = Math.max(0, Math.min(100, score));

  return {
    overallHealthScore: score,
    totalAccountsTracked: accounts.length,
    totalTransactionsRecorded: transactions.length,
    unreconciledProbableTransfersCount: Math.ceil(probableTransfers / 2),
    staleAccountsCount: staleCount,
    identifiedGaps: gaps,
    warnings,
  };
}
