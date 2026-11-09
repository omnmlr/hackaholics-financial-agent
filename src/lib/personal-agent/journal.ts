import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { AppError } from "../domain";
import { IdSchema } from "../financial-data/contracts";
import { requireWorkspace } from "../agent-workspace/store";
import { redactAgentText } from "./privacy";
import type { AgentRun, ExecutionStep, PlanStep, RunStatus } from "./contracts";

let ready: Promise<void> | undefined;
async function storage() {
  requireWorkspace();
  const d = await db();
  await (ready ??= d
    .execute(
      sql`CREATE TABLE IF NOT EXISTS agus2_agent_runs (
    owner text NOT NULL,id text NOT NULL,conversation text NOT NULL,state text NOT NULL,
    version integer NOT NULL,lease text,lease_until timestamptz,payload jsonb NOT NULL,
    PRIMARY KEY(owner,id))`,
    )
    .then(() => undefined)
    .catch((error) => {
      ready = undefined;
      throw error;
    }));
  return d;
}
export function runJournal(owner: string) {
  if (!owner || owner.length > 200)
    throw new AppError("Authentication required", 401);
  const read = async (id: string) => {
    z.uuid().parse(id);
    const d = await storage();
    const r = await d.execute(
      sql`SELECT payload FROM agus2_agent_runs WHERE owner=${owner} AND id=${id}`,
    );
    if (!r.rows.length) throw new AppError("Run not found", 404);
    return r.rows[0].payload as AgentRun;
  };
  return {
    read,
    async list(conversationId?: string) {
      if (conversationId) IdSchema.parse(conversationId);
      const d = await storage();
      const r = await d.execute(
        conversationId
          ? sql`SELECT payload FROM agus2_agent_runs WHERE owner=${owner} AND conversation=${conversationId} ORDER BY payload->>'updatedAt' DESC LIMIT 20`
          : sql`SELECT payload FROM agus2_agent_runs WHERE owner=${owner} ORDER BY payload->>'updatedAt' DESC LIMIT 20`,
      );
      return r.rows.map((r) => r.payload as AgentRun);
    },
    async create(input: {
      id?: string;
      conversationId: string;
      goal: string;
      accountIds: string[];
    }) {
      const id = z.uuid().parse(input.id ?? randomUUID());
      IdSchema.parse(input.conversationId);
      z.string().min(1).max(4000).parse(input.goal);
      z.array(IdSchema).max(5).parse(input.accountIds);
      const at = new Date().toISOString();
      const run: AgentRun = {
        id,
        owner,
        conversationId: input.conversationId,
        goal: redactAgentText(input.goal),
        accountIds: input.accountIds,
        state: "queued",
        version: 0,
        createdAt: at,
        updatedAt: at,
        plan: [],
        steps: [],
      };
      const d = await storage();
      await d.execute(
        sql`INSERT INTO agus2_agent_runs(owner,id,conversation,state,version,payload) VALUES (${owner},${id},${input.conversationId},'queued',0,${JSON.stringify(run)}::jsonb) ON CONFLICT DO NOTHING`,
      );
      const saved = await read(id);
      if (
        saved.conversationId !== run.conversationId ||
        saved.goal !== run.goal ||
        JSON.stringify(saved.accountIds) !== JSON.stringify(run.accountIds)
      )
        throw new AppError(
          "Request identity was already used for different instructions",
          409,
        );
      return saved;
    },
    async claim(id: string, resume = false) {
      const d = await storage();
      const lease = randomUUID();
      return d.transaction(async (tx) => {
        const rows = await tx.execute(
          sql`SELECT payload,lease_until > now() AS busy FROM agus2_agent_runs WHERE owner=${owner} AND id=${z.uuid().parse(id)} FOR UPDATE`,
        );
        if (!rows.rows.length) throw new AppError("Run not found", 404);
        const run = rows.rows[0].payload as AgentRun;
        if (run.state === "completed" || run.state === "waiting_user")
          return { run, lease: null };
        if (run.state === "cancelled") return { run, lease: null };
        if (rows.rows[0].busy)
          throw new AppError("Run is already in progress", 409);
        if (["paused", "interrupted"].includes(run.state) && !resume)
          return { run, lease: null };
        run.steps = run.steps.map((step) =>
          step.state === "started"
            ? {
                ...step,
                state: "unknown" as const,
                code: "INTERRUPTED_BEFORE_RESULT",
              }
            : step,
        );
        run.state = "running";
        run.version++;
        run.updatedAt = new Date().toISOString();
        delete run.reason;
        await tx.execute(
          sql`UPDATE agus2_agent_runs SET state='running',version=${run.version},lease=${lease},lease_until=now()+interval '90 seconds',payload=${JSON.stringify(run)}::jsonb WHERE owner=${owner} AND id=${id}`,
        );
        return { run, lease };
      });
    },
    /** Merge against the locked latest state: user pause/cancel must never be overwritten. */
    async update(
      id: string,
      lease: string,
      patch: {
        step?: ExecutionStep;
        plan?: PlanStep[];
        state?: RunStatus;
        reply?: AgentRun["reply"];
        disclosures?: string[];
        reason?: string;
        release?: boolean;
      },
    ) {
      const d = await storage();
      return d.transaction(async (tx) => {
        const rows = await tx.execute(
          sql`SELECT payload FROM agus2_agent_runs WHERE owner=${owner} AND id=${id} AND lease=${lease} FOR UPDATE`,
        );
        if (!rows.rows.length) throw new AppError("Run lease changed", 409);
        const run = rows.rows[0].payload as AgentRun;
        if (patch.step) {
          const existing = run.steps.findIndex(
            (s) => s.sequence === patch.step!.sequence,
          );
          if (existing < 0) run.steps.push(patch.step);
          else run.steps[existing] = patch.step;
        }
        const stopped = run.state === "paused" || run.state === "cancelled";
        if (!stopped) {
          if (patch.plan) run.plan = patch.plan;
          if (patch.state) run.state = patch.state;
          if (patch.reply) run.reply = patch.reply;
          if (patch.disclosures) run.disclosures = patch.disclosures;
          if (patch.reason) run.reason = patch.reason;
        }
        run.version++;
        run.updatedAt = new Date().toISOString();
        const payload = JSON.stringify(run);
        if (Buffer.byteLength(payload) > 256000)
          throw new AppError("Run checkpoint limit reached", 413);
        await tx.execute(
          sql`UPDATE agus2_agent_runs SET state=${run.state},version=${run.version},payload=${payload}::jsonb,lease=${patch.release ? null : lease},lease_until=${patch.release ? null : sql`now()+interval '90 seconds'`} WHERE owner=${owner} AND id=${id} AND lease=${lease}`,
        );
        return run;
      });
    },
    async control(id: string, version: number, action: "pause" | "cancel") {
      z.number().int().nonnegative().parse(version);
      const d = await storage();
      return d.transaction(async (tx) => {
        const rows = await tx.execute(
          sql`SELECT payload FROM agus2_agent_runs WHERE owner=${owner} AND id=${z.uuid().parse(id)} FOR UPDATE`,
        );
        if (!rows.rows.length) throw new AppError("Run not found", 404);
        const run = rows.rows[0].payload as AgentRun;
        if (run.version !== version)
          throw new AppError("Run changed; refresh", 409);
        if (["completed", "cancelled", "waiting_user"].includes(run.state))
          throw new AppError("Run is already stopped", 409);
        run.state = action === "pause" ? "paused" : "cancelled";
        run.version++;
        run.updatedAt = new Date().toISOString();
        await tx.execute(
          sql`UPDATE agus2_agent_runs SET state=${run.state},version=${run.version},payload=${JSON.stringify(run)}::jsonb WHERE owner=${owner} AND id=${id}`,
        );
        return run;
      });
    },
  };
}
export type RunJournal = ReturnType<typeof runJournal>;
