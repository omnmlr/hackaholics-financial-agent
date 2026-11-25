import { PublicKey, SystemProgram, type Connection } from "@solana/web3.js";
import type { z } from "zod";
import * as C from "../../../packages/contracts/src/crypto";
import { TOKEN_PROGRAM_ID } from "../../lib/solana/classic-spl";
import { MAX_U64, safeLamports } from "../../lib/solana/money";
import { instructionHash } from "../approvals";
import { operationalEvent } from "../observability";
import { database, transaction } from "../sql";
import { priceHoldings } from "./prices";
import { cryptoRpc, SOLANA_NETWORKS } from "./rpc";
import {
  listWallets,
  readSource,
  type Cluster,
  type Scope,
  type Wallet,
} from "./registry";

export type Amount = z.infer<typeof C.CryptoAmount>;
type Holding = z.infer<typeof C.CryptoHolding>;
type Coverage = z.infer<typeof C.CryptoCoverage>;
type Kind = "sol" | "token";
type Balance = {
  kind: Kind;
  holdings: Holding[];
  slot: number;
  observedAt: string;
  partial: boolean;
  chainEligibility?: true;
};

const TTL = 120_000;
const TOKEN_PROGRAM = TOKEN_PROGRAM_ID.toBase58();
export const sol = (cluster: Cluster, atoms: bigint): Amount => ({
  asset: { cluster, kind: "sol" },
  atoms: atoms.toString(),
  decimals: 9,
});
export const token = (
  cluster: Cluster,
  mint: string,
  atoms: string,
  decimals: number,
): Amount => ({
  asset: { cluster, kind: "token", program: TOKEN_PROGRAM, mint },
  atoms,
  decimals,
});

export function assetSymbol(amount: Amount): string | null {
  if (amount.asset.kind === "sol") return "SOL";
  return amount.asset.program === TOKEN_PROGRAM &&
    amount.asset.mint === SOLANA_NETWORKS[amount.asset.cluster].usdc &&
    amount.decimals === 6
    ? "USDC"
    : null;
}

export function assetKey(amount: Amount) {
  const { asset } = amount;
  return asset.kind === "sol"
    ? `${asset.cluster}:sol`
    : `${asset.cluster}:${asset.program}:${asset.mint}`;
}

async function pull(
  wallet: Wallet,
  chain: Connection,
  kind: Kind,
): Promise<Balance> {
  const address = new PublicKey(wallet.address);
  const observedAt = new Date().toISOString();
  if (kind === "sol") {
    const data = await chain.getAccountInfoAndContext(address, "finalized");
    const amount = sol(wallet.cluster, safeLamports(data.value?.lamports ?? 0));
    return {
      kind,
      slot: data.context.slot,
      observedAt,
      partial: false,
      chainEligibility: true,
      holdings: [
        {
          walletId: wallet.id,
          tokenAccount: null,
          amount,
          symbol: "SOL",
          valuation: null,
          spendable:
            !!data.value?.owner.equals(SystemProgram.programId) &&
            data.value.data.length === 0,
        },
      ],
    };
  }
  const data = await chain.getParsedTokenAccountsByOwner(
    address,
    { programId: TOKEN_PROGRAM_ID },
    "finalized",
  );
  const accounts = new Map<string, Holding>();
  let partial = false;
  for (const item of data.value) {
    const pubkey = item.pubkey.toBase58();
    const payload = item.account.data;
    const info = "parsed" in payload ? payload.parsed.info : null;
    if (
      !item.account.owner.equals(TOKEN_PROGRAM_ID) ||
      !info ||
      info.owner !== wallet.address ||
      !C.CryptoAddress.safeParse(info.mint).success ||
      !C.CryptoAtoms.safeParse(info.tokenAmount?.amount).success ||
      BigInt(info.tokenAmount.amount) > MAX_U64 ||
      !Number.isInteger(info.tokenAmount.decimals) ||
      info.tokenAmount.decimals < 0 ||
      info.tokenAmount.decimals > 255 ||
      !["initialized", "frozen"].includes(info.state)
    ) {
      partial = true;
      continue;
    }
    const amount = token(
      wallet.cluster,
      info.mint,
      info.tokenAmount.amount,
      info.tokenAmount.decimals,
    );
    const symbol = assetSymbol(amount);
    accounts.set(pubkey, {
      walletId: wallet.id,
      tokenAccount: pubkey,
      amount,
      symbol,
      valuation: null,
      spendable: info.state === "initialized" && symbol === "USDC",
    });
  }
  return {
    kind,
    slot: data.context.slot,
    observedAt,
    partial,
    chainEligibility: true,
    holdings: [...accounts.values()].sort((a, b) =>
      a.tokenAccount!.localeCompare(b.tokenAccount!),
    ),
  };
}

async function cached(owner: string, wallet: Wallet): Promise<Balance[]> {
  return (
    await (
      await database()
    ).query<{ value: Balance }>(
      "SELECT value FROM agus_crypto_balances WHERE owner=$1 AND wallet_id=$2",
      [owner, wallet.id],
    )
  ).rows.map(({ value }) => value);
}

export async function syncWalletBalances(
  owner: string,
  wallet: Wallet,
  read: typeof cryptoRpc = cryptoRpc,
) {
  const existing = await cached(owner, wallet);
  const parts = (["sol", "token"] as const).filter(
    (kind) =>
      !existing.some(
        (record) =>
          record.kind === kind &&
          record.chainEligibility &&
          Date.now() - Date.parse(record.observedAt) < TTL,
      ),
  );
  if (!parts.length) return existing;

  const collected = await Promise.allSettled(
    parts.map(async (kind) => pull(wallet, await read(wallet.cluster), kind)),
  );
  const values = collected.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  if (values.length !== parts.length) {
    operationalEvent("crypto.balance_partial", {
      code: "PROVIDER_FAILURE",
    });
    const mismatch = collected.find(
      (result) =>
        result.status === "rejected" &&
        result.reason?.code === "CHAIN_IDENTITY_MISMATCH",
    );
    if (mismatch?.status === "rejected" && !existing.length)
      throw mismatch.reason;
  }
  if (!values.length) return existing;
  await transaction(async (sql) => {
    for (const value of values) {
      await sql.query(
        `INSERT INTO agus_crypto_balances(owner,wallet_id,kind,observed_at,slot,value)
         VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(owner,wallet_id,kind) DO UPDATE
         SET observed_at=excluded.observed_at,slot=excluded.slot,value=excluded.value
         WHERE agus_crypto_balances.slot<=excluded.slot
           AND (agus_crypto_balances.slot<excluded.slot OR agus_crypto_balances.observed_at<=excluded.observed_at)
           AND (NOT (excluded.value->>'partial')::boolean OR (agus_crypto_balances.value->>'partial')::boolean)`,
        [
          owner,
          wallet.id,
          value.kind,
          value.observedAt,
          value.slot,
          JSON.stringify(value),
        ],
      );
      for (const item of value.holdings) {
        if (!item.tokenAccount) continue;
        await sql.query(
          "INSERT INTO agus_crypto_token_accounts(owner,wallet_id,address) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [owner, wallet.id, item.tokenAccount],
        );
      }
    }
  });
  return cached(owner, wallet);
}

function coverage(wallet: Wallet, values: Balance[]): Coverage[] {
  const observedAt = values.map((item) => item.observedAt).sort()[0] ?? null;
  const throughSlot = values.length
    ? Math.min(...values.map((item) => item.slot))
    : null;
  const stale =
    observedAt !== null && Date.now() - Date.parse(observedAt) >= TTL;
  const base = {
    walletId: wallet.id,
    observedAt,
    throughSlot,
    coveredWindow: null,
  };
  const partial = values.length !== 2 || values.some(({ partial }) => partial);
  return [
    {
      ...base,
      kind: "balances",
      state: !values.length
        ? "unavailable"
        : stale
          ? "stale"
          : partial
            ? "partial"
            : "ready",
      reason:
        stale || values.length !== 2
          ? "provider_failure"
          : partial
            ? "unsupported"
            : null,
    },
    { ...base, kind: "positions", state: "partial", reason: "unsupported" },
  ];
}

function priceCoverage(wallet: Wallet, holdings: Holding[]): Coverage {
  const items = holdings.filter(({ walletId }) => walletId === wallet.id);
  const priced = items.flatMap(({ valuation }) => valuation ?? []);
  const complete = priced.length > 0 && priced.length === items.length;
  const providerFailed =
    wallet.cluster === "mainnet-beta" &&
    items.some(({ symbol, valuation }) => symbol !== null && !valuation);
  return {
    walletId: wallet.id,
    kind: "prices",
    state: complete ? "ready" : priced.length ? "partial" : "unavailable",
    reason: complete ? null : providerFailed ? "provider_failure" : "unpriced",
    observedAt: priced.map(({ observedAt }) => observedAt).sort()[0] ?? null,
    throughSlot: null,
    coveredWindow: null,
  };
}

export async function portfolio(
  owner: string,
  scope: Scope,
  read: typeof cryptoRpc = cryptoRpc,
) {
  const wallets = await listWallets(owner, scope, true);
  const batches = await Promise.all(
    wallets.map(async (wallet) => {
      const sync = syncWalletBalances(owner, wallet, read);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const values = await Promise.race([
        sync,
        new Promise<Balance[]>((resolve, reject) => {
          timer = setTimeout(() => {
            // Suppress late post-timeout rejections from the losing RPC sync once fallback takes over.
            void sync.catch(() => undefined);
            void cached(owner, wallet).then(resolve, reject);
          }, 4300);
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
      return { wallet, values, coverage: coverage(wallet, values) };
    }),
  );
  const snapshots = batches.flatMap((b) => b.values);
  const observedAt = snapshots.map((b) => b.observedAt).sort()[0];
  const slot = snapshots.length
    ? Math.min(...snapshots.map((b) => b.slot))
    : null;
  const byAccount = new Map<
    string,
    { holding: Holding; slot: number; ambiguous: boolean }
  >();
  const disputed = new Set<string>();
  const signerWallets = new Set(
    wallets.flatMap((wallet) =>
      wallet.ownership === "verified" &&
      wallet.routes.some(
        (route) =>
          route.status === "available" && route.operations.includes("transfer"),
      )
        ? [wallet.id]
        : [],
    ),
  );
  for (const snapshot of snapshots) {
    for (const holding of snapshot.holdings) {
      const key = holding.tokenAccount ?? `sol:${holding.walletId}`;
      const prior = byAccount.get(key);
      if (prior && prior.holding.walletId !== holding.walletId) {
        disputed.add(prior.holding.walletId);
        disputed.add(holding.walletId);
      }
      if (!prior || snapshot.slot > prior.slot) {
        byAccount.set(key, { holding, slot: snapshot.slot, ambiguous: false });
      } else if (
        snapshot.slot === prior.slot &&
        prior.holding.walletId !== holding.walletId
      ) {
        prior.ambiguous = true;
      }
    }
  }
  const { holdings, quotes, subtotal } = await priceHoldings(
    [...byAccount.values()]
      .filter((item) => !item.ambiguous)
      .map(({ holding }) => ({
        ...holding,
        spendable: holding.spendable && signerWallets.has(holding.walletId),
      })),
  );
  const digest = instructionHash({
    owner,
    scope,
    snapshots: batches.map(({ wallet, values }) => [
      wallet.id,
      values.sort((a, b) => a.kind.localeCompare(b.kind)),
    ]),
    ...(quotes.length && { quotes }),
    signerWallets: [...signerWallets],
  });
  const id = [
    digest.slice(0, 8),
    digest.slice(8, 12),
    "4" + digest.slice(13, 16),
    "a" + digest.slice(17, 20),
    digest.slice(20, 32),
  ].join("-");
  const observations = batches.flatMap((batch) =>
    [...batch.coverage, priceCoverage(batch.wallet, holdings)].map((item) =>
      item.kind === "balances" &&
      item.state === "ready" &&
      disputed.has(item.walletId)
        ? { ...item, state: "partial" as const, reason: "rpc_lag" as const }
        : item,
    ),
  );
  return C.CryptoPortfolio.parse({
    id,
    walletIds: wallets.map((w) => w.id),
    source: readSource(scope.cluster, slot, observedAt),
    holdings,
    positions: [],
    coverage: observations,
    pricedSubtotalUsd: subtotal,
  });
}
