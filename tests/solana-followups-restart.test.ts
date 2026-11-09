/** Real process restart and on-disk SQL; controlled read-only result, no network/signing. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("recovers an approved deferred follow-up across process restart and records a single result", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agus-followup-restart-"));
  const script = `
    import {prepareSolanaFollowup, runSolanaFollowups} from './src/lib/agent-workspace/solana-followups.ts';
    import {workspace} from './src/lib/agent-workspace/store.ts';
    import {db} from './src/lib/db.ts';
    const id = '4c74131b-2b15-465b-b6cf-bf31689f42c5';
    const now = new Date('2026-11-09T18:00:00Z');
    const draft = {id,owner:'restart',network:'devnet',state:'unknown',submission:{signature:'fixture-only'},confirmation:null};
    if (process.argv[1] === 'first') {
      const task = await prepareSolanaFollowup('restart',{id},async()=>draft,now);
      await workspace('restart').transition(id,task.version,'approve');
      await runSolanaFollowups('restart',async()=>{throw new Error('offline')},now);
    } else {
      let reads=0;
      const reconcile = async()=>{reads++;return {...draft,state:'confirmed',confirmation:{slot:222,commitment:'confirmed',feeLamports:'5000'}}};
      await runSolanaFollowups('restart',reconcile,new Date('2026-11-09T18:01:00Z'));
      await runSolanaFollowups('restart',reconcile,new Date('2026-11-09T18:02:00Z'));
      const saved=await workspace('restart').snapshot();
      console.log(JSON.stringify({reads,state:saved.tasks[0].state,attempts:saved.tasks[0].watch.attempts,slot:saved.tasks[0].watch.confirmation.slot,notifications:saved.notifications.length,otherOwner:(await workspace('other').snapshot()).tasks.length}));
    }
    await (await db()).$client.close();
  `;
  function run(phase: string) {
    const child = spawnSync(
      process.execPath,
      ["--import=tsx", "--input-type=module", "-e", script, phase],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          DATABASE_URL: `pglite://${directory}/db`,
          PAYMENT_MODE: "fixture",
          AGUS_WORKSPACE_ENABLED: "true",
          AGUS_SOLANA_DEVNET_ENABLED: "true",
        },
      },
    );
    if (child.status !== 0)
      throw new Error(`Restart child failed: ${child.stderr}`);
    return child.stdout.trim();
  }
  try {
    run("first");
    expect(JSON.parse(run("second"))).toEqual({
      reads: 1,
      state: "completed",
      attempts: 2,
      slot: 222,
      notifications: 1,
      otherOwner: 0,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
