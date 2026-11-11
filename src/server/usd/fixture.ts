import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { database, transaction, type Sql } from "../sql";
import { invariant } from "../errors";
import { operation } from "../idempotency";
import { consumeStepUp, instructionHash } from "../approvals";
import { seal, unseal, type Envelope } from "../secrets";
import type { Principal } from "../auth";
import { enqueue } from "../jobs";
import { CIRCLE_DEVNET_USDC_MINT } from "../../lib/solana/assets";
export const OnboardInput = z.strictObject({
  residency: z.literal("NG"),
  purpose: z.enum(["freelance", "salary"]),
});
export const IncomingInput = z.strictObject({
  owner: z.uuid(),
  amountAtoms: z.string().regex(/^[1-9][0-9]{0,8}$/),
  purpose: z.enum(["freelance", "salary"]),
});
export const ConversionInput = z.strictObject({
  incomingId: z.uuid(),
  destination: z.string().min(32).max(44),
  beneficiaryId: z.uuid().optional(),
});
export const StageAction = z.enum(["deliver", "payout"]);
const boundary = {
  simulated: true,
  provider: "fixture",
  environment: "fixture",
  bankCreditVerified: false,
  chainFinalityVerified: false,
  label:
    "SIMULATED — no USD account, conversion, blockchain delivery or bank payout occurred",
};
function fixture() {
  invariant(
    (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
    "USD_FIXTURE_ONLY",
    403,
  );
}
async function customer(sql: Sql, owner: string) {
  const row = (
    await sql.query("SELECT * FROM agus_usd_customers WHERE owner=$1", [owner])
  ).rows[0];
  invariant(row, "USD_FIXTURE_CUSTOMER_REQUIRED", 404);
  return row;
}
async function conversion(sql: Sql, owner: string, id: string, lock = false) {
  const row = (
    await sql.query(
      `SELECT * FROM agus_usd_conversions WHERE owner=$1 AND id=$2 ${lock ? "FOR UPDATE" : ""}`,
      [owner, id],
    )
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  return row;
}
const conversionView = (row: Record<string, unknown>) => ({
  ...row,
  id: String(row.id),
  revision: Number(row.revision),
  conversion_status: String(row.conversion_status),
  delivery_status: String(row.delivery_status),
  payout_status: String(row.payout_status),
  ...boundary,
  usdReceivedIsUsdcDelivered: false,
});
const incomingView = (row: Record<string, unknown>) => ({
  ...row,
  id: String(row.id),
  revision: Number(row.revision),
  status: String(row.status),
  amount: { atoms: String(row.amount_atoms), currency: "USD", scale: 2 },
  ...boundary,
});
export async function onboard(
  owner: string,
  key: string,
  input: z.infer<typeof OnboardInput>,
) {
  fixture();
  return transaction(async (sql) => {
    const op = await operation(sql, owner, "usd.fixture.onboard", key, input);
    const details = {
      accountLabel: `FIXTURE-USD-NOT-A-BANK-${op.id}`,
      currency: "USD",
      purpose: input.purpose,
      residency: input.residency,
      usableForRealPayments: false,
    };
    if (op.created)
      await sql.query(
        "INSERT INTO agus_usd_customers(owner,id,eligibility,receiving_status,details_envelope,provider,environment) VALUES($1,$2,'fixture_eligible','fixture_issued',$3,'fixture','fixture') ON CONFLICT(owner) DO NOTHING",
        [owner, op.id, JSON.stringify(seal(owner, "usd-account", details))],
      );
    return accountView(await customer(sql, owner));
  });
}
function accountView(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    revision: Number(row.revision),
    eligibility: row.eligibility,
    receivingStatus: row.receiving_status,
    details: unseal(
      String(row.owner),
      "usd-account",
      row.details_envelope as Envelope,
    ),
    ...boundary,
  };
}
export async function account(owner: string) {
  fixture();
  return accountView(await customer(await database(), owner));
}
export async function recordIncoming(
  p: Principal,
  key: string,
  input: z.infer<typeof IncomingInput>,
) {
  fixture();
  invariant(p.role === "operations", "OPERATIONS_REQUIRED", 403);
  return transaction(async (sql) => {
    await customer(sql, input.owner);
    const op = await operation(sql, p.id, "usd.fixture.incoming", key, input);
    if (op.created)
      await sql.query(
        "INSERT INTO agus_usd_incoming(owner,id,provider_reference,amount_atoms,status,purpose) VALUES($1,$2,$3,$4,'received',$5)",
        [
          input.owner,
          op.id,
          `fixture_incoming_${op.id}`,
          input.amountAtoms,
          input.purpose,
        ],
      );
    return incomingView(
      (await sql.query("SELECT * FROM agus_usd_incoming WHERE id=$1", [op.id]))
        .rows[0],
    );
  });
}
export async function incoming(owner: string, after: string, limit: number) {
  fixture();
  return (
    await (
      await database()
    ).query(
      "SELECT * FROM agus_usd_incoming WHERE owner=$1 AND id>$2 ORDER BY id LIMIT $3",
      [owner, after, limit],
    )
  ).rows.map(incomingView);
}
export async function quote(
  owner: string,
  key: string,
  input: z.infer<typeof ConversionInput>,
) {
  fixture();
  const destination = new PublicKey(input.destination).toBase58();
  return transaction(async (sql) => {
    const op = await operation(sql, owner, "usd.fixture.quote", key, input);
    if (!op.created)
      return quoteView(
        (
          await sql.query(
            "SELECT * FROM agus_usd_quotes WHERE owner=$1 AND id=$2",
            [owner, op.id],
          )
        ).rows[0],
      );
    const source = (
      await sql.query(
        "SELECT * FROM agus_usd_incoming WHERE owner=$1 AND id=$2 AND status='received'",
        [owner, input.incomingId],
      )
    ).rows[0];
    invariant(source, "INCOMING_FUNDS_UNAVAILABLE");
    let beneficiary = null;
    if (input.beneficiaryId) {
      const b = (
        await sql.query(
          "SELECT id,identity_hash FROM agus_beneficiaries WHERE owner=$1 AND id=$2 AND simulated=true AND environment='fixture'",
          [owner, input.beneficiaryId],
        )
      ).rows[0];
      invariant(b, "BENEFICIARY_NOT_FOUND", 404);
      beneficiary = { id: b.id, identityHash: b.identity_hash };
    }
    const expiresAt = new Date(Date.now() + 120000).toISOString();
    const instruction = {
      incomingId: source.id,
      incomingRevision: source.revision,
      input: { atoms: source.amount_atoms, currency: "USD", scale: 2 },
      output: {
        atoms: (BigInt(source.amount_atoms) * 10000n).toString(),
        currency: "USDC",
        scale: 6,
      },
      destination: {
        network: "devnet",
        address: destination,
        mint: CIRCLE_DEVNET_USDC_MINT,
      },
      beneficiary,
      fee: { atoms: "0", currency: "USD", scale: 2 },
      quoteVersion: "fixture-usd-usdc-1to1-v1",
      feePolicy: "fixture zero for testing only; no commercial policy",
      expiresAt,
      ...boundary,
    };
    const digest = instructionHash(instruction);
    await sql.query(
      "INSERT INTO agus_usd_quotes(owner,id,incoming_id,incoming_revision,instruction,instruction_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        owner,
        op.id,
        source.id,
        source.revision,
        JSON.stringify(instruction),
        digest,
        expiresAt,
      ],
    );
    return {
      id: op.id,
      instruction,
      instructionDigest: digest,
      action: "usd.fixture.convert",
      ...boundary,
    };
  });
}
function quoteView(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    instruction: row.instruction,
    instructionDigest: String(row.instruction_hash),
    action: "usd.fixture.convert",
    ...boundary,
  };
}
export async function submit(
  p: Principal,
  key: string,
  quoteId: string,
  challengeId: string,
  loseResponse = false,
) {
  fixture();
  const result = await transaction(async (sql) => {
    const op = await operation(sql, p.id, "usd.fixture.convert", key, {
      quoteId,
      loseResponse,
    });
    if (!op.created) return { id: op.id, created: false };
    const q = (
      await sql.query(
        "SELECT * FROM agus_usd_quotes WHERE owner=$1 AND id=$2 AND expires_at>now()",
        [p.id, quoteId],
      )
    ).rows[0];
    invariant(q, "QUOTE_EXPIRED_OR_NOT_FOUND");
    const source = (
      await sql.query(
        "SELECT * FROM agus_usd_incoming WHERE owner=$1 AND id=$2 FOR UPDATE",
        [p.id, q.incoming_id],
      )
    ).rows[0];
    invariant(
      source?.status === "received" && source.revision === q.incoming_revision,
      "INCOMING_FUNDS_ALREADY_CLAIMED",
    );
    await consumeStepUp(
      sql,
      p,
      challengeId,
      "usd.fixture.convert",
      q.instruction_hash,
    );
    await sql.query(
      "INSERT INTO agus_usd_conversions(owner,id,incoming_id,instruction,instruction_hash) VALUES($1,$2,$3,$4,$5)",
      [
        p.id,
        op.id,
        q.incoming_id,
        JSON.stringify(q.instruction),
        q.instruction_hash,
      ],
    );
    await sql.query(
      "UPDATE agus_usd_incoming SET status='conversion_claimed',revision=revision+1 WHERE id=$1",
      [q.incoming_id],
    );
    await enqueue(sql, p.id, "usd.reconcile", `usd:${op.id}:conversion`, {
      conversionId: op.id,
    });
    return { id: op.id, created: true };
  });
  if (result.created) {
    // Durable application claim precedes the injected fixture provider effect.
    // A missing provider effect stays pending/unknown; reads never send again.
    await (
      await database()
    ).query(
      "INSERT INTO agus_usd_effects(id,resource_id,kind,request_hash,status) VALUES($1,$2,'conversion',$3,'succeeded') ON CONFLICT(resource_id,kind) DO NOTHING",
      [randomUUID(), result.id, instructionHash({ quoteId })],
    );
    if (loseResponse)
      await (
        await database()
      ).query(
        "UPDATE agus_usd_conversions SET conversion_status='unknown' WHERE id=$1",
        [result.id],
      );
    else return reconcile(p.id, result.id);
  }
  return getConversion(p.id, result.id);
}
export async function getConversion(owner: string, id: string) {
  fixture();
  return conversionView(await conversion(await database(), owner, id));
}
export async function stageReview(
  owner: string,
  id: string,
  stage: z.infer<typeof StageAction>,
) {
  fixture();
  const row = await conversion(await database(), owner, id);
  const instruction = {
    id,
    revision: row.revision,
    conversionDigest: row.instruction_hash,
    stage,
    destination: row.instruction.destination,
    beneficiary: row.instruction.beneficiary,
    amount:
      stage === "deliver"
        ? row.instruction.output
        : {
            atoms: (BigInt(row.instruction.input.atoms) * 1500n).toString(),
            currency: "NGN",
            scale: 2,
          },
    quoteVersion:
      stage === "deliver"
        ? "fixture-delivery-v1"
        : "fixture-1500-NGN-per-USD-v1",
    fee: {
      atoms: "0",
      currency: stage === "deliver" ? "USDC" : "NGN",
      scale: stage === "deliver" ? 6 : 2,
    },
    ...boundary,
  };
  return {
    instruction,
    instructionDigest: instructionHash(instruction),
    action: `usd.fixture.${stage}`,
  };
}
export async function submitStage(
  p: Principal,
  id: string,
  key: string,
  stage: z.infer<typeof StageAction>,
  revision: number,
  challengeId: string,
) {
  fixture();
  const r = await stageReview(p.id, id, stage);
  return transaction(async (sql) => {
    const op = await operation(sql, p.id, `usd.fixture.${stage}`, key, {
      id,
      revision,
    });
    const row = await conversion(sql, p.id, id, true);
    if (!op.created) return conversionView(row);
    invariant(
      row.revision === revision && r.instruction.revision === revision,
      "REVISION_CONFLICT",
    );
    invariant(
      row.conversion_status === "succeeded",
      "USD_CONVERSION_NOT_CONFIRMED",
    );
    const column = stage === "deliver" ? "delivery_status" : "payout_status";
    invariant(row[column] === "not_started", "USD_STAGE_ALREADY_CLAIMED");
    if (stage === "payout") {
      invariant(
        row.delivery_status === "succeeded" && row.instruction.beneficiary,
        "DELIVERY_AND_BENEFICIARY_REQUIRED",
      );
      invariant(
        (
          await sql.query(
            "SELECT 1 FROM agus_beneficiaries WHERE owner=$1 AND id=$2 AND identity_hash=$3 AND simulated=true AND environment='fixture'",
            [
              p.id,
              row.instruction.beneficiary.id,
              row.instruction.beneficiary.identityHash,
            ],
          )
        ).rows.length,
        "BENEFICIARY_IDENTITY_CHANGED",
      );
    }
    await consumeStepUp(sql, p, challengeId, r.action, r.instructionDigest);
    await sql.query(
      `UPDATE agus_usd_conversions SET ${column}='pending',revision=revision+1 WHERE id=$1`,
      [id],
    );
    await sql.query(
      "INSERT INTO agus_usd_effects(id,resource_id,kind,request_hash,status) VALUES($1,$2,$3,$4,'succeeded')",
      [randomUUID(), id, stage, r.instructionDigest],
    );
    await enqueue(sql, p.id, "usd.reconcile", `usd:${id}:${stage}`, {
      conversionId: id,
    });
    return conversionView(await conversion(sql, p.id, id));
  });
}
export async function reconcile(owner: string, id: string) {
  fixture();
  return transaction(async (sql) => {
    const row = await conversion(sql, owner, id, true);
    const effects = (
      await sql.query(
        "SELECT kind,status,observed_at FROM agus_usd_effects WHERE resource_id=$1",
        [id],
      )
    ).rows;
    let changed = false;
    for (const e of effects) {
      const column =
        e.kind === "conversion"
          ? "conversion_status"
          : e.kind === "deliver"
            ? "delivery_status"
            : e.kind === "payout"
              ? "payout_status"
              : null;
      if (column && row[column] !== e.status) {
        row[column] = e.status;
        changed = true;
        row.observed_at = e.observed_at;
      }
    }
    if (changed)
      await sql.query(
        "UPDATE agus_usd_conversions SET conversion_status=$2,delivery_status=$3,payout_status=$4,observed_at=$5,revision=revision+1 WHERE id=$1",
        [
          id,
          row.conversion_status,
          row.delivery_status,
          row.payout_status,
          row.observed_at,
        ],
      );
    return conversionView(await conversion(sql, owner, id));
  });
}
export async function returnReview(owner: string, id: string) {
  fixture();
  const row = (
    await (
      await database()
    ).query("SELECT * FROM agus_usd_incoming WHERE owner=$1 AND id=$2", [
      owner,
      id,
    ])
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  const instruction = {
    incomingId: id,
    revision: row.revision,
    amount: { atoms: row.amount_atoms, currency: "USD", scale: 2 },
    originalReference: row.provider_reference,
    ...boundary,
  };
  return {
    instruction,
    instructionDigest: instructionHash(instruction),
    action: "usd.fixture.return",
  };
}
export async function returnIncoming(
  p: Principal,
  id: string,
  key: string,
  revision: number,
  challengeId: string,
) {
  fixture();
  const r = await returnReview(p.id, id);
  return transaction(async (sql) => {
    const op = await operation(sql, p.id, "usd.fixture.return", key, {
      id,
      revision,
    });
    const row = (
      await sql.query(
        "SELECT * FROM agus_usd_incoming WHERE owner=$1 AND id=$2 FOR UPDATE",
        [p.id, id],
      )
    ).rows[0];
    invariant(row, "NOT_FOUND", 404);
    if (!op.created) return incomingView(row);
    invariant(
      row.status === "received" &&
        row.revision === revision &&
        r.instruction.revision === revision,
      "INCOMING_FUNDS_ALREADY_CLAIMED",
    );
    await consumeStepUp(sql, p, challengeId, r.action, r.instructionDigest);
    await sql.query(
      "INSERT INTO agus_usd_effects(id,resource_id,kind,request_hash,status) VALUES($1,$2,'return',$3,'succeeded')",
      [randomUUID(), id, r.instructionDigest],
    );
    const returned = (
      await sql.query(
        "UPDATE agus_usd_incoming SET status='returned',revision=revision+1 WHERE id=$1 RETURNING *",
        [id],
      )
    ).rows[0];
    return incomingView(returned);
  });
}
