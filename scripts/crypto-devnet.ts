import { setTimeout as delay } from "node:timers/promises";
import { rm, writeFile } from "node:fs/promises";
import { validateEnvironment } from "../src/lib/environment";
import { identity } from "../src/server/auth";
import { closeDatabase, database } from "../src/server/sql";
import { assertSchema } from "../src/server/migrations";
import { assertEncryptionReady } from "../src/server/secrets";
import { cryptoRpc } from "../src/server/crypto/rpc";
import { approvedCryptoProviders } from "../src/server/crypto/registry";
import {
  cryptoMonitoringReady,
  runCryptoMonitoring,
} from "../src/server/crypto/alerts";
import { runCryptoReconciliation } from "../src/server/crypto/execution";

const mode = process.argv[2];
if (mode !== "api" && mode !== "worker") throw new Error("START_MODE_REQUIRED");

try {
  const publicAuthReady =
    process.env.AGUS_AUTH_PUBLIC === "true" &&
    Boolean(
      process.env.RESEND_API_KEY &&
        process.env.AGUS_AUTH_EMAIL_FROM &&
        process.env.APP_ORIGIN?.startsWith("https://"),
    );
  if (
    validateEnvironment().profile !== "devnet" ||
    (process.env.AGUS_AUTH_PUBLIC !== "false" && !publicAuthReady)
  ) {
    throw new Error("INVITE_ONLY_DEVNET_REQUIRED");
  }
  if (
    !process.env.DATABASE_URL?.match(/^postgres(?:ql)?:\/\//) ||
    process.env.MIGRATION_DATABASE_URL
  ) {
    throw new Error("POSTGRES_RUNTIME_ROLE_REQUIRED");
  }
  if (
    !cryptoMonitoringReady() ||
    approvedCryptoProviders("devnet").length !== 2
  ) {
    throw new Error("DEVNET_WALLET_ROUTES_AND_MONITORING_REQUIRED");
  }
  const db = await database();
  await assertSchema(db);
  const { rows } = await db.query<{ safe: boolean }>(
    `SELECT pg_has_role(current_user, 'agus_runtime', 'USAGE')
       AND ($1::text IS NULL OR current_database() = $1)
       AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
       AND NOT has_table_privilege(current_user, 'agus_migrations', 'INSERT,UPDATE,DELETE,TRUNCATE')
       AND NOT has_table_privilege(current_user, 'agus_legacy_archive', 'INSERT,UPDATE,DELETE,TRUNCATE')
       AND NOT has_column_privilege(current_user, 'agus_invitations', 'email', 'UPDATE')
       AND has_column_privilege(current_user, 'agus_invitations', 'consumed_at', 'UPDATE')
       AND ($1::text IS NULL OR NOT EXISTS (
         SELECT 1 FROM unnest(ARRAY['agus_crypto_chain_events','agus_crypto_wallet_events',
           'agus_crypto_receipts','agus_crypto_reviews','agus_audit']) AS immutable(table_name)
         WHERE has_table_privilege(current_user, immutable.table_name, 'UPDATE,DELETE,TRUNCATE')
            OR has_any_column_privilege(current_user, immutable.table_name, 'UPDATE')
       ))
       AND NOT EXISTS (
         SELECT 1 FROM pg_roles WHERE rolname = current_user
           AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)
       ) AS safe
    `,
    [process.env.AGUS_CRYPTO_DATABASE_NAME ?? null],
  );
  if (!rows[0]?.safe) throw new Error("POSTGRES_RUNTIME_ROLE_REQUIRED");
  await Promise.all([cryptoRpc("devnet"), cryptoRpc("devnet", true)]);

  if (mode === "api") {
    const origin = process.env.APP_ORIGIN;
    const parsed = URL.parse(origin ?? "");
    if (
      !parsed ||
      parsed.protocol !== "https:" ||
      parsed.origin !== origin ||
      process.env.BETTER_AUTH_URL !== origin
    ) {
      throw new Error("CANONICAL_HTTPS_AUTH_ORIGIN_REQUIRED");
    }
    assertEncryptionReady();
    await identity();
    console.log("Crypto Devnet API startup verified");
  } else {
    const healthFile = process.env.AGUS_CRYPTO_WORKER_HEALTH_FILE;
    if (healthFile) await rm(healthFile, { force: true });
    const stop = new AbortController();
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.once(signal, () => stop.abort());
    }
    console.log("Crypto Devnet worker started with two verified RPC providers");
    while (!stop.signal.aborted) {
      const results = await Promise.allSettled([
        runCryptoMonitoring(),
        runCryptoReconciliation(),
      ]);
      const incomplete = results.some(({ status }) => status === "rejected");
      if (incomplete) {
        console.error("Crypto Devnet worker cycle incomplete");
      } else {
        if (healthFile) await writeFile(healthFile, "ok\n", { mode: 0o600 });
        console.log(
          "Crypto Devnet monitoring and reconciliation cycle completed",
        );
      }
      if (process.argv.includes("--once")) {
        if (incomplete) process.exitCode = 1;
        break;
      }
      await delay(30_000, undefined, { signal: stop.signal }).catch((error) => {
        if (!stop.signal.aborted) throw error;
      });
    }
  }
} catch (error) {
  const code =
    error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : "STARTUP_CHECK_FAILED";
  console.error(`Crypto Devnet startup failed (${code})`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
