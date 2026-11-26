import {
  CurrencyScale,
  type FinancialTransaction,
  type SupportedCurrency,
  type TransactionCategory,
} from "../types";
import { type DetectedFormatResult } from "./format-detector";

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Parse date strings into UTC ISO string.
 * Defaults to Africa/Lagos (UTC+1, offset +60 minutes) if no offset is present.
 */
export function parseStatementDate(dateStr: string): string {
  if (!dateStr || typeof dateStr !== "string") {
    throw new Error(`Invalid date string: ${dateStr}`);
  }

  const trimmed = dateStr.trim();

  // Try ISO parse first if format contains T or Z
  if (trimmed.includes("T") || trimmed.endsWith("Z")) {
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  // Common format: DD-Mon-YYYY or DD-Mon-YY (e.g. 12-Nov-2026 or 12-Nov-26)
  const monMatch = trimmed.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[-/ ](\d{2,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i);
  if (monMatch) {
    const day = parseInt(monMatch[1], 10);
    const month = MONTH_MAP[monMatch[2].toLowerCase()];
    let year = parseInt(monMatch[3], 10);
    if (year < 100) year += 2000;

    let hour = monMatch[4] ? parseInt(monMatch[4], 10) : 12; // default midday Lagos
    const min = monMatch[5] ? parseInt(monMatch[5], 10) : 0;
    const sec = monMatch[6] ? parseInt(monMatch[6], 10) : 0;
    const ampm = monMatch[7]?.toUpperCase();

    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    // Create in UTC subtracting 1 hour for Lagos (UTC+1)
    const dateUtc = new Date(Date.UTC(year, month, day, hour - 1, min, sec));
    if (!Number.isNaN(dateUtc.getTime())) return dateUtc.toISOString();
  }

  // DD/MM/YYYY or YYYY-MM-DD or DD-MM-YYYY
  const numericMatch = trimmed.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?)?$/i);
  if (numericMatch) {
    let year: number;
    let month: number;
    let day: number;

    const p1 = parseInt(numericMatch[1], 10);
    const p2 = parseInt(numericMatch[2], 10);
    const p3 = parseInt(numericMatch[3], 10);

    if (p1 > 1000) {
      // YYYY-MM-DD
      year = p1;
      month = p2 - 1;
      day = p3;
    } else {
      // DD/MM/YYYY (standard in Nigeria / UK)
      day = p1;
      month = p2 - 1;
      year = p3 < 100 ? p3 + 2000 : p3;
    }

    let hour = numericMatch[4] ? parseInt(numericMatch[4], 10) : 12;
    const min = numericMatch[5] ? parseInt(numericMatch[5], 10) : 0;
    const sec = numericMatch[6] ? parseInt(numericMatch[6], 10) : 0;
    const ampm = numericMatch[7]?.toUpperCase();

    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    const dateUtc = new Date(Date.UTC(year, month, day, hour - 1, min, sec));
    if (!Number.isNaN(dateUtc.getTime())) return dateUtc.toISOString();
  }

  const fallback = new Date(trimmed);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback.toISOString();
  }

  throw new Error(`Unable to parse statement date: "${dateStr}"`);
}

/**
 * Parse an amount string into integer atoms (e.g. kobo for NGN).
 * Returns absolute BigInt.
 */
export function parseMonetaryAtoms(
  valueStr: string,
  currency: SupportedCurrency,
): bigint {
  if (!valueStr || typeof valueStr !== "string") {
    return 0n;
  }

  // Remove currency signs, commas, spaces, single quotes
  let cleaned = valueStr.replace(/[^0-9.-]/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === ".") {
    return 0n;
  }

  const isNegative = cleaned.startsWith("-");
  if (isNegative) {
    cleaned = cleaned.slice(1);
  }

  const scale = CurrencyScale[currency];
  const parts = cleaned.split(".");
  const wholePart = parts[0] || "0";
  const fracPart = (parts[1] || "").slice(0, scale).padEnd(scale, "0");

  const totalAtoms = BigInt(wholePart) * (10n ** BigInt(scale)) + BigInt(fracPart);
  return isNegative ? -totalAtoms : totalAtoms;
}

export interface NarrationAnalysis {
  cleanDescription: string;
  counterpartyName?: string;
  counterpartyInstitution?: string;
  counterpartyAccountMasked?: string;
  category: TransactionCategory;
  isBankCharge: boolean;
  reference?: string;
}

/**
 * Parse Nigerian banking narrations and descriptions
 */
export function analyzeNarration(rawDescription: string): NarrationAnalysis {
  const raw = rawDescription.normalize("NFKC").trim();
  const upper = raw.toUpperCase();

  // 1. Bank charges / statutory levies
  if (
    upper.includes("ELECTRONIC MONEY TRANSFER LEVY") ||
    upper.includes("EMTL") ||
    upper.includes("STAMP DUTY")
  ) {
    return {
      cleanDescription: "Electronic Money Transfer Levy (Stamp Duty)",
      counterpartyName: "Federal Inland Revenue Service (FIRS)",
      category: "bank_charges",
      isBankCharge: true,
    };
  }

  if (
    upper.includes("SMS ALERT") ||
    upper.includes("SMS CHARGE") ||
    upper.includes("NOTIFICATION CHARGE")
  ) {
    return {
      cleanDescription: "SMS Notification Charge",
      counterpartyName: "Bank SMS Notification",
      category: "bank_charges",
      isBankCharge: true,
    };
  }

  if (
    upper.includes("CARD MAINTENANCE") ||
    upper.includes("ACCOUNT MAINTENANCE") ||
    upper.includes("MONTHLY CHARGE")
  ) {
    return {
      cleanDescription: "Account / Card Maintenance Fee",
      counterpartyName: "Bank Account Maintenance",
      category: "bank_charges",
      isBankCharge: true,
    };
  }

  if (
    upper.includes("VAT ON") ||
    upper.includes("TRANSFER CHARGE") ||
    upper.includes("NIP CHARGE") ||
    upper.includes("COMMISSION ON TURNOVER")
  ) {
    return {
      cleanDescription: "Bank Transfer Fee & VAT",
      counterpartyName: "Interbank Transfer Commission",
      category: "bank_charges",
      isBankCharge: true,
    };
  }

  // 2. Airtime / Utilities
  if (
    upper.includes("AIRTIME") ||
    upper.includes("VTU") ||
    upper.includes("DATA TOPUP") ||
    upper.includes("MTN") ||
    upper.includes("AIRTEL") ||
    upper.includes("GLO") ||
    upper.includes("9MOBILE")
  ) {
    const network = upper.includes("MTN")
      ? "MTN"
      : upper.includes("AIRTEL")
      ? "Airtel"
      : upper.includes("GLO")
      ? "Glo"
      : upper.includes("9MOBILE")
      ? "9mobile"
      : "Telecommunications";

    return {
      cleanDescription: `Airtime / Mobile Data (${network})`,
      counterpartyName: network,
      category: "utilities",
      isBankCharge: false,
    };
  }

  if (
    upper.includes("ELECTRICITY") ||
    upper.includes("IKEDC") ||
    upper.includes("EKEDC") ||
    upper.includes("DISCO") ||
    upper.includes("PHCN")
  ) {
    return {
      cleanDescription: "Electricity Utility Bill",
      counterpartyName: "Power Distribution Company",
      category: "utilities",
      isBankCharge: false,
    };
  }

  // 3. Subscriptions
  if (
    upper.includes("NETFLIX") ||
    upper.includes("SPOTIFY") ||
    upper.includes("APPLE.COM/BILL") ||
    upper.includes("GOOGLE SERVICES") ||
    upper.includes("CHATGPT") ||
    upper.includes("OPENAI") ||
    upper.includes("YOUTUBE PREMIUM")
  ) {
    const subName = upper.includes("NETFLIX")
      ? "Netflix"
      : upper.includes("SPOTIFY")
      ? "Spotify"
      : upper.includes("APPLE")
      ? "Apple Services"
      : upper.includes("OPENAI") || upper.includes("CHATGPT")
      ? "OpenAI"
      : upper.includes("YOUTUBE")
      ? "YouTube Premium"
      : "Digital Subscription";

    return {
      cleanDescription: `${subName} Subscription`,
      counterpartyName: subName,
      category: "entertainment",
      isBankCharge: false,
    };
  }

  // 4. Groceries / Food / POS
  if (
    upper.includes("DOMINOS") ||
    upper.includes("COLD STONE") ||
    upper.includes("CHICKEN REPUBLIC") ||
    upper.includes("MAMA T") ||
    upper.includes("KILIMANJARO") ||
    upper.includes("SUPERMARKET") ||
    upper.includes("SPAR") ||
    upper.includes("SHOPRITE")
  ) {
    const merchant = upper.includes("DOMINOS")
      ? "Domino's Pizza"
      : upper.includes("CHICKEN REPUBLIC")
      ? "Chicken Republic"
      : upper.includes("SHOPRITE")
      ? "Shoprite"
      : upper.includes("SPAR")
      ? "SPAR Supermarket"
      : upper.includes("MAMA T")
      ? "Mama T's Kitchen"
      : "Restaurant / Groceries";

    return {
      cleanDescription: merchant,
      counterpartyName: merchant,
      category: "groceries",
      isBankCharge: false,
    };
  }

  // 5. NIP / Interbank Transfer narration format:
  // e.g. TRF/NIP/000013231102123456/JOHN DOE/GTB/PAYMENT FOR SERVICES
  // or NIP/090267/Kuda/JANE DOE/Invoice 12
  const nipParts = raw.split(/[/|]/).map((p) => p.trim());
  if (nipParts.length >= 3 && (upper.startsWith("TRF") || upper.startsWith("NIP"))) {
    let ref: string | undefined;
    let nameCandidate: string | undefined;
    let bankCandidate: string | undefined;

    for (const part of nipParts) {
      if (/^\d{12,30}$/.test(part)) {
        ref = part;
      } else if (/^[A-Za-z ]{3,35}$/.test(part) && !["TRF", "NIP", "OUTWARD", "INWARD"].includes(part.toUpperCase())) {
        if (!nameCandidate) {
          nameCandidate = part;
        } else if (!bankCandidate) {
          bankCandidate = part;
        }
      }
    }

    return {
      cleanDescription: nameCandidate ? `Transfer - ${nameCandidate}` : raw,
      counterpartyName: nameCandidate,
      counterpartyInstitution: bankCandidate,
      reference: ref,
      category: "transfer",
      isBankCharge: false,
    };
  }

  // Default fallback
  return {
    cleanDescription: raw,
    category: upper.includes("SALARY") || upper.includes("STIPEND") ? "income" : "other",
    isBankCharge: false,
  };
}

export interface NormalizeRowOptions {
  row: string[];
  formatInfo: DetectedFormatResult;
  currency: SupportedCurrency;
  accountId: string;
  ownerId: string;
  tenantId: string;
  importId: string;
  fileHash: string;
  rowNumber: number;
}

/**
 * Normalizes an individual statement row into a canonical FinancialTransaction
 */
export function normalizeStatementRow(
  options: NormalizeRowOptions,
): FinancialTransaction | null {
  const {
    row,
    formatInfo,
    currency,
    accountId,
    ownerId,
    tenantId,
    importId,
    fileHash,
    rowNumber,
  } = options;

  const cols = formatInfo.columnIndices;
  const dateRaw = row[cols.date];
  if (!dateRaw || dateRaw.trim().length === 0) return null;

  let postedAt: string;
  try {
    postedAt = parseStatementDate(dateRaw);
  } catch {
    return null; // Skip non-data header/subtotal row
  }

  let valueAt: string | undefined;
  if (cols.valueDate !== undefined && row[cols.valueDate]) {
    try {
      valueAt = parseStatementDate(row[cols.valueDate]);
    } catch {
      // Ignored if invalid
    }
  }

  const descRaw = cols.description !== -1 && row[cols.description] ? row[cols.description] : "";
  if (!descRaw && cols.amount === undefined && cols.debit === undefined) return null;

  let amountAtoms = 0n;

  if (cols.debit !== undefined && cols.credit !== undefined) {
    const debitRaw = row[cols.debit] || "";
    const creditRaw = row[cols.credit] || "";

    const debitAtoms = parseMonetaryAtoms(debitRaw, currency);
    const creditAtoms = parseMonetaryAtoms(creditRaw, currency);

    if (debitAtoms > 0n) {
      amountAtoms = -debitAtoms;
    } else if (creditAtoms > 0n) {
      amountAtoms = creditAtoms;
    } else if (debitAtoms < 0n) {
      amountAtoms = debitAtoms;
    }
  } else if (cols.amount !== undefined) {
    const parsedAmount = parseMonetaryAtoms(row[cols.amount] || "", currency);
    const typeStr = cols.type !== undefined && row[cols.type] ? row[cols.type].toLowerCase() : "";

    const isCredit =
      typeStr.includes("credit") ||
      typeStr.includes("cr") ||
      typeStr.includes("deposit") ||
      typeStr.includes("inward") ||
      typeStr.includes("received") ||
      typeStr.includes("inflow");

    const isDebit =
      typeStr.includes("debit") ||
      typeStr.includes("dr") ||
      typeStr.includes("withdrawal") ||
      typeStr.includes("outward") ||
      typeStr.includes("transfer") ||
      typeStr.includes("payment") ||
      typeStr.includes("purchase") ||
      typeStr.includes("bill");

    if (isCredit) {
      amountAtoms = parsedAmount < 0n ? -parsedAmount : parsedAmount;
    } else if (isDebit) {
      amountAtoms = parsedAmount > 0n ? -parsedAmount : parsedAmount;
    } else {
      amountAtoms = parsedAmount;
    }
  }

  if (amountAtoms === 0n) {
    return null; // Skip empty zero-amount rows
  }

  const refRaw = cols.reference !== undefined && row[cols.reference] ? row[cols.reference].trim() : undefined;
  const analysis = analyzeNarration(descRaw);

  let statementBalanceAtoms: bigint | undefined;
  if (cols.balance !== undefined && row[cols.balance]) {
    try {
      statementBalanceAtoms = parseMonetaryAtoms(row[cols.balance], currency);
    } catch {
      // Ignored if balance is non-numeric
    }
  }

  const txId = `tx_${fileHash.slice(0, 12)}_${rowNumber}`;

  return {
    id: txId,
    accountId,
    ownerId,
    tenantId,
    postedAt,
    valueAt,
    amountAtoms,
    currency,
    scale: CurrencyScale[currency],
    status: "posted",
    rawDescription: descRaw,
    cleanDescription: analysis.cleanDescription,
    counterparty: {
      name: analysis.counterpartyName,
      institution: analysis.counterpartyInstitution,
    },
    category: analysis.category,
    reference: refRaw || analysis.reference,
    statementBalanceAtoms,
    provenance: {
      importId,
      fileHash,
      rowNumber,
      importedAt: new Date().toISOString(),
    },
  };
}
