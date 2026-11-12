import { randomUUID } from "node:crypto";
import {
  type FinancialAccount,
  type FinancialTransaction,
  type SupportedCurrency,
  type UserClassificationOverride,
} from "./types";
import { ingestStatementFile, type IngestionResult } from "./ingestion/engine";
import { reconcileCrossAccountTransfers } from "./reconciliation/matcher";
import { computeAccountBalances, type BalancesAnalysisResult } from "./analytics/balances";
import { computeCashFlow, type CashFlowAnalysisResult } from "./analytics/cash-flow";
import { computeSpendingBreakdown, type SpendingBreakdownResult } from "./analytics/categories";
import { detectRecurringTransactions, type RecurringCommitment } from "./analytics/recurring";
import { evaluateDataQuality, type DataQualityReport } from "./analytics/data-quality";

export interface RegisterAccountInput {
  ownerId: string;
  tenantId?: string;
  institution: {
    code: string;
    name: string;
    type: "commercial_bank" | "microfinance" | "fintech_wallet" | "crypto_wallet" | "investment_platform";
  };
  accountNumberMasked: string;
  accountName: string;
  currency: SupportedCurrency;
  accountType: "checking" | "savings" | "wallet" | "investment" | "credit";
  metadata?: Record<string, unknown>;
}

export interface FinancialOverview {
  tagline: "Your money, and what's next.";
  ownerId: string;
  asOf: string;
  balances: BalancesAnalysisResult;
  cashFlow: CashFlowAnalysisResult;
  spending: SpendingBreakdownResult;
  recurringCommitments: RecurringCommitment[];
  dataQuality: DataQualityReport;
}

export interface TransactionQueryFilter {
  accountId?: string;
  currency?: SupportedCurrency;
  from?: string;
  toExclusive?: string;
  category?: string;
  searchQuery?: string;
  status?: string;
  isInternalTransfer?: boolean;
  limit?: number;
  offset?: number;
}

export class MultiAccountFinancialIntelligenceService {
  private accounts = new Map<string, FinancialAccount>();
  private transactions = new Map<string, FinancialTransaction>();

  /**
   * Register a new financial account for a user.
   */
  public registerAccount(input: RegisterAccountInput): FinancialAccount {
    const now = new Date().toISOString();
    const id = `acc_${randomUUID().slice(0, 10)}`;

    const account: FinancialAccount = {
      id,
      ownerId: input.ownerId,
      tenantId: input.tenantId ?? "default",
      institution: input.institution,
      accountNumberMasked: input.accountNumberMasked,
      accountName: input.accountName,
      currency: input.currency,
      accountType: input.accountType,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    this.accounts.set(id, account);
    return account;
  }

  /**
   * Get all accounts owned by a user.
   */
  public getAccounts(ownerId: string): FinancialAccount[] {
    return Array.from(this.accounts.values()).filter((a) => a.ownerId === ownerId);
  }

  /**
   * Get specific account by id and ownerId.
   */
  public getAccount(ownerId: string, accountId: string): FinancialAccount | null {
    const acc = this.accounts.get(accountId);
    if (!acc || acc.ownerId !== ownerId) return null;
    return acc;
  }

  /**
   * Ingest a bank statement for an account and immediately trigger cross-account reconciliation.
   */
  public ingestStatement(
    ownerId: string,
    accountId: string,
    content: string | Buffer,
    fileName: string,
  ): IngestionResult {
    const account = this.getAccount(ownerId, accountId);
    if (!account) {
      throw new Error(`Account not found or access denied: ${accountId}`);
    }

    const existingAccountTxs = Array.from(this.transactions.values()).filter(
      (t) => t.accountId === accountId,
    );

    const result = ingestStatementFile({
      content,
      fileName,
      accountId,
      ownerId,
      tenantId: account.tenantId,
      currency: account.currency,
      existingTransactions: existingAccountTxs,
    });

    // Store newly accepted transactions in transaction map
    for (const tx of result.allTransactions) {
      this.transactions.set(tx.id, tx);
    }

    // Automatically reconcile across user's owned accounts
    this.reconcile(ownerId);

    return result;
  }

  /**
   * Trigger cross-account internal transfer reconciliation across all accounts of the user.
   */
  public reconcile(ownerId: string) {
    const userAccounts = this.getAccounts(ownerId);
    const userTxs = Array.from(this.transactions.values()).filter(
      (t) => t.ownerId === ownerId,
    );

    const reconcileResult = reconcileCrossAccountTransfers({
      accounts: userAccounts,
      transactions: userTxs,
    });

    // Update state with reconciled transactions
    for (const tx of reconcileResult.transactions) {
      this.transactions.set(tx.id, tx);
    }

    return reconcileResult;
  }

  /**
   * Apply and persist a user classification override (category or internal transfer status).
   */
  public applyUserOverride(
    ownerId: string,
    transactionId: string,
    override: UserClassificationOverride,
  ): FinancialTransaction {
    const tx = this.transactions.get(transactionId);
    if (!tx || tx.ownerId !== ownerId) {
      throw new Error(`Transaction not found or access denied: ${transactionId}`);
    }

    tx.userOverride = {
      ...override,
      updatedAt: new Date().toISOString(),
    };

    if (override.isInternalTransfer !== undefined) {
      tx.internalTransferMetadata = {
        isInternalTransfer: override.isInternalTransfer,
        confidence: override.isInternalTransfer ? "confirmed" : "not_internal",
        counterpartAccountId: override.counterpartAccountId,
        matchedBy: "user_override",
        matchedAt: tx.userOverride.updatedAt,
      };
      if (override.isInternalTransfer) {
        tx.category = "transfer";
      }
    }

    if (override.category) {
      tx.category = override.category;
    }

    this.transactions.set(tx.id, tx);

    // Re-run reconciliation to ensure consistency
    this.reconcile(ownerId);

    return tx;
  }

  /**
   * Produce comprehensive evidence-based financial overview with auditability and data quality report.
   */
  public getFinancialOverview(
    ownerId: string,
    currency: SupportedCurrency = "NGN",
  ): FinancialOverview {
    const userAccounts = this.getAccounts(ownerId);
    const userTxs = Array.from(this.transactions.values()).filter(
      (t) => t.ownerId === ownerId,
    );

    const balances = computeAccountBalances(userAccounts, userTxs);
    const cashFlow = computeCashFlow({ transactions: userTxs, currency });
    const spending = computeSpendingBreakdown(userTxs, currency);
    const recurring = detectRecurringTransactions(userTxs, currency);
    const dataQuality = evaluateDataQuality(userAccounts, userTxs);

    return {
      tagline: "Your money, and what's next.",
      ownerId,
      asOf: new Date().toISOString(),
      balances,
      cashFlow,
      spending,
      recurringCommitments: recurring,
      dataQuality,
    };
  }

  /**
   * Query filtered transactions with audit provenance.
   */
  public queryTransactions(
    ownerId: string,
    filter: TransactionQueryFilter = {},
  ): {
    items: FinancialTransaction[];
    totalCount: number;
  } {
    let list = Array.from(this.transactions.values()).filter(
      (t) => t.ownerId === ownerId,
    );

    if (filter.accountId) {
      list = list.filter((t) => t.accountId === filter.accountId);
    }
    if (filter.currency) {
      list = list.filter((t) => t.currency === filter.currency);
    }
    if (filter.status) {
      list = list.filter((t) => t.status === filter.status);
    }
    if (filter.category) {
      list = list.filter((t) => (t.userOverride?.category || t.category) === filter.category);
    }
    if (filter.isInternalTransfer !== undefined) {
      list = list.filter(
        (t) => (t.internalTransferMetadata?.isInternalTransfer ?? false) === filter.isInternalTransfer,
      );
    }
    if (filter.from) {
      const fromMs = Date.parse(filter.from);
      list = list.filter((t) => Date.parse(t.postedAt) >= fromMs);
    }
    if (filter.toExclusive) {
      const toMs = Date.parse(filter.toExclusive);
      list = list.filter((t) => Date.parse(t.postedAt) < toMs);
    }
    if (filter.searchQuery) {
      const q = filter.searchQuery.toLowerCase();
      list = list.filter(
        (t) =>
          t.rawDescription.toLowerCase().includes(q) ||
          t.cleanDescription.toLowerCase().includes(q) ||
          (t.counterparty.name && t.counterparty.name.toLowerCase().includes(q)) ||
          (t.reference && t.reference.toLowerCase().includes(q)),
      );
    }

    // Sort newest first
    list.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));

    const totalCount = list.length;
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;

    return {
      items: list.slice(offset, offset + limit),
      totalCount,
    };
  }
}
