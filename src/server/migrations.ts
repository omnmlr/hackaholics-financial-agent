import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "./sql";
import { normalizeLegacy } from "./legacy-storage";

export const SCHEMA_VERSION = "0020_conversational_payments.sql";
export async function migrate(
  client: Sql,
  directory = join(process.cwd(), "migrations"),
  advisoryLock = true,
) {
  if (advisoryLock) await client.query("SELECT pg_advisory_lock(2072026110)");
  try {
    await client.query(
      "CREATE TABLE IF NOT EXISTS agus_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const names = (await readdir(directory))
      .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
      .sort();
    for (const name of names) {
      const source = await readFile(join(directory, name), "utf8");
      const checksum = createHash("sha256").update(source).digest("hex");
      const existing = await client.query(
        "SELECT checksum FROM agus_migrations WHERE name=$1",
        [name],
      );
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum)
          throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${name}`);
        continue;
      }
      await client.query("BEGIN");
      try {
        if (client.exec) await client.exec(source);
        else await client.query(source);
        await client.query(
          "INSERT INTO agus_migrations(name,checksum) VALUES($1,$2)",
          [name, checksum],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    await normalizeLegacy(client);
  } finally {
    if (advisoryLock)
      await client.query("SELECT pg_advisory_unlock(2072026110)");
  }
}
export async function assertSchema(client: Sql) {
  const r = await client.query(
    "SELECT 1 FROM agus_migrations WHERE name=$1 AND EXISTS (SELECT 1 FROM agus_legacy_archive WHERE id='workflow_state:1')",
    [SCHEMA_VERSION],
  );
  if (r.rows.length !== 1) throw new Error("SCHEMA_MIGRATION_REQUIRED");
}
