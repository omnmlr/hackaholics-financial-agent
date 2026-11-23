import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import type { z } from "zod";
import * as C from "../../../packages/contracts/src/crypto";
import { DEVNET_GENESIS } from "../../lib/solana/contracts";
import { MAX_U64, safeLamports } from "../../lib/solana/money";
import type { Principal } from "../auth";
import { invariant } from "../errors";
import { operationalEvent } from "../observability";
import { inspectRequestPayment } from "../request-chain";
import { discoverRequest } from "../request-discovery";
import { cancelRequest, createRequest, getRequest } from "../requests";
import { database, transaction as store, type Sql } from "../sql";
import { attributeEvent, normalizeTransaction } from "./ledger";
import { assetSymbol, sol, token } from "./portfolio";
import { cryptoMutation, listWallets } from "./registry";
import { cryptoRpc } from "./rpc";

type Input = z.infer<typeof C.CryptoRequestInput>;
type LegacyRequest = Awaited<ReturnType<typeof getRequest>>;
type RecordRow = {
  id: string;
  wallet_id: string;
  invoice: Input["invoice"] | null;
  observation: "needs_review" | "settled" | null;
  receipt_id: string | null;
};

export function cryptoRequestsReady() {
  return (
    process.env.AGUS_CRYPTO_REQUESTS === "true" &&
    process.env.AGUS_SOLANA_DEVNET_ENABLED === "true" &&
    process.env.PAYMENT_MODE !== "live"
  );
}
export const cryptoInvoicesReady = () =>
  cryptoRequestsReady() && process.env.AGUS_CRYPTO_INVOICES === "true";

function shareOrigin() {
  const url = new URL(
    process.env.BETTER_AUTH_URL ??
      process.env.APP_ORIGIN ??
      "http://localhost:3000",
  );
  invariant(
    url.protocol === "https:" ||
      (process.env.NODE_ENV !== "production" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)),
    "FEATURE_DISABLED",
    503,
  );
  return url.origin;
}

function view(row: RecordRow, item: LegacyRequest) {
  const state =
    item.status === "cancelled"
      ? "cancelled"
      : item.status === "paid_multiple" || row.observation === "needs_review"
        ? "needs_review"
        : row.observation === "settled"
          ? "settled"
          : item.status === "paid"
            ? "needs_review"
            : item.status === "expired"
              ? "expired"
              : "open";
  const asset =
    item.asset === "SOL"
      ? sol("devnet", BigInt(String(item.amountAtoms)))
      : token(
          "devnet",
          String(item.mint),
          String(item.amountAtoms),
          Number(item.scale),
        );
  return C.CryptoRequest.parse({
    id: item.id,
    walletId: row.wallet_id,
    recipient: item.recipient,
    reference: item.reference,
    amount: asset,
    expiresAt: new Date(String(item.expiresAt)).toISOString(),
    revision: Number(item.revision),
    solanaPayUri: item.uri,
    shareUrl: `${shareOrigin()}/api/v1/crypto/share/${item.reference}`,
    qrPath: `/api/v1/crypto/requests/${item.id}/qr`,
    qrMode: "share_url",
    state,
    receiptId: state === "settled" ? row.receipt_id : null,
    ...(row.invoice && { invoice: row.invoice }),
  });
}

async function requestRecord(sql: Sql, owner: string, id: string) {
  const row = (
    await sql.query<RecordRow>(
      "SELECT * FROM agus_crypto_request_records WHERE owner=$1 AND id=$2",
      [owner, id],
    )
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  return row;
}

export async function createCryptoRequest(
  p: Principal,
  input: Input,
  key: string,
) {
  invariant(
    cryptoRequestsReady() && (!input.invoice || cryptoInvoicesReady()),
    "FEATURE_DISABLED",
    503,
  );
  invariant(input.amount.asset.cluster === "devnet", "FEATURE_DISABLED", 503);
  const asset = assetSymbol(input.amount);
  invariant(
    (asset === "SOL" && input.amount.decimals === 9) || asset === "USDC",
    "UNSUPPORTED_ASSET",
    422,
  );
  const atoms = BigInt(input.amount.atoms);
  invariant(atoms > 0n && atoms <= MAX_U64, "INVALID_AMOUNT", 400);
  const [wallet] = await listWallets(p.id, {
    cluster: "devnet",
    walletIds: [input.walletId],
  });
  invariant(wallet.ownership === "verified", "WATCH_ONLY", 403);
  return cryptoMutation(
    p.id,
    "crypto.request.create",
    key,
    input,
    async (sql) => {
      const request = await createRequest(
        p.id,
        `crypto.${key}`,
        {
          recipient: wallet.address,
          asset: asset === "SOL" ? "SOL" : "SPL",
          amountAtoms: input.amount.atoms,
          expiresAt:
            input.expiresAt ?? new Date(Date.now() + 86400_000).toISOString(),
        },
        sql,
      );
      const result = await sql.query<RecordRow>(
        "INSERT INTO agus_crypto_request_records(owner,id,wallet_id,invoice) VALUES($1,$2,$3,$4::jsonb) RETURNING *",
        [
          p.id,
          request.id,
          wallet.id,
          input.invoice ? JSON.stringify(input.invoice) : null,
        ],
      );
      return view(result.rows[0], request);
    },
  );
}

export async function getCryptoRequest(owner: string, id: string) {
  invariant(cryptoRequestsReady(), "FEATURE_DISABLED", 503);
  return view(
    await requestRecord(await database(), owner, id),
    await getRequest(owner, id),
  );
}

export function cancelCryptoRequest(
  p: Principal,
  id: string,
  revision: number,
  key: string,
) {
  invariant(cryptoRequestsReady(), "FEATURE_DISABLED", 503);
  return cryptoMutation(
    p.id,
    "crypto.request.cancel",
    key,
    { id, revision },
    async (sql) => {
      const row = await requestRecord(sql, p.id, id);
      return view(row, await cancelRequest(p.id, id, revision, sql));
    },
  );
}

export async function cryptoRequestQr(owner: string, id: string) {
  const request = await getCryptoRequest(owner, id);
  invariant(request.state === "open", "REQUEST_UNAVAILABLE", 409);
  const png = await QRCode.toBuffer(request.shareUrl, {
    errorCorrectionLevel: "M",
    margin: 4,
  });
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function shareCryptoRequest(reference: string) {
  invariant(cryptoRequestsReady(), "FEATURE_DISABLED", 503);
  const row = (
    await (
      await database()
    ).query<RecordRow & { owner: string }>(
      `SELECT c.* FROM agus_payment_requests x JOIN agus_crypto_request_records c ON c.owner=x.owner AND c.id=x.id WHERE x.reference=$1`,
      [reference],
    )
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  const item = view(row, await getRequest(row.owner, row.id));
  return C.CryptoShare.parse({
    network: "devnet",
    testAssets: true,
    requiresExplicitNetworkSelection: true,
    recipient: item.recipient,
    reference: item.reference,
    amount: item.amount,
    state: item.state,
    expiresAt: item.expiresAt,
    ...(item.state === "open" && { solanaPayUri: item.solanaPayUri }),
  });
}

export async function findCryptoRequestReceipt(owner: string, id: string) {
  return (
    await (
      await database()
    ).query(
      `SELECT c.receipt FROM agus_crypto_request_records c JOIN agus_payment_requests r ON r.owner=c.owner AND r.id=c.id
       WHERE c.owner=$1 AND c.receipt_id=$2 AND c.observation='settled' AND r.status='paid'`,
      [owner, id],
    )
  ).rows[0]?.receipt;
}

async function discover(owner: string, row: RecordRow) {
  const result = await discoverRequest(owner, row.id);
  const sql = await database();
  if (
    result.unresolved.length ||
    result.nextCursor ||
    result.matches.length > 1 ||
    result.request.status === "paid_multiple"
  ) {
    await sql.query(
      "UPDATE agus_crypto_request_records SET observation='needs_review' WHERE owner=$1 AND id=$2",
      [owner, row.id],
    );
    return;
  }
  const match = result.matches[0];
  if (!match || result.request.status !== "paid") return;
  const chain = await cryptoRpc(
    "devnet",
    Boolean(process.env.AGUS_DEVNET_VERIFY_RPC),
  );
  const [statuses, transaction, parsed] = await Promise.all([
    chain.getSignatureStatuses([match.signature], {
      searchTransactionHistory: true,
    }),
    chain.getTransaction(match.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    }),
    chain.getParsedTransaction(match.signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    }),
  ]);
  const item = result.request,
    signature = match.signature;
  inspectRequestPayment(
    {
      reference: String(item.reference),
      recipient: String(item.recipient),
      asset: item.asset === "SOL" ? "SOL" : "SPL",
      mint: item.mint ? String(item.mint) : null,
      amountAtoms: String(item.amountAtoms),
      scale: Number(item.scale),
    },
    signature,
    { genesisHash: DEVNET_GENESIS, status: statuses.value[0], transaction },
  );
  invariant(
    parsed && transaction?.meta && parsed.slot === transaction.slot,
    "REQUEST_FINALITY_PENDING",
    409,
  );
  const normalized = normalizeTransaction("devnet", signature, parsed);
  invariant(
    normalized && normalized.status === "success",
    "REQUEST_FINALITY_PENDING",
    409,
  );
  const wallets = await listWallets(owner, { cluster: "devnet" }, true);
  const event = attributeEvent(normalized, wallets);
  const id = row.receipt_id ?? randomUUID();
  const receipt = C.CryptoReceipt.parse({
    id,
    attemptId: null,
    requestId: row.id,
    source: event.source,
    signature,
    messageDigest: createHash("sha256")
      .update(transaction.transaction.message.serialize())
      .digest("hex"),
    walletIds: [row.wallet_id],
    slot: event.slot,
    time: event.blockTime,
    verifiedAt: new Date().toISOString(),
    finality: "finalized",
    execution: "success",
    feeLamports: safeLamports(transaction.meta.fee).toString(),
    legs: event.legs,
    eventId: event.id,
    explorerUrl: event.explorerUrl,
  });
  await store(async (tx) => {
    const updated = await tx.query(
      `UPDATE agus_crypto_request_records c SET observation='settled',receipt_id=$3,receipt=$4::jsonb
       WHERE c.owner=$1 AND c.id=$2 AND (c.receipt_id IS NULL OR c.receipt_id=$3) AND
       EXISTS(SELECT 1 FROM agus_payment_requests r WHERE r.owner=c.owner AND r.id=c.id
         AND r.status='paid' AND r.settlement_signature=$5) RETURNING id`,
      [owner, row.id, id, JSON.stringify(receipt), signature],
    );
    if (!updated.rows.length) return;
    await tx.query(
      `INSERT INTO agus_crypto_chain_events(cluster,signature,slot,block_time,event)
      VALUES('devnet',$1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
      [signature, event.slot, event.blockTime, JSON.stringify(normalized)],
    );
    await tx.query(
      `INSERT INTO agus_crypto_wallet_events(owner,wallet_id,cluster,signature)
      VALUES($1,$2,'devnet',$3) ON CONFLICT DO NOTHING`,
      [owner, row.wallet_id, signature],
    );
  });
}

export async function runCryptoRequests() {
  if (!cryptoRequestsReady()) return;
  const rows = (
    await (
      await database()
    ).query<RecordRow & { owner: string }>(
      `WITH due AS (
      SELECT c.owner,c.id FROM agus_crypto_request_records c JOIN agus_payment_requests r ON r.owner=c.owner AND r.id=c.id
      WHERE r.status IN ('open','paid','paid_multiple') AND
        (r.expires_at>now() OR (r.status='paid' AND c.receipt_id IS NULL)) AND
        (c.checked_at IS NULL OR c.checked_at<now()-interval '30 seconds')
      ORDER BY c.checked_at NULLS FIRST,c.id LIMIT 3 FOR UPDATE OF c SKIP LOCKED
    )
    UPDATE agus_crypto_request_records c SET checked_at=now() FROM due
    WHERE c.owner=due.owner AND c.id=due.id RETURNING c.*`,
    )
  ).rows;
  for (const row of rows) {
    try {
      await discover(row.owner, row);
    } catch {
      operationalEvent("crypto.request_sync_failed", {
        code: "REQUEST_DISCOVERY_UNAVAILABLE",
      });
    }
  }
}
