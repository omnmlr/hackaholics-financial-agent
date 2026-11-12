import {
  type FinancialTransaction,
  type SupportedCurrency,
  formatMonetaryAmount,
} from "../types";

export interface CashFlowPeriod {
  periodKey: string; // "YYYY-MM" or "total"
  currency: SupportedCurrency;
  grossIncomeAtoms: bigint;
  grossSpendingAtoms: bigint;
  netCashFlowAtoms: bigint;
  savingsRatePercentage: number | null;
  formattedIncome: string;
  formattedSpending: string;
  formattedNet: string;
  incomeTransactionIds: string[];
  spendingTransactionIds: string[];
  internalTransfersExcludedCount: number;
}

export interface CashFlowAnalysisOptions {
  transactions: FinancialTransaction[];
  currency?: SupportedCurrency; // If omitted, defaults to NGN
  from?: string; // ISO 8601
  toExclusive?: string; // ISO 8601
  groupBy?: "none" | "month";
}

export interface CashFlowAnalysisResult {
  currency: SupportedCurrency;
  overall: CashFlowPeriod;
  periods: CashFlowPeriod[];
  excludedInternalTransfersCount: number;
  excludedReversalsCount: number;
}

export function computeCashFlow(
  options: CashFlowAnalysisOptions,
): CashFlowAnalysisResult {
  const {
    transactions,
    currency = "NGN",
    from,
    toExclusive,
    groupBy = "month",
  } = options;

  const fromTime = from ? Date.parse(from) : 0;
  const toTime = toExclusive ? Date.parse(toExclusive) : Infinity;

  // Filter transactions by currency and date range
  const relevantTxs = transactions.filter((tx) => {
    if (tx.currency !== currency) return false;
    const t = Date.parse(tx.postedAt);
    return t >= fromTime && t < toTime;
  });

  let excludedInternalCount = 0;
  let excludedReversalsCount = 0;

  // Periods map
  const periodMap = new Map<string, {
    incomeAtoms: bigint;
    spendingAtoms: bigint;
    incomeIds: string[];
    spendingIds: string[];
    internalExcluded: number;
  }>();

  const getOrCreatePeriod = (key: string) => {
    let p = periodMap.get(key);
    if (!p) {
      p = {
        incomeAtoms: 0n,
        spendingAtoms: 0n,
        incomeIds: [],
        spendingIds: [],
        internalExcluded: 0,
      };
      periodMap.set(key, p);
    }
    return p;
  };

  for (const tx of relevantTxs) {
    const periodKey = groupBy === "month" ? tx.postedAt.slice(0, 7) : "total";
    const period = getOrCreatePeriod(periodKey);

    // Skip reversed transactions completely
    if (tx.status === "reversed" || tx.reversalOfId) {
      excludedReversalsCount++;
      continue;
    }

    // Skip pending / duplicate / non-posted
    if (tx.status !== "posted") {
      continue;
    }

    // Check if internal transfer
    if (tx.internalTransferMetadata?.isInternalTransfer) {
      excludedInternalCount++;
      period.internalExcluded++;

      // However, if there was an explicit transfer fee recorded on the debit, that fee IS a genuine bank charge
      const fee = tx.internalTransferMetadata.transferFeeAtoms;
      if (fee && fee > 0n && tx.amountAtoms < 0n) {
        period.spendingAtoms += fee;
        period.spendingIds.push(tx.id);
      }
      continue;
    }

    if (tx.amountAtoms > 0n) {
      // Inflow / Income
      period.incomeAtoms += tx.amountAtoms;
      period.incomeIds.push(tx.id);
    } else if (tx.amountAtoms < 0n) {
      // Outflow / Spending
      const absSpending = -tx.amountAtoms;
      period.spendingAtoms += absSpending;
      period.spendingIds.push(tx.id);
    }
  }

  // Build period results
  const periods: CashFlowPeriod[] = [];
  let overallIncome = 0n;
  let overallSpending = 0n;
  const overallIncomeIds: string[] = [];
  const overallSpendingIds: string[] = [];

  const sortedKeys = Array.from(periodMap.keys()).sort();

  for (const key of sortedKeys) {
    const data = periodMap.get(key)!;
    const net = data.incomeAtoms - data.spendingAtoms;
    const savingsRate = data.incomeAtoms > 0n
      ? Number((net * 10000n) / data.incomeAtoms) / 100
      : null;

    periods.push({
      periodKey: key,
      currency,
      grossIncomeAtoms: data.incomeAtoms,
      grossSpendingAtoms: data.spendingAtoms,
      netCashFlowAtoms: net,
      savingsRatePercentage: savingsRate,
      formattedIncome: formatMonetaryAmount(data.incomeAtoms, currency),
      formattedSpending: formatMonetaryAmount(data.spendingAtoms, currency),
      formattedNet: formatMonetaryAmount(net, currency),
      incomeTransactionIds: data.incomeIds,
      spendingTransactionIds: data.spendingIds,
      internalTransfersExcludedCount: data.internalExcluded,
    });

    overallIncome += data.incomeAtoms;
    overallSpending += data.spendingAtoms;
    overallIncomeIds.push(...data.incomeIds);
    overallSpendingIds.push(...data.spendingIds);
  }

  const overallNet = overallIncome - overallSpending;
  const overallSavingsRate = overallIncome > 0n
    ? Number((overallNet * 10000n) / overallIncome) / 100
    : null;

  const overall: CashFlowPeriod = {
    periodKey: "total",
    currency,
    grossIncomeAtoms: overallIncome,
    grossSpendingAtoms: overallSpending,
    netCashFlowAtoms: overallNet,
    savingsRatePercentage: overallSavingsRate,
    formattedIncome: formatMonetaryAmount(overallIncome, currency),
    formattedSpending: formatMonetaryAmount(overallSpending, currency),
    formattedNet: formatMonetaryAmount(overallNet, currency),
    incomeTransactionIds: overallIncomeIds,
    spendingTransactionIds: overallSpendingIds,
    internalTransfersExcludedCount: excludedInternalCount,
  };

  return {
    currency,
    overall,
    periods,
    excludedInternalTransfersCount: excludedInternalCount,
    excludedReversalsCount: excludedReversalsCount,
  };
}
