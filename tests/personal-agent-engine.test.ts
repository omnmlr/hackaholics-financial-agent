/** Scripted models exercise actual dispatch/journal/SQL; not genuine model performance. */
import { randomUUID } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
import { z } from "zod";
import type { ToolModel } from "../src/lib/model-led-agent/model";
import {
  createPersonalAgent,
  executionKey,
} from "../src/lib/personal-agent/engine";
import { runJournal } from "../src/lib/personal-agent/journal";
import type { AgentTool } from "../src/lib/personal-agent/contracts";
import { workspace } from "../src/lib/agent-workspace/store";
import { AgentError } from "../src/lib/financial-agent/protocol";

beforeAll(() =>
  Object.assign(process.env, {
    DATABASE_URL: "pglite://:memory:",
    PAYMENT_MODE: "fixture",
    AGUS_WORKSPACE_ENABLED: "true",
  }),
);
type Generated = Awaited<ReturnType<ToolModel["generate"]>>;
function answer(text: string): Generated {
  return { text, content: { role: "model", parts: [{ text }] }, calls: [] };
}
function calls(
  ...list: { name: string; args: Record<string, unknown>; id?: string }[]
): Generated {
  return {
    text: "",
    content: {
      role: "model",
      parts: list.map((functionCall) => ({ functionCall })),
    },
    calls: list,
  };
}
function scripted(
  items: Generated[],
  onGenerate?: (input: Parameters<ToolModel["generate"]>[0]) => void,
): ToolModel {
  let index = 0;
  return {
    provider: "scripted",
    model: "scripted",
    async generate(input) {
      onGenerate?.(input);
      if (input.responseJsonSchema) return answer('{"grounded":true}');
      if (index >= items.length) throw new Error("provider unavailable");
      return items[index++];
    },
  };
}
function noteTool(owner: string): AgentTool {
  const schema = z.strictObject({
    text: z.string().min(1),
    category: z.enum(["note", "preference", "agreement", "commitment"]),
  });
  return {
    declaration: {
      name: "save_note",
      description: "Propose a note",
      parametersJsonSchema: {},
    },
    schema,
    effect: "proposal",
    idempotent: true,
    async execute(args, ctx) {
      const memory = await workspace(owner).proposeMemory(args, ctx.key);
      return {
        summary: "Memory proposed; human confirmation is still required.",
        data: memory,
        awaitingUser: !memory.confirmed,
        reply: {
          kind: "general",
          text: "Memory proposed",
          workspace: { kind: "memory", id: memory.id },
          citations: [],
          evidence: { modelCalls: 0, toolCalls: 1, resultBytes: 0 },
        },
      };
    },
  };
}
async function setup(
  model: ToolModel,
  tools: AgentTool[] = [],
  owner = randomUUID(),
) {
  const journal = runJournal(owner);
  const run = await journal.create({
    conversationId: "general-work",
    goal: "Evaluate my options, preserve useful context and follow through where supported",
    accountIds: [],
  });
  return {
    owner,
    journal,
    run,
    agent: createPersonalAgent({ model, journal, tools }),
  };
}
it("answers open-ended reasoning directly without a bank, plan template or extra reviewer", async () => {
  let generations = 0;
  const s = await setup(
    scripted(
      [
        answer(
          "Here is a structured comparison of the trade-offs, with assumptions stated clearly.",
        ),
      ],
      () => generations++,
    ),
  );
  const result = await s.agent.run({ id: s.run.id });
  expect(result.text).toContain("trade-offs");
  expect(result.execution?.state).toBe("completed");
  expect(generations).toBe(1);
  expect(result.evidence.toolCalls).toBe(0);
});
it("composes dynamic plans, multiple tools, evidence and a useful natural final answer", async () => {
  const owner = randomUUID();
  const tool = noteTool(owner);
  const model = scripted(
    [
      calls({
        name: "update_plan",
        args: {
          steps: [
            {
              id: "evaluate",
              description: "Evaluate supplied options",
              kind: "analysis",
              status: "done",
              result:
                "The supplied alternatives differ in cost and flexibility.",
            },
            {
              id: "remember",
              description: "Save the preferred option",
              kind: "tool",
              status: "in_progress",
            },
          ],
        },
      }),
      calls({
        name: "save_note",
        id: "native-call-42",
        args: { text: "Prefer flexible commitments", category: "preference" },
      }),
      calls({
        name: "update_plan",
        args: {
          steps: [
            {
              id: "evaluate",
              description: "Evaluate supplied options",
              kind: "analysis",
              status: "done",
              result: "Prefer flexibility when costs are comparable.",
            },
            {
              id: "remember",
              description: "Prepare the preference for confirmation",
              kind: "tool",
              status: "done",
              evidence: [2],
            },
          ],
        },
      }),
      answer(
        "The flexible option best fits the preference you described. I saved that preference as an unconfirmed proposal; review it before it becomes confirmed memory. External execution remains unavailable.",
      ),
    ],
    (input) => {
      if (JSON.stringify(input.contents).includes('"functionResponse"'))
        expect(JSON.stringify(input.contents)).toContain("execution");
    },
  );
  const s = await setup(model, [tool], owner);
  const result = await s.agent.run({ id: s.run.id });
  expect(result.text).toContain("best fits");
  expect(result.text).not.toBe("Memory proposed");
  expect(result.execution?.state).toBe("waiting_user");
  expect(result.workspaceActions).toHaveLength(1);
  const saved = await s.journal.read(s.run.id);
  expect(saved.plan[1].evidence).toEqual([2]);
  expect(saved.steps.map((s) => s.state)).toEqual([
    "succeeded",
    "succeeded",
    "succeeded",
  ]);
  expect((await workspace(owner).snapshot()).memories[0].confirmed).toBe(false);
});
it("returns field-specific validation feedback and repairs tool calls without terminating the task", async () => {
  const schema = z.strictObject({ value: z.number().int() });
  let count = 0;
  const tool: AgentTool = {
    declaration: {
      name: "double",
      description: "Double a supplied number",
      parametersJsonSchema: {},
    },
    schema,
    effect: "read",
    async execute(raw) {
      count++;
      return {
        summary: "Number doubled",
        data: { value: schema.parse(raw).value * 2 },
      };
    },
  };
  const s = await setup(
    scripted(
      [
        calls({ name: "double", id: "bad", args: { value: "wrong" } }),
        calls({ name: "double", id: "good", args: { value: 7 } }),
        answer("The evaluated result is 14."),
      ],
      (input) => {
        if (
          JSON.stringify(input.contents).includes('"id":"bad"') &&
          input.contents.length > 2
        )
          expect(JSON.stringify(input.contents)).toContain("INVALID_ARGUMENT");
      },
    ),
    [tool],
  );
  const result = await s.agent.run({ id: s.run.id });
  expect(result.text).toContain("14");
  expect(count).toBe(1);
  expect((await s.journal.read(s.run.id)).steps.map((s) => s.state)).toEqual([
    "failed",
    "succeeded",
  ]);
});
it("returns an already-completed proposal rather than duplicating it on repeated calls or request replay", async () => {
  const owner = randomUUID();
  const tool = noteTool(owner);
  const execute = vi.spyOn(tool, "execute");
  const args = { text: "Follow agreements carefully", category: "note" };
  const s = await setup(
    scripted([
      calls({ name: "save_note", args }),
      calls({ name: "save_note", args }),
      answer("Your note is saved as a proposal and awaits confirmation."),
    ]),
    [tool],
    owner,
  );
  const first = await s.agent.run({ id: s.run.id });
  const second = await s.agent.run({ id: s.run.id });
  expect(first.execution?.state).toBe("waiting_user");
  expect(second.execution?.replayed).toBe(true);
  expect(second.evidence.modelCalls).toBe(0);
  expect(execute).toHaveBeenCalledTimes(1);
  expect((await workspace(owner).snapshot()).memories).toHaveLength(1);
});
it("retains successful steps after provider failure and resumes without repeating a proposal", async () => {
  const owner = randomUUID();
  const tool = noteTool(owner);
  const execute = vi.spyOn(tool, "execute");
  const args = { text: "Remember pending commitments", category: "commitment" };
  const s = await setup(
    scripted([calls({ name: "save_note", args })]),
    [tool],
    owner,
  );
  const partial = await s.agent.run({ id: s.run.id });
  expect(partial.execution?.state).toBe("interrupted");
  expect(partial.workspaceActions).toHaveLength(1);
  const resumed = await createPersonalAgent({
    journal: s.journal,
    tools: [tool],
    model: scripted([
      calls({ name: "save_note", args }),
      answer(
        "The commitment note was already prepared. Please confirm it; no external action occurred.",
      ),
    ]),
  }).run({ id: s.run.id, resume: true });
  expect(resumed.text).toContain("already prepared");
  expect(execute).toHaveBeenCalledTimes(1);
  expect((await workspace(owner).snapshot()).memories).toHaveLength(1);
});
it("honors cancellation before executing model-proposed tools", async () => {
  const owner = randomUUID();
  const journal = runJournal(owner);
  const run = await journal.create({
    conversationId: "stop",
    goal: "Remember a commitment",
    accountIds: [],
  });
  const tool = noteTool(owner);
  const execute = vi.spyOn(tool, "execute");
  const model: ToolModel = {
    provider: "scripted",
    model: "scripted",
    async generate() {
      const current = await journal.read(run.id);
      await journal.control(run.id, current.version, "cancel");
      return calls({
        name: "save_note",
        args: { text: "Must not be created", category: "note" },
      });
    },
  };
  const result = await createPersonalAgent({
    model,
    journal,
    tools: [tool],
  }).run({ id: run.id });
  expect(result.execution?.state).toBe("cancelled");
  expect(execute).not.toHaveBeenCalled();
});
it("retains a completed in-flight record but never overwrites a user pause", async () => {
  const owner = randomUUID();
  const s = await setup(
    scripted([calls({ name: "work", args: {} })]),
    [],
    owner,
  );
  const tool: AgentTool = {
    declaration: { name: "work", parametersJsonSchema: {} },
    schema: z.strictObject({}),
    effect: "read",
    async execute() {
      const current = await s.journal.read(s.run.id);
      await s.journal.control(s.run.id, current.version, "pause");
      return {
        summary: "Read completed before pause was observed",
        data: { value: 1 },
      };
    },
  };
  const result = await createPersonalAgent({
    model: scripted([calls({ name: "work", args: {} })]),
    journal: s.journal,
    tools: [tool],
  }).run({ id: s.run.id });
  expect(result.execution?.state).toBe("paused");
  expect((await s.journal.read(s.run.id)).steps[0].state).toBe("succeeded");
});
it("rejects unsupported completion narration and preserves factual preparation evidence", async () => {
  const owner = randomUUID();
  const model = scripted([
    calls({
      name: "save_note",
      args: { text: "Gerald proposed Friday", category: "agreement" },
    }),
    answer("Your payment was sent and the agreement is approved."),
    answer("Your payment was sent and the agreement is approved."),
  ]);
  const original = model.generate;
  model.generate = async (input) =>
    input.responseJsonSchema ? answer('{"grounded":false}') : original(input);
  const s = await setup(model, [noteTool(owner)], owner);
  const result = await s.agent.run({ id: s.run.id });
  expect(result.text).not.toContain("payment was sent");
  expect(result.text).toContain("human confirmation");
  expect(result.execution?.reason).toBe("UNSUPPORTED_NARRATION");
  expect(result.execution?.state).toBe("interrupted");
});
it("requires execution evidence for completed tool plan steps", async () => {
  const s = await setup(
    scripted([
      calls({
        name: "update_plan",
        args: {
          steps: [
            {
              id: "call",
              description: "Call Gerald",
              kind: "tool",
              status: "done",
            },
          ],
        },
      }),
      answer("Calling is not available; I can help prepare the discussion."),
    ]),
  );
  const result = await s.agent.run({ id: s.run.id });
  expect((await s.journal.read(s.run.id)).plan).toEqual([]);
  expect(result.execution?.steps[0].code).toBe("EXECUTION_EVIDENCE_REQUIRED");
});
it("rechecks authorization before releasing a financial result or cached response", async () => {
  let valid = true;
  const tool: AgentTool = {
    declaration: { name: "financial", parametersJsonSchema: {} },
    schema: z.strictObject({}),
    effect: "read",
    volatile: true,
    validate: async () => {
      if (!valid) throw new AgentError("ACCESS_CHANGED");
    },
    async execute() {
      return {
        summary: "Financial read completed",
        data: { amount: 12345 },
        reply: {
          kind: "financial",
          text: "Private amount 12345",
          citations: ["fixture-source"],
          evidence: { modelCalls: 0, toolCalls: 1, resultBytes: 1 },
        },
      };
    },
  };
  const model = scripted(
    [
      calls({ name: "financial", args: {} }),
      answer("The source reports 12345."),
    ],
    (input) => {
      if (input.responseJsonSchema) valid = false;
    },
  );
  const s = await setup(model, [tool]);
  const result = await s.agent.run({ id: s.run.id });
  expect(result.kind).toBe("unavailable");
  expect(result.text).not.toContain("12345");
  expect(result.citations).toEqual([]);
});
it("uses a canonical server-owned idempotency key independent of model argument ordering", () => {
  const run = randomUUID();
  expect(executionKey(run, "tool", { a: 1, b: 2 })).toBe(
    executionKey(run, "tool", { b: 2, a: 1 }),
  );
  expect(executionKey(run, "tool", { a: 1 })).not.toBe(
    executionKey(run, "tool", { a: 2 }),
  );
  expect(z.uuid().safeParse(executionKey(run, "tool", {})).success).toBe(true);
});

it("does not resurrect a forgotten memory under an old idempotency key", async () => {
  const owner = randomUUID(),
    store = workspace(owner),
    id = randomUUID(),
    input = { text: "A temporary personal note", category: "note" };
  const note = await store.proposeMemory(input, id);
  await store.memoryAction(note.id, "forget");
  await expect(store.proposeMemory(input, id)).rejects.toMatchObject({
    code: "MEMORY_FORGOTTEN",
  });
  expect((await store.snapshot()).memories).toHaveLength(0);
});

it("recovers a transient provider failure once without retrying completed tools", async () => {
  let count = 0;
  const model: ToolModel = {
    provider: "scripted",
    model: "scripted",
    async generate() {
      if (count++ === 0) throw new AgentError("MODEL_HTTP_503");
      return answer("Here is the requested analysis.");
    },
  };
  const s = await setup(model);
  const result = await s.agent.run({ id: s.run.id });
  expect(result.text).toContain("requested analysis");
  expect(count).toBe(2);
  expect(result.execution?.state).toBe("completed");
});
it("repairs unsupported final narration against existing results without replaying a write", async () => {
  const owner = randomUUID();
  let reviews = 0;
  const model = scripted([
    calls({
      name: "save_note",
      args: { text: "Review Gerald's proposal", category: "agreement" },
    }),
    answer("I activated it and paid."),
    answer(
      "The agreement note is proposed, awaiting your confirmation. No payment occurred.",
    ),
  ]);
  const original = model.generate;
  model.generate = async (input) =>
    input.responseJsonSchema
      ? answer(JSON.stringify({ grounded: ++reviews > 1 }))
      : original(input);
  const tool = noteTool(owner),
    execute = vi.spyOn(tool, "execute"),
    s = await setup(model, [tool], owner);
  const result = await s.agent.run({ id: s.run.id });
  expect(result.text).toContain("awaiting your confirmation");
  expect(execute).toHaveBeenCalledTimes(1);
  expect(reviews).toBe(2);
});
