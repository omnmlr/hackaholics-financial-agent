import { z } from "zod";
import { AppError, type Batch, type State } from "../domain";
import {
  AccountSummarySchema,
  OwnershipSchema,
  type AccountRecord,
  type AccountSummary,
  type NormalizedTransaction,
} from "../financial-data/contracts";
import { fingerprint, normalizeTransaction } from "../financial-data/core";
import type { FixtureDataset } from "../financial-data/repository";

export const OpeningSchema = AccountSummarySchema.safeExtend(
  OwnershipSchema.shape,
).refine(
  (s) =>
    s.simulated &&
    !s.simulation &&
    s.availableKobo !== null &&
    s.currentKobo !== null &&
    s.asOf !== null &&
    s.unavailableReason === null,
);
export type SimulationOpening = z.infer<typeof OpeningSchema>;
const same = (
  a: { tenantId: string; ownerId: string; accountId: string },
  b: { tenantId: string; ownerId: string; accountId: string },
) =>
  a.tenantId === b.tenantId &&
  a.ownerId === b.ownerId &&
  a.accountId === b.accountId;

/** An opening is explicit, immutable and independent of partial historical flows. */
export function captureOpenings(s: State, data: FixtureDataset) {
  s.simulationOpenings ??= [];
  for (const raw of data.summaries) {
    const parsed = OpeningSchema.safeParse(raw);
    const account = data.accounts.find((a) => same(a, raw));
    if (
      !parsed.success ||
      account?.provider !== "fixture" ||
      account.mode !== "fixture"
    )
      continue;
    if (!s.simulationOpenings.some((old) => same(old, raw)))
      s.simulationOpenings.push(parsed.data);
  }
}

const submitted = (b: Batch) =>
  b.mode === "fixture" && !!b.approval?.consumedAt && !!b.simulationSource;
const held = (status: string) =>
  ["submitted", "processing", "unknown", "awaiting_otp"].includes(status);
const safe = (n: number) => {
  if (!Number.isSafeInteger(n))
    throw new AppError("Invalid fictional balance state", 409);
  return n;
};

/** Payments themselves are the durable idempotent journal: one immutable ID per
 * submitted instruction. Reconciliation changes its state, never adds a debit. */
export function projectBalance(
  s: State,
  raw: SimulationOpening,
): AccountSummary {
  const opening = OpeningSchema.parse(raw);
  let available = opening.availableKobo!,
    current = opening.currentKobo!,
    count = 0;
  let asOf = opening.asOf!;
  const ids = new Set<string>();
  for (const b of s.batches.filter(
    (b) => submitted(b) && same(b.simulationSource!, opening),
  )) {
    if (Date.parse(b.approval!.consumedAt!) < Date.parse(opening.asOf!))
      throw new AppError("Invalid fictional journal date", 409);
    for (const p of b.payments) {
      if (ids.has(p.id))
        throw new AppError("Duplicate fictional journal entry", 409);
      ids.add(p.id);
      count++;
      const principal = safe(p.amountKobo);
      if (principal <= 0) throw new AppError("Invalid fictional payment", 409);
      if (p.status === "successful") {
        const debit = safe(principal + (p.providerFeeKobo ?? 0));
        available = safe(available - debit);
        current = safe(current - debit);
      } else if (held(p.status))
        available = safe(available - safe(principal + b.feeReserveKobo));
      const changed = p.responses.at(-1)?.at ?? b.approval!.consumedAt!;
      if (Date.parse(changed) > Date.parse(asOf)) asOf = changed;
    }
  }
  return AccountSummarySchema.parse({
    accountId: opening.accountId,
    currency: "NGN",
    availableKobo: available,
    currentKobo: current,
    asOf,
    simulated: true,
    unavailableReason: null,
    simulation: {
      basis: "opening_snapshot_and_authorized_changes",
      openingAsOf: opening.asOf,
      openingAvailableKobo: opening.availableKobo,
      openingCurrentKobo: opening.currentKobo,
      changeCount: count,
      historicalTransactionsReconciled: false,
    },
  });
}

/** Called in the SAME CAS write that consumes approval. No provider side effect. */
export function reserveSimulation(s: State, b: Batch) {
  if (!b.simulationSource) return;
  const opening = s.simulationOpenings?.find((o) =>
    same(o, b.simulationSource!),
  );
  if (b.mode !== "fixture" || !opening)
    throw new AppError("Fictional source unavailable", 409);
  if (projectBalance(s, opening).availableKobo! < 0)
    throw new AppError(
      "Insufficient fictional account available balance including holds",
      409,
    );
}

function paymentTransactions(
  s: State,
  account: AccountRecord,
): NormalizedTransaction[] {
  return s.batches
    .filter((b) => submitted(b) && same(b.simulationSource!, account))
    .flatMap((b) =>
      b.payments.flatMap((p) => {
        const at = b.approval!.consumedAt!;
        const updatedAt = p.responses.at(-1)?.at ?? at;
        const status =
          p.status === "successful"
            ? "posted"
            : p.status === "failed"
              ? "failed"
              : p.status === "reversed"
                ? "reversed"
                : p.status === "unknown"
                  ? "unknown"
                  : "pending";
        const make = (suffix: string, amountKobo: number, label: string) =>
          normalizeTransaction({
            tenantId: account.tenantId,
            ownerId: account.ownerId,
            accountId: account.accountId,
            currency: "NGN",
            schemaVersion: 1,
            id: `sim-${p.id}${suffix}`,
            revision: p.responses.length + 1,
            amountKobo,
            direction: "debit",
            status,
            occurredAt: at,
            bookedAt: status === "posted" ? updatedAt : null,
            observedAt: updatedAt,
            updatedAt,
            counterparty: {
              displayName: label,
              institution: "Fictional payment simulation",
            },
            description:
              "Authorized fictional transfer; source status does not prove recipient bank credit",
            reference: p.reference,
            category: {
              value: suffix ? "fees" : "transfers",
              source: "fixture",
            },
            search: { normalizedText: "", tokens: [], version: 1 },
            provenance: {
              provider: "fixture",
              mode: "fixture",
              providerTransactionId: `sim-${p.id}${suffix}`,
              providerAccountRef: account.accountId,
              consentId: account.consentId,
              fetchedAt: updatedAt,
              rawRecordRef: null,
              rawRecordSha256: null,
              timestampBasis: "fixture",
            },
            evidenceIds: [],
            reversalOfId: null,
            simulated: true,
            simulationLabel:
              "Fictional authorized payment; no real transfer or recipient credit established",
            // Account-only fields do not belong to a transaction's strict contract.
          });
        return [
          make("", p.amountKobo, `${p.name} (fictional transfer)`),
          ...(p.status === "successful" && p.providerFeeKobo
            ? [make("-fee", p.providerFeeKobo, "Fictional transfer fee")]
            : []),
        ];
      }),
    );
}

/** Pure read-model overlay; original fm_* rows and legacy payments stay intact. */
export function projectDataset(data: FixtureDataset, s: State): FixtureDataset {
  const next = structuredClone(data);
  for (const account of next.accounts) {
    if (account.provider !== "fixture" || !account.simulated) continue;
    const opening = s.simulationOpenings?.find((o) => same(o, account));
    if (!opening) continue;
    const summary = {
      tenantId: account.tenantId,
      ownerId: account.ownerId,
      ...projectBalance(s, opening),
    };
    next.summaries = next.summaries
      .filter((v) => !same(v, account))
      .concat(summary);
    next.transactions.push(...paymentTransactions(s, account));
  }
  return next;
}

export const simulationRevision = (s: State) =>
  fingerprint([s.simulationOpenings, s.batches.filter(submitted)]);
