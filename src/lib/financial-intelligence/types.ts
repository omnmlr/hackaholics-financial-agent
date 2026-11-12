import { z } from "zod";

/**
 * AGUS Multi-Account Financial Intelligence
 * Canonical Domain Types & Invariants
 *
 * Tagline: "Your money, and what's next."
 */

export const SupportedCurrencySchema = z.enum(["NGN", "USD", "USDC", "EUR", "GBP"]);
export type SupportedCurrency = z.infer<typeof SupportedCurrencySchema>;

export const CurrencyScale: Record<SupportedCurrency, number> = {
  NGN: 2, // Kobo
  USD: 2, // Cents
  USDC: 6, // Micro-USDC (6 decimals on Solana/canonical)
  EUR: 2, // Cents
  GBP: 2, // Pence
};

export const InstitutionTypeSchema = z.enum([
  "commercial_bank",
  "microfinance",
  "fintech_wallet",
  "crypto_wallet",
  "investment_platform",
]);
export type InstitutionType = z.infer<typeof InstitutionTypeSchema>;

export const AccountTypeSchema = z.enum([
  "checking",
  "savings",
  "wallet",
  "investment",
  "credit",
]);
export type AccountType = z.infer<typeof AccountTypeSchema>;

export const InstitutionInfoSchema = z.strictObject({
  code: z.string().min(1).max(32),
  name: z.string().min(1).max(100),
  type: InstitutionTypeSchema,
});
export type InstitutionInfo = z.infer<typeof InstitutionInfoSchema>;

export const FinancialAccountSchema = z.strictObject({
  id: z.string().min(1).max(128),
  ownerId: z.string().min(1).max(128),
  tenantId: z.string().min(1).max(128).default("default"),
  institution: InstitutionInfoSchema,
  accountNumberMasked: z.string().min(1).max(32),
  accountName: z.string().min(1).max(100),
  currency: SupportedCurrencySchema,
  accountType: AccountTypeSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type FinancialAccount = z.infer<typeof FinancialAccountSchema>;

export const BalanceSourceSchema = z.enum([
  "statement_import",
  "sync",
  "manual",
  "reconciled_ledger",
]);
export type BalanceSource = z.infer<typeof BalanceSourceSchema>;

export interface AccountBalanceSnapshot {
  accountId: string;
  currency: SupportedCurrency;
  availableAtoms: bigint | null;
  currentAtoms: bigint | null;
  ledgerAtoms: bigint | null;
  scale: number;
  asOf: string; // ISO 8601
  source: BalanceSource;
  isStale: boolean;
  stalenessReason?: string;
}

export const TransactionStatusSchema = z.enum([
  "pending",
  "posted",
  "reversed",
  "corrected",
  "duplicate",
]);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const TransactionCategorySchema = z.enum([
  "income",
  "transfer",
  "bills",
  "groceries",
  "transport",
  "utilities",
  "bank_charges",
  "shopping",
  "entertainment",
  "health",
  "education",
  "investment",
  "other",
]);
export type TransactionCategory = z.infer<typeof TransactionCategorySchema>;

export const ReconciliationConfidenceSchema = z.enum([
  "confirmed",
  "probable",
  "unresolved",
  "not_internal",
]);
export type ReconciliationConfidence = z.infer<typeof ReconciliationConfidenceSchema>;

export interface InternalTransferMetadata {
  isInternalTransfer: boolean;
  confidence: ReconciliationConfidence;
  counterpartTransactionId?: string;
  counterpartAccountId?: string;
  transferFeeAtoms?: bigint;
  matchReason?: string;
  matchedBy: "auto" | "user_override";
  matchedAt: string;
}

export interface TransactionProvenance {
  importId: string;
  fileHash: string;
  rowNumber: number;
  importedAt: string;
}

export interface UserClassificationOverride {
  category?: TransactionCategory;
  isInternalTransfer?: boolean;
  counterpartAccountId?: string;
  notes?: string;
  updatedAt: string;
}

export interface FinancialTransaction {
  id: string;
  accountId: string;
  ownerId: string;
  tenantId: string;
  sourceTransactionId?: string;
  postedAt: string; // ISO 8601
  valueAt?: string; // ISO 8601
  amountAtoms: bigint; // Signed: positive = credit/inflow, negative = debit/outflow
  currency: SupportedCurrency;
  scale: number;
  status: TransactionStatus;
  reversalOfId?: string;
  rawDescription: string;
  cleanDescription: string;
  counterparty: {
    name?: string;
    institution?: string;
    accountNumberMasked?: string;
  };
  category: TransactionCategory;
  reference?: string;
  internalTransferMetadata?: InternalTransferMetadata;
  userOverride?: UserClassificationOverride;
  provenance: TransactionProvenance;
}

/**
 * Currency amount representation helper
 */
export interface SerializedMonetaryAmount {
  atoms: string; // string-encoded bigint
  scale: number;
  currency: SupportedCurrency;
  formatted: string;
}

export function formatMonetaryAmount(
  amountAtoms: bigint,
  currency: SupportedCurrency,
): string {
  const scale = CurrencyScale[currency];
  const isNegative = amountAtoms < 0n;
  const absAtoms = isNegative ? -amountAtoms : amountAtoms;
  const divisor = 10n ** BigInt(scale);
  const whole = absAtoms / divisor;
  const fractional = (absAtoms % divisor).toString().padStart(scale, "0");

  const sign = isNegative ? "-" : "";
  const wholeFormatted = whole.toLocaleString("en-US");

  if (currency === "NGN") {
    return `${sign}₦${wholeFormatted}.${fractional}`;
  }
  if (currency === "USD") {
    return `${sign}$${wholeFormatted}.${fractional}`;
  }
  if (currency === "USDC") {
    return `${sign}${wholeFormatted}.${fractional} USDC`;
  }
  if (currency === "EUR") {
    return `${sign}€${wholeFormatted}.${fractional}`;
  }
  if (currency === "GBP") {
    return `${sign}£${wholeFormatted}.${fractional}`;
  }
  return `${sign}${wholeFormatted}.${fractional} ${currency}`;
}

export function serializeMonetaryAmount(
  amountAtoms: bigint,
  currency: SupportedCurrency,
): SerializedMonetaryAmount {
  return {
    atoms: amountAtoms.toString(),
    scale: CurrencyScale[currency],
    currency,
    formatted: formatMonetaryAmount(amountAtoms, currency),
  };
}

export class CurrencyMismatchError extends Error {
  constructor(c1: string, c2: string) {
    super(`Cannot combine different currencies directly: ${c1} and ${c2}. Explicit exchange rate required.`);
    this.name = "CurrencyMismatchError";
  }
}

export function assertSameCurrency(
  c1: SupportedCurrency,
  c2: SupportedCurrency,
): void {
  if (c1 !== c2) {
    throw new CurrencyMismatchError(c1, c2);
  }
}
