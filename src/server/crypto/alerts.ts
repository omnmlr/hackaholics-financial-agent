import { randomUUID } from "node:crypto";
import type { z } from "zod";
import * as C from "../../../packages/contracts/src/crypto";
import type { Principal } from "../auth";
import { invariant } from "../errors";
import { operationalEvent } from "../observability";
import { database, transaction, type Sql } from "../sql";
import { syncWalletActivity } from "./activity";
import { attributeEvent, type ChainEvent } from "./ledger";
import { assetKey, assetSymbol, type Amount } from "./portfolio";
import {
  cryptoMutation,
  listWallets,
  readSource,
  type Cluster,
  type Scope,
} from "./registry";

type RuleInput = z.infer<typeof C.CryptoAlertRuleInput>;
type RuleRow = {
  id: string;
  wallet_id: string;
  minimum: Amount | null;
  enabled: boolean;
  checked_at: Date | null;
};
type AlertRow = {
  id: string;
  rule_id: string;
  wallet_id: string;
  event: ChainEvent;
  created_at: Date;
  read_at: Date | null;
};

export const cryptoMonitoringReady = () =>
  process.env.AGUS_CRYPTO_MONITORING === "true";

function rule(row: RuleRow) {
  return C.CryptoAlertRule.parse({
    id: row.id,
    walletId: row.wallet_id,
    kind: "external_inflow",
    ...(row.minimum && { min: row.minimum }),
    enabled: row.enabled,
    checkedAt: row.checked_at?.toISOString() ?? null,
  });
}
function alert(row: AlertRow) {
  const eventId = row.event.id;
  return C.CryptoAlert.parse({
    id: row.id,
    ruleId: row.rule_id,
    walletId: row.wallet_id,
    eventId,
    source: row.event.source,
    dedupeKey: `${row.rule_id}:${eventId}:${row.wallet_id}`,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at?.toISOString() ?? null,
  });
}

export function addAlertRule(p: Principal, input: RuleInput, key: string) {
  invariant(cryptoMonitoringReady(), "FEATURE_DISABLED", 503);
  return cryptoMutation(p.id, "alert.rule", key, input, async (sql) => {
    const wallet = (
      await sql.query(
        "SELECT cluster,verified_at FROM agus_crypto_wallets WHERE owner=$1 AND id=$2",
        [p.id, input.walletId],
      )
    ).rows[0];
    invariant(wallet, "NOT_FOUND", 404);
    invariant(wallet.verified_at, "WATCH_ONLY", 403);
    invariant(
      !input.min ||
        (input.min.asset.cluster === wallet.cluster &&
          assetSymbol(input.min) &&
          (input.min.asset.kind !== "sol" || input.min.decimals === 9) &&
          BigInt(input.min.atoms) > 0n),
      "INVALID_AMOUNT",
      400,
    );
    const result = await sql.query<RuleRow>(
      "INSERT INTO agus_crypto_alert_rules(owner,id,wallet_id,minimum) VALUES($1,$2,$3,$4::jsonb) RETURNING *",
      [
        p.id,
        randomUUID(),
        input.walletId,
        input.min ? JSON.stringify(input.min) : null,
      ],
    );
    return rule(result.rows[0]);
  });
}

export function updateAlertRule(
  p: Principal,
  id: string,
  enabled: boolean,
  key: string,
) {
  invariant(!enabled || cryptoMonitoringReady(), "FEATURE_DISABLED", 503);
  return cryptoMutation(
    p.id,
    "alert.rule.update",
    key,
    { id, enabled },
    async (sql) => {
      const result = await sql.query<RuleRow>(
        `UPDATE agus_crypto_alert_rules SET enabled=$3,
         activated_at=CASE WHEN NOT enabled AND $3 THEN now() ELSE activated_at END,
         checked_at=CASE WHEN NOT enabled AND $3 THEN NULL ELSE checked_at END
       WHERE owner=$1 AND id=$2 RETURNING *`,
        [p.id, id, enabled],
      );
      invariant(result.rows[0], "NOT_FOUND", 404);
      return rule(result.rows[0]);
    },
  );
}

export async function listAlertRules(owner: string, scope: Scope) {
  const wallets = await listWallets(owner, scope, true);
  const rows = (
    await (
      await database()
    ).query<RuleRow>(
      "SELECT * FROM agus_crypto_alert_rules WHERE owner=$1 AND wallet_id=ANY($2::uuid[]) ORDER BY id",
      [owner, wallets.map((w) => w.id)],
    )
  ).rows;
  return C.CryptoAlertRulePage.parse({
    items: rows.map(rule),
    nextCursor: null,
    source: readSource(scope.cluster),
  });
}

async function alertRows(
  sql: Sql,
  owner: string,
  walletIds: string[] | null,
  id: string | null,
  cursor: string | null,
) {
  return (
    await sql.query<AlertRow>(
      `SELECT a.*,r.wallet_id,e.event FROM agus_crypto_alerts a JOIN agus_crypto_alert_rules r ON r.owner=a.owner AND r.id=a.rule_id
     JOIN agus_crypto_chain_events e ON e.cluster=a.cluster AND e.signature=a.signature
     WHERE a.owner=$1 AND ($2::uuid[] IS NULL OR r.wallet_id=ANY($2)) AND ($3::uuid IS NULL OR a.id=$3)
       AND ($4::uuid IS NULL OR (a.created_at,a.id)<(SELECT created_at,id FROM agus_crypto_alerts WHERE owner=$1 AND id=$4))
     ORDER BY a.created_at DESC,a.id DESC LIMIT 26`,
      [owner, walletIds, id, cursor],
    )
  ).rows;
}
export async function listAlerts(
  owner: string,
  scope: Scope & { cursor?: string },
) {
  const wallets = await listWallets(owner, scope, true);
  const cursor = scope.cursor ? C.CryptoId.safeParse(scope.cursor) : null;
  invariant(!cursor || cursor.success, "INVALID_CURSOR", 400);
  const rows = await alertRows(
    await database(),
    owner,
    wallets.map((w) => w.id),
    null,
    cursor?.data ?? null,
  );
  return C.CryptoAlertPage.parse({
    items: rows.slice(0, 25).map(alert),
    nextCursor: rows.length > 25 ? rows[24].id : null,
    source: readSource(scope.cluster),
  });
}

export function readAlert(p: Principal, id: string, key: string) {
  return cryptoMutation(p.id, "alert.read", key, { id }, async (sql) => {
    await sql.query(
      "UPDATE agus_crypto_alerts SET read_at=COALESCE(read_at,now()) WHERE owner=$1 AND id=$2",
      [p.id, id],
    );
    const row = (await alertRows(sql, p.id, null, id, null))[0];
    invariant(row, "NOT_FOUND", 404);
    return alert(row);
  });
}

export async function evaluateAlertRule(
  owner: string,
  cluster: Cluster,
  id: string,
) {
  const owned = await listWallets(owner, { cluster }, true);
  await transaction(async (sql) => {
    const target = (
      await sql.query<RuleRow & { activated_at: Date }>(
        "SELECT * FROM agus_crypto_alert_rules WHERE owner=$1 AND id=$2 AND enabled FOR UPDATE",
        [owner, id],
      )
    ).rows[0];
    if (!target || !owned.some((w) => w.id === target.wallet_id)) return;
    const events = (
      await sql.query<{ event: ChainEvent }>(
        `SELECT e.event FROM agus_crypto_wallet_events w JOIN agus_crypto_chain_events e USING(cluster,signature)
       WHERE w.owner=$1 AND w.wallet_id=$2 AND w.cluster=$3 AND e.block_time >= $4
         AND NOT EXISTS(SELECT 1 FROM agus_crypto_alert_observations o WHERE o.owner=$1 AND o.rule_id=$5 AND o.signature=w.signature)
       ORDER BY e.slot,e.signature LIMIT 100`,
        [owner, target.wallet_id, cluster, target.activated_at, id],
      )
    ).rows;
    for (const { event } of events) {
      const attributed = attributeEvent(event, owned);
      let incoming = 0n;
      if (
        attributed.status === "success" &&
        attributed.finality === "finalized"
      ) {
        for (const leg of attributed.legs) {
          if (
            leg.kind !== "transfer" ||
            !leg.amount ||
            leg.fromWalletId !== null ||
            leg.toWalletId !== target.wallet_id
          )
            continue;
          if (
            target.minimum &&
            (assetKey(leg.amount) !== assetKey(target.minimum) ||
              leg.amount.decimals !== target.minimum.decimals)
          )
            continue;
          incoming += BigInt(leg.amount.atoms);
        }
      }
      if (incoming > 0n && incoming >= BigInt(target.minimum?.atoms ?? 0)) {
        await sql.query(
          `INSERT INTO agus_crypto_alerts(owner,id,rule_id,cluster,signature)
           VALUES($1,$2,$3,$4,$5) ON CONFLICT(owner,rule_id,cluster,signature) DO NOTHING`,
          [owner, randomUUID(), id, cluster, event.signature],
        );
      }
      await sql.query(
        "INSERT INTO agus_crypto_alert_observations(owner,rule_id,signature) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [owner, id, event.signature],
      );
    }
    await sql.query(
      "UPDATE agus_crypto_alert_rules SET checked_at=now() WHERE owner=$1 AND id=$2",
      [owner, id],
    );
  });
}

export async function runCryptoMonitoring() {
  if (!cryptoMonitoringReady()) return;
  const work = (
    await (
      await database()
    ).query<{ id: string; owner: string; wallet_id: string; cluster: Cluster }>(
      `SELECT r.id,r.owner,r.wallet_id,w.cluster FROM agus_crypto_alert_rules r
     JOIN agus_crypto_wallets w ON w.owner=r.owner AND w.id=r.wallet_id
     WHERE r.enabled AND (r.checked_at IS NULL OR r.checked_at < now()-interval '25 seconds')
     ORDER BY r.checked_at NULLS FIRST,r.id LIMIT 12`,
    )
  ).rows;
  for (let index = 0; index < work.length; index += 3) {
    const results = await Promise.allSettled(
      work.slice(index, index + 3).map(async (target) => {
        const [wallet] = await listWallets(target.owner, {
          cluster: target.cluster,
          walletIds: [target.wallet_id],
        });
        await syncWalletActivity(target.owner, wallet);
        await evaluateAlertRule(target.owner, target.cluster, target.id);
      }),
    );
    if (results.some((r) => r.status === "rejected"))
      operationalEvent("crypto.monitor_failed", {
        code: "MONITOR_CHECK_FAILED",
      });
  }
}
