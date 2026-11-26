import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { operator } from "../auth";
import { config } from "../config";
import { db } from "../db";
import { AppError } from "../domain";
import {
  createFixtureDataSource,
  FIXTURE_LABEL,
} from "../financial-data/fixture";
import { createReadTools } from "../financial-data/tools";
import type {
  PermissionContext,
  ReadToolDispatcher,
} from "../financial-data/contracts";
import {
  createDurableRepository,
  initializeFinancialStorage,
  initializeSimulation,
} from "./storage";
import { createAuthorizer } from "../financial-data/permissions";

export const simulation = Object.freeze({
  mode: "fixture",
  simulated: true,
  label: FIXTURE_LABEL,
});
/** Ordinary personal-agent work is independent of financial fixture access. */
export function requireConversation() {
  if (
    process.env.AGUS_AGENT_ARCHITECTURE === "native-gemini" &&
    process.env.AGUS_WORKSPACE_ENABLED === "true" &&
    config().mode !== "live"
  )
    return;
  requireFinancialDemo();
}
export function requireFinancialDemo() {
  if (
    process.env.FINANCIAL_DEMO_ENABLED !== "true" ||
    config().mode !== "fixture"
  )
    throw new AppError("Financial fixture integration unavailable", 503);
}
export async function financialContext(
  req: Request,
): Promise<PermissionContext> {
  const authenticatedOperator = await operator(req);
  requireFinancialDemo();
  await initializeFinancialStorage();
  const d = await db();
  // Only the configured, session-verified operator receives the default demo binding.
  // A persisted binding is never overwritten when the process restarts.
  await d.execute(
    sql`INSERT INTO fm_principals VALUES (${config().operator}, 'fictional-tenant', 'fictional-amina') ON CONFLICT DO NOTHING`,
  );
  const result = await d.execute(
    sql`SELECT tenant, owner FROM fm_principals WHERE operator_id=${authenticatedOperator}`,
  );
  if (!result.rows.length)
    throw new AppError("Financial access unavailable", 403);
  const row = result.rows[0] as { tenant: string; owner: string };
  await initializeSimulation({ tenantId: row.tenant, actorId: row.owner });
  return {
    tenantId: row.tenant,
    actorId: row.owner,
    requestId: randomUUID(),
    now: new Date().toISOString(),
  };
}
/** Explicit server binding for NEW fixture payment drafts only. The separate
 * provider wallet remains a provider check, never a personal balance source. */
export async function paymentSimulationSource(actor: string) {
  if (
    process.env.FINANCIAL_DEMO_ENABLED !== "true" ||
    config().mode !== "fixture"
  )
    return undefined;
  await initializeFinancialStorage();
  const d = await db();
  const rows = await d.execute(
    sql`SELECT tenant, owner FROM fm_principals WHERE operator_id=${actor}`,
  );
  if (!rows.rows.length)
    throw new AppError(
      "Open the authorized fictional workspace before preparing payments",
      403,
    );
  const p = {
    tenantId: String(rows.rows[0].tenant),
    actorId: String(rows.rows[0].owner),
  };
  const repository = createDurableRepository();
  const ctx = { ...p, requestId: randomUUID(), now: new Date().toISOString() };
  const auth = createAuthorizer(repository, () => ctx.now);
  // Current demo has one funded source. Never infer a source from user/model IDs.
  const bindings = await auth.bind(ctx, ["amina-current"], ["accounts:read"]);
  if (bindings[0].account.provider !== "fixture")
    throw new AppError("Fictional source unavailable", 403);
  await initializeSimulation(p);
  return {
    tenantId: p.tenantId,
    ownerId: p.actorId,
    accountId: bindings[0].account.accountId,
  };
}
let dispatcher: ReadToolDispatcher | undefined;
export function financialDispatcher(): ReadToolDispatcher {
  requireFinancialDemo();
  if (!dispatcher) {
    const repository = createDurableRepository();
    const source = createFixtureDataSource({ repository });
    dispatcher = createReadTools({ repository, sources: [source] });
  }
  return dispatcher;
}
