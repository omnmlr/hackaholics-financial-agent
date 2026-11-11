import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Principal } from "./auth";
import { instructionHash, consumeStepUp } from "./approvals";
import { database, transaction, type Sql } from "./sql";
import { invariant } from "./errors";
import { operation } from "./idempotency";
import { enqueue } from "./jobs";
export const FixtureEscrowAction = z.enum([
  "fund",
  "claim_fiat",
  "verify_fiat",
  "release",
  "mutual_cancel",
  "arbitrate_release",
  "arbitrate_refund",
]);
type Action = z.infer<typeof FixtureEscrowAction>;
async function owned(sql: Sql, p: Principal, id: string, lock = false) {
  const row = (
    await sql.query(
      `SELECT * FROM agus_p2p_orders WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
  invariant(
    row &&
      (row.owner === p.id ||
        row.counterparty === p.id ||
        p.role === "operations"),
    "NOT_FOUND",
    404,
  );
  return row;
}
async function review(
  sql: Sql,
  p: Principal,
  id: string,
  action: Action,
  lock = false,
) {
  invariant(
    (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
    "P2P_SIMULATION_ONLY",
    403,
  );
  const row = await owned(sql, p, id, lock);
  const escrow = (
    await sql.query("SELECT * FROM agus_fixture_escrows WHERE order_id=$1", [
      id,
    ])
  ).rows[0];
  const authorities =
    escrow ??
    (
      await sql.query(
        "SELECT * FROM agus_fixture_escrow_authorities WHERE id=1",
      )
    ).rows[0] ??
    null;
  const instruction = {
    orderId: id,
    revision: row.revision,
    orderDigest: row.instruction_hash,
    action,
    buyer: row.buyer,
    seller: row.seller,
    amount: { atoms: row.token_atoms, currency: "USDC", scale: 6 },
    fiat: { atoms: row.fiat_atoms, currency: "NGN", scale: 2 },
    verifier: authorities?.verifier ?? null,
    arbitrators: authorities?.arbitrators ?? [],
    environment: "fixture",
    simulated: true,
  };
  return {
    row,
    escrow,
    authorities,
    instruction,
    instructionDigest: instructionHash(instruction),
    action: `p2p.fixture.${action}`,
  };
}
export async function fixtureReview(p: Principal, id: string, action: Action) {
  const r = await review(await database(), p, id, action);
  return {
    instruction: r.instruction,
    instructionDigest: r.instructionDigest,
    action: r.action,
    genuineEscrowExecutionEnabled: false,
  };
}
export async function fixtureSnapshot(p: Principal, id: string) {
  const sql = await database();
  const order = await owned(sql, p, id);
  const escrow =
    (
      await sql.query(
        "SELECT state,amount_atoms,verifier,arbitrators,fiat_verifier,cancellation_votes,arbitration_votes,arbitration_choice FROM agus_fixture_escrows WHERE order_id=$1",
        [id],
      )
    ).rows[0] ?? null;
  return {
    order,
    escrow,
    simulated: true,
    bankSettlementVerified: false,
    chainFinalityVerified: false,
    genuineEscrowExecutionEnabled: false,
  };
}
async function notify(
  sql: Sql,
  row: { buyer: string; seller: string; id: string; revision: number },
) {
  for (const owner of [row.buyer, row.seller])
    await enqueue(
      sql,
      owner,
      "notification.in_app",
      `p2p:${row.id}:${row.revision}:${owner}`,
      { resourceType: "p2p", resourceId: row.id },
    );
}
export async function fixtureAction(
  p: Principal,
  id: string,
  key: string,
  action: Action,
  revision: number,
  challengeId: string,
) {
  return transaction(async (sql) => {
    const op = await operation(sql, p.id, `p2p.fixture.${action}`, key, {
      id,
      revision,
      action,
    });
    if (!op.created) return fixtureSnapshotTx(sql, p, id);
    const r = await review(sql, p, id, action, true),
      row = r.row,
      e = r.escrow;
    invariant(row.revision === revision, "REVISION_CONFLICT");
    invariant(
      !["completed", "cancelled", "expired", "refunded"].includes(row.state),
      "ORDER_TERMINAL",
    );
    if (action === "fund") {
      invariant(p.id === row.seller, "SELLER_REQUIRED", 403);
      invariant(
        row.state === "awaiting_escrow" &&
          new Date(row.expires_at).getTime() > Date.now(),
        "ORDER_NOT_FUNDABLE",
      );
      invariant(
        !(
          await sql.query(
            "SELECT 1 FROM agus_p2p_disputes WHERE order_id=$1 AND state='open'",
            [id],
          )
        ).rows.length,
        "ORDER_DISPUTED",
      );
      invariant(
        (
          await sql.query(
            "SELECT owner FROM agus_trader_eligibility WHERE owner=ANY($1::text[]) AND eligible=true AND environment='fixture'",
            [[row.buyer, row.seller]],
          )
        ).rows.length === 2,
        "TRADER_ELIGIBILITY_REQUIRED",
        403,
      );
      const a = r.authorities;
      invariant(
        a &&
          Array.isArray(a.arbitrators) &&
          a.arbitrators.length === 3 &&
          new Set([row.buyer, row.seller, a.verifier, ...a.arbitrators])
            .size === 6,
        "FIXTURE_ESCROW_AUTHORITIES_REQUIRED",
        503,
      );
      const roles = (
        await sql.query(
          "SELECT id FROM agus_users WHERE id=ANY($1::text[]) AND role='operations'",
          [[a.verifier, ...a.arbitrators]],
        )
      ).rows;
      invariant(roles.length === 4, "FIXTURE_ESCROW_AUTHORITIES_REQUIRED", 503);
      await consumeStepUp(sql, p, challengeId, r.action, r.instructionDigest);
      await sql.query(
        "INSERT INTO agus_fixture_token_balances(owner) VALUES($1) ON CONFLICT DO NOTHING",
        [row.seller],
      );
      invariant(
        (
          await sql.query(
            "UPDATE agus_fixture_token_balances SET atoms=atoms-$2 WHERE owner=$1 AND atoms>=$2 RETURNING owner",
            [row.seller, row.token_atoms],
          )
        ).rows.length,
        "INSUFFICIENT_SIMULATED_BALANCE",
      );
      await sql.query(
        "INSERT INTO agus_fixture_escrows(order_id,amount_atoms,verifier,arbitrators) VALUES($1,$2,$3,$4)",
        [id, row.token_atoms, a.verifier, JSON.stringify(a.arbitrators)],
      );
      row.state = "escrow_funded";
    } else {
      invariant(e, "FIXTURE_ESCROW_NOT_FUNDED");
      if (action === "claim_fiat") {
        invariant(p.id === row.buyer, "BUYER_REQUIRED", 403);
        invariant(
          ["escrow_funded", "awaiting_fiat"].includes(row.state),
          "FIAT_CLAIM_NOT_ALLOWED",
        );
      } else if (action === "verify_fiat") {
        invariant(
          p.role === "operations" && p.id === e.verifier,
          "FIXTURE_VERIFIER_REQUIRED",
          403,
        );
        invariant(
          row.state === "fiat_claimed",
          "FIAT_VERIFICATION_NOT_ALLOWED",
        );
      } else if (action === "release") {
        invariant(p.id === row.seller, "SELLER_REQUIRED", 403);
        invariant(
          row.state === "fiat_verified" && e.fiat_verifier === e.verifier,
          "FIAT_VERIFIER_AUTHORITY_REQUIRED",
          403,
        );
      } else if (action === "mutual_cancel") {
        invariant(
          [row.buyer, row.seller].includes(p.id),
          "PARTY_REQUIRED",
          403,
        );
        invariant(
          [
            "escrow_funded",
            "awaiting_fiat",
            "fiat_claimed",
            "fiat_verified",
            "disputed",
            "cancellation_pending",
          ].includes(row.state),
          "MUTUAL_CANCELLATION_NOT_ALLOWED",
        );
        invariant(
          !e.cancellation_votes.includes(p.id),
          "CANCELLATION_ALREADY_SIGNED",
        );
      } else {
        invariant(
          row.state === "disputed" &&
            p.role === "operations" &&
            e.arbitrators.includes(p.id),
          "ARBITRATOR_REQUIRED",
          403,
        );
        invariant(
          !e.arbitration_votes.some((v: string | { actor: string }) =>
            typeof v === "string" ? v === p.id : v.actor === p.id,
          ),
          "ARBITRATOR_ALREADY_SIGNED",
        );
      }
      await consumeStepUp(sql, p, challengeId, r.action, r.instructionDigest);
      if (action === "claim_fiat") row.state = "fiat_claimed";
      if (action === "verify_fiat") {
        row.state = "fiat_verified";
        await sql.query(
          "UPDATE agus_fixture_escrows SET fiat_verifier=$2 WHERE order_id=$1",
          [id, p.id],
        );
      }
      if (action === "release") row.state = "completed";
      if (action === "mutual_cancel") {
        const votes = [...e.cancellation_votes, p.id];
        row.state = votes.length === 2 ? "refunded" : "cancellation_pending";
        await sql.query(
          "UPDATE agus_fixture_escrows SET cancellation_votes=$2 WHERE order_id=$1",
          [id, JSON.stringify(votes)],
        );
      }
      if (action.startsWith("arbitrate_")) {
        const prior = e.arbitration_votes.map(
          (v: string | { actor: string; choice: string }) =>
            typeof v === "string"
              ? { actor: v, choice: e.arbitration_choice }
              : v,
        );
        const votes = [...prior, { actor: p.id, choice: action }];
        const agreed =
          votes.filter((v: { choice: string }) => v.choice === action).length >=
          2;
        if (agreed)
          row.state = action === "arbitrate_release" ? "completed" : "refunded";
        await sql.query(
          "UPDATE agus_fixture_escrows SET arbitration_votes=$2,arbitration_choice=$3 WHERE order_id=$1",
          [id, JSON.stringify(votes), agreed ? action : null],
        );
      }
      if (["completed", "refunded"].includes(row.state)) {
        const recipient = row.state === "completed" ? row.buyer : row.seller;
        await sql.query(
          "INSERT INTO agus_fixture_token_balances(owner,atoms) VALUES($1,$2) ON CONFLICT(owner) DO UPDATE SET atoms=agus_fixture_token_balances.atoms+$2",
          [recipient, row.token_atoms],
        );
        await sql.query(
          "UPDATE agus_fixture_escrows SET state=$2 WHERE order_id=$1",
          [id, row.state === "completed" ? "released" : "refunded"],
        );
        if (row.state === "refunded" && !row.capacity_restored) {
          await sql.query(
            "UPDATE agus_p2p_offers SET available_atoms=available_atoms+$2,revision=revision+1 WHERE id=$1",
            [row.offer_id, row.token_atoms],
          );
          row.capacity_restored = true;
        }
      }
    }
    row.revision++;
    await sql.query(
      "UPDATE agus_p2p_orders SET state=$2,revision=$3,capacity_restored=$4 WHERE id=$1",
      [id, row.state, row.revision, row.capacity_restored],
    );
    await sql.query(
      "INSERT INTO agus_p2p_events(id,order_id,actor,action,revision,instruction_hash) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), id, p.id, r.action, row.revision, r.instructionDigest],
    );
    await notify(sql, {
      buyer: row.buyer,
      seller: row.seller,
      id: row.id,
      revision: row.revision,
    });
    return fixtureSnapshotTx(sql, p, id);
  });
}
async function fixtureSnapshotTx(sql: Sql, p: Principal, id: string) {
  const order = await owned(sql, p, id);
  return {
    id: order.id,
    state: order.state,
    revision: order.revision,
    simulated: true,
    bankSettlementVerified: false,
    chainFinalityVerified: false,
    genuineEscrowExecutionEnabled: false,
  };
}
