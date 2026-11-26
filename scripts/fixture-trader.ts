import { Pool } from "pg";
import { z } from "zod";
const owner = z.uuid().parse(process.argv[2]),
  action = z.enum(["enable", "disable"]).parse(process.argv[3]);
if (
  (process.env.PAYMENT_MODE ?? "fixture") !== "fixture" ||
  !process.env.MIGRATION_DATABASE_URL
)
  throw new Error("FIXTURE_OPERATIONS_CREDENTIAL_REQUIRED");
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  await pool.query(
    "INSERT INTO agus_trader_eligibility(owner,environment,eligible,evidence) VALUES($1,'fixture',$2,'Internal simulated marketplace only; no live trader/KYC acceptance') ON CONFLICT(owner) DO UPDATE SET eligible=excluded.eligible,evidence=excluded.evidence",
    [owner, action === "enable"],
  );
  console.log(
    "Simulated trader eligibility updated. Live trading remains disabled.",
  );
} finally {
  await pool.end();
}
