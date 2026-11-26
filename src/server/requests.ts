import { randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { database, transaction, type Sql } from "./sql";
import { invariant, DomainError } from "./errors";
import { operation } from "./idempotency";
import { service } from "../lib/solana";
import { atomsToDecimal, decimalToAtoms } from "../lib/solana/money";
import { CIRCLE_DEVNET_USDC_MINT } from "../lib/solana/assets";
import { MAX_U64 } from "../lib/solana/money";
import QRCode from "qrcode";
import { enqueue } from "./jobs";
import { DEVNET_GENESIS, DEVNET_RPC } from "../lib/solana/contracts";
import type { RequestChainReceipt } from "./request-chain";
function publicKey(value: string) {
  try {
    return new PublicKey(value);
  } catch {
    throw new DomainError("INVALID_SOLANA_PAY_ADDRESS", 400);
  }
}
export const RequestInput = z.strictObject({
  recipient: z.string().min(32).max(44),
  asset: z.enum(["SOL", "SPL"]),
  amountAtoms: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .refine((n) => BigInt(n) <= MAX_U64),
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
  const status =
    row.status === "open" &&
    new Date(String(row.expires_at)).getTime() <= Date.now()
      ? "expired"
      : row.status;
  return {
    id: String(row.id),
    reference: row.reference,
    recipient: row.recipient,
    asset: row.asset,
    mint: row.mint,
    amountAtoms: row.amount_atoms,
    amount: {
      atoms: String(row.amount_atoms),
      currency: row.asset === "SOL" ? "SOL" : "USDC",
      scale: Number(row.scale),
    },
    scale: row.scale,
    expiresAt: row.expires_at,
    status,
    revision: row.revision,
    network: "devnet",
    uri: `solana:${row.recipient}?${query}`,
    payable: status === "open",
    networkNotEnforcedByUri: true,
    networkRequirement:
      "Devnet must be selected and its genesis verified before signing; a Solana Pay URI alone does not select the wallet cluster.",
    settlementSignature: row.settlement_signature,
    manualReviewRequired: row.status === "paid_multiple",
    automaticRefundAuthorized: false,
    cancelledAt: row.cancelled_at ?? null,
    settlementObservedAt: row.settlement_observed_at ?? null,
    settlementBlockTime: row.settlement_block_time ?? null,
  };
}
export async function createRequest(
  owner: string,
  key: string,
  input: z.infer<typeof RequestInput>,
  existingTransaction?: Sql,
) {
  input = RequestInput.parse(input);
  const recipient = publicKey(input.recipient);
  invariant(recipient.toBase58() === input.recipient, "INVALID_RECIPIENT", 400);
  invariant(
    Date.parse(input.expiresAt) > Date.now() &&
      Date.parse(input.expiresAt) <= Date.now() + 7 * 86400000,
    "REQUEST_EXPIRY_INVALID",
    400,
  );
  async function create(sql: Sql) {
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
  }
  return existingTransaction
    ? create(existingTransaction)
    : transaction(create);
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
export async function listRequests(
  owner: string,
  after: string,
  limit: number,
) {
  return (
    await (
      await database()
    ).query(
      "SELECT * FROM agus_payment_requests WHERE owner=$1 AND id>$2 ORDER BY id LIMIT $3",
      [owner, after, limit],
    )
  ).rows.map(view);
}
export async function requestQr(owner: string, id: string) {
  const row = await getRequest(owner, id);
  invariant(row.payable && row.uri, "REQUEST_UNAVAILABLE", 409);
  return {
    id,
    uri: row.uri,
    svg: await QRCode.toString(row.uri, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 4,
    }),
    network: "devnet",
    networkNotEnforcedByUri: true,
    requiresExplicitReview: true,
  };
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
  sql?: Sql,
) {
  const row = (
    await (sql ?? (await database())).query(
      "UPDATE agus_payment_requests SET status='cancelled',cancelled_at=now(),revision=revision+1 WHERE owner=$1 AND id=$2 AND revision=$3 AND status='open' RETURNING *",
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
      draft.network === "devnet" &&
      draft.genesisHash === DEVNET_GENESIS &&
      draft.rpcEndpoint === DEVNET_RPC &&
      draft.decimals === Number(link.scale) &&
      draft.recipient === link.recipient &&
      draft.asset === link.asset &&
      draft.mint === link.mint &&
      draft.amountAtoms === link.amount_atoms,
    "REQUEST_SETTLEMENT_MISMATCH",
    409,
  );
  return recordRequestReceipt(
    requestId,
    {
      signature: draft.submission.signature,
      sender: draft.sender,
      slot: draft.confirmation.slot,
      blockTime: draft.confirmation.blockTime ?? null,
      amountAtoms: draft.amountAtoms,
      asset: draft.asset,
      mint: draft.mint,
      genesisHash: DEVNET_GENESIS,
      verification: "chain_finalized",
    },
    { owner: link.payer, draftId: draft.id },
  );
}
export async function recordRequestReceipt(
  requestId: string,
  receipt: RequestChainReceipt,
  payer?: { owner: string; draftId: string },
) {
  invariant(
    receipt.genesisHash === DEVNET_GENESIS &&
      receipt.verification === "chain_finalized",
    "REQUEST_FINALITY_PENDING",
    409,
  );
  return transaction(async (tx) => {
    const row = (
      await tx.query(
        "SELECT * FROM agus_payment_requests WHERE id=$1 FOR UPDATE",
        [requestId],
      )
    ).rows[0];
    invariant(row, "NOT_FOUND", 404);
    invariant(
      receipt.amountAtoms === row.amount_atoms &&
        receipt.asset === row.asset &&
        receipt.mint === row.mint,
      "REQUEST_SETTLEMENT_MISMATCH",
      409,
    );
    const existing = (
      await tx.query(
        "SELECT request_id,kind FROM agus_request_chain_observations WHERE signature=$1",
        [receipt.signature],
      )
    ).rows[0];
    if (existing) {
      invariant(
        existing.request_id === requestId,
        "REQUEST_SIGNATURE_ALREADY_ALLOCATED",
      );
      if (payer)
        await enqueue(
          tx,
          payer.owner,
          "notification.in_app",
          `request:${requestId}:${receipt.signature}:${payer.owner}`,
          {
            resourceType: payer.owner === row.owner ? "request" : "solana",
            resourceId: payer.owner === row.owner ? requestId : payer.draftId,
          },
        );
      return {
        ...view(row),
        additionalPayment: existing.kind === "additional",
        automaticRefundAuthorized: false,
      };
    }
    const additional =
      !!row.settlement_signature &&
      row.settlement_signature !== receipt.signature;
    const millis = (receipt.blockTime ?? -1) * 1000;
    const chainAt =
      receipt.blockTime !== null &&
      Number.isSafeInteger(receipt.blockTime) &&
      millis >= 0 &&
      Number.isFinite(new Date(millis).getTime())
        ? new Date(millis)
        : null;
    await tx.query(
      "INSERT INTO agus_request_chain_observations(signature,request_id,kind,slot,sender,amount_atoms,asset,mint,block_time,evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
      [
        receipt.signature,
        requestId,
        additional ? "additional" : "primary",
        receipt.slot,
        receipt.sender,
        receipt.amountAtoms,
        receipt.asset,
        receipt.mint,
        chainAt,
        JSON.stringify({
          provider: "solana-public-rpc",
          environment: "devnet",
          verification: receipt.verification,
          genesisHash: receipt.genesisHash,
        }),
      ],
    );
    if (!row.settlement_signature) {
      const status = chainAt
        ? row.status === "cancelled" &&
          row.cancelled_at &&
          chainAt.getTime() >= new Date(row.cancelled_at).getTime()
          ? "paid_after_cancellation"
          : chainAt.getTime() >= new Date(row.expires_at).getTime()
            ? "paid_after_expiry"
            : "paid"
        : row.status === "cancelled" ||
            new Date(row.expires_at).getTime() <= Date.now()
          ? "paid_timing_unverified"
          : "paid";
      await tx.query(
        "UPDATE agus_payment_requests SET status=$2,settlement_signature=$3,settlement_observed_at=now(),settlement_block_time=$4,revision=revision+1 WHERE id=$1",
        [requestId, status, receipt.signature, chainAt],
      );
    } else if (additional)
      await tx.query(
        "UPDATE agus_payment_requests SET status='paid_multiple',revision=revision+1 WHERE id=$1",
        [requestId],
      );
    for (const target of [
      { owner: row.owner, resourceType: "request", resourceId: requestId },
      ...(payer && payer.owner !== row.owner
        ? [
            {
              owner: payer.owner,
              resourceType: "solana",
              resourceId: payer.draftId,
            },
          ]
        : []),
    ])
      await enqueue(
        tx,
        target.owner,
        "notification.in_app",
        `request:${requestId}:${receipt.signature}:${target.owner}`,
        { resourceType: target.resourceType, resourceId: target.resourceId },
      );
    const updated = (
      await tx.query("SELECT * FROM agus_payment_requests WHERE id=$1", [
        requestId,
      ])
    ).rows[0];
    return {
      ...view(updated),
      additionalPayment: additional,
      automaticRefundAuthorized: false,
    };
  });
}
export async function requestReceipts(
  owner: string,
  id: string,
  after: string,
  limit: number,
) {
  await getRequest(owner, id);
  return (
    await (
      await database()
    ).query<{ id: string; asset: string; amount_atoms: string }>(
      "SELECT signature AS id,signature,kind,slot,sender,amount_atoms,asset,mint,block_time,observed_at,evidence FROM agus_request_chain_observations WHERE request_id=$1 AND signature>$2 ORDER BY signature LIMIT $3",
      [id, after, limit],
    )
  ).rows.map((row) => ({
    ...row,
    amount: {
      atoms: row.amount_atoms,
      currency: row.asset === "SOL" ? "SOL" : "USDC",
      scale: row.asset === "SOL" ? 9 : 6,
    },
  }));
}
export function parseSolanaPay(uri: string) {
  invariant(uri.length <= 2048, "INVALID_SOLANA_PAY_URI", 400);
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new DomainError("INVALID_SOLANA_PAY_URI", 400);
  }
  invariant(
    url.protocol === "solana:" &&
      !url.host &&
      !url.hash &&
      !url.pathname.startsWith("https:") &&
      url.pathname.length <= 44,
    "INVALID_SOLANA_PAY_URI",
    400,
  );
  const allowed = new Set([
    "amount",
    "reference",
    "spl-token",
    "label",
    "message",
  ]);
  for (const key of url.searchParams.keys())
    invariant(
      allowed.has(key) && url.searchParams.getAll(key).length === 1,
      "AMBIGUOUS_SOLANA_PAY_URI",
      400,
    );
  const recipient = publicKey(url.pathname).toBase58(),
    mint = url.searchParams.get("spl-token"),
    reference = url.searchParams.get("reference"),
    amount = url.searchParams.get("amount");
  invariant(
    !mint || mint === CIRCLE_DEVNET_USDC_MINT,
    "UNSUPPORTED_DEVNET_MINT",
    400,
  );
  invariant(reference && amount, "REQUEST_AMOUNT_REFERENCE_REQUIRED", 400);
  publicKey(reference);
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
