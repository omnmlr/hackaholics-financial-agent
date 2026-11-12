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

const GENERIC_REFERENCES = new Set([
  "n/a",
  "na",
  "none",
  "null",
  "nil",
  "ref",
  "reference",
  "transfer",
  "trf",
  "trx",
  "txn",
  "payment",
  "default",
  "undefined",
  "unknown",
  "not applicable",
  "not_applicable",
]);

/**
 * Validates that a reference string has sufficient entropy and specificity
 * to safely match transfers between accounts without false positive collisions.
 * Rejects generic placeholder values like "N/A", "REF", "NONE", short tokens (< 6 chars),
 * and strings with single repeating characters (e.g. "000000", "111111").
 */
export function isValidTransferReference(ref?: string | null): boolean {
  if (!ref || typeof ref !== "string") return false;
  const clean = ref.trim();
  if (clean.length < 6) return false;
  if (GENERIC_REFERENCES.has(clean.toLowerCase())) return false;

  // Reject single repeated character (e.g. "0000000", "111111", "------")
  const uniqueChars = new Set(clean.split(""));
  if (uniqueChars.size < 3) return false;

  // Must contain alphanumeric characters
  if (!/[a-zA-Z0-9]/.test(clean)) return false;

  return true;
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
        matchedAt: tx.userOverride.updatedAt || new Date().toISOString(),
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

  // Index credits by valid reference for O(1) Pass 1 lookups
  const creditsByRef = new Map<string, FinancialTransaction[]>();
  for (const credit of ownedCredits) {
    if (isValidTransferReference(credit.reference)) {
      const ref = credit.reference!;
      let list = creditsByRef.get(ref);
      if (!list) {
        list = [];
        creditsByRef.set(ref, list);
      }
      list.push(credit);
    }
  }

  // Pass 1: Exact reference / session ID match between different owned accounts
  for (const debit of ownedDebits) {
    if (matchedDebitIds.has(debit.id)) continue;
    if (!isValidTransferReference(debit.reference)) continue;

    const refCandidates = creditsByRef.get(debit.reference!);
    if (!refCandidates || refCandidates.length === 0) continue;

    for (const credit of refCandidates) {
      if (matchedCreditIds.has(credit.id)) continue;
      if (debit.accountId === credit.accountId) continue; // Must be between different accounts
      if (debit.currency !== credit.currency) continue; // Strict currency isolation: NEVER match cross-currency
      if (debit.ownerId !== credit.ownerId) continue; // Strict user boundary
      if (debit.tenantId !== credit.tenantId) continue; // Strict tenant boundary

      // Direct reference match
      const exactAmount = -debit.amountAtoms === credit.amountAtoms;
      const timeDiff = Math.abs(Date.parse(credit.postedAt) - Date.parse(debit.postedAt));

      if (timeDiff <= windowMs) {
        const fee = exactAmount ? 0n : (-debit.amountAtoms - credit.amountAtoms);
        if (fee < 0n) continue; // Credit cannot exceed debit on transfer

        markMatchedPair(debit, credit, "confirmed", "Exact reference and matching window", fee);
        matchedDebitIds.add(debit.id);
        matchedCreditIds.add(credit.id);
        confirmedCount += 2;
        break;
      }
    }
  }

  // Index remaining unmatched credits by amount for O(1) candidate lookup in Pass 2 & Pass 3
  const creditsByAmount = new Map<bigint, FinancialTransaction[]>();
  for (const credit of ownedCredits) {
    if (matchedCreditIds.has(credit.id)) continue;
    let list = creditsByAmount.get(credit.amountAtoms);
    if (!list) {
      list = [];
      creditsByAmount.set(credit.amountAtoms, list);
    }
    list.push(credit);
  }

  // Pass 2: Exact amount match within time window between owned accounts of the same user
  for (const debit of ownedDebits) {
    if (matchedDebitIds.has(debit.id)) continue;
    const debitAmount = -debit.amountAtoms;
    const debitTime = Date.parse(debit.postedAt);

    const amountCandidates = creditsByAmount.get(debitAmount);
    if (!amountCandidates || amountCandidates.length === 0) continue;

    // Find all candidate credits with exact amount within window
    const candidates = amountCandidates.filter((credit) => {
      if (matchedCreditIds.has(credit.id)) return false;
      if (debit.accountId === credit.accountId) return false;
      if (debit.currency !== credit.currency) return false; // Strict currency isolation
      if (debit.ownerId !== credit.ownerId) return false; // Strict owner isolation
      if (debit.tenantId !== credit.tenantId) return false; // Strict tenant isolation
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
    if (debit.currency !== "NGN") continue; // NGN kobo fee list only applies to NGN transfers
    const debitAmount = -debit.amountAtoms;
    const debitTime = Date.parse(debit.postedAt);

    for (const fee of COMMON_FEES_KOBO) {
      const principal = debitAmount - fee;
      if (principal <= 0n) continue;

      const feeCandidates = creditsByAmount.get(principal);
      if (!feeCandidates || feeCandidates.length === 0) continue;

      const candidates = feeCandidates.filter((credit) => {
        if (matchedCreditIds.has(credit.id)) return false;
        if (debit.accountId === credit.accountId) return false;
        if (debit.currency !== credit.currency) return false;
        if (debit.ownerId !== credit.ownerId) return false;
        if (debit.tenantId !== credit.tenantId) return false;
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

  // Check distinct institution keyword tokens (e.g. "kuda", "zenith", "access", "guaranty", "gtb")
  const skipWords = new Set(["bank", "microfinance", "commercial", "wallet", "checking", "savings"]);
  const creditTokens = creditBank.split(/\s+/).filter((w) => w.length >= 4 && !skipWords.has(w));
  const debitTokens = debitBank.split(/\s+/).filter((w) => w.length >= 4 && !skipWords.has(w));

  if (creditTokens.some((t) => debitDesc.includes(t)) || debitTokens.some((t) => creditDesc.includes(t))) {
    return true;
  }

  // Check common acronyms
  if (debitBank.includes("guaranty") && (creditDesc.includes("gtb") || creditDesc.includes("gtbank"))) {
    return true;
  }
  if (creditBank.includes("guaranty") && (debitDesc.includes("gtb") || debitDesc.includes("gtbank"))) {
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
