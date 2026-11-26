import { Blob } from "node:buffer";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../../../../../src/server/migrations";

const { Response } = globalThis;

const require = createRequire(import.meta.url);
const pg = require("pg");

const dbMode = process.env.TEST_HARNESS_DB_MODE;
if (dbMode) {
  let pglite;

  if (dbMode === "uninitialized") {
    pglite = new PGlite();
    // Empty migration tables: assertSchema() executes its real SQL query and fails with SCHEMA_MIGRATION_REQUIRED
    await pglite.exec(`
      CREATE TABLE IF NOT EXISTS agus_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS agus_legacy_archive (
        id text PRIMARY KEY
      );
    `);
  } else {
    const snapPath = process.env.TEST_HARNESS_SNAPSHOT_PATH;
    if (snapPath) {
      const snapBytes = await readFile(snapPath);
      pglite = new PGlite({ loadDataDir: new Blob([snapBytes]) });
    } else {
      pglite = new PGlite();
      await migrate(pglite, resolve(process.cwd(), "migrations"), false);
      const roleSql = await readFile(
        resolve(process.cwd(), "scripts/sql/runtime-role.sql"),
        "utf8",
      );
      await pglite.exec(roleSql);
      await pglite.exec(
        "CREATE ROLE agus_crypto_devnet_runtime LOGIN IN ROLE agus_runtime; CREATE ROLE agus_no_role LOGIN; GRANT SELECT ON agus_migrations, agus_legacy_archive TO agus_no_role;",
      );
    }

    if (dbMode === "superuser") {
      // Keep current_user as default postgres superuser -> scripts/crypto-devnet.ts privilege query returns safe=false
    } else if (dbMode === "missing-role") {
      await pglite.exec("SET ROLE agus_no_role;");
    } else if (dbMode === "public-create") {
      await pglite.exec(
        "GRANT CREATE ON SCHEMA public TO agus_crypto_devnet_runtime; SET ROLE agus_crypto_devnet_runtime;",
      );
    } else if (dbMode === "valid-runtime") {
      await pglite.exec("SET ROLE agus_crypto_devnet_runtime;");
    } else {
      throw new Error(`Unsupported TEST_HARNESS_DB_MODE: ${dbMode}`);
    }
  }

  const dispatchQuery = (textOrConfig, values) => {
    if (typeof textOrConfig === "object" && textOrConfig !== null) {
      return pglite.query(textOrConfig.text, textOrConfig.values ?? values, {
        ...(textOrConfig.rowMode ? { rowMode: textOrConfig.rowMode } : {}),
      });
    }
    return pglite.query(textOrConfig, values);
  };

  pg.Pool.prototype.query = function query(textOrConfig, values) {
    return dispatchQuery(textOrConfig, values);
  };

  pg.Pool.prototype.connect = async function connect() {
    return {
      query: dispatchQuery,
      release: () => {},
      on: () => {},
    };
  };

  pg.Pool.prototype.end = async function end() {
    if (!pglite.closed) {
      await pglite.close();
    }
  };
}

const rpcGenesis = process.env.TEST_HARNESS_RPC_GENESIS;
if (rpcGenesis) {
  const originalFetch = globalThis.fetch;
  const rpcTargets = new Set(
    [
      process.env.AGUS_DEVNET_RPC,
      process.env.AGUS_DEVNET_VERIFY_RPC,
      "https://api.devnet.solana.com",
    ]
      .filter(Boolean)
      .map((u) => new URL(u).href),
  );

  globalThis.fetch = async (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    let url = rawUrl;
    try {
      url = new URL(rawUrl).href;
    } catch {
      // keep rawUrl
    }

    if (rpcTargets.has(url) && typeof init?.body === "string") {
      try {
        const body = JSON.parse(init.body);
        if (body?.method === "getGenesisHash") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: body.id ?? 1,
              result: rpcGenesis,
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          );
        }
      } catch {
        // Fall through to original fetch if body is non-JSON
      }
    }

    return originalFetch(input, init);
  };
}
