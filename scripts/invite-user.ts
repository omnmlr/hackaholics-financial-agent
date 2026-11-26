import { Pool } from "pg";
import { z } from "zod";
const email = z.email().parse(process.argv[2]).toLowerCase();
if (!process.env.MIGRATION_DATABASE_URL)
  throw new Error("OPERATIONS_DATABASE_CREDENTIAL_REQUIRED");
const pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
try {
  await pool.query(
    "INSERT INTO agus_invitations(email,expires_at,created_by) VALUES($1,now()+interval '48 hours','operations-cli') ON CONFLICT(email) DO UPDATE SET expires_at=excluded.expires_at,consumed_at=NULL",
    [email],
  );
  console.log(
    "Invite-only enrollment enabled for the specified email for 48 hours.",
  );
} finally {
  await pool.end();
}
