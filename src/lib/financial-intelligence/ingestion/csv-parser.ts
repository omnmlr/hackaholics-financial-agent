/**
 * Safe RFC 4180-compliant CSV Parser with Resource Limits
 * and CSV Formula Injection Protection.
 */

export interface CsvParserOptions {
  maxRows?: number;
  maxFieldLength?: number;
  delimiter?: string;
}

const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_MAX_FIELD_LENGTH = 10_000;

/**
 * Characters that spreadsheet software (Excel, Google Sheets, Calc) interprets as formulas
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Disarms formula injection payloads by prefixing with a single quote (') or stripping dangerous control chars.
 * If the string is a genuine safe numeric value (e.g. "-1250.50"), it is preserved.
 */
export function sanitizeCsvField(field: string): string {
  if (!field) return "";

  // Normalize Unicode and strip null bytes
  let sanitized = field.normalize("NFKC").replace(/\0/g, "").trim();

  // If it's a valid safe number (e.g. "-125.40", "+250"), it's not a formula
  if (/^[-+]?\d+(\.\d+)?$/.test(sanitized)) {
    return sanitized;
  }

  // Check if first character is a formula prefix or tab/CR
  const firstChar = sanitized.charAt(0);
  if (FORMULA_PREFIXES.includes(firstChar)) {
    // Escape with a single quote to neutralize spreadsheet execution
    sanitized = `'${sanitized}`;
  }

  // Also disarm tabs and carriage returns anywhere inside
  sanitized = sanitized.replace(/[\t\r]/g, " ");

  return sanitized;
}

/**
 * Parse raw CSV text safely adhering to RFC 4180.
 * Handles quoted fields, escaped quotes (""), and multiline fields.
 */
export function parseCsv(
  content: string,
  options: CsvParserOptions = {},
): string[][] {
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const maxFieldLength = options.maxFieldLength ?? DEFAULT_MAX_FIELD_LENGTH;

  // Strip UTF-8 BOM if present
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;

  // Detect delimiter if not specified (comma vs semicolon vs tab)
  const delimiter = options.delimiter ?? detectDelimiter(text);

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let insideQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    if (insideQuotes) {
      if (char === '"') {
        // Look ahead for escaped quote ""
        if (i + 1 < len && text[i + 1] === '"') {
          currentField += '"';
          i += 2;
          continue;
        } else {
          // Closing quote
          insideQuotes = false;
          i++;
          continue;
        }
      } else {
        currentField += char;
        if (currentField.length > maxFieldLength) {
          throw new Error(`CSV field exceeded maximum allowed length of ${maxFieldLength} characters`);
        }
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
        i++;
        continue;
      }

      if (char === delimiter) {
        currentRow.push(sanitizeCsvField(currentField));
        currentField = "";
        i++;
        continue;
      }

      if (char === "\r") {
        if (i + 1 < len && text[i + 1] === "\n") {
          i++;
        }
        currentRow.push(sanitizeCsvField(currentField));
        currentField = "";
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
          if (rows.length > maxRows) {
            throw new Error(`CSV exceeded maximum allowed rows limit of ${maxRows}`);
          }
        }
        currentRow = [];
        i++;
        continue;
      }

      if (char === "\n") {
        currentRow.push(sanitizeCsvField(currentField));
        currentField = "";
        if (currentRow.some((f) => f.length > 0)) {
          rows.push(currentRow);
          if (rows.length > maxRows) {
            throw new Error(`CSV exceeded maximum allowed rows limit of ${maxRows}`);
          }
        }
        currentRow = [];
        i++;
        continue;
      }

      currentField += char;
      if (currentField.length > maxFieldLength) {
        throw new Error(`CSV field exceeded maximum allowed length of ${maxFieldLength} characters`);
      }
      i++;
    }
  }

  // Handle trailing field and row
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(sanitizeCsvField(currentField));
    if (currentRow.some((f) => f.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function detectDelimiter(sample: string): string {
  const firstLines = sample.slice(0, 2048).split(/\r?\n/).slice(0, 5).join("\n");
  const commaCount = (firstLines.match(/,/g) || []).length;
  const semicolonCount = (firstLines.match(/;/g) || []).length;
  const tabCount = (firstLines.match(/\t/g) || []).length;

  if (semicolonCount > commaCount && semicolonCount > tabCount) return ";";
  if (tabCount > commaCount && tabCount > semicolonCount) return "\t";
  return ",";
}
