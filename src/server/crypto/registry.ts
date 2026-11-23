import { createPublicKey, randomBytes, randomUUID, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { base58 } from "@scure/base";
import type { z } from "zod";
import * as C from "../../../packages/contracts/src/crypto";
import type { Principal } from "../auth";
import { instructionHash } from "../approvals";
import { invariant } from "../errors";
import { database, transaction, type Sql } from "../sql";

export type Cluster = z.infer<typeof C.CryptoCluster>;
export type Scope = z.infer<typeof C.CryptoScope>;
export type Wallet = z.infer<typeof C.CryptoWallet>;
type WalletRow = {
  id: string;
  cluster: Cluster;
  address: string;
  label: string;
  declared: boolean;
  verified_at: Date | null;
  last_sync: Date | null;
};
type RouteRow = {
  id: string;
  wallet_id: string;
  provider: z.infer<typeof C.CryptoProvider>;
};

export function approvedCryptoProviders(
  cluster: Cluster,
): z.infer<typeof C.CryptoProvider>[] {
  if (
    cluster !== "devnet" ||
    process.env.AGUS_SOLANA_DEVNET_ENABLED !== "true" ||
    process.env.PAYMENT_MODE === "live"
  )
    return [];
  const enabled = new Set(
    process.env.AGUS_CRYPTO_DEVNET_ROUTES?.split(",").map((value) =>
      value.trim(),
    ),
  );
  return (["phantom", "solflare"] as const).filter((provider) =>
    enabled.has(provider),
  );
}

export const readSource = (
  cluster: Cluster,
  slot: number | null = null,
  observedAt = new Date().toISOString(),
) => ({
  mode: "public-rpc" as const,
  cluster,
  provider: "solana-rpc",
  observedAt,
  slot,
});

export async function cryptoMutation<T>(
  owner: string,
  kind: string,
  key: string,
  input: unknown,
  action: (sql: Sql) => Promise<T>,
  replay: (result: T) => T = (result) => result,
): Promise<T> {
  return transaction(async (sql) => {
    const digest = instructionHash(input);
    const inserted = await sql.query(
      "INSERT INTO agus_crypto_operations (owner, kind, key, digest) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING key",
      [owner, kind, key, digest],
    );
    if (!inserted.rows.length) {
      const row = (
        await sql.query<{ digest: string; response: T }>(
          "SELECT digest,response FROM agus_crypto_operations WHERE owner=$1 AND kind=$2 AND key=$3 FOR UPDATE",
          [owner, kind, key],
        )
      ).rows[0];
      invariant(row.digest === digest, "IDEMPOTENCY_CONFLICT");
      return replay(row.response);
    }
    const result = await action(sql);
    await sql.query(
      "UPDATE agus_crypto_operations SET response=$4::jsonb WHERE owner=$1 AND kind=$2 AND key=$3",
      [owner, kind, key, JSON.stringify(result)],
    );
    return result;
  });
}

async function wallets(
  sql: Sql,
  owner: string,
  cluster: Cluster | null,
  ids: string[] | undefined,
  defaultOwned: boolean,
): Promise<Wallet[]> {
  const rows = (
    await sql.query<WalletRow>(
      `SELECT w.*, (SELECT min(b.observed_at) FROM agus_crypto_balances b WHERE b.owner=w.owner AND b.wallet_id=w.id HAVING count(*)=2) AS last_sync
       FROM agus_crypto_wallets w WHERE w.owner=$1 AND ($2::text IS NULL OR w.cluster=$2)
       AND ($3::uuid[] IS NULL OR w.id=ANY($3)) AND (NOT $4::boolean OR w.verified_at IS NOT NULL)
       ORDER BY w.id`,
      [owner, cluster, ids ?? null, defaultOwned && !ids],
    )
  ).rows;
  if (ids) invariant(rows.length === new Set(ids).size, "NOT_FOUND", 404);
  if (!rows.length) return [];
  const routes = (
    await sql.query<RouteRow>(
      "SELECT id,wallet_id,provider FROM agus_crypto_routes WHERE owner=$1 AND wallet_id=ANY($2::uuid[]) AND revoked_at IS NULL ORDER BY id",
      [owner, rows.map((row) => row.id)],
    )
  ).rows;
  return rows.map((row) =>
    C.CryptoWallet.parse({
      id: row.id,
      cluster: row.cluster,
      address: row.address,
      label: row.label,
      group: row.verified_at
        ? "linked_owned"
        : row.declared
          ? "own_watch"
          : "third_party_watch",
      ownership: row.verified_at
        ? "verified"
        : row.declared
          ? "declared"
          : "none",
      lastSyncAt: row.last_sync?.toISOString() ?? null,
      routes: routes
        .filter((route) => route.wallet_id === row.id)
        .map((route) => ({
          id: route.id,
          cluster: row.cluster,
          address: row.address,
          provider: route.provider,
          operations: approvedCryptoProviders(row.cluster).includes(
            route.provider,
          )
            ? ["transfer"]
            : [],
          status: approvedCryptoProviders(row.cluster).includes(route.provider)
            ? "available"
            : "disabled",
          reason: approvedCryptoProviders(row.cluster).includes(route.provider)
            ? null
            : "SIGNER_VALIDATION_PENDING",
        })),
    }),
  );
}

export async function listWallets(
  owner: string,
  scope: Scope,
  defaultOwned = false,
) {
  return wallets(
    await database(),
    owner,
    scope.cluster,
    scope.walletIds,
    defaultOwned,
  );
}

async function walletById(sql: Sql, owner: string, id: string) {
  return (await wallets(sql, owner, null, [id], false))[0];
}

async function reserveWalletSlot(
  sql: Sql,
  owner: string,
  cluster: Cluster,
  address: string,
) {
  // Serialize slot reservations while allowing existing foreign-key locks.
  await sql.query("SELECT id FROM agus_users WHERE id=$1 FOR NO KEY UPDATE", [
    owner,
  ]);
  const { allowed } = (
    await sql.query<{ allowed: boolean }>(
      `SELECT count(*) < 12 OR COALESCE(bool_or(address=$3),false) AS allowed
     FROM agus_crypto_wallets WHERE owner=$1 AND cluster=$2`,
      [owner, cluster, address],
    )
  ).rows[0];
  invariant(allowed, "WALLET_LIMIT", 422);
}

export function watch(
  p: Principal,
  input: z.infer<typeof C.CryptoWatch>,
  key: string,
) {
  return cryptoMutation(p.id, "wallet.watch", key, input, async (sql) => {
    await reserveWalletSlot(sql, p.id, input.cluster, input.address);
    const row = (
      await sql.query<{ id: string }>(
        `INSERT INTO agus_crypto_wallets (owner,id,cluster,address,label,declared)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (owner,cluster,address) DO UPDATE
       SET declared=agus_crypto_wallets.declared OR excluded.declared RETURNING id`,
        [
          p.id,
          randomUUID(),
          input.cluster,
          input.address,
          input.label,
          input.ownDeclared,
        ],
      )
    ).rows[0];
    return walletById(sql, p.id, row.id);
  });
}

export function challenge(
  p: Principal,
  input: z.infer<typeof C.CryptoChallengeInput>,
  key: string,
) {
  invariant(
    ["phantom", "solflare"].includes(input.provider),
    "INELIGIBLE_ROUTE",
    422,
  );
  invariant(
    PublicKey.isOnCurve(new PublicKey(input.address).toBytes()),
    "INVALID_WALLET",
    400,
  );
  return cryptoMutation(
    p.id,
    "wallet.challenge",
    key,
    { ...input, session: p.sessionId },
    async (sql) => {
      const id = randomUUID(),
        expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
      const authority = new URL(
        process.env.BETTER_AUTH_URL ??
          process.env.APP_ORIGIN ??
          "http://localhost:3000",
      ).origin;
      const binding = instructionHash({ user: p.id, session: p.sessionId, id });
      const message = [
        "AGUS wallet ownership proof",
        `Origin: ${authority}`,
        `Cluster: ${input.cluster}`,
        `Address: ${input.address}`,
        `Provider: ${input.provider}`,
        `Session binding: ${binding}`,
        `Expires: ${expiresAt}`,
        `Nonce: ${randomBytes(32).toString("hex")}`,
        "This proves ownership only. It does not authorize a transaction.",
      ].join("\n");
      await sql.query(
        "INSERT INTO agus_crypto_challenges (owner,id,session_id,cluster,address,provider,message,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          p.id,
          id,
          p.sessionId,
          input.cluster,
          input.address,
          input.provider,
          message,
          expiresAt,
        ],
      );
      return {
        id,
        messageBase64: Buffer.from(message).toString("base64"),
        expiresAt,
      };
    },
  );
}

export function associate(
  p: Principal,
  input: z.infer<typeof C.CryptoAssociation>,
  key: string,
) {
  return cryptoMutation(
    p.id,
    "wallet.association",
    key,
    { ...input, session: p.sessionId },
    async (sql) => {
      const row = (
        await sql.query(
          "SELECT *, expires_at>now() AS fresh FROM agus_crypto_challenges WHERE owner=$1 AND id=$2 AND session_id=$3 FOR UPDATE",
          [p.id, input.challengeId, p.sessionId],
        )
      ).rows[0];
      invariant(row && !row.consumed_at, "OWNERSHIP_PROOF_REQUIRED", 403);
      invariant(row.fresh, "CHALLENGE_EXPIRED", 410);
      const publicKey = createPublicKey({
        key: Buffer.concat([
          Buffer.from("302a300506032b6570032100", "hex"),
          new PublicKey(row.address).toBuffer(),
        ]),
        format: "der",
        type: "spki",
      });
      invariant(
        verify(
          null,
          Buffer.from(row.message),
          publicKey,
          base58.decode(input.signature),
        ),
        "OWNERSHIP_PROOF_REQUIRED",
        403,
      );
      await reserveWalletSlot(sql, p.id, row.cluster, row.address);
      const wallet = (
        await sql.query<{ id: string }>(
          `INSERT INTO agus_crypto_wallets (owner,id,cluster,address,label,verified_at) VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT (owner,cluster,address) DO UPDATE SET verified_at=now() RETURNING id`,
          [
            p.id,
            randomUUID(),
            row.cluster,
            row.address,
            input.label ?? row.provider,
          ],
        )
      ).rows[0];
      await sql.query(
        `INSERT INTO agus_crypto_routes (owner,id,wallet_id,provider) VALUES ($1,$2,$3,$4)
       ON CONFLICT (owner,wallet_id,provider) DO UPDATE SET revoked_at=NULL, id=excluded.id
       WHERE agus_crypto_routes.revoked_at IS NOT NULL`,
        [p.id, randomUUID(), wallet.id, row.provider],
      );
      await sql.query(
        "INSERT INTO agus_audit(id,owner,resource_type,resource_id,action,details) VALUES($1,$2,'crypto_wallet',$3,'crypto.wallet_associated',$4::jsonb)",
        [
          randomUUID(),
          p.id,
          wallet.id,
          JSON.stringify({ provider: row.provider, cluster: row.cluster }),
        ],
      );
      await sql.query(
        "UPDATE agus_crypto_challenges SET consumed_at=now() WHERE owner=$1 AND id=$2",
        [p.id, row.id],
      );
      return walletById(sql, p.id, wallet.id);
    },
  );
}

export function relabel(p: Principal, id: string, label: string, key: string) {
  return cryptoMutation(
    p.id,
    "wallet.relabel",
    key,
    { id, label },
    async (sql) => {
      await sql.query(
        "UPDATE agus_crypto_wallets SET label=$3 WHERE owner=$1 AND id=$2",
        [p.id, id, label],
      );
      return walletById(sql, p.id, id);
    },
  );
}

export function unlink(
  p: Principal,
  walletId: string,
  routeId: string,
  key: string,
) {
  return cryptoMutation(
    p.id,
    "wallet.unlink",
    key,
    { walletId, routeId },
    async (sql) => {
      const updated = await sql.query(
        "UPDATE agus_crypto_routes SET revoked_at=COALESCE(revoked_at,now()) WHERE owner=$1 AND wallet_id=$2 AND id=$3 RETURNING id",
        [p.id, walletId, routeId],
      );
      invariant(updated.rows.length, "NOT_FOUND", 404);
      await sql.query(
        "INSERT INTO agus_audit(id,owner,resource_type,resource_id,action,details) VALUES($1,$2,'crypto_wallet',$3,'crypto.route_revoked',$4::jsonb)",
        [randomUUID(), p.id, walletId, JSON.stringify({ routeId })],
      );
      return walletById(sql, p.id, walletId);
    },
  );
}
