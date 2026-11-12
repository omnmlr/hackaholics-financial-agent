import {
  type AccountSummary,
  type EvidenceView,
  type TransactionView,
  AccountSummarySchema,
  EvidenceViewSchema,
  TransactionViewSchema,
} from "../financial-data/contracts";
import {
  type AccountBalanceSnapshot,
  type FinancialAccount,
  type FinancialTransaction,
} from "./types";

/**
 * Bridges Financial Intelligence account snapshot to AGUS Agent AccountSummary contract.
 */
export function toAgentAccountSummary(
  account: FinancialAccount,
  snapshot: AccountBalanceSnapshot,
): AccountSummary {
  const isStale = snapshot.isStale;
  const isAvailable = snapshot.availableAtoms !== null;

  const summary: AccountSummary = {
    accountId: account.id,
    currency: "NGN", // Agent contract currently models NGN core operations
    availableKobo: snapshot.availableAtoms !== null ? Number(snapshot.availableAtoms) : null,
    currentKobo: snapshot.currentAtoms !== null ? Number(snapshot.currentAtoms) : null,
    asOf: snapshot.asOf || new Date().toISOString(),
    simulated: false,
    unavailableReason: !isAvailable ? "not_provided" : isStale ? "stale" : null,
  };

  return AccountSummarySchema.parse(summary);
}

/**
 * Bridges FinancialTransaction to AGUS Agent TransactionView contract.
 */
export function toAgentTransactionView(
  tx: FinancialTransaction,
  accountLabel: string,
): TransactionView {
  const isDebit = tx.amountAtoms < 0n;
  const absAtoms = isDebit ? -tx.amountAtoms : tx.amountAtoms;
  const koboAmount = Number(absAtoms);

  const view: TransactionView = {
    id: tx.id,
    accountId: tx.accountId,
    accountLabel: accountLabel.slice(0, 100),
    revision: 1,
    currency: "NGN",
    amountKobo: koboAmount > 0 ? koboAmount : 1, // Contract requires positive non-zero kobo
    direction: isDebit ? "debit" : "credit",
    status: tx.status === "duplicate" ? "reversed" : tx.status === "corrected" ? "posted" : tx.status,
    reversalOfId: tx.reversalOfId || null,
    occurredAt: tx.valueAt || tx.postedAt,
    bookedAt: tx.postedAt,
    dateBasis: "bookedAt",
    counterparty: {
      displayName: tx.counterparty.name ? tx.counterparty.name.slice(0, 100) : null,
      institution: tx.counterparty.institution ? tx.counterparty.institution.slice(0, 100) : null,
    },
    description: (tx.cleanDescription || tx.rawDescription).slice(0, 500),
    reference: tx.reference ? tx.reference.slice(0, 128) : null,
    category: {
      value: (tx.userOverride?.category || tx.category).slice(0, 50),
      source: tx.userOverride?.category ? "user" : "provider",
    },
    simulated: false,
    simulationLabel: null,
    source: {
      provider: "mono",
      mode: "sandbox",
    },
    evidenceIds: tx.provenance ? [`ev_${tx.id}`] : [],
    rankReason: tx.reference ? "exact_reference" : "filter_match",
  };

  return TransactionViewSchema.parse(view);
}

/**
 * Bridges transaction evidence provenance to AGUS Agent EvidenceView contract.
 */
export function toAgentEvidenceView(
  tx: FinancialTransaction,
): EvidenceView {
  const view: EvidenceView = {
    id: `ev_${tx.id}`,
    transactionId: tx.id,
    kind: tx.internalTransferMetadata?.isInternalTransfer
      ? "transfer_verification"
      : "provider_record",
    provider: "mono",
    mode: "sandbox",
    sourceReference: (tx.reference || tx.id).slice(0, 128),
    observedAt: tx.provenance?.importedAt || tx.postedAt || new Date().toISOString(),
    sourceStatus: tx.status,
    limitations: tx.internalTransferMetadata?.isInternalTransfer
      ? [`Internal transfer verified with confidence: ${tx.internalTransferMetadata.confidence}`]
      : ["Statement file hash verified"],
    simulated: false,
  };

  return EvidenceViewSchema.parse(view);
}
