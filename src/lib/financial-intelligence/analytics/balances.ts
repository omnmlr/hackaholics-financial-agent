import {
  type AccountBalanceSnapshot,
  type BalanceConfidence,
  type BalanceSource,
  type EvidenceProvenance,
  type FinancialAccount,
  type FinancialTransaction,
  type SupportedCurrency,
  formatMonetaryAmount,
} from "../types";

export interface AccountBalanceDetail {
  accountId: string;
  institutionName: string;
  accountName: string;
  maskedNumber: string;
  availableAtoms: bigint | null;
  currentAtoms: bigint | null;
  ledgerAtoms: bigint | null;
  formattedAvailable: string;
  formattedCurrent: string;
  confidence: BalanceConfidence;
  asOf: string;
  isStale: boolean;
  stalenessReason?: string;
  evidenceProvenance?: EvidenceProvenance;
}

export interface CurrencyBalanceSummary {
  currency: SupportedCurrency;
  totalAtoms: bigint; // Total current atoms across accounts
  verifiedAvailableAtoms: bigint; // Total verified immediately available atoms
  formatted: string;
  formattedVerifiedAvailable: string;
  hasUnverifiedEstimates: boolean;
  isComplete: boolean;
  accountCount: number;
  verifiedAccountCount: number;
  accounts: AccountBalanceDetail[];
}

export interface BalancesAnalysisResult {
  asOf: string;
  currencySummaries: Record<SupportedCurrency, CurrencyBalanceSummary>;
  snapshots: AccountBalanceSnapshot[];
  hasStaleAccounts: boolean;
  hasUnverifiedEstimates: boolean;
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
    NGN: { currency: "NGN", totalAtoms: 0n, verifiedAvailableAtoms: 0n, formatted: "₦0.00", formattedVerifiedAvailable: "₦0.00", hasUnverifiedEstimates: false, isComplete: true, accountCount: 0, verifiedAccountCount: 0, accounts: [] },
    USD: { currency: "USD", totalAtoms: 0n, verifiedAvailableAtoms: 0n, formatted: "$0.00", formattedVerifiedAvailable: "$0.00", hasUnverifiedEstimates: false, isComplete: true, accountCount: 0, verifiedAccountCount: 0, accounts: [] },
    USDC: { currency: "USDC", totalAtoms: 0n, verifiedAvailableAtoms: 0n, formatted: "0.000000 USDC", formattedVerifiedAvailable: "0.000000 USDC", hasUnverifiedEstimates: false, isComplete: true, accountCount: 0, verifiedAccountCount: 0, accounts: [] },
    EUR: { currency: "EUR", totalAtoms: 0n, verifiedAvailableAtoms: 0n, formatted: "€0.00", formattedVerifiedAvailable: "€0.00", hasUnverifiedEstimates: false, isComplete: true, accountCount: 0, verifiedAccountCount: 0, accounts: [] },
    GBP: { currency: "GBP", totalAtoms: 0n, verifiedAvailableAtoms: 0n, formatted: "£0.00", formattedVerifiedAvailable: "£0.00", hasUnverifiedEstimates: false, isComplete: true, accountCount: 0, verifiedAccountCount: 0, accounts: [] },
  });

  const currencySummaries = initialSummaries();
  let globalHasUnverifiedEstimates = false;

  for (const account of accounts) {
    const accountTxs = transactions
      .filter((t) => t.accountId === account.id && t.status === "posted")
      .sort((a, b) => {
        const timeDiff = Date.parse(a.postedAt) - Date.parse(b.postedAt);
        if (timeDiff !== 0) return timeDiff;
        return (a.provenance?.rowNumber ?? 0) - (b.provenance?.rowNumber ?? 0);
      });

    let availableAtoms: bigint | null = null;
    let currentAtoms: bigint | null = null;
    let ledgerAtoms: bigint | null = null;
    let confidence: BalanceConfidence = "unverified";
    let source: BalanceSource = "unverified_estimate";
    let evidenceProvenance: EvidenceProvenance | undefined;
    let snapshotAsOf = asOf;

    // Check if there is any verified statement row balance observation
    const txsWithBalance = accountTxs.filter((t) => t.statementBalanceAtoms !== undefined);

    if (txsWithBalance.length > 0) {
      // Find the latest transaction in time that carries a verified statement balance
      const latestAnchor = txsWithBalance[txsWithBalance.length - 1];
      const anchorBalance = latestAnchor.statementBalanceAtoms!;
      const anchorTime = Date.parse(latestAnchor.postedAt);

      // Reconcile any posted transactions that occurred AFTER the anchor
      const subsequentTxs = accountTxs.filter(
        (t) => Date.parse(t.postedAt) > anchorTime && t.id !== latestAnchor.id,
      );
      const subsequentDelta = subsequentTxs.reduce((sum, t) => sum + t.amountAtoms, 0n);

      const verifiedBalance = anchorBalance + subsequentDelta;
      availableAtoms = verifiedBalance;
      currentAtoms = verifiedBalance;
      ledgerAtoms = verifiedBalance;
      confidence = "verified";
      source = subsequentTxs.length > 0 ? "reconciled_verified" : "statement_closing_balance";
      snapshotAsOf = latestAnchor.postedAt;

      evidenceProvenance = {
        sourceType: "statement_row_balance",
        importId: latestAnchor.provenance.importId,
        fileHash: latestAnchor.provenance.fileHash,
        rowNumber: latestAnchor.provenance.rowNumber,
        transactionId: latestAnchor.id,
        observedAt: latestAnchor.postedAt,
      };
    } else if (accountTxs.length > 0) {
      // No verified opening or closing balance was provided by bank statements
      // Only an unanchored transaction delta can be computed
      const netDelta = accountTxs.reduce((sum, t) => sum + t.amountAtoms, 0n);

      // CRITICAL: NEVER label an unanchored estimate as available funds!
      availableAtoms = null;
      currentAtoms = netDelta;
      ledgerAtoms = netDelta;
      confidence = "reconstructed_estimate";
      source = "unverified_estimate";
      snapshotAsOf = accountTxs[accountTxs.length - 1].postedAt;

      evidenceProvenance = {
        sourceType: "unanchored_transaction_delta",
        observedAt: snapshotAsOf,
      };
    }

    // Determine staleness
    const latestTimestampMs = accountTxs.length > 0
      ? Date.parse(accountTxs[accountTxs.length - 1].postedAt)
      : 0;

    let isStale = false;
    let stalenessReason: string | undefined;

    if (latestTimestampMs === 0) {
      isStale = true;
      stalenessReason = "No transaction or statement data uploaded";
    } else if (nowMs - latestTimestampMs > STALENESS_THRESHOLD_MS) {
      isStale = true;
      const daysOld = Math.round((nowMs - latestTimestampMs) / (86400 * 1000));
      stalenessReason = `Balance data is ${daysOld} days old; a recent statement upload is recommended`;
    }

    if (isStale) {
      stalenessWarnings.push(
        `Account ${account.institution.name} (${account.accountNumberMasked}): ${stalenessReason}.`,
      );
    }

    const snapshot: AccountBalanceSnapshot = {
      accountId: account.id,
      currency: account.currency,
      availableAtoms,
      currentAtoms,
      ledgerAtoms,
      scale: accountTxs[0]?.scale ?? 2,
      asOf: snapshotAsOf,
      source,
      confidence,
      isStale,
      stalenessReason,
      evidenceProvenance,
    };

    snapshots.push(snapshot);

    const summary = currencySummaries[account.currency];
    summary.accountCount++;

    if (currentAtoms !== null) {
      summary.totalAtoms += currentAtoms;
    }

    if (confidence === "verified" && availableAtoms !== null) {
      summary.verifiedAvailableAtoms += availableAtoms;
      summary.verifiedAccountCount++;
    } else {
      summary.hasUnverifiedEstimates = true;
      summary.isComplete = false;
      globalHasUnverifiedEstimates = true;
    }

    if (isStale) {
      summary.isComplete = false;
    }

    summary.accounts.push({
      accountId: account.id,
      institutionName: account.institution.name,
      accountName: account.accountName,
      maskedNumber: account.accountNumberMasked,
      availableAtoms,
      currentAtoms,
      ledgerAtoms,
      formattedAvailable: availableAtoms !== null
        ? formatMonetaryAmount(availableAtoms, account.currency)
        : "Unavailable (Estimated)",
      formattedCurrent: currentAtoms !== null
        ? formatMonetaryAmount(currentAtoms, account.currency)
        : "No Data",
      confidence,
      asOf: snapshotAsOf,
      isStale,
      stalenessReason,
      evidenceProvenance,
    });
  }

  // Format currency summaries
  for (const currency of Object.keys(currencySummaries) as SupportedCurrency[]) {
    currencySummaries[currency].formatted = formatMonetaryAmount(
      currencySummaries[currency].totalAtoms,
      currency,
    );
    currencySummaries[currency].formattedVerifiedAvailable = formatMonetaryAmount(
      currencySummaries[currency].verifiedAvailableAtoms,
      currency,
    );
  }

  return {
    asOf,
    currencySummaries,
    snapshots,
    hasStaleAccounts: stalenessWarnings.length > 0,
    hasUnverifiedEstimates: globalHasUnverifiedEstimates,
    stalenessWarnings,
  };
}
