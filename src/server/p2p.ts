import { randomUUID } from "node:crypto";
import { z } from "zod";
import { database, transaction } from "./sql";
import { invariant, DomainError } from "./errors";
import { operation } from "./idempotency";
import { instructionHash, consumeStepUp } from "./approvals";
import type { Principal } from "./auth";
import { CIRCLE_DEVNET_USDC_MINT } from "../lib/solana/assets";
import { MAX_U64 } from "../lib/solana/money";
const atoms = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/)
  .refine((n) => BigInt(n) <= MAX_U64);
export const OfferInput = z.strictObject({
  side: z.enum(["buy", "sell"]),
  availableAtoms: atoms,
  minimumAtoms: atoms,
  maximumAtoms: atoms,
  rateNumerator: atoms,
  rateDenominator: atoms,
  expiresAt: z.iso.datetime(),
  paymentMethod: z.literal("bank-transfer-simulated"),
});
export const QuoteInput = z.strictObject({
  side: z.enum(["buy", "sell"]),
  amountAtoms: atoms,
});
function fixture() {
  invariant(
    (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
    "P2P_SIMULATION_ONLY",
    403,
  );
}
async function eligible(owner: string) {
  invariant(
    (
      await (
        await database()
      ).query(
        "SELECT 1 FROM agus_trader_eligibility WHERE owner=$1 AND eligible=true AND environment='fixture'",
        [owner],
      )
    ).rows.length,
    "TRADER_ELIGIBILITY_REQUIRED",
    403,
  );
}
export async function createOffer(
  owner: string,
  key: string,
  input: z.infer<typeof OfferInput>,
) {
  fixture();
  await eligible(owner);
  invariant(
    BigInt(input.minimumAtoms) <= BigInt(input.maximumAtoms) &&
      BigInt(input.maximumAtoms) <= BigInt(input.availableAtoms),
    "OFFER_LIMITS_INVALID",
    400,
  );
  invariant(
    Date.parse(input.expiresAt) > Date.now() &&
      Date.parse(input.expiresAt) <= Date.now() + 86400000,
    "OFFER_EXPIRY_INVALID",
    400,
  );
  return transaction(async (sql) => {
    const op = await operation(sql, owner, "p2p.offer", key, input);
    if (op.created)
      await sql.query(
        "INSERT INTO agus_p2p_offers(owner,id,side,available_atoms,minimum_atoms,maximum_atoms,rate_numerator,rate_denominator,payment_method,expires_at,environment) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'fixture')",
        [
          owner,
          op.id,
          input.side,
          input.availableAtoms,
          input.minimumAtoms,
          input.maximumAtoms,
          input.rateNumerator,
          input.rateDenominator,
          input.paymentMethod,
          input.expiresAt,
        ],
      );
    return {
      ...(
        await sql.query<{
          id: string;
          side: string;
          available_atoms: string;
          revision: number;
        }>(
          "SELECT id,side,available_atoms,minimum_atoms,maximum_atoms,rate_numerator,rate_denominator,payment_method,expires_at,revision,status,environment FROM agus_p2p_offers WHERE owner=$1 AND id=$2",
          [owner, op.id],
        )
      ).rows[0],
      simulated: true,
    };
  });
}
export async function quote(owner: string, input: z.infer<typeof QuoteInput>) {
  fixture();
  await eligible(owner);
  const rows = (
    await (
      await database()
    ).query(
      "SELECT o.* FROM agus_p2p_offers o JOIN agus_trader_eligibility e ON e.owner=o.owner AND e.eligible=true AND e.environment='fixture' WHERE o.owner<>$1 AND o.side<>$2 AND o.status='open' AND o.expires_at>now() AND o.available_atoms>=$3 AND o.minimum_atoms<=$3 AND o.maximum_atoms>=$3 ORDER BY o.created_at,o.id",
      [owner, input.side, input.amountAtoms],
    )
  ).rows;
  const priced = rows
    .map((offer) => ({
      offer,
      value:
        (BigInt(input.amountAtoms) * BigInt(offer.rate_numerator) +
          (input.side === "buy"
            ? 1000000n * BigInt(offer.rate_denominator) - 1n
            : 0n)) /
        (1000000n * BigInt(offer.rate_denominator)),
    }))
    .filter((q) => q.value > 0n);
  priced.sort((a, b) =>
    a.value === b.value
      ? new Date(a.offer.created_at).getTime() -
          new Date(b.offer.created_at).getTime() ||
        a.offer.id.localeCompare(b.offer.id)
      : (a.value < b.value ? -1 : 1) * (input.side === "buy" ? 1 : -1),
  );
  invariant(priced.length, "NO_EXECUTABLE_QUOTE", 404);
  const best = priced[0],
    id = randomUUID(),
    expiresAt = new Date(
      Math.min(Date.now() + 90000, new Date(best.offer.expires_at).getTime()),
    ).toISOString();
  const instruction = {
    offerId: best.offer.id,
    offerRevision: best.offer.revision,
    tokenAtoms: input.amountAtoms,
    token: { atoms: input.amountAtoms, currency: "USDC", scale: 6 },
    fiat: { atoms: best.value.toString(), currency: "NGN", scale: 2 },
    fiatAtoms: best.value.toString(),
    asset: "Circle test USDC",
    mint: CIRCLE_DEVNET_USDC_MINT,
    network: "devnet",
    environment: "fixture",
    simulated: true,
    expiresAt,
  };
  const digest = instructionHash(instruction);
  await (
    await database()
  ).query(
    "INSERT INTO agus_p2p_quotes(owner,id,offer_id,offer_revision,token_atoms,fiat_atoms,expires_at,instruction_hash,instruction) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [
      owner,
      id,
      best.offer.id,
      best.offer.revision,
      input.amountAtoms,
      best.value.toString(),
      expiresAt,
      digest,
      JSON.stringify(instruction),
    ],
  );
  return { id, instruction, instructionDigest: digest };
}
export async function reserve(
  p: Principal,
  key: string,
  quoteId: string,
  challengeId: string,
) {
  fixture();
  await eligible(p.id);
  return transaction(async (sql) => {
    const op = await operation(sql, p.id, "p2p.reserve", key, { quoteId });
    if (!op.created) return getOrder(p.id, op.id, sql);
    const q = (
      await sql.query(
        "SELECT * FROM agus_p2p_quotes WHERE owner=$1 AND id=$2 AND expires_at>now() FOR UPDATE",
        [p.id, quoteId],
      )
    ).rows[0];
    invariant(q, "QUOTE_EXPIRED_OR_NOT_FOUND");
    const offer = (
      await sql.query(
        "SELECT * FROM agus_p2p_offers WHERE id=$1 AND status='open' AND expires_at>now() FOR UPDATE",
        [q.offer_id],
      )
    ).rows[0];
    invariant(
      offer &&
        offer.revision === q.offer_revision &&
        BigInt(offer.available_atoms) >= BigInt(q.token_atoms),
      "OFFER_REVISION_CONFLICT",
    );
    invariant(
      (
        await sql.query(
          "SELECT 1 FROM agus_trader_eligibility WHERE owner=$1 AND eligible=true AND environment='fixture'",
          [offer.owner],
        )
      ).rows.length,
      "COUNTERPARTY_INELIGIBLE",
      403,
    );
    await consumeStepUp(sql, p, challengeId, "p2p.reserve", q.instruction_hash);
    await sql.query(
      "UPDATE agus_p2p_offers SET available_atoms=available_atoms-$2,revision=revision+1 WHERE id=$1",
      [offer.id, q.token_atoms],
    );
    await sql.query(
      "INSERT INTO agus_p2p_orders(owner,id,counterparty,offer_id,quote_id,token_atoms,fiat_atoms,state,expires_at,instruction_hash,environment,buyer,seller) VALUES($1,$2,$3,$4,$5,$6,$7,'awaiting_escrow',now()+interval '15 minutes',$8,'fixture',$9,$10)",
      [
        p.id,
        op.id,
        offer.owner,
        offer.id,
        quoteId,
        q.token_atoms,
        q.fiat_atoms,
        q.instruction_hash,
        offer.side === "sell" ? p.id : offer.owner,
        offer.side === "sell" ? offer.owner : p.id,
      ],
    );
    return getOrder(p.id, op.id, sql);
  });
}
export async function getOrder(
  owner: string,
  id: string,
  sql?: import("./sql").Sql,
) {
  const row = (
    await (
      await (sql ?? database())
    ).query<{
      id: string;
      state: string;
      revision: number;
      token_atoms: string;
      fiat_atoms: string;
    }>(
      "SELECT id,offer_id,quote_id,buyer,seller,token_atoms,fiat_atoms,state,revision,expires_at,instruction_hash,environment FROM agus_p2p_orders WHERE (owner=$1 OR counterparty=$1) AND id=$2",
      [owner, id],
    )
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  return {
    ...row,
    token: {
      atoms: row.token_atoms,
      currency: "USDC",
      scale: 6,
      mint: CIRCLE_DEVNET_USDC_MINT,
    },
    fiat: { atoms: row.fiat_atoms, currency: "NGN", scale: 2 },
    simulated: true,
    escrowExecutionEnabled: false,
    fiatSettlementVerified: false,
  };
}
export async function cancelOrder(owner: string, id: string, revision: number) {
  return transaction(async (sql) => {
    const row = (
      await sql.query(
        "SELECT * FROM agus_p2p_orders WHERE (owner=$1 OR counterparty=$1) AND id=$2 FOR UPDATE",
        [owner, id],
      )
    ).rows[0];
    invariant(row, "NOT_FOUND", 404);
    invariant(
      row.revision === revision &&
        ["reserved", "awaiting_escrow"].includes(row.state),
      "ORDER_NOT_CANCELLABLE",
    );
    await sql.query(
      "UPDATE agus_p2p_orders SET state='cancelled',revision=revision+1,capacity_restored=true WHERE id=$1",
      [id],
    );
    await sql.query(
      "UPDATE agus_p2p_offers SET available_atoms=available_atoms+$2,revision=revision+1 WHERE id=$1",
      [row.offer_id, row.token_atoms],
    );
    return getOrder(owner, id, sql);
  });
}
export async function updateOffer(
  owner: string,
  id: string,
  revision: number,
  input: z.infer<typeof OfferInput> | null,
) {
  fixture();
  if (input) {
    input = OfferInput.parse(input);
    await eligible(owner);
    invariant(
      BigInt(input.minimumAtoms) <= BigInt(input.maximumAtoms) &&
        BigInt(input.maximumAtoms) <= BigInt(input.availableAtoms),
      "OFFER_LIMITS_INVALID",
      400,
    );
    invariant(
      Date.parse(input.expiresAt) > Date.now() &&
        Date.parse(input.expiresAt) <= Date.now() + 86400000,
      "OFFER_EXPIRY_INVALID",
      400,
    );
  }
  return transaction(async (sql) => {
    const row = (
      await sql.query(
        "SELECT * FROM agus_p2p_offers WHERE owner=$1 AND id=$2 FOR UPDATE",
        [owner, id],
      )
    ).rows[0];
    invariant(row, "NOT_FOUND", 404);
    invariant(
      row.status === "open" && row.revision === revision,
      "OFFER_REVISION_CONFLICT",
    );
    if (!input)
      await sql.query(
        "UPDATE agus_p2p_offers SET status='closed',revision=revision+1 WHERE id=$1",
        [id],
      );
    else {
      invariant(row.side === input.side, "OFFER_SIDE_IMMUTABLE", 400);
      await sql.query(
        "UPDATE agus_p2p_offers SET available_atoms=$2,minimum_atoms=$3,maximum_atoms=$4,rate_numerator=$5,rate_denominator=$6,expires_at=$7,revision=revision+1 WHERE id=$1",
        [
          id,
          input.availableAtoms,
          input.minimumAtoms,
          input.maximumAtoms,
          input.rateNumerator,
          input.rateDenominator,
          input.expiresAt,
        ],
      );
    }
    return {
      ...(
        await sql.query(
          "SELECT id,status,revision FROM agus_p2p_offers WHERE id=$1",
          [id],
        )
      ).rows[0],
      simulated: true,
    };
  });
}
export function escrowGate(): never {
  throw new DomainError("GENUINE_DEVNET_ACCEPTANCE_PENDING", 503, false);
}
export async function openDispute(
  owner: string,
  id: string,
  key: string,
  reason: string,
) {
  fixture();
  return transaction(async (sql) => {
    await getOrder(owner, id, sql);
    const op = await operation(sql, owner, "p2p.dispute", key, { id, reason });
    if (op.created) {
      const order = (
        await sql.query(
          "SELECT * FROM agus_p2p_orders WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (
        !["cancelled", "expired", "completed", "refunded", "disputed"].includes(
          order.state,
        )
      ) {
        await sql.query(
          "UPDATE agus_p2p_orders SET state=CASE WHEN EXISTS(SELECT 1 FROM agus_fixture_escrows WHERE order_id=$1) THEN 'disputed' ELSE state END,revision=revision+1 WHERE id=$1",
          [id],
        );
        await sql.query(
          "UPDATE agus_fixture_escrows SET state='disputed',cancellation_votes='[]',arbitration_votes='[]',arbitration_choice=NULL WHERE order_id=$1",
          [id],
        );
      }
      await sql.query(
        "INSERT INTO agus_p2p_disputes(owner,id,order_id,reason) VALUES($1,$2,$3,$4)",
        [owner, op.id, id, reason],
      );
    }
    return {
      id: op.id,
      orderId: id,
      state: "open",
      simulated: true,
      releaseAuthorized: false,
    };
  });
}
export async function expireUnfundedOrders() {
  return transaction(async (sql) => {
    const rows = (
      await sql.query(
        "SELECT id,offer_id,token_atoms FROM agus_p2p_orders WHERE expires_at<=now() AND state IN ('reserved','awaiting_escrow') FOR UPDATE SKIP LOCKED LIMIT 100",
      )
    ).rows;
    for (const row of rows) {
      await sql.query(
        "UPDATE agus_p2p_orders SET state='expired',revision=revision+1,capacity_restored=true WHERE id=$1",
        [row.id],
      );
      await sql.query(
        "UPDATE agus_p2p_offers SET available_atoms=available_atoms+$2,revision=revision+1 WHERE id=$1",
        [row.offer_id, row.token_atoms],
      );
    }
    return { expired: rows.length, fundedRefunds: 0 };
  });
}
