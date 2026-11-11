import { Pool } from "pg";
import { z } from "zod";
const ids = z.array(z.uuid()).length(4).parse(process.argv.slice(2));
if (
  new Set(ids).size !== 4 ||
  (process.env.PAYMENT_MODE ?? "fixture") !== "fixture" ||
  !process.env.MIGRATION_DATABASE_URL
)
  throw new Error("FIXTURE_OPERATIONS_CONFIGURATION_REQUIRED");
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  const r = await pool.query(
    "SELECT id FROM agus_users WHERE id=ANY($1::text[]) AND role='operations'",
    [ids],
  );
  if (r.rows.length !== 4)
    throw new Error("FOUR_DISTINCT_OPERATIONS_IDENTITIES_REQUIRED");
  await pool.query(
    "INSERT INTO agus_fixture_escrow_authorities(id,verifier,arbitrators) VALUES(1,$1,$2) ON CONFLICT(id) DO UPDATE SET verifier=excluded.verifier,arbitrators=excluded.arbitrators",
    [ids[0], JSON.stringify(ids.slice(1))],
  );
  console.log(
    "Fixture-only verifier and 2-of-3 arbitration configured. Existing funded orders retain immutable snapshots. No chain keys were provisioned.",
  );
} finally {
  await pool.end();
}
