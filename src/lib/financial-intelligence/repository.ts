import { randomUUID } from "node:crypto";
import type { Sql } from "../../server/sql";
import {
  type AccountBalanceSnapshot,
  type FinancialAccount,
  type FinancialTransaction,
  type IngestionAuditRecord,
  type SupportedCurrency,
  type UserClassificationOverride,
} from "./types";
import { computeTransactionFingerprint } from "./ingestion/idempotency";

export interface TransactionFilter {
  accountId?: string;
  currency?: SupportedCurrency;
  from?: string;
  toExclusive?: string;
  category?: string;
  status?: string;
  isInternalTransfer?: boolean;
  searchQuery?: string;
  limit?: number;
  offset?: number;
}

export class FinancialIntelligenceRepository {
  constructor(private sql: Sql) {}

  /**
   * Ensure schema tables exist on the current client.
   * Safe to call multiple times (idempotent).
   */
  public async ensureSchema(): Promise<void> {
    const ddl = `
      CREATE TABLE IF NOT EXISTS agus_financial_accounts (
        id text PRIMARY KEY,
        owner_id text NOT NULL,
        tenant_id text NOT NULL DEFAULT 'default',
        institution_code text NOT NULL,
        institution_name text NOT NULL,
        institution_type text NOT NULL,
        account_number_masked text NOT NULL,
        account_name text NOT NULL,
        currency text NOT NULL CHECK (currency IN ('NGN','USD','USDC','EUR','GBP')),
        account_type text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        metadata jsonb
      );
      CREATE INDEX IF NOT EXISTS agus_accounts_owner ON agus_financial_accounts(tenant_id, owner_id);

      CREATE TABLE IF NOT EXISTS agus_statement_imports (
        id text PRIMARY KEY,
        file_hash text NOT NULL,
        file_name text NOT NULL,
        account_id text NOT NULL REFERENCES agus_financial_accounts(id) ON DELETE CASCADE,
        owner_id text NOT NULL,
        tenant_id text NOT NULL DEFAULT 'default',
        format text NOT NULL,
        imported_at timestamptz NOT NULL DEFAULT now(),
        total_rows integer NOT NULL,
        imported_count integer NOT NULL,
        duplicate_count integer NOT NULL,
        skipped_count integer NOT NULL,
        opening_balance_atoms text,
        closing_balance_atoms text,
        as_of timestamptz,
        warnings jsonb NOT NULL DEFAULT '[]'::jsonb
      );
      CREATE UNIQUE INDEX IF NOT EXISTS agus_statement_imports_file ON agus_statement_imports(account_id, file_hash);
      CREATE INDEX IF NOT EXISTS agus_statement_imports_owner ON agus_statement_imports(tenant_id, owner_id, account_id);

      CREATE TABLE IF NOT EXISTS agus_financial_transactions (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES agus_financial_accounts(id) ON DELETE CASCADE,
        owner_id text NOT NULL,
        tenant_id text NOT NULL DEFAULT 'default',
        posted_at timestamptz NOT NULL,
        value_at timestamptz,
        amount_atoms text NOT NULL,
        currency text NOT NULL CHECK (currency IN ('NGN','USD','USDC','EUR','GBP')),
        scale integer NOT NULL,
        status text NOT NULL CHECK (status IN ('pending','posted','reversed','corrected','duplicate')),
        reversal_of_id text,
        raw_description text NOT NULL,
        clean_description text NOT NULL,
        counterparty jsonb NOT NULL DEFAULT '{}'::jsonb,
        category text NOT NULL,
        reference text,
        statement_balance_atoms text,
        fingerprint text NOT NULL,
        internal_transfer jsonb,
        user_override jsonb,
        provenance jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS agus_transactions_fingerprint ON agus_financial_transactions(account_id, fingerprint);
      CREATE INDEX IF NOT EXISTS agus_transactions_owner_posted ON agus_financial_transactions(tenant_id, owner_id, posted_at DESC);
      CREATE INDEX IF NOT EXISTS agus_transactions_account_posted ON agus_financial_transactions(account_id, posted_at DESC);

      CREATE TABLE IF NOT EXISTS agus_account_balance_observations (
        id text PRIMARY KEY,
        account_id text NOT NULL REFERENCES agus_financial_accounts(id) ON DELETE CASCADE,
        owner_id text NOT NULL,
        tenant_id text NOT NULL DEFAULT 'default',
        currency text NOT NULL,
        scale integer NOT NULL,
        available_atoms text,
        current_atoms text,
        ledger_atoms text,
        as_of timestamptz NOT NULL,
        source text NOT NULL,
        confidence text NOT NULL,
        is_stale boolean NOT NULL DEFAULT false,
        staleness_reason text,
        evidence_provenance jsonb,
        observed_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS agus_balance_obs_account ON agus_account_balance_observations(account_id, as_of DESC);
    `;

    if (this.sql.exec) {
      await this.sql.exec(ddl);
    } else {
      await this.sql.query(ddl);
    }
  }

  public async saveAccount(account: FinancialAccount): Promise<void> {
    const q = `
      INSERT INTO agus_financial_accounts (
        id, owner_id, tenant_id, institution_code, institution_name, institution_type,
        account_number_masked, account_name, currency, account_type, created_at, updated_at, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (id) DO UPDATE SET
        account_name = EXCLUDED.account_name,
        updated_at = EXCLUDED.updated_at,
        metadata = EXCLUDED.metadata;
    `;
    await this.sql.query(q, [
      account.id,
      account.ownerId,
      account.tenantId ?? "default",
      account.institution.code,
      account.institution.name,
      account.institution.type,
      account.accountNumberMasked,
      account.accountName,
      account.currency,
      account.accountType,
      account.createdAt,
      account.updatedAt,
      account.metadata ? JSON.stringify(account.metadata) : null,
    ]);
  }

  public async getAccount(
    ownerId: string,
    accountId: string,
    tenantId = "default",
  ): Promise<FinancialAccount | null> {
    const res = await this.sql.query<{
      id: string;
      owner_id: string;
      tenant_id: string;
      institution_code: string;
      institution_name: string;
      institution_type: string;
      account_number_masked: string;
      account_name: string;
      currency: SupportedCurrency;
      account_type: FinancialAccount["accountType"];
      created_at: string | Date;
      updated_at: string | Date;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT * FROM agus_financial_accounts WHERE id = $1 AND owner_id = $2 AND tenant_id = $3`,
      [accountId, ownerId, tenantId],
    );

    if (res.rows.length === 0) return null;
    const r = res.rows[0];

    return {
      id: r.id,
      ownerId: r.owner_id,
      tenantId: r.tenant_id,
      institution: {
        code: r.institution_code,
        name: r.institution_name,
        type: r.institution_type as FinancialAccount["institution"]["type"],
      },
      accountNumberMasked: r.account_number_masked,
      accountName: r.account_name,
      currency: r.currency,
      accountType: r.account_type,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      metadata: r.metadata ?? undefined,
    };
  }

  public async listAccounts(
    ownerId: string,
    tenantId = "default",
  ): Promise<FinancialAccount[]> {
    const res = await this.sql.query<{
      id: string;
      owner_id: string;
      tenant_id: string;
      institution_code: string;
      institution_name: string;
      institution_type: string;
      account_number_masked: string;
      account_name: string;
      currency: SupportedCurrency;
      account_type: FinancialAccount["accountType"];
      created_at: string | Date;
      updated_at: string | Date;
      metadata: Record<string, unknown> | null;
    }>(
      `SELECT * FROM agus_financial_accounts WHERE owner_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
      [ownerId, tenantId],
    );

    return res.rows.map((r) => ({
      id: r.id,
      ownerId: r.owner_id,
      tenantId: r.tenant_id,
      institution: {
        code: r.institution_code,
        name: r.institution_name,
        type: r.institution_type as FinancialAccount["institution"]["type"],
      },
      accountNumberMasked: r.account_number_masked,
      accountName: r.account_name,
      currency: r.currency,
      accountType: r.account_type,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString(),
      metadata: r.metadata ?? undefined,
    }));
  }

  public async saveStatementImport(
    audit: IngestionAuditRecord,
    format: string,
    metadata?: { openingBalanceAtoms?: bigint; closingBalanceAtoms?: bigint; asOf?: string },
    tenantId = "default",
  ): Promise<void> {
    const q = `
      INSERT INTO agus_statement_imports (
        id, file_hash, file_name, account_id, owner_id, tenant_id, format,
        imported_at, total_rows, imported_count, duplicate_count, skipped_count,
        opening_balance_atoms, closing_balance_atoms, as_of, warnings
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (account_id, file_hash) DO NOTHING;
    `;

    await this.sql.query(q, [
      audit.importId,
      audit.fileHash,
      audit.fileName,
      audit.accountId,
      audit.ownerId,
      tenantId,
      format,
      audit.importedAt,
      audit.totalRows,
      audit.importedCount,
      audit.duplicateCount,
      audit.skippedCount,
      metadata?.openingBalanceAtoms?.toString() ?? null,
      metadata?.closingBalanceAtoms?.toString() ?? null,
      metadata?.asOf ? new Date(metadata.asOf).toISOString() : null,
      JSON.stringify(audit.warnings),
    ]);
  }

  public async saveTransactions(transactions: FinancialTransaction[]): Promise<void> {
    for (const tx of transactions) {
      const fp = computeTransactionFingerprint(tx);

      // We preserve existing user_override when updating!
      const q = `
        INSERT INTO agus_financial_transactions (
          id, account_id, owner_id, tenant_id, posted_at, value_at, amount_atoms,
          currency, scale, status, reversal_of_id, raw_description, clean_description,
          counterparty, category, reference, statement_balance_atoms, fingerprint,
          internal_transfer, user_override, provenance, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
        ON CONFLICT (account_id, fingerprint) DO UPDATE SET
          status = EXCLUDED.status,
          reversal_of_id = COALESCE(EXCLUDED.reversal_of_id, agus_financial_transactions.reversal_of_id),
          internal_transfer = COALESCE(EXCLUDED.internal_transfer, agus_financial_transactions.internal_transfer),
          category = CASE
            WHEN agus_financial_transactions.user_override IS NOT NULL AND agus_financial_transactions.user_override->>'category' IS NOT NULL
            THEN agus_financial_transactions.category
            ELSE EXCLUDED.category
          END,
          statement_balance_atoms = COALESCE(EXCLUDED.statement_balance_atoms, agus_financial_transactions.statement_balance_atoms);
      `;

      await this.sql.query(q, [
        tx.id,
        tx.accountId,
        tx.ownerId,
        tx.tenantId ?? "default",
        tx.postedAt,
        tx.valueAt ? tx.valueAt : null,
        tx.amountAtoms.toString(),
        tx.currency,
        tx.scale,
        tx.status,
        tx.reversalOfId ?? null,
        tx.rawDescription,
        tx.cleanDescription,
        JSON.stringify(tx.counterparty),
        tx.category,
        tx.reference ?? null,
        tx.statementBalanceAtoms ? tx.statementBalanceAtoms.toString() : null,
        fp,
        tx.internalTransferMetadata ? JSON.stringify(tx.internalTransferMetadata) : null,
        tx.userOverride ? JSON.stringify(tx.userOverride) : null,
        JSON.stringify(tx.provenance),
        tx.provenance.importedAt ? tx.provenance.importedAt : new Date().toISOString(),
      ]);
    }
  }

  public async getTransaction(
    ownerId: string,
    transactionId: string,
    tenantId = "default",
  ): Promise<FinancialTransaction | null> {
    const res = await this.sql.query<{
      id: string;
      account_id: string;
      owner_id: string;
      tenant_id: string;
      posted_at: string | Date;
      value_at: string | Date | null;
      amount_atoms: string;
      currency: SupportedCurrency;
      scale: number;
      status: FinancialTransaction["status"];
      reversal_of_id: string | null;
      raw_description: string;
      clean_description: string;
      counterparty: FinancialTransaction["counterparty"];
      category: FinancialTransaction["category"];
      reference: string | null;
      statement_balance_atoms: string | null;
      internal_transfer: FinancialTransaction["internalTransferMetadata"] | null;
      user_override: FinancialTransaction["userOverride"] | null;
      provenance: FinancialTransaction["provenance"];
    }>(
      `SELECT * FROM agus_financial_transactions WHERE id = $1 AND owner_id = $2 AND tenant_id = $3`,
      [transactionId, ownerId, tenantId],
    );

    if (res.rows.length === 0) return null;
    return this.mapTransactionRow(res.rows[0]);
  }

  public async listTransactions(
    ownerId: string,
    filter: TransactionFilter = {},
    tenantId = "default",
  ): Promise<{ items: FinancialTransaction[]; totalCount: number }> {
    const conditions: string[] = ["owner_id = $1", "tenant_id = $2"];
    const values: unknown[] = [ownerId, tenantId];
    let idx = 3;

    if (filter.accountId) {
      conditions.push(`account_id = $${idx++}`);
      values.push(filter.accountId);
    }
    if (filter.currency) {
      conditions.push(`currency = $${idx++}`);
      values.push(filter.currency);
    }
    if (filter.status) {
      conditions.push(`status = $${idx++}`);
      values.push(filter.status);
    }
    if (filter.category) {
      conditions.push(`category = $${idx++}`);
      values.push(filter.category);
    }
    if (filter.from) {
      conditions.push(`posted_at >= $${idx++}`);
      values.push(filter.from);
    }
    if (filter.toExclusive) {
      conditions.push(`posted_at < $${idx++}`);
      values.push(filter.toExclusive);
    }
    if (filter.isInternalTransfer !== undefined) {
      if (filter.isInternalTransfer) {
        conditions.push(`(internal_transfer->>'isInternalTransfer')::boolean = true`);
      } else {
        conditions.push(`((internal_transfer->>'isInternalTransfer') IS NULL OR (internal_transfer->>'isInternalTransfer')::boolean = false)`);
      }
    }
    if (filter.searchQuery) {
      conditions.push(`(raw_description ILIKE $${idx} OR clean_description ILIKE $${idx} OR reference ILIKE $${idx})`);
      values.push(`%${filter.searchQuery}%`);
      idx++;
    }

    const whereClause = conditions.join(" AND ");

    // Count
    const countRes = await this.sql.query<{ count: string }>(
      `SELECT count(*) as count FROM agus_financial_transactions WHERE ${whereClause}`,
      values,
    );
    const totalCount = parseInt(countRes.rows[0]?.count ?? "0", 10);

    // Items
    let pageQuery = `SELECT * FROM agus_financial_transactions WHERE ${whereClause} ORDER BY posted_at DESC`;
    if (filter.limit) {
      pageQuery += ` LIMIT ${filter.limit}`;
    }
    if (filter.offset) {
      pageQuery += ` OFFSET ${filter.offset}`;
    }

    const res = await this.sql.query<{
      id: string;
      account_id: string;
      owner_id: string;
      tenant_id: string;
      posted_at: string | Date;
      value_at: string | Date | null;
      amount_atoms: string;
      currency: SupportedCurrency;
      scale: number;
      status: FinancialTransaction["status"];
      reversal_of_id: string | null;
      raw_description: string;
      clean_description: string;
      counterparty: FinancialTransaction["counterparty"];
      category: FinancialTransaction["category"];
      reference: string | null;
      statement_balance_atoms: string | null;
      internal_transfer: FinancialTransaction["internalTransferMetadata"] | null;
      user_override: FinancialTransaction["userOverride"] | null;
      provenance: FinancialTransaction["provenance"];
    }>(pageQuery, values);

    return {
      items: res.rows.map((r) => this.mapTransactionRow(r)),
      totalCount,
    };
  }

  public async saveUserOverride(
    ownerId: string,
    transactionId: string,
    override: UserClassificationOverride,
    tenantId = "default",
  ): Promise<FinancialTransaction> {
    const tx = await this.getTransaction(ownerId, transactionId, tenantId);
    if (!tx) {
      throw new Error(`Transaction not found or access denied: ${transactionId}`);
    }

    const newOverride: UserClassificationOverride = {
      ...override,
      updatedAt: new Date().toISOString(),
    };

    let newInternalTransfer = tx.internalTransferMetadata;
    let newCategory = tx.category;

    if (override.isInternalTransfer !== undefined) {
      newInternalTransfer = {
        isInternalTransfer: override.isInternalTransfer,
        confidence: override.isInternalTransfer ? "confirmed" : "not_internal",
        counterpartAccountId: override.counterpartAccountId,
        matchedBy: "user_override",
        matchedAt: newOverride.updatedAt || new Date().toISOString(),
      };
      if (override.isInternalTransfer) {
        newCategory = "transfer";
      }
    }

    if (override.category) {
      newCategory = override.category;
    }

    const q = `
      UPDATE agus_financial_transactions
      SET user_override = $1, internal_transfer = $2, category = $3
      WHERE id = $4 AND owner_id = $5 AND tenant_id = $6
    `;

    await this.sql.query(q, [
      JSON.stringify(newOverride),
      newInternalTransfer ? JSON.stringify(newInternalTransfer) : null,
      newCategory,
      transactionId,
      ownerId,
      tenantId,
    ]);

    return {
      ...tx,
      category: newCategory,
      userOverride: newOverride,
      internalTransferMetadata: newInternalTransfer,
    };
  }

  public async saveBalanceSnapshot(
    snapshot: AccountBalanceSnapshot,
    ownerId: string,
    tenantId = "default",
  ): Promise<void> {
    const q = `
      INSERT INTO agus_account_balance_observations (
        id, account_id, owner_id, tenant_id, currency, scale,
        available_atoms, current_atoms, ledger_atoms, as_of,
        source, confidence, is_stale, staleness_reason, evidence_provenance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `;

    await this.sql.query(q, [
      `bal_${randomUUID().slice(0, 10)}`,
      snapshot.accountId,
      ownerId,
      tenantId,
      snapshot.currency,
      snapshot.scale,
      snapshot.availableAtoms !== null ? snapshot.availableAtoms.toString() : null,
      snapshot.currentAtoms !== null ? snapshot.currentAtoms.toString() : null,
      snapshot.ledgerAtoms !== null ? snapshot.ledgerAtoms.toString() : null,
      snapshot.asOf,
      snapshot.source,
      snapshot.confidence,
      snapshot.isStale,
      snapshot.stalenessReason ?? null,
      snapshot.evidenceProvenance ? JSON.stringify(snapshot.evidenceProvenance) : null,
    ]);
  }

  public async getLatestBalanceSnapshot(
    accountId: string,
  ): Promise<AccountBalanceSnapshot | null> {
    const res = await this.sql.query<{
      account_id: string;
      currency: SupportedCurrency;
      scale: number;
      available_atoms: string | null;
      current_atoms: string | null;
      ledger_atoms: string | null;
      as_of: string | Date;
      source: AccountBalanceSnapshot["source"];
      confidence: AccountBalanceSnapshot["confidence"];
      is_stale: boolean;
      staleness_reason: string | null;
      evidence_provenance: AccountBalanceSnapshot["evidenceProvenance"] | null;
    }>(
      `SELECT * FROM agus_account_balance_observations WHERE account_id = $1 ORDER BY as_of DESC LIMIT 1`,
      [accountId],
    );

    if (res.rows.length === 0) return null;
    const r = res.rows[0];

    return {
      accountId: r.account_id,
      currency: r.currency,
      scale: r.scale,
      availableAtoms: r.available_atoms !== null ? BigInt(r.available_atoms) : null,
      currentAtoms: r.current_atoms !== null ? BigInt(r.current_atoms) : null,
      ledgerAtoms: r.ledger_atoms !== null ? BigInt(r.ledger_atoms) : null,
      asOf: new Date(r.as_of).toISOString(),
      source: r.source,
      confidence: r.confidence,
      isStale: r.is_stale,
      stalenessReason: r.staleness_reason ?? undefined,
      evidenceProvenance: r.evidence_provenance ?? undefined,
    };
  }

  private mapTransactionRow(r: {
    id: string;
    account_id: string;
    owner_id: string;
    tenant_id: string;
    posted_at: string | Date;
    value_at: string | Date | null;
    amount_atoms: string;
    currency: SupportedCurrency;
    scale: number;
    status: FinancialTransaction["status"];
    reversal_of_id: string | null;
    raw_description: string;
    clean_description: string;
    counterparty: FinancialTransaction["counterparty"];
    category: FinancialTransaction["category"];
    reference: string | null;
    statement_balance_atoms: string | null;
    internal_transfer: FinancialTransaction["internalTransferMetadata"] | null;
    user_override: FinancialTransaction["userOverride"] | null;
    provenance: FinancialTransaction["provenance"];
  }): FinancialTransaction {
    return {
      id: r.id,
      accountId: r.account_id,
      ownerId: r.owner_id,
      tenantId: r.tenant_id,
      postedAt: new Date(r.posted_at).toISOString(),
      valueAt: r.value_at ? new Date(r.value_at).toISOString() : undefined,
      amountAtoms: BigInt(r.amount_atoms),
      currency: r.currency,
      scale: r.scale,
      status: r.status,
      reversalOfId: r.reversal_of_id ?? undefined,
      rawDescription: r.raw_description,
      cleanDescription: r.clean_description,
      counterparty: r.counterparty,
      category: r.category,
      reference: r.reference ?? undefined,
      statementBalanceAtoms: r.statement_balance_atoms !== null ? BigInt(r.statement_balance_atoms) : undefined,
      internalTransferMetadata: r.internal_transfer ?? undefined,
      userOverride: r.user_override ?? undefined,
      provenance: r.provenance,
    };
  }
}
