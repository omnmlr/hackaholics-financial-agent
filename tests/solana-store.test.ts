/** Real on-disk PostgreSQL-compatible storage; no RPC, wallets or network effects. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("persists a single submission claim and audit across process restarts with owner isolation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agus-solana-store-"));
  const script = `
    import { durableDraftStore } from './src/lib/solana/store.ts';
    import { DEVNET_RPC, DEVNET_GENESIS } from './src/lib/solana/contracts.ts';
    import { draftDigest } from './src/lib/solana/service.ts';
    import { db } from './src/lib/db.ts';
    import { sql } from 'drizzle-orm';
    const store = durableDraftStore();
    const id = '0334ad84-9262-4453-b814-e9d93c11f452';
    const at = '2026-11-09T12:00:00.000Z';
    if (process.argv[1] === 'create-and-claim') {
      const d = { id, owner: 'alice', revision: 0, network: 'devnet', rpcEndpoint: DEVNET_RPC, genesisHash: DEVNET_GENESIS,
        state: 'prepared', sender: '11111111111111111111111111111111', recipient: '11111111111111111111111111111111',
        asset: 'SOL', mint: null, decimals: 9, amount: '1', amountAtoms: '1000000000', sourceTokenAccount: null,
        recipientTokenAccount: null, createsRecipientTokenAccount: false, feeLamports: '5000', estimatedRentLamports: '0',
        totalSolRequiredLamports: '1000005000', blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1000,
        preparedAt: at, expiresAt: '2026-11-09T12:01:30.000Z', unsignedTransactionBase64: 'AA==', messageBase64: 'AA==',
        messageDigest: '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d', digest: '',
        approval: null, submission: null, confirmation: null, failureCode: null };
      d.digest = draftDigest(d);
      await store.create(d, {action:'prepared', at});
      const approved = {...d, revision:1, state:'approved', approval:{actor:'alice', at, digest:d.digest}};
      await store.transition(d, approved, {action:'human_approved', at});
      const claim = {...approved, revision:2, state:'submitting', submission:{claimId:'one-use', claimedAt:at, signature:'fictional-test-signature'}};
      const results = await Promise.all([
        store.transition(approved, claim, {action:'submission_claimed', at}),
        store.transition(approved, claim, {action:'submission_claimed', at}),
      ]);
      console.log(JSON.stringify({claims:results.filter(Boolean).length}));
    } else {
      const d = await store.get('alice',id);
      const hidden = await store.get('bob',id);
      const list = await store.list('bob');
      const events = await (await db()).execute(sql\`SELECT action FROM agus_solana_events ORDER BY action\`);
      console.log(JSON.stringify({state:d.state, signature:d.submission.signature, revision:d.revision,
        otherOwner:hidden, otherList:list, events:events.rows.map(r=>r.action)}));
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
        timeout: 20_000,
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: `pglite://${directory}/db`,
          PAYMENT_MODE: "fixture",
          AGUS_SOLANA_DEVNET_ENABLED: "true",
        },
      },
    );
    if (child.status !== 0)
      throw new Error(`Storage child failed: ${child.stderr}`);
    return JSON.parse(child.stdout.trim());
  }
  try {
    expect(run("create-and-claim")).toEqual({ claims: 1 });
    expect(run("restart-read")).toEqual({
      state: "submitting",
      signature: "fictional-test-signature",
      revision: 2,
      otherOwner: null,
      otherList: [],
      events: ["human_approved", "prepared", "submission_claimed"],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
