/** Offline security tests: ephemeral test signers and mocked RPC, never a funded wallet. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import {
  AccountLayout,
  MintLayout,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  DEVNET_GENESIS,
  DEVNET_RPC,
  createSolanaService,
  draftDigest,
  decimalToAtoms,
  atomsToDecimal,
  type DraftStore,
  type SolanaDraft,
  type SolanaRpc,
} from "../src/lib/solana";

class MemoryStore implements DraftStore {
  rows = new Map<string, SolanaDraft>();
  events: string[] = [];
  async create(d: SolanaDraft) {
    this.rows.set(d.id, structuredClone(d));
    this.events.push("prepared");
  }
  async get(owner: string, id: string) {
    const d = this.rows.get(id);
    return d?.owner === owner ? structuredClone(d) : null;
  }
  async list(owner: string) {
    return [...this.rows.values()]
      .filter((d) => d.owner === owner)
      .map((d) => structuredClone(d));
  }
  async transition(a: SolanaDraft, b: SolanaDraft, e: { action: string }) {
    if (this.rows.get(a.id)?.revision !== a.revision) return false;
    this.rows.set(a.id, structuredClone(b));
    this.events.push(e.action);
    return true;
  }
}
function info(
  data = Buffer.alloc(0),
  owner = SystemProgram.programId,
): AccountInfo<Buffer> {
  return {
    data,
    owner,
    lamports: 10_000_000_000,
    executable: false,
    rentEpoch: 0,
  };
}
function tokenInfo(
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
  state = 1,
) {
  const data = Buffer.alloc(165);
  AccountLayout.encode(
    {
      mint,
      owner,
      amount,
      delegateOption: 0,
      delegate: PublicKey.default,
      state,
      isNativeOption: 0,
      isNative: 0n,
      delegatedAmount: 0n,
      closeAuthorityOption: 0,
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return info(data, TOKEN_PROGRAM_ID);
}
function mintInfo(decimals = 6) {
  const data = Buffer.alloc(82);
  MintLayout.encode(
    {
      mintAuthorityOption: 0,
      mintAuthority: PublicKey.default,
      supply: 10_000_000_000_000n,
      decimals,
      isInitialized: true,
      freezeAuthorityOption: 0,
      freezeAuthority: PublicKey.default,
    },
    data,
  );
  return info(data, TOKEN_PROGRAM_ID);
}
function setup() {
  const sender = Keypair.generate(),
    recipient = Keypair.generate(),
    other = Keypair.generate();
  const store = new MemoryStore();
  const rpc: SolanaRpc = {
    endpoint: DEVNET_RPC,
    getGenesisHash: vi.fn(async () => DEVNET_GENESIS),
    getBalance: vi.fn(async () => 10_000_000_000),
    getAccountInfo: vi.fn(async () => info()),
    getTokenAccountsByOwner: vi.fn(async () => []),
    getLatestBlockhash: vi.fn(async () => ({
      blockhash: other.publicKey.toBase58(),
      lastValidBlockHeight: 1000,
    })),
    getFeeForMessage: vi.fn(async () => 5000),
    getMinimumBalanceForRentExemption: vi.fn(async () => 2039280),
    getBlockHeight: vi.fn(async () => 950),
    simulateTransaction: vi.fn(async () => ({
      err: null,
      slot: 100,
      unitsConsumed: 450,
    })),
    sendRawTransaction: vi.fn(async () => {
      throw new Error("simulated response loss");
    }),
    getSignatureStatus: vi.fn(async () => null),
    getTransaction: vi.fn(async () => null),
  };
  let clock = new Date("2026-11-09T12:00:00.000Z");
  const service = createSolanaService({ rpc, store, now: () => clock });
  const input = {
    sender: sender.publicKey.toBase58(),
    recipient: recipient.publicKey.toBase58(),
    asset: "SOL" as const,
    amount: "0.01",
  };
  const prepare = () => service.prepare("alice", input);
  const signed = (draft: SolanaDraft, signer = sender) => {
    const tx = Transaction.from(
      Buffer.from(draft.unsignedTransactionBase64, "base64"),
    );
    tx.sign(signer);
    return tx.serialize().toString("base64");
  };
  return {
    sender,
    recipient,
    other,
    rpc,
    store,
    service,
    input,
    prepare,
    signed,
    setClock: (d: Date) => {
      clock = d;
    },
  };
}
beforeEach(() => {
  process.env.AGUS_SOLANA_DEVNET_ENABLED = "true";
  process.env.PAYMENT_MODE = "fixture";
});

describe("devnet exact decimal accounting", () => {
  it("keeps amounts above Number.MAX_SAFE_INTEGER exact and canonical", () => {
    expect(decimalToAtoms("9007199254.740993001", 9)).toBe(
      9007199254740993001n,
    );
    expect(atomsToDecimal(decimalToAtoms("0.000001", 6), 6)).toBe("0.000001");
    expect(atomsToDecimal(decimalToAtoms("1.230000", 6), 6)).toBe("1.23");
    expect(decimalToAtoms("18446744073709551615", 0)).toBe((1n << 64n) - 1n);
  });
  it.each([
    "0",
    "-1",
    "+1",
    "1e3",
    "1,000",
    " 1",
    "01",
    ".1",
    "1.",
    "NaN",
    "0.0000000001",
    "18446744073709551616",
  ])("rejects unsafe amount %s", (value) => {
    expect(() =>
      decimalToAtoms(value, value === "18446744073709551616" ? 0 : 9),
    ).toThrow();
  });
});

describe("devnet preparation and authority", () => {
  it("simulates the exact unsigned message before creating a review record", async () => {
    const s = setup();
    const draft = await s.prepare();
    const raw = vi.mocked(s.rpc.simulateTransaction).mock.calls[0][0];
    expect(raw.toString("base64")).toBe(draft.unsignedTransactionBase64);
    expect(Transaction.from(raw).serializeMessage().toString("base64")).toBe(
      draft.messageBase64,
    );
    expect(draft.simulation).toMatchObject({
      passed: true,
      slot: 100,
      unitsConsumed: 450,
    });
    expect(s.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("fails closed on simulation execution errors or unavailability without persisting an approvable draft", async () => {
    const s = setup();
    vi.mocked(s.rpc.simulateTransaction).mockResolvedValueOnce({
      err: { InstructionError: [0, "InsufficientFunds"] },
      slot: 100,
    });
    await expect(s.prepare()).rejects.toMatchObject({
      code: "SIMULATION_FAILED",
    });
    vi.mocked(s.rpc.simulateTransaction).mockRejectedValueOnce(
      new Error("unavailable"),
    );
    await expect(s.prepare()).rejects.toMatchObject({
      code: "RPC_UNAVAILABLE",
    });
    expect(s.store.rows.size).toBe(0);
    expect(s.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("keeps historical unsimulated drafts readable but forbids new approval or submission", async () => {
    const s = setup();
    const draft = await s.prepare();
    delete draft.simulation;
    draft.digest = draftDigest(draft);
    s.store.rows.set(draft.id, draft);
    expect((await s.service.get("alice", draft.id)).id).toBe(draft.id);
    await expect(
      s.service.approve("alice", draft.id, {
        digest: draft.digest,
        acknowledged: true,
      }),
    ).rejects.toMatchObject({ code: "SIMULATION_REQUIRED" });
    await expect(
      s.service.submitSigned("alice", draft.id, {
        digest: draft.digest,
        signedTransactionBase64: draft.unsignedTransactionBase64,
      }),
    ).rejects.toMatchObject({ code: "SIMULATION_REQUIRED" });
    expect(s.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });

  it("pins the complete independently observed devnet genesis hash", () => {
    expect(DEVNET_GENESIS).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
  });
  it("fails closed when disabled, in live mode, on custom endpoint or wrong genesis", async () => {
    const s = setup();
    process.env.AGUS_SOLANA_DEVNET_ENABLED = "false";
    await expect(s.prepare()).rejects.toMatchObject({
      code: "DEVNET_DISABLED",
    });
    expect(s.rpc.getGenesisHash).not.toHaveBeenCalled();
    process.env.AGUS_SOLANA_DEVNET_ENABLED = "true";
    process.env.PAYMENT_MODE = "live";
    await expect(s.prepare()).rejects.toMatchObject({ code: "LIVE_FORBIDDEN" });
    process.env.PAYMENT_MODE = "fixture";
    Object.assign(s.rpc, { endpoint: "https://api.mainnet-beta.solana.com" });
    await expect(s.prepare()).rejects.toMatchObject({ code: "RPC_ENDPOINT" });
    Object.assign(s.rpc, { endpoint: DEVNET_RPC });
    vi.mocked(s.rpc.getGenesisHash).mockResolvedValue("mainnet-genesis");
    await expect(s.prepare()).rejects.toMatchObject({ code: "WRONG_CLUSTER" });
    expect(s.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("prepares a legacy unsigned SOL transfer with canonical amount, exact fee and binding digest", async () => {
    const s = setup();
    const d = await s.service.prepare("alice", {
      ...s.input,
      amount: "0.0100",
    });
    const tx = Transaction.from(
      Buffer.from(d.unsignedTransactionBase64, "base64"),
    );
    expect(d).toMatchObject({
      amount: "0.01",
      amountAtoms: "10000000",
      feeLamports: "5000",
      totalSolRequiredLamports: "10005000",
      state: "prepared",
      approval: null,
      submission: null,
    });
    expect(d.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(tx.signatures[0].signature).toBeNull();
    expect(tx.serializeMessage().toString("base64")).toBe(d.messageBase64);
    expect(s.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("rejects owner mismatch, review tampering, omitted acknowledgement and stored message tampering", async () => {
    const s = setup(),
      d = await s.prepare();
    await expect(s.service.get("bob", d.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      s.service.approve("bob", d.id, { digest: d.digest, acknowledged: true }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      s.service.approve("alice", d.id, {
        digest: "0".repeat(64),
        acknowledged: true,
      }),
    ).rejects.toMatchObject({ code: "REVIEW_CHANGED" });
    await expect(
      s.service.approve("alice", d.id, { digest: d.digest } as never),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    s.store.rows.get(d.id)!.feeLamports = "1";
    await expect(s.service.get("alice", d.id)).rejects.toMatchObject({
      code: "DRAFT_INTEGRITY",
    });
  });
  it("rejects insufficient fee funds and unsafe RPC integer balances", async () => {
    const s = setup();
    vi.mocked(s.rpc.getBalance).mockResolvedValue(10_000_000);
    await expect(s.prepare()).rejects.toMatchObject({
      code: "INSUFFICIENT_SOL",
    });
    vi.mocked(s.rpc.getBalance).mockResolvedValue(Number.MAX_SAFE_INTEGER + 1);
    await expect(s.prepare()).rejects.toMatchObject({
      code: "INVALID_RPC_AMOUNT",
    });
  });
  it("rejects blockheight and wall-clock expiration before approval or submission", async () => {
    const s = setup(),
      d = await s.prepare();
    vi.mocked(s.rpc.getBlockHeight).mockResolvedValue(1001);
    await expect(
      s.service.approve("alice", d.id, {
        digest: d.digest,
        acknowledged: true,
      }),
    ).rejects.toMatchObject({ code: "DRAFT_EXPIRED" });
    expect((await s.service.get("alice", d.id)).state).toBe("expired");
    const t = setup(),
      fresh = await t.prepare();
    await t.service.approve("alice", fresh.id, {
      digest: fresh.digest,
      acknowledged: true,
    });
    t.setClock(new Date("2026-11-09T12:01:31.000Z"));
    await expect(
      t.service.submitSigned("alice", fresh.id, {
        digest: fresh.digest,
        signedTransactionBase64: t.signed(fresh),
      }),
    ).rejects.toMatchObject({ code: "DRAFT_EXPIRED" });
    expect(t.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("wallet signing and single submission", () => {
  it("cannot submit without human approval, with unsigned bytes, or altered instructions", async () => {
    const s = setup(),
      d = await s.prepare();
    await expect(
      s.service.submitSigned("alice", d.id, {
        digest: d.digest,
        signedTransactionBase64: s.signed(d),
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await s.service.approve("alice", d.id, {
      digest: d.digest,
      acknowledged: true,
    });
    await expect(
      s.service.submitSigned("alice", d.id, {
        digest: d.digest,
        signedTransactionBase64: d.unsignedTransactionBase64,
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNED_TRANSACTION" });
    const tampered = Transaction.from(
      Buffer.from(d.unsignedTransactionBase64, "base64"),
    );
    tampered.instructions[0] = SystemProgram.transfer({
      fromPubkey: s.sender.publicKey,
      toPubkey: s.other.publicKey,
      lamports: 10_000_000,
    });
    tampered.sign(s.sender);
    await expect(
      s.service.submitSigned("alice", d.id, {
        digest: d.digest,
        signedTransactionBase64: tampered.serialize().toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNED_TRANSACTION" });
    const raw = Buffer.from(s.signed(d), "base64");
    raw[1] ^= 1;
    await expect(
      s.service.submitSigned("alice", d.id, {
        digest: d.digest,
        signedTransactionBase64: raw.toString("base64"),
      }),
    ).rejects.toMatchObject({ code: "INVALID_SIGNED_TRANSACTION" });
    expect(s.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("durably claims before send, allows only one racing submit, and never resends uncertainty", async () => {
    const s = setup(),
      d = await s.prepare();
    await s.service.approve("alice", d.id, {
      digest: d.digest,
      acknowledged: true,
    });
    vi.mocked(s.rpc.sendRawTransaction).mockImplementation(async () => {
      const saved = await s.store.get("alice", d.id);
      expect(saved?.state).toBe("submitting");
      expect(saved?.submission?.signature).toMatch(
        /^[1-9A-HJ-NP-Za-km-z]{87,88}$/,
      );
      throw new Error("response lost after acceptance");
    });
    const input = { digest: d.digest, signedTransactionBase64: s.signed(d) };
    const results = await Promise.allSettled([
      s.service.submitSigned("alice", d.id, input),
      s.service.submitSigned("alice", d.id, input),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(s.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
    const saved = await s.service.get("alice", d.id);
    expect(saved.state).toBe("unknown");
    // Simulate restarting the service with the same persistent store.
    const restarted = createSolanaService({ rpc: s.rpc, store: s.store });
    await expect(
      restarted.submitSigned("alice", d.id, input),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    await restarted.reconcile("alice", d.id);
    await expect(restarted.cancel("alice", d.id)).rejects.toMatchObject({
      code: "CANNOT_CANCEL",
    });
    expect(s.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("RPC acknowledgement is only submitted; confirmation requires matching on-chain message and signature", async () => {
    const s = setup(),
      d = await s.prepare();
    await s.service.approve("alice", d.id, {
      digest: d.digest,
      acknowledged: true,
    });
    vi.mocked(s.rpc.sendRawTransaction).mockImplementation(
      async () => s.store.rows.get(d.id)!.submission!.signature,
    );
    const sent = await s.service.submitSigned("alice", d.id, {
      digest: d.digest,
      signedTransactionBase64: s.signed(d),
    });
    expect(sent.state).toBe("submitted");
    expect(sent.confirmation).toBeNull();
    const tx = Transaction.from(Buffer.from(s.signed(d), "base64"));
    const record: VersionedTransactionResponse = {
      slot: 42,
      blockTime: null,
      version: "legacy",
      transaction: {
        signatures: [sent.submission!.signature],
        message: tx.compileMessage(),
      },
      meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
    };
    vi.mocked(s.rpc.getTransaction).mockResolvedValue(record);
    vi.mocked(s.rpc.getSignatureStatus).mockResolvedValue({
      slot: 42,
      confirmations: null,
      err: null,
      confirmationStatus: "finalized",
    });
    const confirmed = await s.service.reconcile("alice", d.id);
    expect(confirmed).toMatchObject({
      state: "finalized",
      confirmation: { slot: 42, commitment: "finalized", feeLamports: "5000" },
    });
    expect(s.rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
  });
  it("rejects unrelated chain evidence and treats missing history as unresolved", async () => {
    const s = setup(),
      d = await s.prepare();
    await s.service.approve("alice", d.id, {
      digest: d.digest,
      acknowledged: true,
    });
    const sent = await s.service.submitSigned("alice", d.id, {
      digest: d.digest,
      signedTransactionBase64: s.signed(d),
    });
    expect((await s.service.reconcile("alice", d.id)).state).toBe("unknown");
    const otherTx = new Transaction({
      feePayer: s.sender.publicKey,
      recentBlockhash: d.blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: s.sender.publicKey,
        toPubkey: s.other.publicKey,
        lamports: 1,
      }),
    );
    vi.mocked(s.rpc.getTransaction).mockResolvedValue({
      slot: 43,
      version: "legacy",
      blockTime: null,
      transaction: {
        signatures: [sent.submission!.signature],
        message: otherTx.compileMessage(),
      },
      meta: { err: null, fee: 5000, preBalances: [], postBalances: [] },
    });
    await expect(s.service.reconcile("alice", d.id)).rejects.toMatchObject({
      code: "CONFIRMATION_MISMATCH",
    });
    expect((await s.service.get("alice", d.id)).state).toBe("unknown");
  });
  it("cancels before claim and invalidates the approved flow", async () => {
    const s = setup(),
      d = await s.prepare();
    await s.service.approve("alice", d.id, {
      digest: d.digest,
      acknowledged: true,
    });
    expect((await s.service.cancel("alice", d.id)).state).toBe("cancelled");
    await expect(
      s.service.submitSigned("alice", d.id, {
        digest: d.digest,
        signedTransactionBase64: s.signed(d),
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(s.rpc.sendRawTransaction).not.toHaveBeenCalled();
  });
});

describe("classic SPL discovery and preparation", () => {
  it("reads actual mock account layouts, preserves precision and prepares checked transfer with ATA rent", async () => {
    const s = setup(),
      mint = Keypair.generate().publicKey,
      source = Keypair.generate().publicKey;
    const destination = getAssociatedTokenAddressSync(
      mint,
      s.recipient.publicKey,
    );
    vi.mocked(s.rpc.getTokenAccountsByOwner).mockResolvedValue([
      {
        pubkey: source,
        account: tokenInfo(mint, s.sender.publicKey, 9007199254740993n),
      },
    ]);
    vi.mocked(s.rpc.getAccountInfo).mockImplementation(async (key) =>
      key.equals(mint) ? mintInfo(6) : key.equals(destination) ? null : info(),
    );
    const wallet = await s.service.discoverWallet(
      "alice",
      s.sender.publicKey.toBase58(),
    );
    expect(wallet.tokens[0]).toMatchObject({
      mint: mint.toBase58(),
      amountAtoms: "9007199254740993",
      amount: "9007199254.740993",
      decimals: 6,
    });
    const d = await s.service.prepare("alice", {
      ...s.input,
      asset: "SPL",
      mint: mint.toBase58(),
      amount: "1.000001",
    });
    expect(d).toMatchObject({
      amountAtoms: "1000001",
      sourceTokenAccount: source.toBase58(),
      recipientTokenAccount: destination.toBase58(),
      createsRecipientTokenAccount: true,
      estimatedRentLamports: "2039280",
      totalSolRequiredLamports: "2044280",
    });
    const tx = Transaction.from(
      Buffer.from(d.unsignedTransactionBase64, "base64"),
    );
    expect(tx.instructions).toHaveLength(2);
    expect(tx.instructions[1].programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(tx.instructions[1].data.readBigUInt64LE(1)).toBe(1000001n);
    expect(tx.instructions[1].data[9]).toBe(6);
  });
  it("rejects Token-2022, frozen sources, insufficient tokens and corrupt source ownership", async () => {
    const s = setup(),
      mint = Keypair.generate().publicKey,
      source = Keypair.generate().publicKey;
    const input = {
      ...s.input,
      asset: "SPL" as const,
      mint: mint.toBase58(),
      amount: "1",
    };
    vi.mocked(s.rpc.getAccountInfo).mockResolvedValue(
      info(Buffer.alloc(82), s.other.publicKey),
    );
    await expect(s.service.prepare("alice", input)).rejects.toMatchObject({
      code: "UNSUPPORTED_TOKEN",
    });
    vi.mocked(s.rpc.getAccountInfo).mockResolvedValue(mintInfo());
    vi.mocked(s.rpc.getTokenAccountsByOwner).mockResolvedValue([
      {
        pubkey: source,
        account: tokenInfo(mint, s.sender.publicKey, 2_000_000n, 2),
      },
    ]);
    await expect(s.service.prepare("alice", input)).rejects.toMatchObject({
      code: "INSUFFICIENT_TOKEN_BALANCE",
    });
    vi.mocked(s.rpc.getTokenAccountsByOwner).mockResolvedValue([
      {
        pubkey: source,
        account: tokenInfo(mint, s.other.publicKey, 2_000_000n),
      },
    ]);
    await expect(s.service.prepare("alice", input)).rejects.toMatchObject({
      code: "INVALID_RPC_DATA",
    });
  });
});
