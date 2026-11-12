import {
  type FinancialAccount,
  type FinancialTransaction,
} from "../types";

export interface ReconcileOptions {
  accounts: FinancialAccount[];
  transactions: FinancialTransaction[];
  timeWindowHours?: number; // default 48 hours
}

export interface ReconcileResult {
  transactions: FinancialTransaction[];
  confirmedTransfersCount: number;
  probableTransfersCount: number;
  unresolvedCount: number;
}

/**
 * Cross-account reconciliation engine.
 * Correlates transfers between owned accounts of the same user.
 */
export function reconcileCrossAccountTransfers(
  options: ReconcileOptions,
): ReconcileResult {
  const {
    accounts,
    transactions,
    timeWindowHours = 48,
  } = options;

  const windowMs = timeWindowHours * 3600 * 1000;
  const ownedAccountIds = new Set(accounts.map((a) => a.id));

  // Clone transactions
  const txList = transactions.map((t) => ({ ...t }));

  // Separate debits and credits among owned accounts
  const ownedDebits: FinancialTransaction[] = [];
  const ownedCredits: FinancialTransaction[] = [];

  for (const tx of txList) {
    // Respect existing user overrides first!
    if (tx.userOverride?.isInternalTransfer !== undefined) {
      tx.internalTransferMetadata = {
        isInternalTransfer: tx.userOverride.isInternalTransfer,
        confidence: tx.userOverride.isInternalTransfer ? "confirmed" : "not_internal",
        counterpartAccountId: tx.userOverride.counterpartAccountId,
        matchedBy: "user_override",
        matchedAt: tx.userOverride.updatedAt,
      };
      continue;
    }

    // Skip already reversed transactions
    if (tx.status === "reversed" || tx.category === "bank_charges") {
      continue;
    }

    if (ownedAccountIds.has(tx.accountId)) {
      if (tx.amountAtoms < 0n) {
        ownedDebits.push(tx);
      } else if (tx.amountAtoms > 0n) {
        ownedCredits.push(tx);
      }
    }
  }

  const matchedDebitIds = new Set<string>();
  const matchedCreditIds = new Set<string>();

  let confirmedCount = 0;
  let probableCount = 0;
  let unresolvedCount = 0;

  // Pass 1: Exact reference / session ID match between different owned accounts
  for (const debit of ownedDebits) {
    if (matchedDebitIds.has(debit.id)) continue;
    if (!debit.reference) continue;

    for (const credit of ownedCredits) {
      if (matchedCreditIds.has(credit.id)) continue;
      if (debit.accountId === credit.accountId) continue; // Must be between different accounts
      if (!credit.reference) continue;

      if (debit.reference === credit.reference) {
        // Direct reference match
        const exactAmount = -debit.amountAtoms === credit.amountAtoms;
        const timeDiff = Math.abs(Date.parse(credit.postedAt) - Date.parse(debit.postedAt));

        if (timeDiff <= windowMs) {
          const fee = exactAmount ? 0n : (-debit.amountAtoms - credit.amountAtoms);

          markMatchedPair(debit, credit, "confirmed", "Exact reference and matching window", fee);
          matchedDebitIds.add(debit.id);
          matchedCreditIds.add(credit.id);
          confirmedCount += 2;
          break;
        }
      }
    }
  }

  // Pass 2: Exact amount match within time window between owned accounts
  for (const debit of ownedDebits) {
    if (matchedDebitIds.has(debit.id)) continue;
    const debitAmount = -debit.amountAtoms;
    const debitTime = Date.parse(debit.postedAt);

    // Find all candidate credits with exact amount within window
    const candidates = ownedCredits.filter((credit) => {
      if (matchedCreditIds.has(credit.id)) return false;
      if (debit.accountId === credit.accountId) return false;
      if (credit.amountAtoms !== debitAmount) return false;
      const creditTime = Date.parse(credit.postedAt);
      const diff = creditTime - debitTime;
      // Credit must occur between (debitTime - 2 hours) and (debitTime + windowMs)
      return diff >= -2 * 3600 * 1000 && diff <= windowMs;
    });

    if (candidates.length === 1) {
      const credit = candidates[0];
      // Check if there is narration or counterparty correlation
      const hasNarrationHint =
        hasCorrelationHint(debit, credit, accounts);

      const confidence = hasNarrationHint ? "confirmed" : "probable";

      markMatchedPair(
        debit,
        credit,
        confidence,
        hasNarrationHint
          ? "Exact amount and matching counterparty / narration hint"
          : "Exact amount match within time window between owned accounts",
        0n,
      );

      matchedDebitIds.add(debit.id);
      matchedCreditIds.add(credit.id);

      if (confidence === "confirmed") confirmedCount += 2;
      else probableCount += 2;
    } else if (candidates.length > 1) {
      // Ambiguous multiple candidates
      debit.internalTransferMetadata = {
        isInternalTransfer: false,
        confidence: "unresolved",
        matchReason: `Ambiguous: ${candidates.length} matching credits found on owned accounts`,
        matchedBy: "auto",
        matchedAt: new Date().toISOString(),
      };
      unresolvedCount++;
    }
  }

  // Pass 3: Amount with common transfer fee (e.g. ₦10, ₦26.88, ₦53.75) splitting
  // In case debit amount includes fee (e.g. ₦50,053.75 debit, ₦50,000 credit)
  const COMMON_FEES_KOBO = [1000n, 2688n, 5375n, 5000n]; // ₦10, ₦26.88, ₦53.75, ₦50

  for (const debit of ownedDebits) {
    if (matchedDebitIds.has(debit.id)) continue;
    const debitAmount = -debit.amountAtoms;
    const debitTime = Date.parse(debit.postedAt);

    for (const fee of COMMON_FEES_KOBO) {
      const principal = debitAmount - fee;
      if (principal <= 0n) continue;

      const candidates = ownedCredits.filter((credit) => {
        if (matchedCreditIds.has(credit.id)) return false;
        if (debit.accountId === credit.accountId) return false;
        if (credit.amountAtoms !== principal) return false;
        const creditTime = Date.parse(credit.postedAt);
        const diff = creditTime - debitTime;
        return diff >= -2 * 3600 * 1000 && diff <= windowMs;
      });

      if (candidates.length === 1) {
        const credit = candidates[0];
        markMatchedPair(
          debit,
          credit,
          "probable",
          `Amount match with fee deduction (${fee.toString()} atoms)`,
          fee,
        );
        matchedDebitIds.add(debit.id);
        matchedCreditIds.add(credit.id);
        probableCount += 2;
        break;
      }
    }
  }

  return {
    transactions: txList,
    confirmedTransfersCount: confirmedCount,
    probableTransfersCount: probableCount,
    unresolvedCount,
  };
}

function markMatchedPair(
  debit: FinancialTransaction,
  credit: FinancialTransaction,
  confidence: "confirmed" | "probable",
  reason: string,
  feeAtoms: bigint,
): void {
  const now = new Date().toISOString();

  debit.internalTransferMetadata = {
    isInternalTransfer: true,
    confidence,
    counterpartTransactionId: credit.id,
    counterpartAccountId: credit.accountId,
    transferFeeAtoms: feeAtoms > 0n ? feeAtoms : undefined,
    matchReason: reason,
    matchedBy: "auto",
    matchedAt: now,
  };
  debit.category = "transfer";

  credit.internalTransferMetadata = {
    isInternalTransfer: true,
    confidence,
    counterpartTransactionId: debit.id,
    counterpartAccountId: debit.accountId,
    matchReason: reason,
    matchedBy: "auto",
    matchedAt: now,
  };
  credit.category = "transfer";
}

function hasCorrelationHint(
  debit: FinancialTransaction,
  credit: FinancialTransaction,
  accounts: FinancialAccount[],
): boolean {
  const debitAccount = accounts.find((a) => a.id === debit.accountId);
  const creditAccount = accounts.find((a) => a.id === credit.accountId);

  if (!debitAccount || !creditAccount) return false;

  const debitDesc = debit.rawDescription.toLowerCase();
  const creditDesc = credit.rawDescription.toLowerCase();

  // If credit bank name appears in debit narration or vice versa
  const creditBank = creditAccount.institution.name.toLowerCase();
  const debitBank = debitAccount.institution.name.toLowerCase();

  if (debitDesc.includes(creditBank) || creditDesc.includes(debitBank)) {
    return true;
  }

  // If masked account numbers appear in description
  const creditMasked = creditAccount.accountNumberMasked.replace(/[*.]/g, "");
  const debitMasked = debitAccount.accountNumberMasked.replace(/[*.]/g, "");

  if (creditMasked.length >= 4 && debitDesc.includes(creditMasked)) {
    return true;
  }
  if (debitMasked.length >= 4 && creditDesc.includes(debitMasked)) {
    return true;
  }

  return false;
}
