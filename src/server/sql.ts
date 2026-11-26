import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { db } from "../lib/db";

export interface Sql {
  exec?(text: string): Promise<unknown>;
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}
let pool: Pool | undefined;
export function postgresPool() {
  if (!process.env.DATABASE_URL?.match(/^postgres(?:ql)?:\/\//))
    throw new Error("POSTGRES_REQUIRED");
  return (pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 12,
  }));
}
export async function database(): Promise<Sql> {
  if (process.env.DATABASE_URL?.startsWith("postgres")) return postgresPool();
  return (await db()).$client as unknown as Sql;
}
export async function transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
  if (!process.env.DATABASE_URL?.startsWith("postgres")) {
    const client = (await db()).$client as unknown as {
      transaction: (fn: (tx: Sql) => Promise<T>) => Promise<T>;
    };
    return client.transaction(fn);
  }
  const client: PoolClient = await postgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function closeDatabase() {
  await pool?.end();
  pool = undefined;
}
