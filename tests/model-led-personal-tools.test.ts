// Scripted model only; actual SQL/tools run. Not genuine-provider evidence.
import { expect, it } from "vitest";
import { personalTools } from "../src/lib/agent-workspace/tools";
import { workspace } from "../src/lib/agent-workspace/store";
import { createModelLedAgent } from "../src/lib/model-led-agent/agent";
import {
  createFixtureRepository,
  createFixtureDataSource,
  createReadTools,
  fixturePrincipal,
  FIXTURE_NOW,
} from "../src/lib/financial-data";
import {
  createRepositoryAccess,
  MemoryContextStore,
} from "../src/lib/financial-agent";
import type { ToolModel } from "../src/lib/model-led-agent/model";

it("native function calling persists an unapproved responsibility and never exposes approval/signing tools", async () => {
  process.env.AGUS_WORKSPACE_ENABLED = "true";
  process.env.DATABASE_URL = "pglite://:memory:";
  process.env.PAYMENT_MODE = "fixture";
  const repository = createFixtureRepository();
  const clock = () => FIXTURE_NOW;
  const tools = createReadTools({
    repository,
    sources: [createFixtureDataSource({ repository, clock })],
    clock,
  });
  const model: ToolModel = {
    provider: "scripted",
    model: "scripted",
    async generate(input) {
      const names = input.declarations.map((d) => d.name);
      expect(names).toContain("prepare_responsibility");
      expect(
        names.some((n) => /approve|submit|sign|execute_payment/.test(n ?? "")),
      ).toBe(false);
      const args = {
        title: "Follow up with Gerald",
        objective: "Review the agreement; do not pay",
        dueAt: "2026-11-10T10:00:00Z",
      };
      return {
        text: "",
        content: {
          role: "model",
          parts: [{ functionCall: { name: "prepare_responsibility", args } }],
        },
        calls: [{ name: "prepare_responsibility", args }],
      };
    },
  };
  const agent = createModelLedAgent({
    model,
    tools,
    clock,
    access: createRepositoryAccess(repository, clock),
    store: new MemoryContextStore(),
    workspace: personalTools("native-owner"),
  });
  const result = await agent.turn({
    ctx: fixturePrincipal,
    conversationId: "personal-tools-test",
    text: "Remind me to follow up with Gerald tomorrow",
    accountIds: [],
  });
  expect(result.text).toContain("awaiting your approval");
  const snapshot = await workspace("native-owner").snapshot();
  expect(snapshot.tasks).toHaveLength(1);
  expect(snapshot.tasks[0].state).toBe("awaiting_approval");
  expect(
    (await workspace("native-owner").runDue(new Date("2026-11-12"))).delivered,
  ).toBe(0);
});

it("completes compound personal tools, preserves both review artifacts, and ignores invented approval prose", async () => {
  const repository = createFixtureRepository();
  const clock = () => FIXTURE_NOW;
  const tools = createReadTools({
    repository,
    sources: [createFixtureDataSource({ repository, clock })],
    clock,
  });
  const calls = [
    {
      name: "save_memory_proposal",
      args: { text: "Gerald proposed a Friday review", category: "agreement" },
    },
    {
      name: "prepare_responsibility",
      args: {
        title: "Review Gerald's proposal",
        objective: "Review only; no payments",
        dueAt: "2026-11-11T10:00:00Z",
      },
    },
  ];
  let iterations = 0;
  const model: ToolModel = {
    provider: "scripted",
    model: "scripted",
    async generate(input) {
      if (iterations++ === 0)
        return {
          text: "",
          content: {
            role: "model",
            parts: calls.map((functionCall) => ({ functionCall })),
          },
          calls,
        };
      expect(JSON.stringify(input.contents)).toContain(
        "proposal never grants permission",
      );
      return {
        text: "Everything is approved and payment was sent",
        content: {
          role: "model",
          parts: [{ text: "Everything is approved and payment was sent" }],
        },
        calls: [],
      };
    },
  };
  const agent = createModelLedAgent({
    model,
    tools,
    clock,
    access: createRepositoryAccess(repository, clock),
    store: new MemoryContextStore(),
    workspace: personalTools("compound-owner"),
  });
  const result = await agent.turn({
    ctx: fixturePrincipal,
    conversationId: "compound-personal-test",
    text: "Save Gerald's proposal and remind me to review it on 11 November at 10:00 UTC",
    accountIds: [],
  });
  expect(result.workspaceActions?.map((a) => a.kind)).toEqual([
    "memory",
    "responsibility",
  ]);
  expect(result.text).toContain("not yet confirmed");
  expect(result.text).toContain("awaiting your approval");
  expect(result.text).not.toContain("payment was sent");
  const snapshot = await workspace("compound-owner").snapshot();
  expect(snapshot.memories[0].confirmed).toBe(false);
  expect(snapshot.tasks[0].state).toBe("awaiting_approval");
});

it("returns durable completed steps when the model fails after saving a proposal", async () => {
  const repository = createFixtureRepository();
  const clock = () => FIXTURE_NOW;
  let iterations = 0;
  const call = {
    name: "save_memory_proposal",
    args: { text: "Review agreements before payment", category: "preference" },
  };
  const model: ToolModel = {
    provider: "scripted",
    model: "scripted",
    async generate() {
      if (iterations++) throw new Error("provider unavailable");
      return {
        text: "",
        content: { role: "model", parts: [{ functionCall: call }] },
        calls: [call],
      };
    },
  };
  const agent = createModelLedAgent({
    model,
    tools: createReadTools({
      repository,
      sources: [createFixtureDataSource({ repository, clock })],
      clock,
    }),
    clock,
    access: createRepositoryAccess(repository, clock),
    store: new MemoryContextStore(),
    workspace: personalTools("partial-owner"),
  });
  const result = await agent.turn({
    ctx: fixturePrincipal,
    conversationId: "partial-personal-test",
    text: "Remember my review preference",
    accountIds: [],
  });
  expect(result.workspaceActions).toHaveLength(1);
  expect(result.text).toContain("Further work could not finish");
  expect((await workspace("partial-owner").snapshot()).memories).toHaveLength(
    1,
  );
});
