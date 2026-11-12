import {
  type FinancialTransaction,
  type SupportedCurrency,
  CurrencyScale,
} from "../types";

export interface CsvExportOptions {
  includeHeader?: boolean;
  delimiter?: string;
  disarmFormulas?: boolean;
}

const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r", "%", "|"];

/**
 * Format BigInt monetary atoms into standard decimal string without scientific notation.
 * e.g. -5000000n with scale 2 => "-50000.00"
 */
export function formatAtomsToDecimal(atoms: bigint, scale: number): string {
  const isNegative = atoms < 0n;
  const absAtoms = isNegative ? -atoms : atoms;
  const divisor = 10n ** BigInt(scale);
  const whole = absAtoms / divisor;
  const frac = absAtoms % divisor;
  const fracStr = frac.toString().padStart(scale, "0");

  const formatted = scale > 0 ? `${whole}.${fracStr}` : `${whole}`;
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Disarms formula injection payloads and properly quotes/escapes fields for RFC 4180 CSV export.
 *
 * Spreadsheet applications (Excel, Calc, Sheets) execute strings starting with =, +, -, @, \t, \r, %, |
 * as DDE commands or formulas. This function prefixes such non-numeric strings with a single quote (')
 * to force spreadsheet applications to treat them strictly as plain text.
 */
export function sanitizeFieldForCsvExport(
  value: unknown,
  disarmFormulas: boolean = true,
): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "bigint" || typeof value === "number") {
    return value.toString();
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  let str = String(value).normalize("NFKC").replace(/\0/g, "");

  if (disarmFormulas) {
    const trimmed = str.trim();
    if (trimmed.length > 0) {
      const firstChar = trimmed.charAt(0);
      if (FORMULA_PREFIXES.includes(firstChar)) {
        // Safe if it is a genuine numeric value (e.g. "-1500.50" or "+250")
        const isNumeric = /^[-+]?\d+(\.\d+)?$/.test(trimmed);
        if (!isNumeric) {
          str = `'${str}`;
        }
      }
    }
  }

  // Check if quoting is required by RFC 4180
  const needsQuotes =
    str.includes(",") ||
    str.includes('"') ||
    str.includes("\n") ||
    str.includes("\r") ||
    str.includes(";") ||
    str.startsWith(" ") ||
    str.endsWith(" ");

  if (needsQuotes) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Serializes an array of field values into a valid RFC 4180 CSV line.
 */
export function serializeCsvRow(
  fields: unknown[],
  delimiter: string = ",",
  disarmFormulas: boolean = true,
): string {
  return fields
    .map((f) => sanitizeFieldForCsvExport(f, disarmFormulas))
    .join(delimiter);
}

export const TRANSACTION_CSV_HEADERS = [
  "Transaction ID",
  "Account ID",
  "Posted At",
  "Value Date",
  "Amount",
  "Currency",
  "Status",
  "Category",
  "Clean Description",
  "Raw Description",
  "Counterparty Name",
  "Counterparty Institution",
  "Reference",
  "Is Internal Transfer",
  "Transfer Confidence",
  "Counterpart Account ID",
  "Statement Balance",
];

/**
 * Exports financial transactions to an RFC 4180 compliant CSV string,
 * guaranteed to be safe from spreadsheet formula injection.
 */
export function exportTransactionsToCsv(
  transactions: FinancialTransaction[],
  options: CsvExportOptions = {},
): string {
  const {
    includeHeader = true,
    delimiter = ",",
    disarmFormulas = true,
  } = options;

  const rows: string[] = [];

  if (includeHeader) {
    rows.push(serializeCsvRow(TRANSACTION_CSV_HEADERS, delimiter, false));
  }

  for (const tx of transactions) {
    const scale = tx.scale ?? (CurrencyScale[tx.currency as SupportedCurrency] || 2);
    const formattedAmount = formatAtomsToDecimal(tx.amountAtoms, scale);
    const formattedBalance = tx.statementBalanceAtoms !== undefined
      ? formatAtomsToDecimal(tx.statementBalanceAtoms, scale)
      : "";

    const row = [
      tx.id,
      tx.accountId,
      tx.postedAt,
      tx.valueAt || "",
      formattedAmount,
      tx.currency,
      tx.status,
      tx.category,
      tx.cleanDescription,
      tx.rawDescription,
      tx.counterparty.name || "",
      tx.counterparty.institution || "",
      tx.reference || "",
      tx.internalTransferMetadata?.isInternalTransfer ? "true" : "false",
      tx.internalTransferMetadata?.confidence || "",
      tx.internalTransferMetadata?.counterpartAccountId || "",
      formattedBalance,
    ];

    rows.push(serializeCsvRow(row, delimiter, disarmFormulas));
  }

  return rows.join("\r\n");
}
