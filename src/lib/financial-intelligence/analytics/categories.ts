import {
  type FinancialTransaction,
  type SupportedCurrency,
  type TransactionCategory,
  formatMonetaryAmount,
} from "../types";

export interface CategorySpendingItem {
  category: TransactionCategory;
  categoryDisplayName: string;
  totalSpentAtoms: bigint;
  formattedTotal: string;
  transactionCount: number;
  percentageOfTotal: number;
  transactionIds: string[];
}

export interface BankChargeBreakdownItem {
  chargeType: "stamp_duty_emtl" | "sms_alert" | "card_maintenance" | "transfer_fee_vat" | "other_fee";
  displayName: string;
  totalAtoms: bigint;
  formattedTotal: string;
  count: number;
  transactionIds: string[];
}

export interface BankChargesSummary {
  currency: SupportedCurrency;
  totalBankChargesAtoms: bigint;
  formattedTotal: string;
  chargeCount: number;
  breakdown: BankChargeBreakdownItem[];
  transactionIds: string[];
}

export interface SpendingBreakdownResult {
  currency: SupportedCurrency;
  totalSpendingAtoms: bigint;
  formattedTotalSpending: string;
  categories: CategorySpendingItem[];
  bankCharges: BankChargesSummary;
}

const CATEGORY_NAMES: Record<TransactionCategory, string> = {
  income: "Income",
  transfer: "Transfers",
  bills: "Bills & Subscriptions",
  groceries: "Food & Groceries",
  transport: "Transportation",
  utilities: "Utilities & Mobile Data",
  bank_charges: "Bank Fees & Charges",
  shopping: "Shopping & Retail",
  entertainment: "Entertainment & Leisure",
  health: "Health & Medical",
  education: "Education",
  investment: "Investment & Savings",
  other: "Other Expenses",
};

export function computeSpendingBreakdown(
  transactions: FinancialTransaction[],
  currency: SupportedCurrency = "NGN",
): SpendingBreakdownResult {
  const spendingTxs = transactions.filter((tx) => {
    if (tx.currency !== currency) return false;
    if (tx.status !== "posted") return false;
    if (tx.reversalOfId) return false;
    // Strictly exclude internal transfers
    if (tx.internalTransferMetadata?.isInternalTransfer) return false;
    // Only debit / outflow transactions
    return tx.amountAtoms < 0n;
  });

  const catMap = new Map<TransactionCategory, { total: bigint; ids: string[] }>();
  let grandTotalSpent = 0n;

  // Bank charge sub-categorization
  const chargeMap = {
    stamp_duty_emtl: { total: 0n, ids: [] as string[] },
    sms_alert: { total: 0n, ids: [] as string[] },
    card_maintenance: { total: 0n, ids: [] as string[] },
    transfer_fee_vat: { total: 0n, ids: [] as string[] },
    other_fee: { total: 0n, ids: [] as string[] },
  };

  for (const tx of spendingTxs) {
    const spentAtoms = -tx.amountAtoms;
    grandTotalSpent += spentAtoms;

    // Use userOverride category if present
    const cat = tx.userOverride?.category || tx.category;

    let catData = catMap.get(cat);
    if (!catData) {
      catData = { total: 0n, ids: [] };
      catMap.set(cat, catData);
    }
    catData.total += spentAtoms;
    catData.ids.push(tx.id);

    // If bank charge, categorize specifically
    if (cat === "bank_charges") {
      const desc = tx.rawDescription.toUpperCase();
      if (desc.includes("EMTL") || desc.includes("STAMP DUTY") || desc.includes("ELECTRONIC MONEY TRANSFER")) {
        chargeMap.stamp_duty_emtl.total += spentAtoms;
        chargeMap.stamp_duty_emtl.ids.push(tx.id);
      } else if (desc.includes("SMS ALERT") || desc.includes("SMS CHARGE") || desc.includes("NOTIFICATION")) {
        chargeMap.sms_alert.total += spentAtoms;
        chargeMap.sms_alert.ids.push(tx.id);
      } else if (desc.includes("CARD MAINTENANCE") || desc.includes("ACCOUNT MAINTENANCE")) {
        chargeMap.card_maintenance.total += spentAtoms;
        chargeMap.card_maintenance.ids.push(tx.id);
      } else if (desc.includes("TRANSFER") || desc.includes("NIP") || desc.includes("VAT")) {
        chargeMap.transfer_fee_vat.total += spentAtoms;
        chargeMap.transfer_fee_vat.ids.push(tx.id);
      } else {
        chargeMap.other_fee.total += spentAtoms;
        chargeMap.other_fee.ids.push(tx.id);
      }
    }
  }

  // Build sorted category list
  const categories: CategorySpendingItem[] = [];
  for (const [cat, data] of catMap.entries()) {
    const pct = grandTotalSpent > 0n
      ? Number((data.total * 10000n) / grandTotalSpent) / 100
      : 0;

    categories.push({
      category: cat,
      categoryDisplayName: CATEGORY_NAMES[cat] || cat,
      totalSpentAtoms: data.total,
      formattedTotal: formatMonetaryAmount(data.total, currency),
      transactionCount: data.ids.length,
      percentageOfTotal: pct,
      transactionIds: data.ids,
    });
  }

  categories.sort((a, b) => (b.totalSpentAtoms > a.totalSpentAtoms ? 1 : -1));

  // Build bank charges summary
  const bankChargesTotal = catMap.get("bank_charges")?.total || 0n;
  const bankChargeIds = catMap.get("bank_charges")?.ids || [];

  const breakdown: BankChargeBreakdownItem[] = [
    {
      chargeType: "stamp_duty_emtl" as const,
      displayName: "Electronic Money Transfer Levy (EMTL)",
      totalAtoms: chargeMap.stamp_duty_emtl.total,
      formattedTotal: formatMonetaryAmount(chargeMap.stamp_duty_emtl.total, currency),
      count: chargeMap.stamp_duty_emtl.ids.length,
      transactionIds: chargeMap.stamp_duty_emtl.ids,
    },
    {
      chargeType: "sms_alert" as const,
      displayName: "SMS Alert Fees",
      totalAtoms: chargeMap.sms_alert.total,
      formattedTotal: formatMonetaryAmount(chargeMap.sms_alert.total, currency),
      count: chargeMap.sms_alert.ids.length,
      transactionIds: chargeMap.sms_alert.ids,
    },
    {
      chargeType: "card_maintenance" as const,
      displayName: "Card & Account Maintenance Fees",
      totalAtoms: chargeMap.card_maintenance.total,
      formattedTotal: formatMonetaryAmount(chargeMap.card_maintenance.total, currency),
      count: chargeMap.card_maintenance.ids.length,
      transactionIds: chargeMap.card_maintenance.ids,
    },
    {
      chargeType: "transfer_fee_vat" as const,
      displayName: "Transfer Fees & VAT",
      totalAtoms: chargeMap.transfer_fee_vat.total,
      formattedTotal: formatMonetaryAmount(chargeMap.transfer_fee_vat.total, currency),
      count: chargeMap.transfer_fee_vat.ids.length,
      transactionIds: chargeMap.transfer_fee_vat.ids,
    },
    {
      chargeType: "other_fee" as const,
      displayName: "Other Bank Fees",
      totalAtoms: chargeMap.other_fee.total,
      formattedTotal: formatMonetaryAmount(chargeMap.other_fee.total, currency),
      count: chargeMap.other_fee.ids.length,
      transactionIds: chargeMap.other_fee.ids,
    },
  ].filter((item) => item.count > 0);

  const bankCharges: BankChargesSummary = {
    currency,
    totalBankChargesAtoms: bankChargesTotal,
    formattedTotal: formatMonetaryAmount(bankChargesTotal, currency),
    chargeCount: bankChargeIds.length,
    breakdown,
    transactionIds: bankChargeIds,
  };

  return {
    currency,
    totalSpendingAtoms: grandTotalSpent,
    formattedTotalSpending: formatMonetaryAmount(grandTotalSpent, currency),
    categories,
    bankCharges,
  };
}
