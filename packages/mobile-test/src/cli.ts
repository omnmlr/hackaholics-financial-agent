#!/usr/bin/env -S node --import tsx
import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { id, RunFailure } from "./contracts";
import { openRunner } from "./runner";
import { outcome, scoreDecision } from "./evaluation";
import { sealReport, verifyReceipt } from "./receipt";

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const [argument, second] = args;
  if (command === "verify-receipt" && args.length === 2) {
    const [body, key] = await Promise.all(args.map((path) => readFile(path, "utf8")));
    const valid = verifyReceipt(JSON.parse(body), key);
    console.log(JSON.stringify({ valid }));
    if (!valid) process.exitCode = 1;
    return;
  }
  const config = process.env.AGUS_TEST_CONFIG;
  const evidence = process.env.AGUS_TEST_EVIDENCE;
  const arities: Record<string, number> = { devices: 0, run: 1, get: 1, mcp: 0, score: 2, seal: 2 };
  if (!config || !evidence || !Object.hasOwn(arities, command) || args.length !== arities[command]) {
    throw new Error("Set AGUS_TEST_CONFIG and AGUS_TEST_EVIDENCE. Usage: agus-test devices | run <scenario> | get <id> | score <id> <outcome> | seal <id> <key> | verify-receipt <receipt> <public-key> | mcp");
  }
  const runner = await openRunner(config, evidence);
  if (command === "mcp") {
    const server = new McpServer({ name: "agus-mobile-test", version: "0.1.0" });
    const reply = (value: object) => ({
      content: [{ type: "text" as const, text: JSON.stringify(value) }],
      structuredContent: { ...value },
    });
    server.registerTool("list_test_scenarios", {
      description: "List approved Solana Mobile regression scenarios and the configured isolated Android device class.",
      annotations: { readOnlyHint: true },
    }, async () => reply(await runner.describe()));
    server.registerTool("start_test_run", {
      description: "Start one operator-approved test scenario. A scenario can approve and send a disposable test transaction.",
      inputSchema: { scenario: id, device: id.optional() },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async ({ scenario, device }) => reply({ runId: await runner.start(scenario, device) }));
    server.registerTool("get_test_run", {
      description: "Read the current test state, observed transaction, diagnosis and local evidence filenames.",
      inputSchema: { runId: z.uuid() },
      annotations: { readOnlyHint: true },
    }, async ({ runId }) => reply(await runner.get(runId)));
    server.registerTool("score_test_outcome", {
      description: "Grade an agent's wallet-outcome decision against the completed run's deterministic evidence.",
      inputSchema: { runId: z.uuid(), outcome },
      annotations: { readOnlyHint: true },
    }, async ({ runId, outcome }) => reply(scoreDecision(await runner.get(runId), outcome)));
    await server.connect(new StdioServerTransport());
    return;
  }
  const value = await (command === "devices" ? runner.describe()
    : command === "run" ? runner.run(argument)
      : command === "score" ? scoreDecision(await runner.get(argument), outcome.parse(second))
        : command === "seal" ? sealReport(await runner.get(argument), await readFile(second, "utf8"))
          : runner.get(argument));
  console.log(JSON.stringify(value, null, 2));
  if ("state" in value && command === "run" && value.state === "failed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof RunFailure ? `${error.code} ${error.message}` : error.message);
  process.exitCode = 2;
});
