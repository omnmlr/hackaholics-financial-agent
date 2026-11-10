import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { database, transaction } from "./sql";
import { invariant } from "./errors";
import { operation } from "./idempotency";
import { service } from "../lib/solana";
import { atomsToDecimal, decimalToAtoms } from "../lib/solana/money";
import { CIRCLE_DEVNET_USDC_MINT } from "../lib/solana/assets";
export const RequestInput = z.strictObject({
  recipient: z.string().min(32).max(44),
  asset: z.enum(["SOL", "SPL"]),
  amountAtoms: z.string().regex(/^[1-9][0-9]{0,19}$/),
  expiresAt: z.iso.datetime(),
});
function view(row: Record<string, unknown>) {
  const amount = atomsToDecimal(
    BigInt(String(row.amount_atoms)),
    Number(row.scale),
  );
  const query = new URLSearchParams({
    amount,
    reference: String(row.reference),
    label: "AGUS Devnet test payment",
  });
  if (row.mint) query.set("spl-token", String(row.mint));
  return {
    id: row.id,
    reference: row.reference,
    recipient: row.recipient,
    asset: row.asset,
    mint: row.mint,
    amountAtoms: row.amount_atoms,
    scale: row.scale,
    expiresAt: row.expires_at,
    status:
      row.status === "open" && Date.parse(String(row.expires_at)) <= Date.now()
        ? "expired"
        : row.status,
    revision: row.revision,
    network: "devnet",
    uri: `solana:${row.recipient}?${query}`,
    settlementSignature: row.settlement_signature,
  };
}
export async function createRequest(
  owner: string,
  key: string,
  input: z.infer<typeof RequestInput>,
) {
  const recipient = new PublicKey(input.recipient);
  invariant(recipient.toBase58() === input.recipient, "INVALID_RECIPIENT", 400);
  invariant(
    Date.parse(input.expiresAt) > Date.now() &&
      Date.parse(input.expiresAt) <= Date.now() + 7 * 86400000,
    "REQUEST_EXPIRY_INVALID",
    400,
  );
  return transaction(async (sql) => {
    const op = await operation(sql, owner, "payment.request", key, input);
    if (op.created)
      await sql.query(
        "INSERT INTO agus_payment_requests(owner,id,reference,recipient,asset,mint,amount_atoms,scale,expires_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'open')",
        [
          owner,
          op.id,
          new PublicKey(randomBytes(32)).toBase58(),
          input.recipient,
          input.asset,
          input.asset === "SPL" ? CIRCLE_DEVNET_USDC_MINT : null,
          input.amountAtoms,
          input.asset === "SPL" ? 6 : 9,
          input.expiresAt,
        ],
      );
    return view(
      (
        await sql.query(
          "SELECT * FROM agus_payment_requests WHERE owner=$1 AND id=$2",
          [owner, op.id],
        )
      ).rows[0],
    );
  });
}
export async function getRequest(owner: string, id: string) {
  const row = (
    await (
      await database()
    ).query("SELECT * FROM agus_payment_requests WHERE owner=$1 AND id=$2", [
      owner,
      id,
    ])
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  return view(row);
}
export async function lookupRequest(reference: string) {
  const row = (
    await (
      await database()
    ).query("SELECT * FROM agus_payment_requests WHERE reference=$1", [
      reference,
    ])
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  return view(row);
}
export async function cancelRequest(
  owner: string,
  id: string,
  revision: number,
) {
  const row = (
    await (
      await database()
    ).query(
      "UPDATE agus_payment_requests SET status='cancelled',revision=revision+1 WHERE owner=$1 AND id=$2 AND revision=$3 AND status='open' RETURNING *",
      [owner, id, revision],
    )
  ).rows[0];
  invariant(row, "REQUEST_REVISION_CONFLICT");
  return view(row);
}
export async function prepareRequestedTransfer(
  payer: string,
  requestId: string,
  sender: string,
  key: string,
) {
  const row = (
    await (
      await database()
    ).query(
      "SELECT * FROM agus_payment_requests WHERE id=$1 AND status='open' AND expires_at>now()",
      [requestId],
    )
  ).rows[0];
  invariant(row, "REQUEST_UNAVAILABLE", 409);
  const draft = await service().prepare(
    payer,
    {
      sender,
      recipient: row.recipient,
      asset: row.asset,
      amount: atomsToDecimal(BigInt(row.amount_atoms), row.scale),
      ...(row.mint ? { mint: row.mint } : {}),
      reference: row.reference,
    },
    z.uuid().parse(key),
  );
  await (
    await database()
  ).query(
    "INSERT INTO agus_request_drafts(request_id,payer,draft_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
    [requestId, payer, draft.id],
  );
  return draft;
}
export async function matchRequest(
  actor: string,
  requestId: string,
  draftId: string,
) {
  const sql = await database(),
    link = (
      await sql.query(
        "SELECT l.payer,r.* FROM agus_request_drafts l JOIN agus_payment_requests r ON r.id=l.request_id WHERE l.request_id=$1 AND l.draft_id=$2 AND (r.owner=$3 OR l.payer=$3)",
        [requestId, draftId, actor],
      )
    ).rows[0];
  invariant(link, "NOT_FOUND", 404);
  const draft = await service().reconcile(link.payer, draftId);
  invariant(
    draft.state === "finalized" &&
      draft.confirmation?.commitment === "finalized" &&
      draft.submission,
    "REQUEST_FINALITY_PENDING",
    409,
  );
  invariant(
    draft.reference === link.reference &&
      draft.recipient === link.recipient &&
      draft.asset === link.asset &&
      draft.mint === link.mint &&
      draft.amountAtoms === link.amount_atoms,
    "REQUEST_SETTLEMENT_MISMATCH",
    409,
  );
  return transaction(async (tx) => {
    const row = (
      await tx.query(
        "SELECT * FROM agus_payment_requests WHERE id=$1 FOR UPDATE",
        [requestId],
      )
    ).rows[0];
    if (row.settlement_signature) {
      invariant(
        row.settlement_signature === draft.submission!.signature,
        "REQUEST_ALREADY_SETTLED",
      );
      return view(row);
    }
    const status =
      row.status === "cancelled"
        ? "paid_after_cancellation"
        : new Date(row.expires_at).getTime() <= Date.now()
          ? "paid_after_expiry"
          : "paid";
    const updated = (
      await tx.query(
        "UPDATE agus_payment_requests SET status=$2,settlement_signature=$3,revision=revision+1 WHERE id=$1 RETURNING *",
        [requestId, status, draft.submission!.signature],
      )
    ).rows[0];
    return view(updated);
  });
}
export function parseSolanaPay(uri: string) {
  const url = new URL(uri);
  invariant(
    url.protocol === "solana:" &&
      !url.pathname.startsWith("https:") &&
      url.pathname.length <= 44,
    "INVALID_SOLANA_PAY_URI",
    400,
  );
  const recipient = new PublicKey(url.pathname).toBase58(),
    mint = url.searchParams.get("spl-token"),
    reference = url.searchParams.get("reference"),
    amount = url.searchParams.get("amount");
  invariant(
    !mint || mint === CIRCLE_DEVNET_USDC_MINT,
    "UNSUPPORTED_DEVNET_MINT",
    400,
  );
  invariant(reference && amount, "REQUEST_AMOUNT_REFERENCE_REQUIRED", 400);
  new PublicKey(reference);
  return {
    recipient,
    asset: mint ? "SPL" : "SOL",
    mint,
    reference,
    amountAtoms: decimalToAtoms(amount, mint ? 6 : 9).toString(),
    network: "devnet",
    verification: "unverified_request_only",
  };
}
