import { randomUUID } from "node:crypto";
import { database, transaction, type Sql } from "../sql";
import { invariant, DomainError } from "../errors";
import { instructionHash, consumeStepUp } from "../approvals";
import type { Principal } from "../auth";
import { operation } from "../idempotency";
import { enqueue } from "../jobs";
import { sourceAccess } from "./service";
import { fixturePayments } from "./fixture";
import type { SourceInstruction, PaymentObservation } from "./contracts";
import type { PreparePayment } from "../../../packages/contracts/src";

type PaymentRow = {
  observed_at: Date | null;
  id: string;
  owner: string;
  source_account_id: string;
  grant_id: string;
  provider: string;
  environment: string;
  revision: number;
  status: string;
  instruction_hash: string;
  instruction: SourceInstruction;
  provider_reference: string;
  expires_at: Date;
  grant_revision: number;
  simulated: boolean;
};
function fixtureMode() {
  invariant(
    (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
    "PAYMENT_ENVIRONMENT_CHANGED",
    403,
  );
}
export function paymentView(row: PaymentRow) {
  return {
    observedAt: row.observed_at,
    id: row.id,
    revision: row.revision,
    status: row.status,
    instructionDigest: row.instruction_hash,
    instruction: row.instruction,
    providerReference: row.provider_reference,
    provider: row.provider,
    environment: row.environment,
    simulated: row.simulated,
    verification: row.simulated ? "simulated" : "unverified",
  };
}
async function owned(sql: Sql, owner: string, id: string, lock = false) {
  const r = await sql.query<PaymentRow>(
    `SELECT * FROM agus_payments WHERE owner=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
    [owner, id],
  );
  invariant(r.rows.length, "NOT_FOUND", 404);
  return r.rows[0];
}
async function audit(
  sql: Sql,
  row: PaymentRow,
  action: string,
  details: Record<string, unknown> = {},
) {
  await sql.query(
    "INSERT INTO agus_audit(id,owner,resource_type,resource_id,action,details) VALUES($1,$2,'payment',$3,$4,$5)",
    [randomUUID(), row.owner, row.id, action, JSON.stringify(details)],
  );
}
export async function getPayment(owner: string, id: string) {
  return paymentView(await owned(await database(), owner, id));
}
export async function listPayments(
  owner: string,
  after: string,
  limit: number,
) {
  return (
    await (
      await database()
    ).query<PaymentRow>(
      "SELECT * FROM agus_payments WHERE owner=$1 AND id>$2 ORDER BY id LIMIT $3",
      [owner, after, limit],
    )
  ).rows.map(paymentView);
}
export async function preparePayment(
  owner: string,
  key: string,
  input: PreparePayment,
) {
  fixtureMode();
  invariant(BigInt(input.amount.atoms) > 0n, "AMOUNT_MUST_BE_POSITIVE", 400);
  // Read-only quote outside the database transaction. All quote/source/grant
  // bindings are rechecked under locks before the instruction is committed.
  const quote = await fixturePayments.quote({
    amount: input.amount,
    sourceAccountId: input.sourceAccountId,
  });
  return transaction(async (sql) => {
    const op = await operation(sql, owner, "payment.prepare", key, input);
    if (!op.created) return paymentView(await owned(sql, owner, op.id));
    const source = await sourceAccess(
      sql,
      owner,
      input.sourceAccountId,
      true,
      "fixture-source-payment",
    );
    invariant(
      source.simulated &&
        source.provider === "fixture" &&
        source.environment === "fixture",
      "SOURCE_PAYMENT_UNAVAILABLE",
      503,
    );
    invariant(
      source.currency === input.amount.currency &&
        source.scale === input.amount.scale,
      "SOURCE_CURRENCY_MISMATCH",
      400,
    );
    invariant(
      BigInt(input.amount.atoms) <= 50_000_000n,
      "FIXTURE_LIMIT_EXCEEDED",
      400,
    );
    const beneficiary = (
      await sql.query(
        "SELECT * FROM agus_beneficiaries WHERE owner=$1 AND id=$2 AND simulated=true AND environment='fixture'",
        [owner, input.beneficiaryId],
      )
    ).rows[0];
    invariant(beneficiary, "BENEFICIARY_NOT_FOUND", 404);
    const expiresAt = new Date(
      Math.min(
        Date.parse(quote.expiresAt),
        new Date(source.grant_expires_at).getTime(),
      ),
    ).toISOString();
    const instruction: SourceInstruction = {
      sourceAccountId: source.id,
      providerAccountId: source.provider_account_id,
      grantId: source.grant_id,
      grantRevision: source.grant_revision,
      beneficiaryId: beneficiary.id,
      beneficiaryIdentityHash: beneficiary.identity_hash,
      amount: input.amount,
      fee: quote.fee,
      feeQuoteVersion: quote.version,
      expiresAt,
      provider: fixturePayments.id,
      environment: "fixture",
      ...(input.testScenario ? { testScenario: input.testScenario } : {}),
    };
    const digest = instructionHash(instruction),
      reference = `agus_fixture_${randomUUID().replaceAll("-", "")}`;
    await sql.query(
      "INSERT INTO agus_payments(owner,id,source_account_id,grant_id,beneficiary_id,provider,environment,amount_atoms,currency,scale,fee_atoms,fee_quote_version,expires_at,grant_revision,status,instruction_hash,idempotency_key,request_hash,provider_reference,instruction,simulated) VALUES($1,$2,$3,$4,$5,$6,'fixture',$7,$8,$9,$10,$11,$12,$13,'awaiting_confirmation',$14,$15,$16,$17,$18,true)",
      [
        owner,
        op.id,
        source.id,
        source.grant_id,
        beneficiary.id,
        fixturePayments.id,
        input.amount.atoms,
        input.amount.currency,
        input.amount.scale,
        quote.fee.atoms,
        quote.version,
        expiresAt,
        source.grant_revision,
        digest,
        key,
        instructionHash(input),
        reference,
        JSON.stringify(instruction),
      ],
    );
    const saved = await owned(sql, owner, op.id);
    await audit(sql, saved, "prepared");
    return paymentView(saved);
  });
}
async function authority(sql: Sql, row: PaymentRow) {
  fixtureMode();
  invariant(
    row.environment === "fixture" &&
      row.simulated &&
      row.provider === fixturePayments.id,
    "PAYMENT_ENVIRONMENT_CHANGED",
    403,
  );
  invariant(
    instructionHash(row.instruction) === row.instruction_hash,
    "PAYMENT_INTEGRITY_MISMATCH",
  );
  invariant(
    new Date(row.expires_at).getTime() > Date.now(),
    "PAYMENT_QUOTE_EXPIRED",
  );
  const source = await sourceAccess(
    sql,
    row.owner,
    row.source_account_id,
    true,
    "fixture-source-payment",
  );
  invariant(
    source.grant_revision === row.grant_revision &&
      source.grant_id === row.grant_id,
    "SOURCE_AUTHORITY_CHANGED",
    403,
  );
}
export async function authorizePayment(
  p: Principal,
  id: string,
  revision: number,
  challengeId: string,
  key = `authorize:${id}:${revision}`,
) {
  return transaction(async (sql) => {
    const row = await owned(sql, p.id, id, true);
    const op = await operation(sql, p.id, "payment.authorize", key, {
      id,
      revision,
      challengeId,
    });
    if (!op.created) return paymentView(row);
    invariant(
      row.revision === revision && row.status === "awaiting_confirmation",
      "PAYMENT_REVISION_CONFLICT",
    );
    await authority(sql, row);
    await consumeStepUp(
      sql,
      p,
      challengeId,
      "payment.authorize",
      row.instruction_hash,
    );
    await sql.query(
      "UPDATE agus_payments SET status='authorized',revision=revision+1 WHERE owner=$1 AND id=$2",
      [p.id, id],
    );
    await audit(sql, row, "human_authorized", {
      instructionDigest: row.instruction_hash,
      sessionId: p.sessionId,
    });
    return paymentView(await owned(sql, p.id, id));
  });
}
export async function submitPayment(
  p: Principal,
  id: string,
  revision: number,
  key = `submit:${id}:${revision}`,
) {
  const claim = await transaction(async (sql) => {
    const row = await owned(sql, p.id, id, true);
    await operation(sql, p.id, "payment.submit", key, { id, revision });
    const existing = await sql.query(
      "SELECT id FROM agus_payment_attempts WHERE owner=$1 AND payment_id=$2",
      [p.id, id],
    );
    // Return the durable existing instruction for duplicate/lost-response calls;
    // an expired quote never turns a claimed operation into a fresh write right.
    if (existing.rows.length) return { row, broadcast: false };
    invariant(
      row.revision === revision && row.status === "authorized",
      "PAYMENT_REVISION_CONFLICT",
    );
    await authority(sql, row);
    await sql.query(
      "INSERT INTO agus_payment_attempts(owner,payment_id,id,state) VALUES($1,$2,$3,'claimed')",
      [p.id, id, randomUUID()],
    );
    await sql.query(
      "UPDATE agus_payments SET status='submitting',revision=revision+1 WHERE owner=$1 AND id=$2",
      [p.id, id],
    );
    await audit(sql, row, "submission_claimed");
    await enqueue(
      sql,
      p.id,
      "payment.reconcile",
      `payment-initial-reconcile:${id}`,
      { paymentId: id },
    );
    return { row: await owned(sql, p.id, id), broadcast: true };
  });
  if (!claim.broadcast) return paymentView(claim.row);
  try {
    // Provider effects occur only after the claim commits and outside a DB tx.
    await fixturePayments.submit(
      claim.row.provider_reference,
      claim.row.instruction,
    );
    await (
      await database()
    ).query(
      "UPDATE agus_payments SET status='pending',revision=revision+1 WHERE owner=$1 AND id=$2 AND status='submitting'",
      [p.id, id],
    );
    await (
      await database()
    ).query(
      "UPDATE agus_payment_attempts SET state='submitted',observed_at=now() WHERE owner=$1 AND payment_id=$2 AND state='claimed'",
      [p.id, id],
    );
  } catch {
    await (
      await database()
    ).query(
      "UPDATE agus_payments SET status='unknown',revision=revision+1 WHERE owner=$1 AND id=$2 AND status='submitting'",
      [p.id, id],
    );
    await (
      await database()
    ).query(
      "UPDATE agus_payment_attempts SET state='unknown',observed_at=now() WHERE owner=$1 AND payment_id=$2 AND state='claimed'",
      [p.id, id],
    );
  }
  return getPayment(p.id, id);
}
export async function reconcilePayment(owner: string, id: string) {
  const sql = await database(),
    current = await owned(sql, owner, id);
  invariant(
    (
      await sql.query(
        "SELECT id FROM agus_payment_attempts WHERE owner=$1 AND payment_id=$2",
        [owner, id],
      )
    ).rows.length,
    "PAYMENT_NOT_SUBMITTED",
  );
  const observation = await fixturePayments.verify(current.provider_reference);
  return recordObservation(owner, id, observation);
}
async function recordObservation(
  owner: string,
  id: string,
  observation: PaymentObservation,
) {
  return transaction(async (sql) => {
    const row = await owned(sql, owner, id, true);
    invariant(
      observation.providerReference === row.provider_reference &&
        observation.simulated === row.simulated,
      "PROVIDER_OBSERVATION_MISMATCH",
      502,
    );
    let status: string =
      observation.status === "not_found" ? "unknown" : observation.status;
    if (row.status === "reversed") status = "reversed";
    if (row.status === "succeeded" && status !== "reversed")
      status = "succeeded";
    if (row.status === "failed" && status !== "failed")
      throw new DomainError("PROVIDER_OBSERVATION_CONFLICT", 409, false);
    await sql.query(
      "UPDATE agus_payments SET observed_at=$3 WHERE owner=$1 AND id=$2",
      [owner, id, observation.observedAt],
    );
    row.observed_at = new Date(observation.observedAt);
    if (row.status !== status) {
      await sql.query(
        "UPDATE agus_payments SET status=$3,revision=revision+1 WHERE owner=$1 AND id=$2",
        [owner, id, status],
      );
      row.status = status;
      row.revision++;
      await audit(sql, row, "provider_observed", {
        status,
        simulated: row.simulated,
      });
      const payload = {
        label: "SIMULATED — no bank transfer occurred",
        paymentId: id,
        status,
        amount: row.instruction.amount,
        fee: row.instruction.fee,
        providerReference: row.provider_reference,
        provider: row.provider,
        environment: row.environment,
        simulated: true,
        bankCreditVerified: false,
        observedAt: observation.observedAt,
        verification: "simulated_provider_observation",
      };
      await sql.query(
        "INSERT INTO agus_receipts(owner,id,payment_id,revision,status,evidence_kind,payload) VALUES($1,$2,$3,$4,$5,'simulated_provider_observation',$6) ON CONFLICT DO NOTHING",
        [
          owner,
          randomUUID(),
          id,
          row.revision,
          status,
          JSON.stringify(payload),
        ],
      );
      await enqueue(
        sql,
        owner,
        "notification.in_app",
        `payment-status:${id}:${row.revision}`,
        { resourceType: "payment", resourceId: id },
      );
    }
    return paymentView(row);
  });
}
export async function receipts(owner: string, id: string) {
  await owned(await database(), owner, id);
  return {
    data: (
      await (
        await database()
      ).query(
        "SELECT id,revision,payload FROM agus_receipts WHERE owner=$1 AND payment_id=$2 ORDER BY revision",
        [owner, id],
      )
    ).rows,
  };
}
export async function dispute(
  owner: string,
  id: string,
  key: string,
  reason: string,
) {
  return transaction(async (sql) => {
    await owned(sql, owner, id);
    const op = await operation(sql, owner, "payment.dispute", key, {
      id,
      reason,
    });
    if (op.created)
      await sql.query(
        "INSERT INTO agus_disputes(owner,id,payment_id,reason,status) VALUES($1,$2,$3,$4,'open')",
        [owner, op.id, id, reason],
      );
    return { id: op.id, paymentId: id, status: "open", simulated: true };
  });
}
