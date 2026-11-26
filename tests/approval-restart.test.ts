/** Real on-disk auth counter across independent processes; no RPC or wallet. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("retains the financial password lockout across process restart and concurrent attempts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agus-approval-restart-"));
  const script = `
    import { scryptSync } from 'node:crypto';
    import { reauthenticate } from './src/lib/auth.ts';
    import { db, sessions } from './src/lib/db.ts';
    process.env.OPERATOR_PASSWORD_HASH = 'fixture-salt:' + scryptSync('correct', 'fixture-salt', 64).toString('hex');
    const run = async password => {
      try { await reauthenticate('restart-owner', password); return 200; }
      catch (e) { return e.status; }
    };
    const statuses = process.argv[1] === 'failures'
      ? await Promise.all(Array.from({length:10}, () => run('incorrect')))
      : [await run('correct')];
    console.log(JSON.stringify({ statuses, sessions: (await (await db()).select().from(sessions)).length }));
    await (await db()).$client.close();
  `;
  function run(phase: string) {
    const child = spawnSync(
      process.execPath,
      ["--import=tsx", "--input-type=module", "-e", script, phase],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20_000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          DATABASE_URL: `pglite://${directory}/db`,
          PAYMENT_MODE: "fixture",
          OPERATOR_ID: "restart-owner",
        },
      },
    );
    if (child.status !== 0)
      throw new Error(`Approval restart child failed: ${child.stderr}`);
    return JSON.parse(child.stdout.trim());
  }
  try {
    expect(run("failures")).toEqual({
      statuses: Array(10).fill(401),
      sessions: 0,
    });
    expect(run("restart")).toEqual({ statuses: [429], sessions: 0 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
