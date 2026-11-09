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
