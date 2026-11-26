export type StatementFormat =
  | "gtbank"
  | "access_bank"
  | "zenith_bank"
  | "kuda"
  | "moniepoint"
  | "generic_csv";

export interface DetectedFormatResult {
  format: StatementFormat;
  headerRowIndex: number;
  confidence: "high" | "medium" | "low";
  columnIndices: {
    date: number;
    valueDate?: number;
    description: number;
    debit?: number;
    credit?: number;
    amount?: number;
    type?: number;
    balance?: number;
    reference?: number;
    fee?: number;
  };
}

export function detectStatementFormat(rows: string[][]): DetectedFormatResult {
  if (rows.length === 0) {
    throw new Error("Cannot detect format from empty rows");
  }

  // Scan the first 15 rows to find the header row
  const scanLimit = Math.min(15, rows.length);

  for (let r = 0; r < scanLimit; r++) {
    const row = rows[r].map((cell) => cell.toLowerCase().trim());

    // 1. Moniepoint detection
    const isMoniepoint =
      row.some((c) => c.includes("beneficiary") || c.includes("sender")) &&
      row.some((c) => c.includes("session id") || c.includes("session_id") || c.includes("transaction type"));
    if (isMoniepoint) {
      return {
        format: "moniepoint",
        headerRowIndex: r,
        confidence: "high",
        columnIndices: {
          date: findColIndex(row, ["date & time", "date", "time"]),
          description: findColIndex(row, ["beneficiary/sender", "beneficiary", "sender", "narration", "description"]),
          amount: findColIndex(row, ["amount"]),
          fee: findColIndex(row, ["fee"]),
          type: findColIndex(row, ["transaction type", "type"]),
          balance: findColIndex(row, ["balance"]),
          reference: findColIndex(row, ["session id", "session_id", "reference"]),
        },
      };
    }

    // 2. Kuda detection
    const isKuda =
      row.some((c) => c === "date") &&
      row.some((c) => c === "amount") &&
      row.some((c) => c === "type") &&
      row.some((c) => c === "balance");
    if (isKuda) {
      return {
        format: "kuda",
        headerRowIndex: r,
        confidence: "high",
        columnIndices: {
          date: findColIndex(row, ["date"]),
          description: findColIndex(row, ["description", "narration", "memo"]),
          amount: findColIndex(row, ["amount"]),
          type: findColIndex(row, ["type"]),
          balance: findColIndex(row, ["balance"]),
          reference: findColIndex(row, ["reference", "ref"]),
        },
      };
    }

    // 3. GTBank detection
    const isGtbank =
      row.some((c) => c.includes("remarks")) &&
      row.some((c) => c.includes("debits") || c.includes("debit")) &&
      row.some((c) => c.includes("credits") || c.includes("credit"));
    if (isGtbank) {
      return {
        format: "gtbank",
        headerRowIndex: r,
        confidence: "high",
        columnIndices: {
          date: findColIndex(row, ["trans date", "transaction date", "date"]),
          valueDate: findColIndex(row, ["value date"]),
          reference: findColIndex(row, ["reference", "ref"]),
          debit: findColIndex(row, ["debits", "debit"]),
          credit: findColIndex(row, ["credits", "credit"]),
          balance: findColIndex(row, ["balance"]),
          description: findColIndex(row, ["remarks", "description", "narration"]),
        },
      };
    }

    // 4. Access Bank detection
    const isAccess =
      row.some((c) => c.includes("trans. date") || c.includes("transaction date")) &&
      row.some((c) => c.includes("description")) &&
      row.some((c) => c === "debit") &&
      row.some((c) => c === "credit");
    if (isAccess) {
      return {
        format: "access_bank",
        headerRowIndex: r,
        confidence: "high",
        columnIndices: {
          date: findColIndex(row, ["trans. date", "transaction date", "trans date", "date"]),
          valueDate: findColIndex(row, ["value date"]),
          description: findColIndex(row, ["description", "narration"]),
          debit: findColIndex(row, ["debit", "debits"]),
          credit: findColIndex(row, ["credit", "credits"]),
          balance: findColIndex(row, ["balance"]),
          reference: findColIndex(row, ["reference", "ref"]),
        },
      };
    }

    // 5. Zenith Bank detection
    const isZenith =
      row.some((c) => c.includes("narration")) &&
      row.some((c) => c.includes("debit")) &&
      row.some((c) => c.includes("credit"));
    if (isZenith) {
      return {
        format: "zenith_bank",
        headerRowIndex: r,
        confidence: "high",
        columnIndices: {
          date: findColIndex(row, ["trans date", "transaction date", "date"]),
          valueDate: findColIndex(row, ["value date"]),
          description: findColIndex(row, ["narration", "description"]),
          debit: findColIndex(row, ["debit", "debits"]),
          credit: findColIndex(row, ["credit", "credits"]),
          balance: findColIndex(row, ["balance"]),
          reference: findColIndex(row, ["ref", "reference"]),
        },
      };
    }

    // 6. Generic CSV detection
    const hasDate = row.some((c) => c.includes("date"));
    const hasAmountOrDebit =
      row.some((c) => c.includes("amount") || c.includes("debit") || c.includes("credit"));
    const hasDescription =
      row.some((c) => c.includes("desc") || c.includes("narrat") || c.includes("detail") || c.includes("memo") || c.includes("remark"));

    if (hasDate && hasAmountOrDebit && hasDescription) {
      const debitIdx = findColIndex(row, ["debit", "debits", "withdrawal", "out"]);
      const creditIdx = findColIndex(row, ["credit", "credits", "deposit", "in"]);
      const amountIdx = findColIndex(row, ["amount", "value", "sum"]);

      return {
        format: "generic_csv",
        headerRowIndex: r,
        confidence: "medium",
        columnIndices: {
          date: findColIndex(row, ["date", "timestamp", "time"]),
          description: findColIndex(row, ["description", "narration", "details", "memo", "remarks", "title"]),
          debit: debitIdx !== -1 ? debitIdx : undefined,
          credit: creditIdx !== -1 ? creditIdx : undefined,
          amount: amountIdx !== -1 ? amountIdx : undefined,
          type: findColIndex(row, ["type", "direction", "kind"]),
          balance: findColIndex(row, ["balance", "ledger balance"]),
          reference: findColIndex(row, ["reference", "ref", "id", "trans id", "transaction id"]),
        },
      };
    }
  }

  throw new Error("Unable to identify statement format from headers. Ensure standard CSV headers are present.");
}

function findColIndex(row: string[], candidateNames: string[]): number {
  for (const name of candidateNames) {
    const idx = row.findIndex((c) => c === name || c.includes(name));
    if (idx !== -1) return idx;
  }
  return -1;
}
