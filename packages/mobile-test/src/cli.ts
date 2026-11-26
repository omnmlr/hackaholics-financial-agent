#!/usr/bin/env -S node --import tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { id, RunFailure } from "./contracts";
import { openRunner } from "./runner";

async function main() {
  const [command, argument, ...extra] = process.argv.slice(2);
  const config = process.env.AGUS_TEST_CONFIG;
  const evidence = process.env.AGUS_TEST_EVIDENCE;
  if (!config || !evidence || extra.length || !["devices", "run", "get", "mcp"].includes(command) ||
      Boolean(argument) !== ["run", "get"].includes(command)) {
    throw new Error("Set AGUS_TEST_CONFIG and AGUS_TEST_EVIDENCE. Usage: agus-test devices | run <scenario> | get <run-id> | mcp");
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
    }, () => reply(runner.describe()));
    server.registerTool("start_test_run", {
      description: "Start one operator-approved test scenario. A scenario can approve and send a disposable test transaction.",
      inputSchema: { scenario: id },
      annotations: { destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async ({ scenario }) => reply({ runId: await runner.start(scenario) }));
    server.registerTool("get_test_run", {
      description: "Read the current test state, observed transaction, diagnosis and local evidence filenames.",
      inputSchema: { runId: z.uuid() },
      annotations: { readOnlyHint: true },
    }, async ({ runId }) => reply(await runner.get(runId)));
    await server.connect(new StdioServerTransport());
    return;
  }
  const value = command === "devices" ? runner.describe()
    : await (command === "run" ? runner.run(argument) : runner.get(argument));
  console.log(JSON.stringify(value, null, 2));
  if ("state" in value && command === "run" && value.state === "failed") process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof RunFailure ? `${error.code} ${error.message}` : error.message);
  process.exitCode = 2;
});
