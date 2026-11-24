import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { PublicKey, type Connection } from "@solana/web3.js";
import { z } from "zod";
import * as C from "../../../packages/contracts/src/crypto";
import { DomainError, invariant } from "../errors";
import { operationalEvent } from "../observability";
import { database, transaction, type Sql } from "../sql";
import {
  attributeEvent,
  normalizeTransaction,
  tokenAccountsFor,
  type ChainEvent,
} from "./ledger";
import { syncWalletBalances } from "./portfolio";
import { listWallets, readSource, type Scope, type Wallet } from "./registry";
import { cryptoRpc } from "./rpc";

const DAY = 86_400_000;
const PAGE = 25;
const FEED_PAGE = 12;
type Coverage = z.infer<typeof C.CryptoCoverage>;
type WindowQuery = z.infer<typeof C.CryptoActivityQuery>;
type Feed = {
  address: string;
  head: string | null;
  candidate_head: string | null;
  continuation: string | null;
  observed_at: Date | null;
  slot: string | null;
};
type Cursor = {
  observed: string;
  from: string;
  to: string;
  slot: number;
  signature: string;
};
const CursorValue = z.strictObject({
  observed: C.CryptoUtc,
  from: C.CryptoUtc,
  to: C.CryptoUtc,
  slot: z.number().int().nonnegative(),
  signature: C.CryptoSignature,
});

function cursorMac(context: string, payload: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  invariant(
    secret && secret.length >= 32,
    "IDENTITY_CONFIGURATION_REQUIRED",
    503,
  );
  return createHmac("sha256", secret)
    .update(context)
    .update(".")
    .update(payload)
    .digest();
}

function encodeCursor(context: string, cursor: Cursor) {
  const payload = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  return `${payload}.${cursorMac(context, payload).toString("base64url")}`;
}

function decodeCursor(context: string, cursor: string) {
  try {
    const [payload, tag, extra] = cursor.split(".");
    const actual = Buffer.from(tag, "base64url");
    const expected = cursorMac(context, payload);
    invariant(
      !extra &&
        actual.length === expected.length &&
        timingSafeEqual(actual, expected),
      "INVALID_CURSOR",
      400,
    );
    return CursorValue.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString()),
    );
  } catch {
    throw new DomainError("INVALID_CURSOR", 400);
  }
}

async function rememberTokenAccounts(
  sql: Sql,
  owner: string,
  wallet: Wallet,
  addresses: Set<string>,
) {
  addresses.delete(wallet.address);
  if (!addresses.size) return;
  await sql.query(
    `INSERT INTO agus_crypto_token_accounts(owner,wallet_id,address)
     SELECT $1,$2,unnest($3::text[]) ON CONFLICT DO NOTHING`,
    [owner, wallet.id, [...addresses].sort((a, b) => a.localeCompare(b))],
  );
}

async function scanFeed(
  owner: string,
  wallet: Wallet,
  chain: Connection,
  feed: Feed,
  cutoff: number,
) {
  const entries = await chain.getSignaturesForAddress(
    new PublicKey(feed.address),
    {
      limit: FEED_PAGE,
      ...(feed.continuation && { before: feed.continuation }),
    },
    "finalized",
  );
  const stop = entries.findIndex(
    (entry) =>
      entry.signature === feed.head ||
      (!feed.head &&
        entry.blockTime !== null &&
        entry.blockTime !== undefined &&
        entry.blockTime * 1000 < cutoff),
  );
  const selected = stop < 0 ? entries : entries.slice(0, stop);
  const head = feed.candidate_head ?? selected[0]?.signature ?? feed.head;
  const next =
    stop < 0 && entries.length === FEED_PAGE
      ? (selected.at(-1)?.signature ?? null)
      : null;
  const selectedSlots = new Map(
    selected.map(({ signature, slot }) => [signature, slot]),
  );
  const keys = [...selectedSlots.keys()];
  const reused = keys.length
    ? (
        await (
          await database()
        ).query<{ event: ChainEvent }>(
          "SELECT event FROM agus_crypto_chain_events WHERE cluster=$1 AND signature=ANY($2::text[])",
          [wallet.cluster, keys],
        )
      ).rows
    : [];
  const stored = new Map(reused.map(({ event }) => [event.signature, event]));
  const known = reused.flatMap(({ event }) =>
    event.slot === selectedSlots.get(event.signature) ? [event] : [],
  );
  const missing = keys.filter((key) => !stored.has(key));
  const fetched = missing.length
    ? await chain.getParsedTransactions(missing, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      })
    : [];
  const eventsBySignature = new Map<string, ChainEvent>();
  for (const tx of fetched) {
    const signature = tx?.transaction.signatures[0];
    if (!tx || !signature || tx.slot !== selectedSlots.get(signature)) continue;
    const event = normalizeTransaction(wallet.cluster, signature, tx);
    if (event) eventsBySignature.set(signature, event);
  }
  const events = [...eventsBySignature.values()];
  const complete = known.length + events.length === keys.length;
  await transaction(async (sql) => {
    for (const event of events) {
      await sql.query(
        `INSERT INTO agus_crypto_chain_events(cluster,signature,slot,block_time,event)
         VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING`,
        [
          wallet.cluster,
          event.signature,
          event.slot,
          event.blockTime,
          JSON.stringify(event),
        ],
      );
    }
    const observed: string[] = [];
    const discovered = new Set<string>();
    for (const event of [...known, ...events]) {
      const accounts = tokenAccountsFor(event, wallet.address);
      // An authority can change, so a historical token feed alone cannot
      // attribute every transaction on that account to the wallet.
      if (feed.address !== wallet.address && !accounts.has(feed.address))
        continue;
      observed.push(event.signature);
      for (const address of accounts) discovered.add(address);
    }
    if (observed.length) {
      await sql.query(
        `INSERT INTO agus_crypto_wallet_events(owner,wallet_id,cluster,signature)
         SELECT $1,$2,$3,unnest($4::text[]) ON CONFLICT DO NOTHING`,
        [owner, wallet.id, wallet.cluster, observed],
      );
    }
    await rememberTokenAccounts(sql, owner, wallet, discovered);
    if (complete) {
      await sql.query(
        `INSERT INTO agus_crypto_feeds(owner,wallet_id,address,head,candidate_head,continuation,observed_at,slot)
         VALUES($1,$2,$3,$4,$5,$6,now(),$7) ON CONFLICT(owner,wallet_id,address) DO UPDATE
         SET head=excluded.head,candidate_head=excluded.candidate_head,continuation=excluded.continuation,
             observed_at=excluded.observed_at,slot=GREATEST(agus_crypto_feeds.slot,excluded.slot)
         WHERE agus_crypto_feeds.head IS NOT DISTINCT FROM $8::text
           AND agus_crypto_feeds.continuation IS NOT DISTINCT FROM $9::text`,
        [
          owner,
          wallet.id,
          feed.address,
          next ? feed.head : head,
          next ? head : null,
          next,
          entries[0]?.slot ?? feed.slot,
          feed.head,
          feed.continuation,
        ],
      );
    }
  });
  return { complete, slot: entries[0]?.slot ?? null, backlog: !!next };
}

export async function syncWalletActivity(
  owner: string,
  wallet: Wallet,
  read: typeof cryptoRpc = cryptoRpc,
) {
  const sql = await database();
  const claimId = randomUUID();
  const claim = (
    await sql.query(
      `INSERT INTO agus_crypto_scan_status(owner,wallet_id,claim_id,claimed_until) VALUES($1,$2,$3,now()+interval '25 seconds')
     ON CONFLICT (owner,wallet_id) DO UPDATE SET claim_id=excluded.claim_id,claimed_until=excluded.claimed_until
     WHERE agus_crypto_scan_status.claimed_until<=now() AND
       (agus_crypto_scan_status.checked_at IS NULL OR agus_crypto_scan_status.checked_at<now()-interval '25 seconds')
     RETURNING claim_id`,
      [owner, wallet.id, claimId],
    )
  ).rows[0];
  if (!claim) return;
  let coverage: Coverage = {
    walletId: wallet.id,
    kind: "activity",
    state: "unavailable",
    reason: "provider_failure",
    observedAt: null,
    coveredWindow: null,
    throughSlot: null,
  };
  try {
    const chain = await read(wallet.cluster);
    await syncWalletBalances(owner, wallet, async () => chain);
    // Seed history for existing wallets whose owner feed already passed
    // these transactions before token discovery was part of the scanner.
    const legacy = (
      await sql.query<{ event: ChainEvent }>(
        `SELECT e.event FROM agus_crypto_wallet_events w
         JOIN agus_crypto_chain_events e ON e.cluster=w.cluster AND e.signature=w.signature
         WHERE w.owner=$1 AND w.wallet_id=$2 AND NOT (e.event ? 'tokenAccounts')
           AND (e.block_time IS NULL OR e.block_time>=now()-interval '7 days')
         ORDER BY e.slot DESC LIMIT 25`,
        [owner, wallet.id],
      )
    ).rows;
    await rememberTokenAccounts(
      sql,
      owner,
      wallet,
      new Set(
        legacy.flatMap(({ event }) => [
          ...tokenAccountsFor(event, wallet.address),
        ]),
      ),
    );
    const feeds = (
      await sql.query<Feed>(
        `SELECT a.address,f.head,f.candidate_head,f.continuation,f.observed_at,f.slot FROM (
         SELECT $3::text AS address UNION SELECT address FROM agus_crypto_token_accounts WHERE owner=$1 AND wallet_id=$2
       ) a LEFT JOIN agus_crypto_feeds f ON f.owner=$1 AND f.wallet_id=$2 AND f.address=a.address
       ORDER BY f.observed_at NULLS FIRST, a.address LIMIT 3`,
        [owner, wallet.id, wallet.address],
      )
    ).rows;
    const results = await Promise.allSettled(
      feeds.map((feed) =>
        scanFeed(owner, wallet, chain, feed, Date.now() - 7 * DAY),
      ),
    );
    const good = results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    const slots = good.flatMap(({ slot }) => (slot === null ? [] : [slot]));
    coverage = {
      ...coverage,
      state: good.length ? "partial" : "unavailable",
      reason:
        good.length !== feeds.length
          ? "provider_failure"
          : good.some((item) => !item.complete)
            ? "pruned"
            : good.some((item) => item.backlog)
              ? "bounded_window"
              : "missing_token_accounts",
      observedAt: good.length ? new Date().toISOString() : null,
      throughSlot: slots.length ? Math.min(...slots) : null,
    };
  } catch (error) {
    operationalEvent("crypto.activity_sync_failed", {
      code: error instanceof DomainError ? error.code : "PROVIDER_UNAVAILABLE",
    });
  }
  if (coverage.state === "unavailable") {
    const previous = (
      await sql.query<{ coverage: Coverage | null }>(
        "SELECT coverage FROM agus_crypto_scan_status WHERE owner=$1 AND wallet_id=$2",
        [owner, wallet.id],
      )
    ).rows[0]?.coverage;
    if (previous?.observedAt)
      coverage = { ...previous, state: "stale", reason: "provider_failure" };
  }
  await sql.query(
    `UPDATE agus_crypto_scan_status SET checked_at=now(),claimed_until=now(),coverage=$3::jsonb
     WHERE owner=$1 AND wallet_id=$2 AND claim_id=$4`,
    [owner, wallet.id, JSON.stringify(coverage), claimId],
  );
}

async function syncScopedWallets(owner: string, scope: Scope) {
  const [wallets, owned] = await Promise.all([
    listWallets(owner, scope, true),
    listWallets(owner, { cluster: scope.cluster }, true),
  ]);
  const timeout = AbortSignal.timeout(4200);
  await Promise.race([
    Promise.all(wallets.map((wallet) => syncWalletActivity(owner, wallet))),
    new Promise<void>((resolve) =>
      timeout.addEventListener("abort", () => resolve(), { once: true }),
    ),
  ]);
  return { wallets, owned };
}

async function activityCoverage(owner: string, wallets: Wallet[]) {
  const rows = (
    await (
      await database()
    ).query<{ wallet_id: string; coverage: Coverage | null }>(
      "SELECT wallet_id,coverage FROM agus_crypto_scan_status WHERE owner=$1 AND wallet_id=ANY($2::uuid[])",
      [owner, wallets.map(({ id }) => id)],
    )
  ).rows;
  return wallets.map(({ id }) => {
    const entry = rows.find((row) => row.wallet_id === id)?.coverage;
    if (!entry)
      return {
        walletId: id,
        kind: "activity",
        state: "unavailable",
        reason: "provider_failure",
        observedAt: null,
        coveredWindow: null,
        throughSlot: null,
      } as const;
    if (entry.observedAt && Date.now() - Date.parse(entry.observedAt) > 120_000)
      return { ...entry, state: "stale" as const, reason: "rpc_lag" as const };
    return entry;
  });
}

export async function activity(owner: string, input: WindowQuery) {
  const { cluster, walletIds, from, to, cursor } = input;
  invariant(
    !from || !to || Date.parse(from) < Date.parse(to),
    "INVALID_INPUT",
    400,
  );
  const context = JSON.stringify([
    owner,
    cluster,
    [...new Set(walletIds ?? [])].sort(),
    from ?? null,
    to ?? null,
  ]);
  const previous = cursor ? decodeCursor(context, cursor) : null;
  const { wallets, owned } = await syncScopedWallets(owner, input);
  const cutoff = Math.max(
    Date.parse(previous?.observed ?? new Date().toISOString()) - 7 * DAY,
    from ? Date.parse(from) : 0,
  );
  const start = previous?.from ?? new Date(cutoff).toISOString();
  const finish = previous?.to ?? to ?? new Date().toISOString();
  const sql = await database();
  const observed =
    previous?.observed ??
    (
      await sql.query<{ observed: string }>(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed`,
      )
    ).rows[0].observed;
  const result = (
    await (
      await database()
    ).query<{ event: ChainEvent }>(
      `SELECT e.event FROM agus_crypto_chain_events e WHERE e.cluster=$2 AND
       EXISTS (SELECT 1 FROM agus_crypto_wallet_events w WHERE w.owner=$1 AND w.cluster=e.cluster AND
         w.signature=e.signature AND w.wallet_id=ANY($3::uuid[]) AND w.observed_at <= $6) AND
       (e.block_time >= $4::timestamptz AND e.block_time < $5::timestamptz OR
        (e.block_time IS NULL AND $9::boolean)) AND
       ($7::bigint IS NULL OR (e.slot,e.signature)<($7::bigint,$8::text))
     ORDER BY e.slot DESC,e.signature DESC LIMIT 26`,
      [
        owner,
        cluster,
        wallets.map((w) => w.id),
        start,
        finish,
        observed,
        previous?.slot ?? null,
        previous?.signature ?? null,
        !from && !to,
      ],
    )
  ).rows.map(({ event }) => attributeEvent(event, owned));
  const items = result.slice(0, PAGE);
  const last = items.at(-1);
  const coverage = await activityCoverage(owner, wallets);
  return C.CryptoActivityPage.parse({
    items,
    source: readSource(cluster),
    nextCursor:
      result.length > PAGE && last
        ? encodeCursor(context, {
            observed,
            from: start,
            to: finish,
            slot: last.slot,
            signature: last.signature,
          })
        : null,
    coverage,
  });
}

export async function activityEvent(owner: string, scope: Scope, id: string) {
  const prefix = `${scope.cluster}:`;
  invariant(id.startsWith(prefix), "NOT_FOUND", 404);
  const signature = C.CryptoSignature.safeParse(id.slice(prefix.length));
  invariant(signature.success, "NOT_FOUND", 404);
  const [wallets, owned] = await Promise.all([
    listWallets(owner, scope, true),
    listWallets(owner, { cluster: scope.cluster }, true),
  ]);
  const row = (
    await (
      await database()
    ).query<{ event: ChainEvent }>(
      `SELECT e.event FROM agus_crypto_chain_events e WHERE e.cluster=$2 AND e.signature=$4 AND EXISTS (
      SELECT 1 FROM agus_crypto_wallet_events w WHERE w.owner=$1 AND w.cluster=e.cluster AND
        w.signature=e.signature AND w.wallet_id=ANY($3::uuid[])
    )`,
      [owner, scope.cluster, wallets.map((w) => w.id), signature.data],
    )
  ).rows[0];
  invariant(row, "NOT_FOUND", 404);
  return attributeEvent(row.event, owned);
}
