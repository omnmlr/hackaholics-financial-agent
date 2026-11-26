import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
it("restores approved responsibilities and memory across actual process restarts without duplicate notifications", () => {
  const directory = mkdtempSync(join(tmpdir(), "agus-workspace-restart-"));
  try {
    function run(mode: string) {
      const result = spawnSync(
        process.execPath,
        ["--import=tsx", "tests/agent-workspace-worker.ts", mode],
        {
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "test",
            DATABASE_URL: `pglite://${directory}`,
            PAYMENT_MODE: "fixture",
            AGUS_WORKSPACE_ENABLED: "true",
          },
          encoding: "utf8",
          timeout: 30000,
        },
      );
      expect(result.status).toBe(0);
      return JSON.parse(result.stdout.trim());
    }
    expect(run("create").created).toBe(true);
    expect(run("run")).toEqual({
      delivered: 1,
      tasks: 1,
      memories: 1,
      notifications: 1,
    });
    expect(run("run")).toEqual({
      delivered: 0,
      tasks: 1,
      memories: 1,
      notifications: 1,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
