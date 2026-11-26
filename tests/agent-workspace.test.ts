import { beforeAll, describe, expect, it } from "vitest";
import {
  initializeWorkspace,
  workspace,
} from "../src/lib/agent-workspace/store";
import { GET, POST } from "../src/app/api/agent-workspace/route";

beforeAll(async () => {
  process.env.AGUS_WORKSPACE_ENABLED = "true";
  process.env.PAYMENT_MODE = "fixture";
  process.env.DATABASE_URL = "pglite://:memory:";
  await initializeWorkspace();
});
describe("durable personal responsibilities", () => {
  const dueAt = "2026-01-01T00:00:00.000Z";
  it("requires explicit approval, prevents duplicate due effects, and isolates owners", async () => {
    const a = workspace("workspace-A"),
      b = workspace("workspace-B");
    const task = await a.createTask({
      title: "Review agreement",
      objective: "Check the terms with Gerald",
      dueAt,
    });
    expect(await a.runDue()).toEqual({ delivered: 0, externalActions: 0 });
    await expect(b.transition(task.id, 0, "approve")).rejects.toMatchObject({
      status: 404,
    });
    await a.transition(task.id, 0, "approve");
    await expect(a.transition(task.id, 0, "cancel")).rejects.toMatchObject({
      status: 409,
    });
    expect((await a.runDue()).delivered).toBe(1);
    expect((await a.runDue()).delivered).toBe(0);
    expect((await a.snapshot()).notifications).toHaveLength(1);
    expect((await b.snapshot()).tasks).toHaveLength(0);
  });
  it("pause, new service instance, resume, and cancellation persist", async () => {
    const a = workspace("workspace-lifecycle");
    const t = await a.createTask({
      title: "Bill check",
      objective: "Review bill; do not pay",
      dueAt,
      intervalSeconds: 60,
    });
    await a.transition(t.id, 0, "approve");
    await a.transition(t.id, 1, "pause");
    expect((await workspace("workspace-lifecycle").runDue()).delivered).toBe(0);
    await a.transition(t.id, 2, "resume");
    await a.transition(t.id, 3, "cancel");
    expect((await a.runDue()).delivered).toBe(0);
    await expect(a.transition(t.id, 4, "resume")).rejects.toMatchObject({
      status: 409,
    });
  });
  it("recurring reminders advance after downtime without a catch-up storm", async () => {
    const a = workspace("workspace-recurring");
    const t = await a.createTask({
      title: "Review commitments",
      objective: "Review known commitments",
      dueAt,
      intervalSeconds: 3600,
    });
    await a.transition(t.id, 0, "approve");
    const now = new Date("2026-11-09T12:00:00Z");
    expect((await a.runDue(now)).delivered).toBe(1);
    expect((await a.runDue(now)).delivered).toBe(0);
    expect((await a.snapshot()).tasks[0].dueAt).toBe(
      "2026-11-09T13:00:00.000Z",
    );
  });
  it("memory remains attributed and unconfirmed until user confirmation, and can be forgotten", async () => {
    const a = workspace("workspace-memory");
    const m = await a.proposeMemory({
      text: "Gerald proposed Friday",
      category: "agreement",
    });
    expect(m.confirmed).toBe(false);
    await expect(
      workspace("other").memoryAction(m.id, "confirm"),
    ).rejects.toMatchObject({ status: 404 });
    await a.memoryAction(m.id, "confirm");
    expect((await a.snapshot()).memories[0].confirmed).toBe(true);
    await a.memoryAction(m.id, "forget");
    expect((await a.snapshot()).memories).toEqual([]);
  });
  it("rejects extra action authority and unsafe input", async () => {
    await expect(
      workspace("A").createTask({
        title: "Pay",
        objective: "pay",
        dueAt,
        executeTransfer: true,
      }),
    ).rejects.toThrow();
    await expect(
      workspace("A").createTask({ title: "", objective: "x", dueAt }),
    ).rejects.toThrow();
  });
  it("API denies anonymous reads and cross-origin writes", async () => {
    expect(
      (await GET(new Request("http://localhost/api/agent-workspace"))).status,
    ).toBe(401);
    expect(
      (
        await POST(
          new Request("http://localhost/api/agent-workspace", {
            method: "POST",
            headers: { origin: "https://elsewhere.invalid" },
          }),
        )
      ).status,
    ).toBe(403);
  });
  it("fails closed when disabled or live financial execution is configured", async () => {
    process.env.PAYMENT_MODE = "live";
    await expect(workspace("A").snapshot()).rejects.toMatchObject({
      status: 503,
    });
    process.env.PAYMENT_MODE = "fixture";
  });
});
