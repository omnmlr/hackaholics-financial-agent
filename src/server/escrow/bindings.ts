import { z } from "zod";
import { database, transaction } from "../sql";
import type { Principal } from "../auth";
import { invariant } from "../errors";
import { instructionHash } from "../approvals";
import { operation } from "../idempotency";
import {
  escrowAddresses,
  fundingInstruction,
  observeFinalizedFunding,
  type EscrowTerms,
  ESCROW_PROGRAM_ID,
} from "./devnet";
import { CIRCLE_DEVNET_USDC_MINT } from "../../lib/solana/assets";
export const BindingInput = z.strictObject({
  buyerWallet: z.string().min(32).max(44),
  sellerWallet: z.string().min(32).max(44),
  buyerDestination: z.string().min(32).max(44),
  sellerSource: z.string().min(32).max(44),
});
async function ownedOrder(p: Principal, id: string) {
  const row = (
    await (
      await database()
    ).query(
      "SELECT * FROM agus_p2p_orders WHERE id=$1 AND (buyer=$2 OR seller=$2)",
      [id, p.id],
    )
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  return row;
}
function view(t: EscrowTerms) {
  const a = escrowAddresses(t),
    ix = fundingInstruction(t);
  return {
    orderDigest: t.digest,
    terms: t,
    escrow: a.escrow.toBase58(),
    vault: a.vault.toBase58(),
    programId: ESCROW_PROGRAM_ID.toBase58(),
    network: "devnet",
    mint: CIRCLE_DEVNET_USDC_MINT,
    instruction: {
      accounts: ix.keys.map((k) => ({
        address: k.pubkey.toBase58(),
        signer: k.isSigner,
        writable: k.isWritable,
      })),
      dataBase64: ix.data.toString("base64"),
    },
    transactionPrepared: false,
    feeAndRentReviewed: false,
    genuineExecutionEnabled: false,
    programAddressAccepted: false,
    deploymentStatus:
      "local-program-only; owner-controlled deployment address pending",
    gate: "GENUINE_DEVNET_ACCEPTANCE_PENDING",
    verifierSimulated: true,
  };
}
export async function createBinding(
  p: Principal,
  id: string,
  key: string,
  input: z.infer<typeof BindingInput>,
) {
  const row = await ownedOrder(p, id);
  invariant(p.id === row.seller, "SELLER_REQUIRED", 403);
  invariant(row.state === "awaiting_escrow", "ORDER_NOT_FUNDABLE");
  const verifier = process.env.AGUS_DEVNET_ESCROW_VERIFIER ?? "",
    arbitrators = (process.env.AGUS_DEVNET_ESCROW_ARBITRATORS ?? "").split(",");
  invariant(
    verifier && arbitrators.length === 3 && arbitrators.every(Boolean),
    "ESCROW_AUTHORITY_CONFIGURATION_REQUIRED",
    503,
  );
  const pairs = [
    [row.buyer, input.buyerWallet],
    [row.seller, input.sellerWallet],
  ];
  for (const [owner, wallet] of pairs)
    invariant(
      (
        await (
          await database()
        ).query(
          "SELECT 1 FROM agus_wallets WHERE owner=$1 AND wallet=$2 AND network='devnet' AND verified_at IS NOT NULL",
          [owner, wallet],
        )
      ).rows.length,
      "VERIFIED_PARTY_WALLET_REQUIRED",
      403,
    );
  return transaction(async (sql) => {
    const locked = (
      await sql.query(
        "SELECT state FROM agus_p2p_orders WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    invariant(locked.state === "awaiting_escrow", "ORDER_NOT_FUNDABLE");
    await operation(sql, p.id, "p2p.escrow.bind", key, { id, ...input });
    // Snapshot the immutable authorities once. Configuration changes cannot
    // rewrite existing prepared/funded order terms.
    const current = (
      await sql.query(
        "SELECT terms FROM agus_devnet_escrow_bindings WHERE order_id=$1",
        [id],
      )
    ).rows[0];
    if (current) {
      invariant(
        current.terms.buyer === input.buyerWallet &&
          current.terms.seller === input.sellerWallet &&
          current.terms.buyerDestination === input.buyerDestination &&
          current.terms.sellerSource === input.sellerSource,
        "ESCROW_BINDING_IMMUTABLE",
      );
      return view(current.terms);
    }
    const terms: EscrowTerms = {
      digest: instructionHash({
        protocol: "agus-devnet-escrow-v1",
        id,
        marketplaceDigest: row.instruction_hash,
        ...input,
        verifier,
        arbitrators,
        amountAtoms: row.token_atoms,
        mint: CIRCLE_DEVNET_USDC_MINT,
        programId: ESCROW_PROGRAM_ID.toBase58(),
        verifierSimulated: true,
      }),
      amountAtoms: row.token_atoms,
      buyer: input.buyerWallet,
      seller: input.sellerWallet,
      buyerDestination: input.buyerDestination,
      sellerSource: input.sellerSource,
      verifier,
      arbitrators: arbitrators as [string, string, string],
    };
    const template = view(terms);
    await sql.query(
      "INSERT INTO agus_devnet_escrow_bindings(order_id,protocol_digest,terms) VALUES($1,$2,$3)",
      [id, terms.digest, JSON.stringify(terms)],
    );
    return template;
  });
}
export async function getBinding(p: Principal, id: string) {
  await ownedOrder(p, id);
  const b = (
    await (
      await database()
    ).query("SELECT * FROM agus_devnet_escrow_bindings WHERE order_id=$1", [id])
  ).rows[0];
  invariant(b, "NOT_FOUND", 404);
  return {
    ...view(b.terms),
    fundingObservation: b.funding_observation,
    revision: b.revision,
  };
}
export async function reconcileBinding(
  p: Principal,
  id: string,
  signature: string,
) {
  await ownedOrder(p, id);
  const sql = await database();
  const b = (
    await sql.query(
      "SELECT * FROM agus_devnet_escrow_bindings WHERE order_id=$1",
      [id],
    )
  ).rows[0];
  invariant(b, "NOT_FOUND", 404);
  invariant(
    !b.funding_signature || b.funding_signature === signature,
    "ESCROW_FUNDING_SIGNATURE_CONFLICT",
  );
  if (b.funding_observation) return getBinding(p, id);
  const observation = await observeFinalizedFunding(b.terms, signature);
  await transaction(async (tx) => {
    const current = (
      await tx.query(
        "SELECT * FROM agus_devnet_escrow_bindings WHERE order_id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    invariant(
      !current.funding_signature || current.funding_signature === signature,
      "ESCROW_FUNDING_SIGNATURE_CONFLICT",
    );
    if (!current.funding_observation)
      await tx.query(
        "UPDATE agus_devnet_escrow_bindings SET funding_signature=$2,funding_observation=$3,revision=revision+1 WHERE order_id=$1",
        [id, signature, JSON.stringify(observation)],
      );
  });
  // Chain proof is recorded separately. It cannot promote the fiat simulation
  // ledger or authorize cooperative/arbitrated release.
  return getBinding(p, id);
}
