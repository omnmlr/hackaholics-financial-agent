import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("a generic MCP client schedules a known scenario and polls its real runner report", async () => {
  const workingDir = await mkdtemp(join(tmpdir(), "agus-mcp-"));
  const config = join(workingDir, "test.json");
  await writeFile(config, JSON.stringify({
    version: 1,
    network: { cluster: "devnet" },
    device: { serial: "emulator-9999", kind: "emulator", isolated: true },
    apks: {},
    scenarios: {
      smoke: { title: "Runner unavailable", packages: ["app.agus.testfixture"], steps: [{ action: "launch", package: "app.agus.testfixture" }] },
    },
  }));
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", cli, "mcp"], cwd: dirname(cli),
    env: { AGUS_TEST_CONFIG: config, AGUS_TEST_EVIDENCE: join(workingDir, "evidence"), AGUS_ADB: "agus-test-adb-intentionally-unavailable" },
    stderr: "pipe",
  });
  const client = new Client({ name: "independent-mcp-client", version: "1.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["list_test_scenarios", "start_test_run", "get_test_run"]);
    const listed = await client.callTool({ name: "list_test_scenarios" });
    assert.deepEqual((listed.structuredContent as { scenarios: unknown }).scenarios, [{ title: "Runner unavailable", scenario: "smoke" }]);
    const invalid = await client.callTool({ name: "start_test_run", arguments: { scenario: "unapproved" } });
    assert.equal(invalid.isError, true);
    const run = await client.callTool({ name: "start_test_run", arguments: { scenario: "smoke" } });
    const { runId } = run.structuredContent as { runId: string };
    assert.match(runId, /^[0-9a-f-]{36}$/);
    for (let attempt = 0; attempt < 20; attempt++) {
      const result = await client.callTool({ name: "get_test_run", arguments: { runId } });
      const report = result.structuredContent as { state: string; failure?: { code: string } };
      if (report.state === "failed") {
        assert.equal(report.failure?.code, "DEVICE_UNAVAILABLE");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.fail("MCP report did not reach the expected terminal state");
  } finally {
    await client.close();
    await rm(workingDir, { recursive: true, force: true });
  }
});
