/** Offline wire-size measurement with scripted replies; makes no HTTP requests.
 * An optional module path permits measuring the exact PR #37 agent source using
 * the same dependencies, input, repository and fixture clock as the candidate.
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
const modulePath = resolve(
  process.argv[2] ?? "src/lib/model-led-agent/agent.ts",
);
const { createModelLedAgent } = await import(pathToFileURL(modulePath).href);
const results: Array<{
  selectedAccounts: number;
  schemaBytes: number;
  systemBytes: number;
  historyBytes: number;
  functionNames: Array<string | undefined>;
}> = [];
for (const accountIds of [[], ["amina-current"]]) {
  const repository = createFixtureRepository(),
    clock = () => FIXTURE_NOW;
  const tools = createReadTools({
    repository,
    sources: [createFixtureDataSource({ repository, clock })],
    clock,
  });
  const model: ToolModel = {
    provider: "scripted-offline-measurement",
    model: "not-a-provider",
    async generate({ system, contents, declarations }) {
      results.push({
        selectedAccounts: accountIds.length,
        schemaBytes: Buffer.byteLength(JSON.stringify(declarations)),
        systemBytes: Buffer.byteLength(system),
        historyBytes: Buffer.byteLength(JSON.stringify(contents)),
        functionNames: declarations.map((d) => d.name),
      });
      return {
        content: {
          role: "model",
          parts: [{ text: "A lizard with a crown would rule the sofa." }],
        },
        text: "A lizard with a crown would rule the sofa.",
        calls: [],
      };
    },
  };
  await createModelLedAgent({
    model,
    tools,
    access: createRepositoryAccess(repository, clock),
    store: new MemoryContextStore(),
    clock,
  }).turn({
    ctx: fixturePrincipal,
    conversationId: "prompt-measurement",
    text: "Tell me a joke about a lizard",
    accountIds,
  });
}
await writeFile(
  process.argv[3] ?? "/tmp/agus-prompt-size.json",
  JSON.stringify(
    {
      genuineModelCalls: 0,
      metric: "UTF-8 bytes, not provider tokens or cost",
      results,
    },
    null,
    2,
  ),
);
