import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { migrate } from "../src/server/migrations";
const url =
  process.env.MIGRATION_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "pglite://.data/agent";
if (url.startsWith("postgres")) {
  if (!process.env.MIGRATION_DATABASE_URL)
    throw new Error(
      "MIGRATION_DATABASE_URL_REQUIRED: use a separate migration role",
    );
  const pool = new Pool({ connectionString: url, max: 1 }),
    client = await pool.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
    await pool.end();
  }
} else {
  const path = url.replace("pglite://", "");
  const client = new PGlite(path === ":memory:" ? undefined : path);
  try {
    await migrate(client, undefined, false);
  } finally {
    await client.close();
  }
}
console.log(
  "Checksummed migrations applied; runtime credentials do not migrate schemas.",
);
