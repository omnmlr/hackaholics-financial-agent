import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { AppError } from "../domain";

export function requireWorkspace() {
  if (
    process.env.AGUS_WORKSPACE_ENABLED !== "true" ||
    process.env.PAYMENT_MODE === "live"
  )
    throw new AppError("Development agent workspace is disabled", 503);
}
export const TaskInput = z.strictObject({
  requestId: z.uuid().optional(),
  title: z.string().trim().min(1).max(120),
  objective: z.string().trim().min(1).max(2000),
  dueAt: z.iso.datetime({ offset: true }),
  intervalSeconds: z.number().int().min(60).max(2678400).optional(),
});
export const MemoryInput = z.strictObject({
  text: z.string().trim().min(1).max(1000),
  category: z.enum(["preference", "commitment", "agreement", "note"]),
});
export type Responsibility = z.infer<typeof TaskInput> & {
  id: string;
  version: number;
  state: "awaiting_approval" | "active" | "paused" | "cancelled" | "completed";
  scope: "in_app_reminder_only" | "solana_devnet_reconciliation_only";
  watch?: {
    draftId: string;
    expiresAt: string;
    attempts: number;
    checkedAt?: string;
    observedState?: string;
    failureCode?: string;
    signature?: string;
    confirmation?: {
      slot: number;
      commitment: "confirmed" | "finalized";
      feeLamports: string;
    };
  };
  createdAt: string;
};
export type MemoryFact = z.infer<typeof MemoryInput> & {
  id: string;
  confirmed: boolean;
  createdAt: string;
  provenance: "user_supplied_or_model_proposed";
};
let ready: Promise<void> | undefined;
export async function initializeWorkspace() {
  requireWorkspace();
  const d = await db();
  await (ready ??= (async () => {
    await d.execute(sql`CREATE TABLE IF NOT EXISTS agus2_tasks (
      owner text NOT NULL,id text NOT NULL,version integer NOT NULL DEFAULT 0,
      state text NOT NULL,due_at timestamptz NOT NULL,payload jsonb NOT NULL,
      PRIMARY KEY(owner,id))`);
    await d.execute(
      sql`CREATE INDEX IF NOT EXISTS agus2_tasks_due ON agus2_tasks(state,due_at)`,
    );
    await d.execute(sql`CREATE TABLE IF NOT EXISTS agus2_memories (
      owner text NOT NULL,id text NOT NULL,confirmed boolean NOT NULL DEFAULT false,
      payload jsonb NOT NULL,PRIMARY KEY(owner,id))`);
    await d.execute(sql`CREATE TABLE IF NOT EXISTS agus2_events (
      owner text NOT NULL,id text NOT NULL,task text NOT NULL,kind text NOT NULL,
      created_at timestamptz NOT NULL,PRIMARY KEY(owner,id))`);
    await d.execute(sql`CREATE TABLE IF NOT EXISTS agus2_notifications (
      owner text NOT NULL,id text NOT NULL,task text NOT NULL,payload jsonb NOT NULL,
      PRIMARY KEY(owner,id))`);
  })().catch((error) => {
    ready = undefined;
    throw error;
  }));
  return d;
}
export function workspace(owner: string) {
  if (!owner || owner.length > 200)
    throw new AppError("Authentication required", 401);
  return {
    async snapshot() {
      const d = await initializeWorkspace();
      const tasks = await d.execute(
        sql`SELECT payload FROM agus2_tasks WHERE owner=${owner} ORDER BY due_at,id LIMIT 100`,
      );
      const memories = await d.execute(
        sql`SELECT payload FROM agus2_memories WHERE owner=${owner} ORDER BY id LIMIT 100`,
      );
      const notifications = await d.execute(
        sql`SELECT payload FROM agus2_notifications WHERE owner=${owner} ORDER BY id DESC LIMIT 100`,
      );
      const events = await d.execute(
        sql`SELECT task,kind,created_at FROM agus2_events WHERE owner=${owner} ORDER BY created_at DESC LIMIT 100`,
      );
      return {
        tasks: tasks.rows.map((r) => r.payload as Responsibility),
        memories: memories.rows.map((r) => r.payload as MemoryFact),
        notifications: notifications.rows.map((r) => r.payload),
        events: events.rows,
      };
    },
    async createTask(raw: unknown) {
      const input = TaskInput.parse(raw);
      if (Date.parse(input.dueAt) > Date.now() + 366 * 86400000)
        throw new AppError("Choose a due date within one year", 400);
      const task: Responsibility = {
        ...input,
        id: input.requestId ?? randomUUID(),
        version: 0,
        state: "awaiting_approval",
        scope: "in_app_reminder_only",
        createdAt: new Date().toISOString(),
      };
      const d = await initializeWorkspace();
      const inserted = await d.execute(
        sql`INSERT INTO agus2_tasks(owner,id,state,due_at,payload) VALUES (${owner},${task.id},${task.state},${task.dueAt}::timestamptz,${JSON.stringify(task)}::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
      );
      if (!inserted.rows.length) {
        const rows = await d.execute(
          sql`SELECT payload FROM agus2_tasks WHERE owner=${owner} AND id=${task.id}`,
        );
        const original = rows.rows[0]?.payload as Responsibility | undefined;
        if (
          !original ||
          original.scope !== "in_app_reminder_only" ||
          original.title !== task.title ||
          original.objective !== task.objective ||
          original.dueAt !== task.dueAt ||
          original.intervalSeconds !== task.intervalSeconds
        )
          throw new AppError(
            "Request identity already used for different instructions",
            409,
          );
        return original;
      }
      return task;
    },
    async transition(
      id: string,
      version: number,
      action: "approve" | "pause" | "resume" | "cancel",
    ) {
      z.uuid().parse(id);
      z.number().int().min(0).parse(version);
      const d = await initializeWorkspace();
      return d.transaction(async (tx) => {
        const row = await tx.execute(
          sql`SELECT payload FROM agus2_tasks WHERE owner=${owner} AND id=${id} FOR UPDATE`,
        );
        if (!row.rows.length)
          throw new AppError("Responsibility not found", 404);
        const task = row.rows[0].payload as Responsibility;
        if (task.version !== version)
          throw new AppError("Responsibility changed; refresh", 409);
        const allowed = {
          approve: ["awaiting_approval"],
          pause: ["active"],
          resume: ["paused"],
          cancel: ["awaiting_approval", "active", "paused"],
        };
        if (!allowed[action].includes(task.state))
          throw new AppError("Transition is not allowed", 409);
        task.state =
          action === "pause"
            ? "paused"
            : action === "cancel"
              ? "cancelled"
              : "active";
        task.version++;
        await tx.execute(
          sql`UPDATE agus2_tasks SET version=${task.version},state=${task.state},payload=${JSON.stringify(task)}::jsonb WHERE owner=${owner} AND id=${id}`,
        );
        await tx.execute(
          sql`INSERT INTO agus2_events VALUES (${owner},${randomUUID()},${id},${action},now())`,
        );
        return task;
      });
    },
    async proposeMemory(raw: unknown) {
      const input = MemoryInput.parse(raw);
      const memory: MemoryFact = {
        ...input,
        id: randomUUID(),
        confirmed: false,
        createdAt: new Date().toISOString(),
        provenance: "user_supplied_or_model_proposed",
      };
      const d = await initializeWorkspace();
      await d.execute(
        sql`INSERT INTO agus2_memories VALUES (${owner},${memory.id},false,${JSON.stringify(memory)}::jsonb)`,
      );
      return memory;
    },
    async memoryAction(id: string, action: "confirm" | "forget") {
      z.uuid().parse(id);
      const d = await initializeWorkspace();
      if (action === "forget") {
        const r = await d.execute(
          sql`DELETE FROM agus2_memories WHERE owner=${owner} AND id=${id} RETURNING id`,
        );
        if (!r.rows.length) throw new AppError("Memory not found", 404);
        return { forgotten: true };
      }
      const r = await d.execute(
        sql`UPDATE agus2_memories SET confirmed=true,payload=jsonb_set(payload,'{confirmed}','true') WHERE owner=${owner} AND id=${id} RETURNING payload`,
      );
      if (!r.rows.length) throw new AppError("Memory not found", 404);
      return r.rows[0].payload;
    },
    async runDue(now = new Date()) {
      const d = await initializeWorkspace();
      // All work is a local notification in one transaction: no replayable external effects.
      return d.transaction(async (tx) => {
        const rows = await tx.execute(
          sql`SELECT payload FROM agus2_tasks WHERE owner=${owner} AND state='active' AND payload->>'scope'='in_app_reminder_only' AND due_at <= ${now.toISOString()}::timestamptz ORDER BY due_at,id LIMIT 25 FOR UPDATE SKIP LOCKED`,
        );
        let delivered = 0;
        for (const row of rows.rows) {
          const task = row.payload as Responsibility;
          const notification = {
            id: `${task.id}:${task.dueAt}`,
            taskId: task.id,
            title: task.title,
            text: task.objective,
            dueAt: task.dueAt,
            createdAt: now.toISOString(),
            evidence:
              "Scheduled reminder only; not a verified financial or external outcome.",
          };
          const inserted = await tx.execute(
            sql`INSERT INTO agus2_notifications VALUES (${owner},${notification.id},${task.id},${JSON.stringify(notification)}::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
          );
          delivered += inserted.rows.length;
          task.version++;
          task.state = task.intervalSeconds ? "active" : "completed";
          if (task.intervalSeconds)
            task.dueAt = new Date(
              now.getTime() + task.intervalSeconds * 1000,
            ).toISOString();
          await tx.execute(
            sql`UPDATE agus2_tasks SET version=${task.version},state=${task.state},due_at=${task.dueAt}::timestamptz,payload=${JSON.stringify(task)}::jsonb WHERE owner=${owner} AND id=${task.id}`,
          );
          await tx.execute(
            sql`INSERT INTO agus2_events VALUES (${owner},${randomUUID()},${task.id},'in_app_reminder_delivered',${now.toISOString()}::timestamptz)`,
          );
        }
        return { delivered, externalActions: 0 };
      });
    },
  };
}
