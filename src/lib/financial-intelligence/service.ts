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
import { FinancialIntelligenceRepository, type TransactionFilter } from "./repository";
import { exportTransactionsToCsv, type CsvExportOptions } from "./export/csv-export";

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

export type TransactionQueryFilter = TransactionFilter;

export class MultiAccountFinancialIntelligenceService {
  private inMemoryAccounts = new Map<string, FinancialAccount>();
  private inMemoryTransactions = new Map<string, FinancialTransaction>();

  constructor(private repository?: FinancialIntelligenceRepository) {}

  /**
   * Register a new financial account for a user.
   */
  public async registerAccount(input: RegisterAccountInput): Promise<FinancialAccount> {
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

    if (this.repository) {
      await this.repository.saveAccount(account);
    } else {
      this.inMemoryAccounts.set(id, account);
    }

    return account;
  }

  /**
   * Get all accounts owned by a user.
   */
  public async getAccounts(ownerId: string, tenantId = "default"): Promise<FinancialAccount[]> {
    if (this.repository) {
      return this.repository.listAccounts(ownerId, tenantId);
    }
    return Array.from(this.inMemoryAccounts.values()).filter(
      (a) => a.ownerId === ownerId && a.tenantId === tenantId,
    );
  }

  /**
   * Get specific account by id and ownerId.
   */
  public async getAccount(
    ownerId: string,
    accountId: string,
    tenantId = "default",
  ): Promise<FinancialAccount | null> {
    if (this.repository) {
      return this.repository.getAccount(ownerId, accountId, tenantId);
    }
    const acc = this.inMemoryAccounts.get(accountId);
    if (!acc || acc.ownerId !== ownerId || acc.tenantId !== tenantId) return null;
    return acc;
  }

  /**
   * Ingest a bank statement for an account and immediately trigger cross-account reconciliation.
   */
  public async ingestStatement(
    ownerId: string,
    accountId: string,
    content: string | Buffer,
    fileName: string,
    tenantId = "default",
  ): Promise<IngestionResult> {
    const account = await this.getAccount(ownerId, accountId, tenantId);
    if (!account) {
      throw new Error(`Account not found or access denied: ${accountId}`);
    }

    let existingAccountTxs: FinancialTransaction[] = [];
    if (this.repository) {
      const res = await this.repository.listTransactions(ownerId, { accountId }, tenantId);
      existingAccountTxs = res.items;
    } else {
      existingAccountTxs = Array.from(this.inMemoryTransactions.values()).filter(
        (t) => t.accountId === accountId,
      );
    }

    const result = ingestStatementFile({
      content,
      fileName,
      accountId,
      ownerId,
      tenantId: account.tenantId,
      currency: account.currency,
      existingTransactions: existingAccountTxs,
    });

    if (this.repository) {
      await this.repository.saveStatementImport(result.audit, result.format, undefined, tenantId);
      await this.repository.saveTransactions(result.allTransactions);
      await this.reconcile(ownerId, tenantId);
    } else {
      for (const tx of result.allTransactions) {
        this.inMemoryTransactions.set(tx.id, tx);
      }
      await this.reconcile(ownerId, tenantId);
    }

    return result;
  }

  /**
   * Trigger cross-account internal transfer reconciliation across all accounts of the user.
   */
  public async reconcile(ownerId: string, tenantId = "default") {
    const userAccounts = await this.getAccounts(ownerId, tenantId);
    let userTxs: FinancialTransaction[] = [];

    if (this.repository) {
      const res = await this.repository.listTransactions(ownerId, {}, tenantId);
      userTxs = res.items;
    } else {
      userTxs = Array.from(this.inMemoryTransactions.values()).filter(
        (t) => t.ownerId === ownerId && t.tenantId === tenantId,
      );
    }

    const reconcileResult = reconcileCrossAccountTransfers({
      accounts: userAccounts,
      transactions: userTxs,
    });

    if (this.repository) {
      await this.repository.saveTransactions(reconcileResult.transactions);
    } else {
      for (const tx of reconcileResult.transactions) {
        this.inMemoryTransactions.set(tx.id, tx);
      }
    }

    return reconcileResult;
  }

  /**
   * Apply and persist a user classification override (category or internal transfer status).
   */
  public async applyUserOverride(
    ownerId: string,
    transactionId: string,
    override: UserClassificationOverride,
    tenantId = "default",
  ): Promise<FinancialTransaction> {
    if (this.repository) {
      const updatedTx = await this.repository.saveUserOverride(ownerId, transactionId, override, tenantId);
      await this.reconcile(ownerId, tenantId);
      return updatedTx;
    }

    const tx = this.inMemoryTransactions.get(transactionId);
    if (!tx || tx.ownerId !== ownerId || tx.tenantId !== tenantId) {
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
        matchedAt: tx.userOverride.updatedAt || new Date().toISOString(),
      };
      if (override.isInternalTransfer) {
        tx.category = "transfer";
      }
    }

    if (override.category) {
      tx.category = override.category;
    }

    this.inMemoryTransactions.set(tx.id, tx);
    await this.reconcile(ownerId, tenantId);
    return tx;
  }

  /**
   * Produce comprehensive evidence-based financial overview with auditability and data quality report.
   */
  public async getFinancialOverview(
    ownerId: string,
    currency: SupportedCurrency = "NGN",
    tenantId = "default",
  ): Promise<FinancialOverview> {
    const userAccounts = await this.getAccounts(ownerId, tenantId);
    let userTxs: FinancialTransaction[] = [];

    if (this.repository) {
      const res = await this.repository.listTransactions(ownerId, {}, tenantId);
      userTxs = res.items;
    } else {
      userTxs = Array.from(this.inMemoryTransactions.values()).filter(
        (t) => t.ownerId === ownerId && t.tenantId === tenantId,
      );
    }

    const balances = computeAccountBalances(userAccounts, userTxs);
    const cashFlow = computeCashFlow({ transactions: userTxs, currency });
    const spending = computeSpendingBreakdown(userTxs, currency);
    const recurring = detectRecurringTransactions(userTxs, currency);
    const dataQuality = evaluateDataQuality(userAccounts, userTxs);

    // Save balance observations if backed by repository
    if (this.repository) {
      for (const snap of balances.snapshots) {
        await this.repository.saveBalanceSnapshot(snap, ownerId, tenantId);
      }
    }

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
  public async queryTransactions(
    ownerId: string,
    filter: TransactionQueryFilter = {},
    tenantId = "default",
  ): Promise<{
    items: FinancialTransaction[];
    totalCount: number;
  }> {
    if (this.repository) {
      return this.repository.listTransactions(ownerId, filter, tenantId);
    }

    let list = Array.from(this.inMemoryTransactions.values()).filter(
      (t) => t.ownerId === ownerId && t.tenantId === tenantId,
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

    list.sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt));

    const totalCount = list.length;
    const offset = filter.offset || 0;
    const limit = filter.limit || 50;

    return {
      items: list.slice(offset, offset + limit),
      totalCount,
    };
  }

  /**
   * Export transactions for an owner to RFC 4180 CSV with formula injection defense.
   */
  public async exportTransactionsCsv(
    ownerId: string,
    filter: TransactionQueryFilter = {},
    options?: CsvExportOptions,
    tenantId = "default",
  ): Promise<string> {
    const { items } = await this.queryTransactions(
      ownerId,
      {
        ...filter,
        limit: 100_000,
      },
      tenantId,
    );
    return exportTransactionsToCsv(items, options);
  }
}
