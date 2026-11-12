import {
  type AccountBalanceSnapshot,
  type FinancialAccount,
  type FinancialTransaction,
  type SupportedCurrency,
  formatMonetaryAmount,
} from "../types";

export interface CurrencyBalanceSummary {
  currency: SupportedCurrency;
  totalAtoms: bigint;
  formatted: string;
  accountCount: number;
  accounts: {
    accountId: string;
    institutionName: string;
    accountName: string;
    maskedNumber: string;
    balanceAtoms: bigint;
    formatted: string;
    isStale: boolean;
  }[];
}

export interface BalancesAnalysisResult {
  asOf: string;
  currencySummaries: Record<SupportedCurrency, CurrencyBalanceSummary>;
  snapshots: AccountBalanceSnapshot[];
  hasStaleAccounts: boolean;
  stalenessWarnings: string[];
}

const STALENESS_THRESHOLD_MS = 30 * 86400 * 1000; // 30 days

export function computeAccountBalances(
  accounts: FinancialAccount[],
  transactions: FinancialTransaction[],
  nowMs: number = Date.now(),
): BalancesAnalysisResult {
  const asOf = new Date(nowMs).toISOString();
  const snapshots: AccountBalanceSnapshot[] = [];
  const stalenessWarnings: string[] = [];

  const initialSummaries = (): Record<SupportedCurrency, CurrencyBalanceSummary> => ({
    NGN: { currency: "NGN", totalAtoms: 0n, formatted: "₦0.00", accountCount: 0, accounts: [] },
    USD: { currency: "USD", totalAtoms: 0n, formatted: "$0.00", accountCount: 0, accounts: [] },
    USDC: { currency: "USDC", totalAtoms: 0n, formatted: "0.000000 USDC", accountCount: 0, accounts: [] },
    EUR: { currency: "EUR", totalAtoms: 0n, formatted: "€0.00", accountCount: 0, accounts: [] },
    GBP: { currency: "GBP", totalAtoms: 0n, formatted: "£0.00", accountCount: 0, accounts: [] },
  });

  const currencySummaries = initialSummaries();

  for (const account of accounts) {
    const accountTxs = transactions.filter(
      (t) => t.accountId === account.id && t.status === "posted",
    );

    let netBalanceAtoms = 0n;
    let latestTimestampMs = 0;

    for (const tx of accountTxs) {
      netBalanceAtoms += tx.amountAtoms;
      const txTime = Date.parse(tx.postedAt);
      if (txTime > latestTimestampMs) {
        latestTimestampMs = txTime;
      }
    }

    const isStale =
      latestTimestampMs === 0 || (nowMs - latestTimestampMs > STALENESS_THRESHOLD_MS);

    if (isStale) {
      const daysOld = latestTimestampMs === 0
        ? "no transactions recorded"
        : `${Math.round((nowMs - latestTimestampMs) / (86400 * 1000))} days old`;
      stalenessWarnings.push(
        `Account ${account.institution.name} (${account.accountNumberMasked}) data is stale (${daysOld}).`,
      );
    }

    const snapshot: AccountBalanceSnapshot = {
      accountId: account.id,
      currency: account.currency,
      availableAtoms: netBalanceAtoms,
      currentAtoms: netBalanceAtoms,
      ledgerAtoms: netBalanceAtoms,
      scale: accountTxs[0]?.scale ?? 2,
      asOf,
      source: "reconciled_ledger",
      isStale,
      stalenessReason: isStale ? "No recent transaction activity in over 30 days" : undefined,
    };

    snapshots.push(snapshot);

    const summary = currencySummaries[account.currency];
    summary.totalAtoms += netBalanceAtoms;
    summary.accountCount++;
    summary.accounts.push({
      accountId: account.id,
      institutionName: account.institution.name,
      accountName: account.accountName,
      maskedNumber: account.accountNumberMasked,
      balanceAtoms: netBalanceAtoms,
      formatted: formatMonetaryAmount(netBalanceAtoms, account.currency),
      isStale,
    });
  }

  // Format the aggregate totals for each currency
  for (const currency of Object.keys(currencySummaries) as SupportedCurrency[]) {
    currencySummaries[currency].formatted = formatMonetaryAmount(
      currencySummaries[currency].totalAtoms,
      currency,
    );
  }

  return {
    asOf,
    currencySummaries,
    snapshots,
    hasStaleAccounts: stalenessWarnings.length > 0,
    stalenessWarnings,
  };
}
