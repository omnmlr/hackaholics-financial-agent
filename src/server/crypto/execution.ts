import { createHash, randomUUID } from "node:crypto";
import {
  Keypair,
  PublicKey,
  Transaction,
  type Connection,
  type Message,
  type VersionedMessage,
} from "@solana/web3.js";
import { z } from "zod";
import * as C from "../../../packages/contracts/src/crypto";
import { TOKEN_PROGRAM_ID } from "../../lib/solana/classic-spl";
import { atomsToDecimal, MAX_U64, safeLamports } from "../../lib/solana/money";
import { service } from "../../lib/solana";
import { DEVNET_GENESIS } from "../../lib/solana/contracts";
import { consumeStepUp, instructionHash } from "../approvals";
import type { Principal } from "../auth";
import { invariant } from "../errors";
import { idempotencyKey } from "../idempotency";
import { inspectRequestPayment } from "../request-chain";
import { operationalEvent } from "../observability";
import { database, transaction, type Sql } from "../sql";
import {
  attributeEvent,
  normalizeTransaction,
  type ChainEvent,
} from "./ledger";
import { assetSymbol, portfolio, type Amount } from "./portfolio";
import {
  cryptoMutation,
  listWallets,
  readSource,
  approvedCryptoProviders,
  type Scope,
} from "./registry";
import { cryptoRpc } from "./rpc";
import { findCryptoRequestReceipt } from "./requests";

type Review = z.infer<typeof C.CryptoReview>;
type Attempt = z.infer<typeof C.CryptoAttempt>;
type AttemptRow = {
  id: string;
  review_id: string;
  state: Attempt["state"];
  signature: string | null;
  receipt_id: string | null;
  reason: string | null;
  created_at: Date;
  updated_at: Date;
  review: Review;
};
const walletUnavailable = new Set([
  "WALLET_NOT_INSTALLED",
  "WALLET_POWER_RESTRICTION",
  "WALLET_ATTESTATION_REQUIRED",
  "WALLET_RECONNECT_REQUIRED",
  "UNSUPPORTED_SIGNER_CAPABILITY",
  "EXACT_FRESH_REVIEW_REQUIRED",
  "REVIEW_MESSAGE_MISMATCH",
  "WALLET_ACCOUNT_CHANGED",
  "WALLET_ACTIVITY_UNAVAILABLE",
  "WALLET_ASSOCIATION_TIMEOUT",
  "WALLET_ASSOCIATION_CANCELLED",
  "WALLET_PAYLOAD_REJECTED",
  "WALLET_SUBMISSION_UNCERTAIN",
  "WALLET_TRANSPORT_LOST",
  "WALLET_SIGNATURE_UNAVAILABLE",
]);
const terminal: Attempt["state"][] = [
  "declined",
  "failed",
  "expired",
  "finalized",
];
const MAX_EXPIRY_TRANSACTIONS = 12;

function view(row: AttemptRow) {
  return C.CryptoAttempt.parse({
    id: row.id,
    reviewId: row.review_id,
    state: row.state,
    revision: row.review.revision,
    reviewDigest: row.review.reviewDigest,
    cluster: row.review.cluster,
    routeId: row.review.routeId,
    expectedSigner: row.review.expectedSigner,
    reference: row.review.reference,
    signature: row.signature,
    reason: row.reason,
    receiptId: row.receipt_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  });
}
async function audit(
  sql: Sql,
  owner: string,
  id: string,
  action: string,
  details: Record<string, unknown>,
) {
  await sql.query(
    "INSERT INTO agus_audit(id,owner,resource_type,resource_id,action,details) VALUES($1,$2,'crypto_attempt',$3,$4,$5::jsonb)",
    [randomUUID(), owner, id, action, JSON.stringify(details)],
  );
}
async function rowFor(sql: Sql, owner: string, id: string, lock = false) {
  const row = (
    await sql.query<AttemptRow>(
      `SELECT a.*,r.review FROM agus_crypto_attempts a JOIN agus_crypto_reviews r ON r.owner=a.owner AND r.id=a.review_id
     WHERE a.owner=$1 AND a.id=$2${lock ? " FOR UPDATE OF a" : ""}`,
      [owner, id],
    )
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  return row;
}
async function routeFor(
  sql: Sql,
  owner: string,
  walletId: string,
  routeId: string,
  cluster: Scope["cluster"],
  lock = false,
) {
  const row = (
    await sql.query<{
      address: string;
      verified_at: Date | null;
      provider: z.infer<typeof C.CryptoProvider> | null;
    }>(
      `SELECT w.address,w.verified_at,r.provider FROM agus_crypto_wallets w
       LEFT JOIN agus_crypto_routes r ON r.owner=w.owner AND r.wallet_id=w.id AND r.id=$3 AND r.revoked_at IS NULL
       WHERE w.owner=$1 AND w.id=$2 AND w.cluster=$4${lock ? " FOR UPDATE OF w" : ""}`,
      [owner, walletId, routeId, cluster],
    )
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  invariant(row.verified_at, "WATCH_ONLY", 403);
  invariant(
    row.provider && approvedCryptoProviders(cluster).includes(row.provider),
    "INELIGIBLE_ROUTE",
    422,
  );
  if (lock) {
    const active = (
      await sql.query(
        "SELECT id FROM agus_crypto_routes WHERE owner=$1 AND id=$2 AND wallet_id=$3 AND revoked_at IS NULL FOR UPDATE",
        [owner, routeId, walletId],
      )
    ).rows[0];
    invariant(active, "ROUTE_CHANGED");
  }
  return row.address;
}

function checkAmount(amount: Amount) {
  invariant(
    BigInt(amount.atoms) > 0n && BigInt(amount.atoms) <= MAX_U64,
    "INVALID_AMOUNT",
    400,
  );
  invariant(
    amount.asset.kind === "sol"
      ? amount.decimals === 9
      : amount.asset.program === TOKEN_PROGRAM_ID.toBase58() &&
          assetSymbol(amount) === "USDC",
    "UNSUPPORTED_ASSET",
    422,
  );
}

export function prepareCrypto(
  p: Principal,
  intent: z.infer<typeof C.CryptoIntent>,
  key: string,
) {
  invariant(
    intent.kind === "transfer" && intent.amount.asset.cluster === "devnet",
    "FEATURE_DISABLED",
    503,
  );
  invariant(!intent.requestId, "FEATURE_DISABLED", 503);
  checkAmount(intent.amount);
  return cryptoMutation(p.id, "transfer.review", key, intent, async (sql) => {
    const cluster = "devnet" as const;
    const sender = await routeFor(
      sql,
      p.id,
      intent.sourceWalletId,
      intent.routeId,
      cluster,
    );
    const { asset, atoms, decimals } = intent.amount;
    const draft = await service().prepare(
      p.id,
      {
        sender,
        recipient: intent.recipient,
        asset: asset.kind === "sol" ? "SOL" : "SPL",
        amount: atomsToDecimal(BigInt(atoms), decimals),
        ...(asset.kind === "token" && { mint: asset.mint }),
        reference: Keypair.generate().publicKey.toBase58(),
      },
      undefined,
      false,
    );
    invariant(
      draft.decimals === decimals &&
        draft.amountAtoms === atoms &&
        draft.simulation,
      "INVALID_AMOUNT",
      400,
    );
    const simulation = draft.simulation;
    const bound = {
      id: draft.id,
      revision: 0,
      operation: "transfer",
      cluster,
      sourceWalletId: intent.sourceWalletId,
      routeId: intent.routeId,
      expectedSigner: sender,
      feePayer: sender,
      recipient: draft.recipient,
      sourceTokenAccount: draft.sourceTokenAccount,
      destinationTokenAccount: draft.recipientTokenAccount,
      amount: intent.amount,
      estimatedFeeLamports: draft.feeLamports,
      estimatedRentLamports: draft.estimatedRentLamports,
      quote: null,
      expiresAt: draft.expiresAt,
      blockhash: draft.blockhash,
      lastValidBlockHeight: draft.lastValidBlockHeight,
      reference: draft.reference,
      minContextSlot: simulation.slot,
      messageDigest: draft.messageDigest,
      transactionVersion: "legacy",
      unsignedTransactionBase64: draft.unsignedTransactionBase64,
      simulation: {
        passed: simulation.passed,
        slot: simulation.slot,
        observedAt: simulation.at,
      },
      source: readSource(cluster, simulation.slot, simulation.at),
    };
    const review = C.CryptoReview.parse({
      ...bound,
      reviewDigest: instructionHash({
        owner: p.id,
        genesis: draft.genesisHash,
        review: bound,
      }),
    });
    const fingerprint = instructionHash({
      cluster,
      sender,
      recipient: draft.recipient,
      amount: intent.amount,
    });
    await sql.query(
      "INSERT INTO agus_crypto_reviews(owner,id,wallet_id,fingerprint,review) VALUES($1,$2,$3,$4,$5::jsonb)",
      [
        p.id,
        review.id,
        review.sourceWalletId,
        fingerprint,
        JSON.stringify(review),
      ],
    );
    return review;
  });
}

export async function beginCrypto(
  p: Principal,
  reviewId: string,
  input: z.infer<typeof C.CryptoBegin>,
  key: string,
) {
  const attempt = await cryptoMutation(
    p.id,
    "transfer.begin",
    key,
    { reviewId, ...input },
    async (sql) => {
      const record = (
        await sql.query<{ review: Review; fingerprint: string }>(
          "SELECT review,fingerprint FROM agus_crypto_reviews WHERE owner=$1 AND id=$2 FOR UPDATE",
          [p.id, reviewId],
        )
      ).rows[0];
      invariant(record, "NOT_FOUND", 404);
      const { review } = record;
      invariant(
        review.reviewDigest === input.reviewDigest &&
          review.revision === input.revision,
        "REVISION_CHANGED",
      );
      const previous = (
        await sql.query<{ id: string }>(
          "SELECT id FROM agus_crypto_attempts WHERE owner=$1 AND review_id=$2",
          [p.id, reviewId],
        )
      ).rows[0];
      if (previous) return view(await rowFor(sql, p.id, previous.id));
      invariant(
        Date.parse(review.expiresAt) > Date.now(),
        "REVIEW_EXPIRED",
        410,
      );
      await routeFor(
        sql,
        p.id,
        review.sourceWalletId,
        review.routeId,
        review.cluster,
        true,
      );
      if (
        process.env.AGUS_CRYPTO_REQUIRE_STEP_UP === "true" ||
        input.challengeId
      ) {
        invariant(input.challengeId, "APPROVAL_REQUIRED", 403);
        await consumeStepUp(
          sql,
          p,
          input.challengeId,
          "crypto.transfer",
          review.reviewDigest,
        );
      }
      const id = randomUUID();
      const result = await sql.query(
        `INSERT INTO agus_crypto_attempts(owner,id,review_id,fingerprint,state) VALUES($1,$2,$3,$4,'ready')
       ON CONFLICT DO NOTHING RETURNING id`,
        [p.id, id, reviewId, record.fingerprint],
      );
      invariant(result.rows.length, "ATTEMPT_IN_PROGRESS");
      await audit(sql, p.id, id, "crypto.approved", {
        reviewId,
        digest: review.reviewDigest,
        routeId: review.routeId,
      });
      return view(await rowFor(sql, p.id, id));
    },
  );
  return getAttempt(p.id, attempt.id);
}

export async function handoffCrypto(
  p: Principal,
  id: string,
  request: Request,
) {
  const key = idempotencyKey(request);
  const result = await cryptoMutation(
    p.id,
    "transfer.handoff",
    key,
    { id },
    async (sql) => {
      const row = await rowFor(sql, p.id, id, true);
      if (row.state !== "ready") return { id, granted: false };
      const { review } = row;
      invariant(
        Date.parse(review.expiresAt) > Date.now(),
        "REVIEW_EXPIRED",
        410,
      );
      await routeFor(
        sql,
        p.id,
        review.sourceWalletId,
        review.routeId,
        review.cluster,
        true,
      );
      await sql.query(
        "UPDATE agus_crypto_attempts SET state='handoff',updated_at=now() WHERE owner=$1 AND id=$2",
        [p.id, id],
      );
      await audit(sql, p.id, id, "crypto.handoff", {
        digest: review.reviewDigest,
      });
      return { id, granted: true };
    },
    (replay) => ({ ...replay, granted: false }),
  );
  return C.CryptoHandoff.parse({
    attempt: await getAttempt(p.id, id),
    launchGranted: result.granted,
  });
}

export function reportWalletOutcome(
  p: Principal,
  id: string,
  outcome: z.infer<typeof C.CryptoWalletOutcome>,
  key: string,
) {
  invariant(outcome.kind !== "signed", "INELIGIBLE_ROUTE", 422);
  return cryptoMutation(
    p.id,
    "transfer.wallet_outcome",
    key,
    { id, outcome },
    async (sql) => {
      const row = await rowFor(sql, p.id, id, true);
      if (terminal.includes(row.state)) return view(row);
      invariant(row.state !== "ready", "APPROVAL_REQUIRED", 403);
      const reportedReason =
        "reason" in outcome &&
        outcome.reason &&
        walletUnavailable.has(outcome.reason)
          ? outcome.reason
          : null;
      if (row.signature) return view(row);
      if (row.state === "unknown" && outcome.kind !== "signature") {
        if (
          reportedReason &&
          [
            "CALLBACK_UNKNOWN",
            "AWAITING_FINALIZED_EVIDENCE",
            "PROVIDER_UNAVAILABLE",
          ].includes(row.reason ?? "")
        ) {
          await sql.query(
            "UPDATE agus_crypto_attempts SET reason=$3,updated_at=now() WHERE owner=$1 AND id=$2",
            [p.id, id, reportedReason],
          );
          await audit(sql, p.id, id, "crypto.wallet_diagnostic", {
            reason: reportedReason,
          });
          return view(await rowFor(sql, p.id, id));
        }
        return view(row);
      }
      // Vendor alerts can be ambiguous after opening the wallet. Only an explicit
      // decline can close the attempt without chain evidence.
      const next =
        outcome.kind === "signature"
          ? "pending"
          : outcome.kind === "declined"
            ? "declined"
            : "unknown";
      const reason =
        outcome.kind === "unavailable"
          ? walletUnavailable.has(outcome.reason)
            ? outcome.reason
            : "WALLET_UNAVAILABLE"
          : outcome.kind === "unknown"
            ? outcome.reason && walletUnavailable.has(outcome.reason)
              ? outcome.reason
              : "CALLBACK_UNKNOWN"
            : null;
      const sig = outcome.kind === "signature" ? outcome.signature : null;
      await sql.query(
        "UPDATE agus_crypto_attempts SET state=$3,reason=$4,signature=$5,updated_at=now() WHERE owner=$1 AND id=$2",
        [p.id, id, next, reason, sig],
      );
      await audit(sql, p.id, id, "crypto.wallet_outcome", {
        state: next,
        signature: sig,
      });
      return view(await rowFor(sql, p.id, id));
    },
  );
}

export async function getAttempt(owner: string, id: string) {
  return view(await rowFor(await database(), owner, id));
}

export async function listAttempts(
  owner: string,
  query: z.infer<typeof C.CryptoAttemptQuery>,
) {
  const wallets = await listWallets(owner, query, true);
  const cursor = query.cursor ? C.CryptoId.safeParse(query.cursor) : null;
  invariant(!cursor || cursor.success, "INVALID_CURSOR", 400);
  const rows = (
    await (
      await database()
    ).query<AttemptRow>(
      `SELECT a.*,r.review FROM agus_crypto_attempts a JOIN agus_crypto_reviews r ON r.owner=a.owner AND r.id=a.review_id
     WHERE a.owner=$1 AND r.wallet_id=ANY($2::uuid[])
       AND (NOT $3::boolean OR a.state IN ('ready','handoff','pending','unknown'))
       AND ($4::uuid IS NULL OR (a.created_at,a.id)<(SELECT created_at,id FROM agus_crypto_attempts WHERE owner=$1 AND id=$4))
     ORDER BY a.created_at DESC,a.id DESC LIMIT 26`,
      [
        owner,
        wallets.map((w) => w.id),
        query.unresolvedOnly ?? false,
        cursor?.data ?? null,
      ],
    )
  ).rows;
  return C.CryptoAttemptPage.parse({
    items: rows.slice(0, 25).map(view),
    nextCursor: rows.length > 25 ? rows[24].id : null,
    source: readSource(query.cluster),
  });
}

export async function receipt(owner: string, id: string) {
  const row = (
    await (
      await database()
    ).query(
      "SELECT receipt FROM agus_crypto_receipts WHERE owner=$1 AND id=$2",
      [owner, id],
    )
  ).rows[0];
  const value = row?.receipt ?? (await findCryptoRequestReceipt(owner, id));
  invariant(value, "NOT_FOUND", 404);
  return C.CryptoReceipt.parse(value);
}

async function expiryEvidence(chain: Connection, review: Review) {
  const boundary = Math.max(0, review.minContextSlot - 128);
  const [height, retained] = await Promise.all([
    chain.getBlockHeight("finalized"),
    chain.getFirstAvailableBlock(),
  ]);
  if (height <= review.lastValidBlockHeight || retained > boundary) return null;
  const source = await chain.getSignaturesForAddress(
    new PublicKey(review.expectedSigner),
    { limit: 50, minContextSlot: review.minContextSlot },
    "finalized",
  );
  if (!source.some((item) => item.slot < boundary)) return null;
  return source
    .filter((item) => item.slot >= boundary)
    .map(({ signature, slot }) => ({ signature, slot }))
    .sort((a, b) => a.signature.localeCompare(b.signature));
}

function transactionDigest(message: VersionedMessage) {
  return createHash("sha256").update(message.serialize()).digest("hex");
}

export async function reconcileCrypto(
  owner: string,
  id: string,
  read: typeof cryptoRpc = cryptoRpc,
) {
  const sql = await database();
  const initial = await rowFor(sql, owner, id);
  if (terminal.includes(initial.state)) return view(initial);
  const { review } = initial;
  if (
    initial.state === "handoff" &&
    Date.now() - initial.updated_at.getTime() < 30_000
  )
    return view(initial);
  await sql.query(
    "UPDATE agus_crypto_attempts SET checked_at=now() WHERE owner=$1 AND id=$2",
    [owner, id],
  );
  let state: Attempt["state"] = initial.state;
  let reason = initial.reason;
  let match: ChainEvent | null = null;
  let fee = "0";
  if (initial.state === "ready") {
    if (Date.parse(review.expiresAt) <= Date.now()) {
      state = "expired";
      reason = "REVIEW_EXPIRED";
    }
  } else {
    try {
      const chain = await read(
        review.cluster,
        Boolean(process.env.AGUS_DEVNET_VERIFY_RPC),
      );
      const known = initial.signature ? [initial.signature] : [];
      const reference = review.reference
        ? (
            await chain
              .getSignaturesForAddress(
                new PublicKey(review.reference),
                { limit: 10 },
                "finalized",
              )
              .catch(() => [])
          ).map((x) => x.signature)
        : [];
      let expiry: { primary: Connection; slots: Map<string, number> } | null =
        null;
      let primaryRefs: string[] = [];
      if (
        process.env.AGUS_DEVNET_VERIFY_RPC &&
        Date.parse(review.expiresAt) <= Date.now()
      ) {
        try {
          const primary = await read(review.cluster, false);
          const [primaryHistory, verifierHistory, refs] = await Promise.all([
            expiryEvidence(primary, review),
            expiryEvidence(chain, review),
            review.reference
              ? primary.getSignaturesForAddress(
                  new PublicKey(review.reference),
                  { limit: 10 },
                  "finalized",
                )
              : [],
          ]);
          primaryRefs = refs.map(({ signature }) => signature);
          if (
            primaryHistory &&
            verifierHistory &&
            verifierHistory.length <= MAX_EXPIRY_TRANSACTIONS &&
            instructionHash(primaryHistory) === instructionHash(verifierHistory)
          ) {
            expiry = {
              primary,
              slots: new Map(
                verifierHistory.map(({ signature, slot }) => [signature, slot]),
              ),
            };
          }
        } catch {
          // Continue looking for finalized settlement on the pinned verifier.
        }
      }
      const references = new Set([...reference, ...primaryRefs]);
      const check = [
        ...new Set([...known, ...references, ...(expiry?.slots.keys() ?? [])]),
      ];
      const unrelated = new Map<string, string>();
      let sawExactMessage = false;
      let missingReference = false;
      for (const sig of check) {
        const tx = await chain.getTransaction(sig, {
          commitment: "finalized",
          maxSupportedTransactionVersion: 0,
        });
        if (!tx || tx.transaction.signatures[0] !== sig) {
          if (references.has(sig)) missingReference = true;
          continue;
        }
        const message = tx.transaction.message;
        const digest = transactionDigest(message);
        if (digest !== review.messageDigest) {
          if (expiry?.slots.get(sig) === tx.slot) unrelated.set(sig, digest);
          continue;
        }
        sawExactMessage = true;
        if (
          !tx.meta ||
          (tx.version !== undefined && tx.version !== "legacy") ||
          message.staticAccountKeys[0]?.toBase58() !== review.expectedSigner ||
          message.header.numRequiredSignatures !== 1
        )
          continue;
        const [parsed, statuses] = await Promise.all([
          chain.getParsedTransaction(sig, {
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          }),
          chain.getSignatureStatuses([sig], { searchTransactionHistory: true }),
        ]);
        const status = statuses.value[0];
        if (
          !parsed?.meta ||
          parsed.slot !== tx.slot ||
          parsed.meta.fee !== tx.meta.fee ||
          status?.confirmationStatus !== "finalized" ||
          status.slot !== tx.slot ||
          instructionHash(status.err) !== instructionHash(tx.meta.err) ||
          instructionHash(parsed.meta.err) !== instructionHash(tx.meta.err) ||
          !Transaction.populate(
            message as Message,
            tx.transaction.signatures,
          ).verifySignatures(true)
        )
          continue;
        const event = normalizeTransaction(review.cluster, sig, parsed);
        if (!event) continue;
        if (event.status === "failed") {
          state = "failed";
          reason = "ON_CHAIN_FAILURE";
          match = event;
          break;
        }
        const amount = review.amount;
        if (!amount || !review.reference || !review.recipient) continue;
        try {
          inspectRequestPayment(
            {
              reference: review.reference,
              recipient: review.recipient,
              amountAtoms: amount.atoms,
              scale: amount.decimals,
              asset: amount.asset.kind === "sol" ? "SOL" : "SPL",
              mint: amount.asset.kind === "token" ? amount.asset.mint : null,
            },
            sig,
            { genesisHash: DEVNET_GENESIS, status, transaction: tx },
          );
        } catch {
          state = "unknown";
          reason = "SETTLEMENT_EFFECTS_UNVERIFIED";
          continue;
        }
        const expected = review.amount!;
        const leg = event.legs.find(
          (leg) =>
            leg.kind === "transfer" &&
            leg.amount &&
            instructionHash(leg.amount) === instructionHash(expected) &&
            leg.from === (review.sourceTokenAccount ?? review.expectedSigner) &&
            leg.to === (review.destinationTokenAccount ?? review.recipient) &&
            leg.fromOwner === review.expectedSigner &&
            leg.toOwner === review.recipient,
        );
        if (!leg) {
          state = "unknown";
          reason = "SETTLEMENT_EFFECTS_UNVERIFIED";
          continue;
        }
        fee = safeLamports(tx.meta.fee).toString();
        match = event;
        state = "finalized";
        reason = null;
        break;
      }
      let expiredWithCoverage = false;
      if (
        !match &&
        !sawExactMessage &&
        !missingReference &&
        expiry &&
        unrelated.size === expiry.slots.size
      ) {
        const signatures = [...expiry.slots.keys()];
        const primaryTransactions = signatures.length
          ? await expiry.primary.getTransactions(signatures, {
              commitment: "finalized",
              maxSupportedTransactionVersion: 0,
            })
          : [];
        expiredWithCoverage =
          primaryTransactions.length === signatures.length &&
          signatures.every((sig, index) => {
            const tx = primaryTransactions[index];
            return (
              tx &&
              tx.slot === expiry.slots.get(sig) &&
              tx.transaction.signatures[0] === sig &&
              transactionDigest(tx.transaction.message) === unrelated.get(sig)
            );
          });
      }
      if (!match && expiredWithCoverage) {
        state = "expired";
        reason = "BLOCKHASH_EXPIRED_WITH_MATCHED_HISTORY";
      } else if (
        !match &&
        (initial.state === "handoff" ||
          (initial.signature && Date.parse(review.expiresAt) <= Date.now()))
      ) {
        state = "unknown";
        reason ??= "AWAITING_FINALIZED_EVIDENCE";
      }
    } catch {
      if (initial.state === "handoff") {
        state = "unknown";
        reason = "PROVIDER_UNAVAILABLE";
      }
    }
  }
  const owned =
    match?.status === "success"
      ? await listWallets(owner, { cluster: review.cluster }, true)
      : [];
  return transaction(async (tx) => {
    const current = await rowFor(tx, owner, id, true);
    if (terminal.includes(current.state)) return view(current);
    if (
      !match &&
      (current.state !== initial.state ||
        current.signature !== initial.signature)
    )
      return view(current);
    let receiptId: string | null = null;
    if (match) {
      await tx.query(
        "INSERT INTO agus_crypto_chain_events(cluster,signature,slot,block_time,event) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING",
        [
          review.cluster,
          match.signature,
          match.slot,
          match.blockTime,
          JSON.stringify(match),
        ],
      );
      const event = attributeEvent(match, owned);
      const walletIds = [
        ...new Set([
          review.sourceWalletId,
          ...event.legs.flatMap((leg) =>
            leg.walletDeltas.map((delta) => delta.walletId),
          ),
        ]),
      ];
      await tx.query(
        "INSERT INTO agus_crypto_wallet_events(owner,wallet_id,cluster,signature) SELECT $1,unnest($2::uuid[]),$3,$4 ON CONFLICT DO NOTHING",
        [owner, walletIds, review.cluster, match.signature],
      );
      if (state === "finalized") {
        receiptId = randomUUID();
        const result = C.CryptoReceipt.parse({
          id: receiptId,
          attemptId: id,
          requestId: null,
          source: match.source,
          signature: match.signature,
          messageDigest: review.messageDigest,
          walletIds,
          slot: match.slot,
          time: match.blockTime,
          verifiedAt: new Date().toISOString(),
          finality: "finalized",
          execution: "success",
          feeLamports: fee,
          legs: event.legs,
          eventId: event.id,
          explorerUrl: match.explorerUrl,
        });
        const applied = await tx.query(
          "INSERT INTO agus_crypto_receipts(owner,id,attempt_id,cluster,signature,receipt) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING id",
          [
            owner,
            receiptId,
            id,
            review.cluster,
            match.signature,
            JSON.stringify(result),
          ],
        );
        invariant(applied.rows.length, "SETTLEMENT_ALREADY_LINKED");
      }
    }
    if (state !== current.state || reason !== current.reason || match) {
      await tx.query(
        "UPDATE agus_crypto_attempts SET state=$3,reason=$4,signature=COALESCE($5,signature),receipt_id=$6,updated_at=now() WHERE owner=$1 AND id=$2",
        [owner, id, state, reason, match?.signature ?? null, receiptId],
      );
      await audit(tx, owner, id, "crypto.reconciled", {
        state,
        reason,
        signature: match?.signature ?? current.signature,
      });
    }
    return view(await rowFor(tx, owner, id));
  });
}

export async function runCryptoReconciliation() {
  if (
    !process.env.AGUS_SOLANA_DEVNET_ENABLED ||
    process.env.AGUS_SOLANA_DEVNET_ENABLED !== "true"
  )
    return;
  const work = (
    await (
      await database()
    ).query<{ owner: string; id: string }>(
      `SELECT owner,id FROM agus_crypto_attempts WHERE state IN ('ready','handoff','pending','unknown')
       AND (checked_at IS NULL OR checked_at<now()-interval '25 seconds')
       ORDER BY checked_at NULLS FIRST,created_at LIMIT 12`,
    )
  ).rows;
  const results = await Promise.allSettled(
    work.map(({ owner, id }) => reconcileCrypto(owner, id)),
  );
  if (results.some((result) => result.status === "rejected"))
    operationalEvent("crypto.reconcile_failed", {
      code: "RECONCILIATION_FAILED",
    });
}

export async function walletEligibility(
  owner: string,
  input: z.infer<typeof C.CryptoEligibilityInput>,
) {
  checkAmount(input.amount);
  invariant(
    input.scope.cluster === input.amount.asset.cluster,
    "INVALID_AMOUNT",
    400,
  );
  const [wallets, snapshot] = await Promise.all([
    listWallets(owner, input.scope, true),
    portfolio(owner, input.scope),
  ]);
  const result = [];
  for (const wallet of wallets) {
    const relevant = snapshot.holdings.filter(
      (item) =>
        item.walletId === wallet.id &&
        item.spendable &&
        instructionHash(item.amount.asset) ===
          instructionHash(input.amount.asset) &&
        item.amount.decimals === input.amount.decimals,
    );
    const max = relevant.reduce(
      (a, b) => (a > BigInt(b.amount.atoms) ? a : BigInt(b.amount.atoms)),
      0n,
    );
    const routes = wallet.routes.filter(
      (route) =>
        route.operations.includes("transfer") && input.operation === "transfer",
    );
    for (const route of routes.length ? routes : [null]) {
      let reason = !route
        ? "INELIGIBLE_ROUTE"
        : !input.recipient
          ? "RECIPIENT_REQUIRED"
          : "REVIEW_REQUIRED";
      let feeLamports: string | null = null,
        rentLamports: string | null = null;
      const current = snapshot.coverage.some(
        (item) =>
          item.walletId === wallet.id &&
          item.kind === "balances" &&
          item.state === "ready",
      );
      if (!current) reason = "PROVIDER_UNAVAILABLE";
      if (route && current && input.recipient) {
        if (max < BigInt(input.amount.atoms)) reason = "INSUFFICIENT_FUNDS";
        else {
          try {
            const asset = input.amount.asset;
            const prepared = await service().prepare(
              owner,
              {
                sender: wallet.address,
                recipient: input.recipient,
                asset: asset.kind === "sol" ? "SOL" : "SPL",
                amount: atomsToDecimal(
                  BigInt(input.amount.atoms),
                  input.amount.decimals,
                ),
                ...(asset.kind === "token" && { mint: asset.mint }),
              },
              undefined,
              false,
            );
            if (prepared.decimals === input.amount.decimals) {
              reason = "";
              feeLamports = prepared.feeLamports;
              rentLamports = prepared.estimatedRentLamports;
            } else reason = "UNSUPPORTED_ASSET";
          } catch (error) {
            reason =
              (error as { code?: string }).code ?? "PROVIDER_UNAVAILABLE";
          }
        }
      }
      result.push({
        walletId: wallet.id,
        routeId: route?.id ?? null,
        amountAvailable: { ...input.amount, atoms: max.toString() },
        eligible: !reason,
        reason: reason || null,
        feeLamports,
        rentLamports,
      });
    }
  }
  return C.CryptoEligibility.parse({
    items: result,
    coverage: snapshot.coverage,
  });
}
