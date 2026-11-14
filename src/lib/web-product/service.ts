import { conversationConfiguration } from "./runtime-configuration";
import { isIssuerAddress } from "../pollar/network";
import { randomUUID, createHash } from "node:crypto";
import { reauthenticate } from "../auth";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "../domain";
import { database, transaction, type Sql } from "../../server/sql";
import { workspace, initializeWorkspace } from "../agent-workspace/store";
import {
  FinancialIntelligenceRepository,
  MultiAccountFinancialIntelligenceService,
  computeAccountBalances,
  computeCashFlow,
  formatMonetaryAmount,
} from "../financial-intelligence";
import {
  atomic,
  InvoiceInput,
  RequestInput,
  moneyScale,
  type Invoice,
  type PaymentRequest,
  type ProductEvent,
  type ProductSnapshot,
  type VerificationEvidence,
} from "./contracts";
import {
  pollarConfiguration,
  stellarAddress,
  zcashUri,
  verifyStellar,
  verifyZcash,
} from "./rails";

let ready: Promise<void> | undefined;
export async function initializeProduct() {
  await initializeWorkspace();
  await (ready ??= (async () => {
    const sql = await database();
    if (!process.env.DATABASE_URL?.startsWith("postgres")) {
      const repo = new FinancialIntelligenceRepository(sql);
      await repo.ensureSchema();
      for (const name of [
        "0019_web_product.sql",
        "0020_conversational_payments.sql",
        "0021_web_preferences.sql",
      ]) {
        const migration = await readFile(
          join(process.cwd(), "migrations", name),
          "utf8",
        );
        if (sql.exec) await sql.exec(migration);
        else await sql.query(migration);
      }
    }
  })().catch((e) => {
    ready = undefined;
    throw e;
  }));
  return database();
}

async function event(
  sql: Sql,
  owner: string,
  kind: string,
  text: string,
  refs: { invoiceId?: string; requestId?: string } = {},
) {
  const payload: ProductEvent = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    text,
    ...refs,
  };
  await sql.query(
    "INSERT INTO agus_web_events(owner,id,payload) VALUES($1,$2,$3::jsonb)",
    [owner, payload.id, JSON.stringify(payload)],
  );
}

export function currentRequest(
  request: PaymentRequest,
  now = Date.now(),
): PaymentRequest {
  const reviewDigest = createHash("sha256")
    .update(
      JSON.stringify([
        request.id,
        request.owner,
        request.invoiceId,
        request.rail,
        request.network,
        request.recipient,
        request.asset,
        request.issuer ?? null,
        request.amount,
        request.memo,
        request.expiresAt,
        "100000",
      ]),
    )
    .digest("hex");
  return request.state === "pending" && Date.parse(request.expiresAt) <= now
    ? { ...request, state: "expired", reviewDigest }
    : { ...request, reviewDigest };
}

async function invoiceRow(
  sql: Sql,
  owner: string,
  id: string,
  lock = false,
): Promise<Invoice> {
  const result = await sql.query(
    "SELECT payload FROM agus_web_invoices WHERE owner=$1 AND id=$2" +
      (lock ? " FOR UPDATE" : ""),
    [owner, id],
  );
  if (!result.rows.length) throw new AppError("Invoice not found", 404);
  return result.rows[0].payload;
}

export async function createInvoice(owner: string, raw: unknown) {
  const input = InvoiceInput.parse(raw);
  try {
    if (atomic(input.amount, moneyScale[input.currency]) <= 0n)
      throw new Error("Enter a positive amount.");
  } catch (error) {
    throw new AppError(
      error instanceof Error ? error.message : "Invalid amount",
    );
  }
  if (Date.parse(input.dueAt) > Date.now() + 365 * 86400000)
    throw new AppError("Choose a due date within one year.");
  await initializeProduct();
  const task = await workspace(owner).createTask({
    requestId: input.id,
    title: input.title,
    objective:
      `${input.direction === "receivable" ? "Follow up with" : "Review payment to"} ${input.counterparty}: ${input.amount} ${input.currency}. ${input.note}`.trim(),
    dueAt: input.dueAt,
  });
  return transaction(async (sql) => {
    const invoice: Invoice = {
      ...input,
      owner,
      createdAt: new Date().toISOString(),
      state: "open",
      responsibilityId: task.id,
    };
    const inserted = await sql.query(
      "INSERT INTO agus_web_invoices(owner,id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING id",
      [owner, input.id, JSON.stringify(invoice)],
    );
    const saved = await invoiceRow(sql, owner, input.id);
    if (
      Object.keys(input).some(
        (key) =>
          saved[key as keyof InvoiceInput] !== input[key as keyof InvoiceInput],
      )
    )
      throw new AppError(
        "This request ID already belongs to a different invoice.",
        409,
      );
    if (inserted.rows.length)
      await event(
        sql,
        owner,
        "invoice.created",
        `${input.title} · ${input.counterparty} · ${input.amount} ${input.currency}`,
        { invoiceId: input.id },
      );
    return saved;
  });
}

export async function createPaymentRequest(
  owner: string,
  raw: unknown,
): Promise<PaymentRequest> {
  const input = RequestInput.parse(raw);
  await initializeProduct();
  return transaction(async (sql) => {
    const invoice = await invoiceRow(sql, owner, input.invoiceId, true);
    const existing = await sql.query(
      "SELECT payload FROM agus_web_requests WHERE owner=$1 AND id=$2",
      [owner, input.id],
    );
    if (existing.rows.length) {
      const saved: PaymentRequest = existing.rows[0].payload;
      if (
        saved.invoiceId !== input.invoiceId ||
        saved.rail !== input.rail ||
        saved.recipient !== input.recipient
      )
        throw new AppError(
          "Request identity already used for different payment instructions.",
          409,
        );
      return currentRequest(saved);
    }
    if (invoice.state !== "open" || invoice.direction !== "receivable")
      throw new AppError(
        "Create a request for an open receivable invoice.",
        409,
      );
    if (
      (input.rail === "pollar-stellar" && invoice.currency !== "USDC") ||
      (input.rail === "zcash" && invoice.currency !== "ZEC")
    )
      throw new AppError(
        "The invoice asset must match the payment pathway. Create a separate invoice to use a different asset.",
        409,
      );
    const active = await sql.query(
      "SELECT payload FROM agus_web_requests WHERE owner=$1 AND invoice_id=$2 AND payload->>'state' IN ('pending','confirmed')",
      [owner, invoice.id],
    );
    if (
      active.rows.some((r) =>
        ["pending", "confirmed"].includes(currentRequest(r.payload).state),
      )
    )
      throw new AppError(
        "This invoice already has an active payment request.",
        409,
      );
    const memo = `AGUS-${input.id.replaceAll("-", "").slice(0, 20)}`;
    const now = new Date().toISOString();
    const issuer =
      input.rail === "pollar-stellar"
        ? pollarConfiguration().issuer
        : undefined;
    if (
      input.rail === "pollar-stellar" &&
      isIssuerAddress(input.recipient, issuer)
    )
      throw new AppError(
        "That is the USDC issuer address, not the recipient’s wallet. Use a separate controlled receiving account with the appropriate trustline.",
      );
    if (
      input.rail === "pollar-stellar" &&
      (!stellarAddress(input.recipient) || !issuer)
    )
      throw new AppError(
        "Configure the Stellar testnet USDC issuer and provide a valid receiving wallet.",
        503,
      );
    const uri =
      input.rail === "zcash"
        ? zcashUri(input.recipient, invoice.amount, memo)
        : `web+stellar:pay?${new URLSearchParams({ destination: input.recipient, amount: invoice.amount, asset_code: "USDC", asset_issuer: issuer!, memo, memo_type: "MEMO_TEXT", network_passphrase: "Test SDF Network ; September 2015" })}`;
    const request: PaymentRequest = {
      id: input.id,
      owner,
      invoiceId: invoice.id,
      rail: input.rail,
      network: "testnet",
      asset: input.rail === "zcash" ? "ZEC" : "USDC",
      ...(issuer ? { issuer } : {}),
      amount: invoice.amount,
      recipient: input.recipient,
      memo,
      uri,
      createdAt: now,
      expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
      state: "pending",
    };
    await sql.query(
      "INSERT INTO agus_web_requests(owner,id,invoice_id,payload) VALUES($1,$2,$3,$4::jsonb)",
      [owner, request.id, invoice.id, JSON.stringify(request)],
    );
    await event(
      sql,
      owner,
      "request.created",
      `${request.asset} testnet request created. Awaiting receiving evidence.`,
      { invoiceId: invoice.id, requestId: request.id },
    );
    return request;
  });
}

export async function getPaymentRequest(
  owner: string,
  id: string,
): Promise<PaymentRequest> {
  const sql = await initializeProduct();
  const row = await sql.query(
    "SELECT payload FROM agus_web_requests WHERE owner=$1 AND id=$2",
    [owner, id],
  );
  if (!row.rows.length) throw new AppError("Payment request not found", 404);
  return currentRequest(row.rows[0].payload);
}

/** Internal-only commit boundary. Evidence comes solely from a server verifier. */
export async function recordSettlement(
  owner: string,
  requestId: string,
  evidence: VerificationEvidence,
) {
  return transaction(async (sql) => {
    const rows = await sql.query(
      "SELECT payload FROM agus_web_requests WHERE owner=$1 AND id=$2 FOR UPDATE",
      [owner, requestId],
    );
    if (!rows.rows.length) throw new AppError("Payment request not found", 404);
    const request = currentRequest(rows.rows[0].payload);
    const invoice = await invoiceRow(sql, owner, request.invoiceId, true);
    if (request.state === "confirmed") return request;
    if (
      request.nativeWallet &&
      (!evidence.walletReceipt ||
        evidence.walletReceipt.invoiceKey !== request.nativeWallet.invoiceKey ||
        evidence.walletReceipt.termsDigest !==
          request.nativeWallet.termsDigest ||
        evidence.walletReceipt.walletId !== request.nativeWallet.walletId ||
        evidence.walletReceipt.walletRequestId !==
          request.nativeWallet.walletRequestId ||
        evidence.walletReceipt.matching !== "unique-wallet-address" ||
        (evidence.confirmations ?? 0) < 3 ||
        evidence.asset !== "ZEC")
    )
      throw new AppError(
        "Managed wallet evidence does not match the invoice binding",
        409,
      );
    if (request.state !== "pending" || invoice.state !== "open")
      throw new AppError(
        "This request is no longer open. Review late payments separately.",
        409,
      );
    if (
      evidence.recipient !== request.recipient ||
      evidence.amount !== request.amount ||
      evidence.memo !== request.memo ||
      evidence.network !== "testnet" ||
      evidence.source !==
        (request.rail === "zcash"
          ? "zcash-receiving-wallet"
          : "stellar-horizon-testnet")
    )
      throw new AppError(
        "Receiving evidence does not match the payment request.",
        409,
      );
    const used = await sql.query(
      "SELECT id FROM agus_web_requests WHERE payload->>'state'='confirmed' AND payload->'evidence'->>'source'=$1 AND payload->'evidence'->>'transactionId'=$2",
      [evidence.source, evidence.transactionId],
    );
    if (used.rows.length)
      throw new AppError(
        "This transaction has already settled another request.",
        409,
      );
    request.state = "confirmed";
    request.evidence = evidence;
    request.lastCheckedAt = evidence.observedAt;
    request.lastCheck = "Receiving evidence verified";
    invoice.state = "settled";
    invoice.settledAt = evidence.observedAt;
    invoice.settlementRequestId = request.id;
    await sql.query(
      "UPDATE agus_web_requests SET payload=$3::jsonb WHERE owner=$1 AND id=$2",
      [owner, request.id, JSON.stringify(request)],
    );
    await sql.query(
      "UPDATE agus_web_invoices SET payload=$3::jsonb WHERE owner=$1 AND id=$2",
      [owner, invoice.id, JSON.stringify(invoice)],
    );
    // Complete the existing responsibility in the same DB transaction as settlement.
    await sql.query(
      "UPDATE agus2_tasks SET state='completed',version=version+1,payload=jsonb_set(jsonb_set(payload,'{state}','\"completed\"'::jsonb),'{version}',to_jsonb(version+1)) WHERE owner=$1 AND id=$2 AND state<>'cancelled'",
      [owner, invoice.responsibilityId],
    );
    await sql.query(
      "INSERT INTO agus2_events(owner,id,task,kind,created_at) VALUES($1,$2,$3,'settlement_verified',now())",
      [owner, randomUUID(), invoice.responsibilityId],
    );
    await event(
      sql,
      owner,
      "payment.confirmed",
      `${invoice.counterparty} · ${request.amount} ${request.asset} received on testnet. Responsibility completed.`,
      { invoiceId: invoice.id, requestId: request.id },
    );
    return request;
  });
}

export async function checkPayment(
  owner: string,
  id: string,
  transactionId: string,
) {
  if (!/^[a-f0-9]{64}$/i.test(transactionId))
    throw new AppError("Enter a 64-character hexadecimal transaction ID.");
  const request = await getPaymentRequest(owner, id);
  if (request.state === "confirmed") return request;
  if (request.state !== "pending")
    throw new AppError(
      "This payment request has expired or was cancelled. Review late payments separately.",
      409,
    );
  let evidence: VerificationEvidence;
  try {
    evidence = await (request.rail === "zcash"
      ? verifyZcash(request, transactionId)
      : verifyStellar(request, transactionId));
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : "Network verification is unavailable. No settlement was recorded.";
    const sql = await database();
    // Do not replace concurrent successful evidence with a stale failure.
    await sql.query(
      "UPDATE agus_web_requests SET payload=payload || $3::jsonb WHERE owner=$1 AND id=$2 AND payload->>'state'='pending'",
      [
        owner,
        id,
        JSON.stringify({
          lastCheckedAt: new Date().toISOString(),
          candidateTransactionId: transactionId,
          lastCheck: message,
        }),
      ],
    );
    throw error instanceof AppError ? error : new AppError(message, 502);
  }
  return recordSettlement(owner, id, evidence);
}

export async function cancelRequest(owner: string, id: string) {
  await initializeProduct();
  return transaction(async (sql) => {
    const row = await sql.query(
      "SELECT payload FROM agus_web_requests WHERE owner=$1 AND id=$2 FOR UPDATE",
      [owner, id],
    );
    if (!row.rows.length) throw new AppError("Payment request not found", 404);
    const request: PaymentRequest = row.rows[0].payload;
    if (request.state === "confirmed")
      throw new AppError("A verified receipt cannot be cancelled.", 409);
    request.state = "cancelled";
    await sql.query(
      "UPDATE agus_web_requests SET payload=$3::jsonb WHERE owner=$1 AND id=$2",
      [owner, id, JSON.stringify(request)],
    );
    await event(
      sql,
      owner,
      "request.cancelled",
      "Payment request cancelled. The invoice remains outstanding.",
      { invoiceId: request.invoiceId, requestId: id },
    );
    return request;
  });
}

/** Reserve exactly one explicit SDK send attempt; never retry an uncertain POST. */
export async function beginPollarSubmission(
  owner: string,
  id: string,
  password: string,
  reviewDigest: string,
) {
  await initializeProduct();
  await reauthenticate(owner, password);
  return transaction(async (sql) => {
    const rows = await sql.query(
      "SELECT payload FROM agus_web_requests WHERE owner=$1 AND id=$2 FOR UPDATE",
      [owner, id],
    );
    if (!rows.rows.length) throw new AppError("Payment request not found", 404);
    const request = currentRequest(rows.rows[0].payload);
    if (
      request.rail !== "pollar-stellar" ||
      request.state !== "pending" ||
      request.submissionStartedAt
    )
      throw new AppError(
        "This request cannot start another send. Check wallet history and verify any existing transaction.",
        409,
      );
    if (request.reviewDigest !== reviewDigest)
      throw new AppError(
        "Payment request instructions changed; review them again before authorizing.",
        409,
      );
    request.submissionStartedAt = new Date().toISOString();
    await sql.query(
      "UPDATE agus_web_requests SET payload=$3::jsonb WHERE owner=$1 AND id=$2",
      [owner, id, JSON.stringify(request)],
    );
    await event(
      sql,
      owner,
      "payment.submission_started",
      "One Pollar SDK testnet send authorized. Outcome requires independent verification.",
      { invoiceId: request.invoiceId, requestId: id },
    );
    return request;
  });
}

export const ImportInput = z.strictObject({
  accountId: z.string().max(128).optional(),
  institution: z.string().trim().min(1).max(100),
  label: z.string().trim().min(1).max(100),
  lastFour: z.string().regex(/^\d{4}$/),
  currency: z.enum(["NGN", "USD", "USDC", "EUR", "GBP"]),
  fileName: z
    .string()
    .min(1)
    .max(120)
    .regex(/\.csv$/i),
  content: z.string().min(1).max(500000),
});

export async function importStatement(owner: string, raw: unknown) {
  const input = ImportInput.parse(raw);
  await initializeProduct();
  // Account creation, import audit, transactions and reconciliation commit together.
  return transaction(async (sql) => {
    const service = new MultiAccountFinancialIntelligenceService(
      new FinancialIntelligenceRepository(sql),
    );
    if (!input.accountId) {
      const accounts = await service.getAccounts(owner);
      if (
        accounts.some(
          (account) =>
            account.institution.name.trim().toLowerCase() ===
              input.institution.toLowerCase() &&
            account.accountNumberMasked.endsWith(input.lastFour) &&
            account.currency === input.currency,
        )
      )
        throw new AppError(
          "An imported account with this institution, currency and last four digits already exists. Choose it from the account list to avoid counting it twice.",
          409,
        );
    }
    const account = input.accountId
      ? await service.getAccount(owner, input.accountId)
      : await service.registerAccount({
          ownerId: owner,
          institution: {
            code: "manual",
            name: input.institution,
            type: "commercial_bank",
          },
          accountNumberMasked: `•••• ${input.lastFour}`,
          accountName: input.label,
          currency: input.currency,
          accountType: "checking",
          metadata: { source: "user_statement_import" },
        });
    if (!account) throw new AppError("Account not found", 404);
    if (account.currency !== input.currency)
      throw new AppError(
        "Statement currency must match the existing account.",
        409,
      );
    let result;
    try {
      result = await service.ingestStatement(
        owner,
        account.id,
        input.content,
        input.fileName,
      );
    } catch {
      throw new AppError(
        "The CSV could not be imported. Check the date, description, debit/credit or amount, and balance columns.",
      );
    }
    if (
      !result.totalParsedRows ||
      (!result.importedTransactions.length &&
        !result.duplicateTransactions.length)
    )
      throw new AppError(
        "No usable transactions were found. Check the CSV columns and dates.",
      );
    await event(
      sql,
      owner,
      "statement.imported",
      `${input.label}: ${result.importedTransactions.length} rows imported, ${result.duplicateTransactions.length} duplicates skipped. User-provided statement; no bank connection.`,
    );
    return {
      accountId: account.id,
      imported: result.importedTransactions.length,
      duplicates: result.duplicateTransactions.length,
      warnings: result.warnings,
    };
  });
}

export async function completeOnboarding(owner: string) {
  const sql = await initializeProduct();
  await sql.query(
    "INSERT INTO agus_web_preferences(owner,onboarding_completed) VALUES($1,TRUE) ON CONFLICT(owner) DO UPDATE SET onboarding_completed=TRUE",
    [owner],
  );
  return { onboardingCompleted: true };
}

export async function productSnapshot(owner: string): Promise<ProductSnapshot> {
  const sql = await initializeProduct();
  const repo = new FinancialIntelligenceRepository(sql);
  const [accounts, txs, invoiceRows, requestRows, events, preferences] =
    await Promise.all([
      repo.listAccounts(owner),
      repo.listTransactions(owner),
      sql.query(
        "SELECT payload FROM agus_web_invoices WHERE owner=$1 ORDER BY created_at DESC LIMIT 200",
        [owner],
      ),
      sql.query(
        "SELECT payload FROM agus_web_requests WHERE owner=$1 ORDER BY created_at DESC LIMIT 200",
        [owner],
      ),
      sql.query(
        "SELECT payload FROM agus_web_events WHERE owner=$1 ORDER BY at DESC,id LIMIT 100",
        [owner],
      ),
      sql.query(
        "SELECT onboarding_completed FROM agus_web_preferences WHERE owner=$1",
        [owner],
      ),
    ]);
  const balances = computeAccountBalances(accounts, txs.items);
  const cash = computeCashFlow({ transactions: txs.items, currency: "NGN" });
  const invoices: Invoice[] = invoiceRows.rows.map((r) => r.payload);
  const ngn = balances.currencySummaries.NGN;
  const hasNaira =
    ngn.accountCount > 0 && ngn.verifiedAccountCount === ngn.accountCount;
  const open = invoices.filter((i) => i.state === "open");
  const warnings = [...balances.stalenessWarnings];
  if (balances.hasUnverifiedEstimates)
    warnings.push(
      "Some imported accounts lack a balance anchor. Their transaction deltas are not available funds.",
    );
  if (accounts.length)
    warnings.push(
      "Imported statements are user-provided historical records, not live bank balances or bank-verified evidence.",
    );
  return {
    owner,
    preferences: {
      onboardingCompleted: preferences.rows[0]?.onboarding_completed === true,
    },
    asOf: new Date().toISOString(),
    invoices,
    requests: requestRows.rows.map((r) => currentRequest(r.payload)),
    events: events.rows.map((r) => r.payload),
    accounts: accounts.map((account) => {
      const snap = balances.snapshots.find((s) => s.accountId === account.id);
      return {
        id: account.id,
        label: account.accountName,
        institution: account.institution.name,
        maskedNumber: account.accountNumberMasked,
        currency: account.currency,
        amount:
          snap?.confidence === "verified" && snap.currentAtoms !== null
            ? formatMonetaryAmount(snap.currentAtoms, account.currency)
            : null,
        asOf: snap?.evidenceProvenance?.observedAt ?? null,
        stale: snap?.isStale ?? true,
        confidence:
          snap?.confidence === "verified" ? "statement anchored" : "unanchored",
        source: "statement import",
      };
    }),
    transactions: txs.items.slice(0, 100).map((tx) => ({
      id: tx.id,
      description: tx.cleanDescription || tx.rawDescription,
      amount: formatMonetaryAmount(tx.amountAtoms, tx.currency),
      currency: tx.currency,
      postedAt: tx.postedAt,
      category: tx.userOverride?.category ?? tx.category,
      internal: tx.internalTransferMetadata?.isInternalTransfer ?? false,
    })),
    intelligence: {
      naira: hasNaira ? ngn.formatted : null,
      importedAccountCount: accounts.length,
      income: cash.overall.formattedIncome,
      spending: cash.overall.formattedSpending,
      excludedTransfers: cash.excludedInternalTransfersCount,
      warnings,
      nextAction: open.length
        ? `You have ${open.length} open ${open.length === 1 ? "obligation" : "obligations"}. ${open.some((i) => Date.parse(i.dueAt) < Date.now()) ? "Follow up on the overdue items first." : "Prepare a payment request for your next receivable."}`
        : accounts.length
          ? "Your imported records are ready. Add an obligation to put your next financial step in context."
          : "Start with a statement or an obligation. I’ll keep the source and the next step clear.",
    },
    capabilities: {
      pollar: pollarConfiguration(),
      zcash: {
        managedReceivingConfigured:
          !!process.env.ZCASH_RECEIVE_SERVICE_URL &&
          !!process.env.ZCASH_RECEIVE_TOKEN,
        verificationConfigured:
          !!process.env.ZCASH_WALLET_RPC_URL ||
          (!!process.env.ZCASH_RECEIVE_SERVICE_URL &&
            !!process.env.ZCASH_RECEIVE_TOKEN),
        receivingAddress: process.env.ZCASH_TESTNET_RECEIVING_ADDRESS ?? null,
        network: "testnet",
      },
      ai: conversationConfiguration(),
      bank: "coming-soon",
      session: "single-operator",
    },
  };
}

export async function financialGuidance(owner: string) {
  const snapshot = await productSnapshot(owner);
  return {
    source: "deterministic-financial-snapshot",
    asOf: snapshot.asOf,
    text: [
      snapshot.intelligence.nextAction,
      snapshot.intelligence.naira
        ? `${snapshot.intelligence.naira} is the combined balance anchored to your imported Naira statements. It is not a live spendable balance.`
        : "I don’t have a complete statement-anchored Naira balance yet.",
      "Digital assets and their USD valuations remain separate. An open invoice is not cash received.",
      `${snapshot.requests.filter((r) => r.state === "confirmed").length} payment requests have receiving evidence; ${snapshot.requests.filter((r) => r.state === "pending").length} are awaiting verification.`,
    ].join("\n\n"),
  };
}
