import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import {
  requireDevnet,
  type DraftEvent,
  type DraftStore,
  type SolanaDraft,
} from "./contracts";

let initialization: Promise<void> | undefined;
async function initialize() {
  requireDevnet();
  return (initialization ??= (async () => {
    const d = await db();
    // Separate development-only tables: never alter banking/auth/workflow schemas.
    await d.execute(sql`CREATE TABLE IF NOT EXISTS agus_solana_drafts (
      owner text NOT NULL,
      id text NOT NULL,
      revision integer NOT NULL CHECK (revision >= 0),
      state text NOT NULL,
      signature text UNIQUE,
      payload jsonb NOT NULL,
      PRIMARY KEY (owner, id),
      CHECK (payload->>'owner' = owner AND payload->>'id' = id AND payload->>'state' = state),
      CHECK ((payload->>'revision')::integer = revision)
    )`);
    await d.execute(sql`CREATE TABLE IF NOT EXISTS agus_solana_events (
      id text PRIMARY KEY,
      owner text NOT NULL,
      draft_id text NOT NULL,
      action text NOT NULL,
      at timestamptz NOT NULL,
      details jsonb NOT NULL,
      FOREIGN KEY (owner, draft_id) REFERENCES agus_solana_drafts(owner, id)
    )`);
  })().catch((error) => {
    initialization = undefined;
    throw error;
  }));
}

export function durableDraftStore(): DraftStore {
  return {
    async create(draft: SolanaDraft, event: DraftEvent) {
      await initialize();
      const d = await db();
      await d.transaction(async (tx) => {
        await tx.execute(sql`INSERT INTO agus_solana_drafts (owner,id,revision,state,payload)
          VALUES (${draft.owner},${draft.id},${draft.revision},${draft.state},${JSON.stringify(draft)}::jsonb)`);
        await tx.execute(sql`INSERT INTO agus_solana_events VALUES
          (${randomUUID()},${draft.owner},${draft.id},${event.action},${event.at},${JSON.stringify(event.details ?? {})}::jsonb)`);
      });
    },
    async get(owner, id) {
      await initialize();
      const d = await db();
      const r = await d.execute(
        sql`SELECT payload FROM agus_solana_drafts WHERE owner=${owner} AND id=${id}`,
      );
      return r.rows.length ? (r.rows[0].payload as SolanaDraft) : null;
    },
    async list(owner) {
      await initialize();
      const d = await db();
      const r = await d.execute(
        sql`SELECT payload FROM agus_solana_drafts WHERE owner=${owner} ORDER BY id DESC LIMIT 50`,
      );
      return r.rows.map((row) => row.payload as SolanaDraft);
    },
    async transition(previous, next, event) {
      await initialize();
      const d = await db();
      return d.transaction(async (tx) => {
        const r = await tx.execute(sql`UPDATE agus_solana_drafts SET
          revision=${next.revision},state=${next.state},signature=${next.submission?.signature ?? null},payload=${JSON.stringify(next)}::jsonb
          WHERE owner=${previous.owner} AND id=${previous.id} AND revision=${previous.revision} AND state=${previous.state}
          RETURNING id`);
        if (!r.rows.length) return false;
        await tx.execute(sql`INSERT INTO agus_solana_events VALUES
          (${randomUUID()},${previous.owner},${previous.id},${event.action},${event.at},${JSON.stringify(event.details ?? {})}::jsonb)`);
        return true;
      });
    },
  };
}
