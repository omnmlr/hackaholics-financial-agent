import { randomBytes, createPublicKey, verify } from "node:crypto";
import { PublicKey, Transaction } from "@solana/web3.js";
import { base58 } from "../lib/solana/encoding";
import { database, transaction } from "./sql";
import { invariant } from "./errors";
import { consumeStepUp } from "./approvals";
import type { Principal } from "./auth";
import { service } from "../lib/solana";
import { requireDevnet } from "../lib/solana/contracts";
import type { SolanaDraft } from "../lib/solana/contracts";
import { operation } from "./idempotency";
import { CIRCLE_DEVNET_USDC_MINT } from "../lib/solana/assets";
export function devnetView(draft: SolanaDraft) {
  const { amount, ...rest } = draft;
  return {
    ...rest,
    amount: {
      atoms: draft.amountAtoms,
      currency:
        draft.asset === "SOL"
          ? "SOL"
          : draft.mint === CIRCLE_DEVNET_USDC_MINT && draft.decimals === 6
            ? "USDC"
            : "TOKEN",
      scale: draft.decimals,
    },
    displayAmount: amount,
  };
}
export async function walletChallenge(owner: string, wallet: string) {
  requireDevnet();
  const key = new PublicKey(wallet);
  invariant(PublicKey.isOnCurve(key.toBytes()), "INVALID_WALLET", 400);
  const challenge = `AGUS Devnet wallet association\nOwner: ${owner}\nWallet: ${wallet}\nNonce: ${randomBytes(32).toString("hex")}\nNo transaction or funds authorization.`;
  await (
    await database()
  ).query(
    "INSERT INTO agus_wallets(owner,wallet,network,challenge,expires_at) VALUES($1,$2,'devnet',$3,now()+interval '5 minutes') ON CONFLICT(owner,wallet) DO UPDATE SET challenge=excluded.challenge,expires_at=excluded.expires_at,verified_at=NULL",
    [owner, wallet, challenge],
  );
  return { wallet, challenge, network: "devnet", expiresInSeconds: 300 };
}
export function verifySubmissionReplay(
  draft: SolanaDraft,
  signedTransactionBase64: string,
) {
  try {
    const raw = Buffer.from(signedTransactionBase64, "base64"),
      tx = Transaction.from(raw);
    invariant(
      raw.length <= 1232 &&
        raw.toString("base64") === signedTransactionBase64 &&
        tx.signatures.length === 1 &&
        tx.signatures[0].publicKey.toBase58() === draft.sender &&
        tx.verifySignatures(true) &&
        tx.signature &&
        base58(tx.signature) === draft.submission?.signature &&
        tx.serializeMessage().toString("base64") === draft.messageBase64,
      "INVALID_SIGNED_TRANSACTION",
      400,
    );
  } catch {
    invariant(false, "INVALID_SIGNED_TRANSACTION", 400);
  }
}
export async function associateWallet(
  owner: string,
  wallet: string,
  signatureBase64: string,
) {
  requireDevnet();
  return transaction(async (sql) => {
    const row = (
      await sql.query(
        "SELECT challenge FROM agus_wallets WHERE owner=$1 AND wallet=$2 AND verified_at IS NULL AND expires_at>now() FOR UPDATE",
        [owner, wallet],
      )
    ).rows[0];
    invariant(row, "WALLET_CHALLENGE_INVALID", 403);
    const signature = Buffer.from(signatureBase64, "base64");
    invariant(
      signature.length === 64 &&
        signature.toString("base64") === signatureBase64,
      "WALLET_SIGNATURE_INVALID",
      403,
    );
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        new PublicKey(wallet).toBuffer(),
      ]),
      format: "der",
      type: "spki",
    });
    invariant(
      verify(null, Buffer.from(row.challenge), publicKey, signature),
      "WALLET_SIGNATURE_INVALID",
      403,
    );
    await sql.query(
      "UPDATE agus_wallets SET verified_at=now() WHERE owner=$1 AND wallet=$2",
      [owner, wallet],
    );
    return { wallet, network: "devnet", ownershipVerified: true };
  });
}
export async function approveDevnet(
  p: Principal,
  id: string,
  revision: number,
  challengeId: string,
  key: string,
) {
  const draft = await service().get(p.id, id);
  const created = await transaction(async (sql) => {
    const op = await operation(sql, p.id, "solana.approve", key, {
      id,
      revision,
      challengeId,
    });
    if (!op.created) return false;
    invariant(draft.revision === revision, "DRAFT_REVISION_CONFLICT");
    await consumeStepUp(sql, p, challengeId, "solana.approve", draft.digest);
    return true;
  });
  if (!created) {
    invariant(
      draft.approval?.actor === p.id && draft.approval.digest === draft.digest,
      "APPROVAL_NOT_RECORDED",
      409,
    );
    return draft;
  }
  return service().approve(p.id, id, {
    digest: draft.digest,
    acknowledged: true,
  });
}
