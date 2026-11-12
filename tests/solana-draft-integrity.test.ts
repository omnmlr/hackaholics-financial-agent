/** Real PGlite jsonb persistence and restart integrity regression tests. */
import { createHash, randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { db } from "../src/lib/db";
import { login } from "../src/lib/auth";
import { draftDigest } from "../src/lib/solana/service";
import { DEVNET_GENESIS, DEVNET_RPC, type SolanaDraft } from "../src/lib/solana/contracts";
import type { SolanaRpc } from "../src/lib/solana/rpc";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.doUnmock("../src/lib/solana/rpc");
});

function makeMockRpc(): SolanaRpc {
  const blockhash = Keypair.generate().publicKey.toBase58();
  return {
    endpoint: DEVNET_RPC,
    getGenesisHash: async () => DEVNET_GENESIS,
    getBalance: async () => 10_000_000_000,
    getAccountInfo: async () => ({
      data: Buffer.alloc(0),
      owner: SystemProgram.programId,
      lamports: 10_000_000_000,
      executable: false,
      rentEpoch: 0,
    }),
    getTokenAccountsByOwner: async () => [],
    getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 1000 }),
    getFeeForMessage: async () => 5000,
    getMinimumBalanceForRentExemption: async () => 2039280,
    getBlockHeight: async () => 950,
    simulateTransaction: async () => ({ err: null, slot: 520763363, unitsConsumed: 150 }),
    sendRawTransaction: async () => {
      throw new Error("unused");
    },
    getSignatureStatus: async () => null,
    getTransaction: async () => null,
  };
}

it("survives real PGlite jsonb persistence and process restarts for prepare -> get -> list -> approve", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agus-solana-integrity-"));
  const script = `
    import { SystemProgram } from '@solana/web3.js';
    import { sql } from 'drizzle-orm';
    import { db } from './src/lib/db.ts';
    import { createSolanaService } from './src/lib/solana/service.ts';
    import { DEVNET_GENESIS, DEVNET_RPC } from './src/lib/solana/contracts.ts';

    const sender = '11111111111111111111111111111111';
    const recipient = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    const blockhash = '11111111111111111111111111111111';
    const fixedClock = new Date('2026-11-09T12:00:00.000Z');
    const rpc = {
      endpoint: DEVNET_RPC,
      getGenesisHash: async () => DEVNET_GENESIS,
      getBalance: async () => 10_000_000_000,
      getAccountInfo: async () => ({
        data: Buffer.alloc(0),
        owner: SystemProgram.programId,
        lamports: 10_000_000_000,
        executable: false,
        rentEpoch: 0,
      }),
      getTokenAccountsByOwner: async () => [],
      getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 1000 }),
      getFeeForMessage: async () => 5000,
      getMinimumBalanceForRentExemption: async () => 2039280,
      getBlockHeight: async () => 950,
      simulateTransaction: async () => ({ err: null, slot: 520763363, unitsConsumed: 150 }),
      sendRawTransaction: async () => { throw new Error('unused'); },
      getSignatureStatus: async () => null,
      getTransaction: async () => null,
    };
    const svc = createSolanaService({ rpc, now: () => fixedClock });
    const phase = process.argv[1];

    if (phase === 'prepare') {
      const prepared = await svc.prepare('devnet-acceptance-owner', {
        sender,
        recipient,
        asset: 'SOL',
        amount: '0.001',
      });
      console.log(JSON.stringify({ id: prepared.id, digest: prepared.digest, state: prepared.state }));
    } else if (phase === 'approve') {
      const [id, digest] = [process.argv[2], process.argv[3]];
      const fetched = await svc.get('devnet-acceptance-owner', id);
      const listed = await svc.list('devnet-acceptance-owner');
      const approved = await svc.approve('devnet-acceptance-owner', id, {
        digest,
        acknowledged: true,
      });
      console.log(JSON.stringify({
        fetchedId: fetched.id,
        listedCount: listed.length,
        state: approved.state,
        revision: approved.revision,
        approvalDigest: approved.approval?.digest,
      }));
    } else if (phase === 'verify-after-restart') {
      const id = process.argv[2];
      const loaded = await svc.get('devnet-acceptance-owner', id);
      console.log(JSON.stringify({ state: loaded.state, revision: loaded.revision }));
    } else if (phase === 'tamper-and-check') {
      const id = process.argv[2];
      const d = await db();
      await d.execute(sql\`UPDATE agus_solana_drafts SET payload = jsonb_set(payload, '{simulation,slot}', '999999'::jsonb) WHERE owner='devnet-acceptance-owner' AND id=\${id}\`);
      try {
        await svc.get('devnet-acceptance-owner', id);
        console.log(JSON.stringify({ rejected: false }));
      } catch (err) {
        console.log(JSON.stringify({ rejected: true, code: err.code, status: err.status }));
      }
    }
    const client = (await db()).$client;
  if ("close" in client) await client.close();
  `;
  function run(args: string[]) {
    const child = spawnSync(
      process.execPath,
      ["--import=tsx", "--input-type=module", "-e", script, ...args],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 45_000,
        env: {
          ...process.env,
          NODE_ENV: "test",
          DATABASE_URL: `pglite://${directory}/db`,
          PAYMENT_MODE: "fixture",
          AGUS_ENVIRONMENT: "devnet",
          AGUS_SOLANA_DEVNET_ENABLED: "true",
        },
      },
    );
    if (child.status !== 0)
      throw new Error(`Phase ${args[0]} failed: ${child.stderr}\n${child.stdout}`);
    return JSON.parse(child.stdout.trim());
  }
  try {
    const prepared = run(["prepare"]);
    expect(prepared.state).toBe("prepared");
    expect(run(["approve", prepared.id, prepared.digest])).toEqual({
      fetchedId: prepared.id,
      listedCount: 1,
      state: "approved",
      revision: 1,
      approvalDigest: prepared.digest,
    });
    expect(run(["verify-after-restart", prepared.id])).toEqual({
      state: "approved",
      revision: 1,
    });
    expect(run(["tamper-and-check", prepared.id])).toEqual({
      rejected: true,
      code: "DRAFT_INTEGRITY",
      status: 409,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

it("preserves compatibility with pre-existing jsonb drafts and approves via HTTP route with reauthentication", async () => {
  const sender = Keypair.generate();
  const recipient = Keypair.generate();
  const password = "fixture-devnet-owner-pass";
  const salt = randomBytes(16).toString("hex");
  vi.stubEnv("DATABASE_URL", "pglite://:memory:");
  vi.stubEnv("PAYMENT_MODE", "fixture");
  vi.stubEnv("AGUS_ENVIRONMENT", "devnet");
  vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  vi.stubEnv("OPERATOR_ID", "devnet-acceptance-owner");
  vi.stubEnv(
    "OPERATOR_PASSWORD_HASH",
    `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  );
  const mockRpc = makeMockRpc();
  vi.doMock("../src/lib/solana/rpc", () => ({
    pinnedDevnetRpc: () => mockRpc,
    pinnedDevnetConnection: () => {
      throw new Error("unused");
    },
  }));
  const { POST, GET } = await import("../src/app/api/agent-workspace/solana/route");
  const token = await login(password);
  const prepareRes = await POST(
    new Request("http://localhost:3000/api/agent-workspace/solana", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `ha_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "prepare",
        sender: sender.publicKey.toBase58(),
        recipient: recipient.publicKey.toBase58(),
        asset: "SOL",
        amount: "0.001",
      }),
    }),
  );
  expect(prepareRes.status).toBe(200);
  const { result: prepared } = (await prepareRes.json()) as { result: SolanaDraft };

  const listRes = await GET(
    new Request("http://localhost:3000/api/agent-workspace/solana", {
      headers: { cookie: `ha_session=${token}` },
    }),
  );
  expect(listRes.status).toBe(200);

  const approveRes = await POST(
    new Request("http://localhost:3000/api/agent-workspace/solana", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `ha_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "approve",
        id: prepared.id,
        digest: prepared.digest,
        acknowledged: true,
        password,
      }),
    }),
  );
  const approveBody = (await approveRes.json()) as { result?: SolanaDraft; code?: string };
  expect(approveRes.status, JSON.stringify(approveBody)).toBe(200);
  expect(approveBody.result?.state).toBe("approved");
  expect(approveBody.result?.approval?.digest).toBe(prepared.digest);

  // Simulate an existing draft already stored in jsonb before this fix (digest computed with {at, slot, unitsConsumed, passed})
  const tx = new Transaction({
    feePayer: sender.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient.publicKey,
      lamports: 1_000_000n,
    }),
  );
  const message = tx.serializeMessage();
  const unsigned = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  const now = new Date();
  const existingDraft: SolanaDraft = {
    id: "11111111-1111-4111-8111-111111111111",
    owner: "devnet-acceptance-owner",
    revision: 0,
    network: "devnet",
    rpcEndpoint: DEVNET_RPC,
    genesisHash: DEVNET_GENESIS,
    state: "prepared",
    sender: sender.publicKey.toBase58(),
    recipient: recipient.publicKey.toBase58(),
    asset: "SOL",
    mint: null,
    decimals: 9,
    amount: "0.001",
    amountAtoms: "1000000",
    sourceTokenAccount: null,
    recipientTokenAccount: null,
    createsRecipientTokenAccount: false,
    feeLamports: "5000",
    estimatedRentLamports: "0",
    totalSolRequiredLamports: "1005000",
    blockhash: tx.recentBlockhash!,
    lastValidBlockHeight: 1000,
    preparedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90_000).toISOString(),
    unsignedTransactionBase64: unsigned.toString("base64"),
    simulation: {
      at: now.toISOString(),
      slot: 520763363,
      unitsConsumed: 150,
      passed: true,
    },
    messageBase64: message.toString("base64"),
    messageDigest: createHash("sha256").update(message).digest("hex"),
    digest: "",
    approval: null,
    submission: null,
    confirmation: null,
    failureCode: null,
  };
  existingDraft.digest = createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        id: existingDraft.id,
        owner: existingDraft.owner,
        network: existingDraft.network,
        rpcEndpoint: existingDraft.rpcEndpoint,
        genesisHash: existingDraft.genesisHash,
        sender: existingDraft.sender,
        recipient: existingDraft.recipient,
        asset: existingDraft.asset,
        mint: existingDraft.mint,
        decimals: existingDraft.decimals,
        amount: existingDraft.amount,
        amountAtoms: existingDraft.amountAtoms,
        sourceTokenAccount: existingDraft.sourceTokenAccount,
        recipientTokenAccount: existingDraft.recipientTokenAccount,
        createsRecipientTokenAccount: existingDraft.createsRecipientTokenAccount,
        feeLamports: existingDraft.feeLamports,
        estimatedRentLamports: existingDraft.estimatedRentLamports,
        totalSolRequiredLamports: existingDraft.totalSolRequiredLamports,
        blockhash: existingDraft.blockhash,
        lastValidBlockHeight: existingDraft.lastValidBlockHeight,
        preparedAt: existingDraft.preparedAt,
        expiresAt: existingDraft.expiresAt,
        messageBase64: existingDraft.messageBase64,
        messageDigest: existingDraft.messageDigest,
        unsignedTransactionBase64: existingDraft.unsignedTransactionBase64,
        simulation: {
          at: existingDraft.simulation!.at,
          slot: existingDraft.simulation!.slot,
          unitsConsumed: existingDraft.simulation!.unitsConsumed,
          passed: existingDraft.simulation!.passed,
        },
      }),
    )
    .digest("hex");
  const d = await db();
  await d.execute(
    sql`INSERT INTO agus_solana_drafts (owner,id,revision,state,payload) VALUES (${existingDraft.owner},${existingDraft.id},0,'prepared',${JSON.stringify(existingDraft)}::jsonb)`,
  );
  const existingApproveRes = await POST(
    new Request("http://localhost:3000/api/agent-workspace/solana", {
      method: "POST",
      headers: {
        origin: "http://localhost:3000",
        cookie: `ha_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "approve",
        id: existingDraft.id,
        digest: existingDraft.digest,
        acknowledged: true,
        password,
      }),
    }),
  );
  expect(existingApproveRes.status).toBe(200);
  expect(((await existingApproveRes.json()) as { result: SolanaDraft }).result.state).toBe("approved");

  // Also ensure draftDigest still detects tampering on simulation fields
  const tampered = { ...existingDraft, simulation: { ...existingDraft.simulation!, unitsConsumed: 999 } };
  expect(draftDigest(tampered)).not.toBe(existingDraft.digest);
  const client = (await db()).$client;
  if ("close" in client) await client.close();
}, 60_000);
