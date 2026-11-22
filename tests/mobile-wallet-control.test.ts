import { Buffer } from "buffer";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Message,
} from "@solana/web3.js";
import { base58 } from "@scure/base";
import type { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { describe, expect, it, vi } from "vitest";
import {
  mwaSigner,
  walletControlIdentity,
} from "../apps/mobile/src/mwa-control";
import { SolanaControl } from "../apps/mobile/src/solana-control";
import {
  WalletControl,
  portfolioValue,
  type Payment,
  type PreparedTransfer,
  type WalletProvider,
  type WalletStorage,
} from "../apps/mobile/src/wallet-control";
import { CIRCLE_DEVNET_USDC_MINT } from "../src/lib/solana/assets";
import { DEVNET_GENESIS } from "../src/lib/solana/contracts";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "../src/lib/solana/classic-spl";

const phantom = Keypair.fromSeed(new Uint8Array(32).fill(1));
const solflare = Keypair.fromSeed(new Uint8Array(32).fill(2));
const recipient = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey;
const blockhash = new PublicKey(new Uint8Array(32).fill(4)).toBase58();
const signers = { phantom, solflare, backpack: phantom };
const destinations = {
  phantom: "agus-mwa-package:app.phantom",
  solflare: "agus-mwa-package:com.solflare.mobile",
  backpack: "agus-mwa-package:app.backpack.mobile",
};
const address = (provider: WalletProvider) =>
  signers[provider].publicKey.toBase58();
const account = (key: PublicKey) => ({
  address: key.toBuffer().toString("base64"),
  chains: ["solana:devnet"],
});
type WireTx = {
  transaction: { message: Message; signatures: string[] };
  meta: { err: unknown };
};

function fixture() {
  const records = new Map<string, string>();
  const storage: WalletStorage = {
    get: async (key) => records.get(key) ?? null,
    set: async (key, value) => {
      records.set(key, value);
    },
  };
  const wire = new Map<string, WireTx>();
  const found = new Map<string, string[]>();
  const rpc = {
    getGenesisHash: vi.fn(async (): Promise<string> => DEVNET_GENESIS),
    getBalance: vi.fn(async () => 5_000_000_000),
    getAccountInfo: vi.fn(async (_key: PublicKey): Promise<unknown> => null),
    getParsedTokenAccountsByOwner: vi.fn(async () => ({
      value: [] as unknown[],
    })),
    getMinimumBalanceForRentExemption: vi.fn(async () => 2_039_280),
    getLatestBlockhashAndContext: vi.fn(async () => ({
      value: { blockhash, lastValidBlockHeight: 200 },
      context: { slot: 101 },
    })),
    getFeeForMessage: vi.fn(async () => ({ value: 5000 })),
    simulateTransaction: vi.fn(async () => ({
      value: { err: null as unknown },
    })),
    getBlockHeight: vi.fn(async () => 120),
    getSignaturesForAddress: vi.fn(async (ref: PublicKey) =>
      (found.get(ref.toBase58()) ?? []).map((signature) => ({
        signature,
        confirmationStatus: "finalized",
      })),
    ),
    getTransaction: vi.fn(
      async (signature: string) => wire.get(signature) ?? null,
    ),
  };
  let ref = 20;
  const adapter = new SolanaControl(() => new Uint8Array(32).fill(ref++), {
    devnet: rpc,
    mainnet: rpc,
  } as unknown as ConstructorParameters<typeof SolanaControl>[1]);
  const behavior = {
    reject: false,
    lostResponse: false,
    wrongAccount: false,
    wrongMessage: false,
    deniedRenewal: false,
    multiAccount: false,
    failedOnChain: false,
  };
  const authorized = vi.fn();
  const submitted = vi.fn();
  const transport = vi.fn(async (callback, config) => {
    const provider = (Object.keys(destinations) as WalletProvider[]).find(
      (key) => destinations[key] === config.baseUri,
    );
    if (!provider) throw new Error("Expected a package-scoped association.");
    const key = signers[provider];
    return callback({
      authorize: async (request: {
        auth_token?: string;
        addresses?: string[];
      }) => {
        authorized(provider, request);
        if (request.auth_token && behavior.deniedRenewal) throw { code: -1 };
        const selected = behavior.wrongAccount ? recipient : key.publicKey;
        return {
          auth_token: `${provider}-${request.auth_token ? "renewed" : "original"}`,
          accounts: behavior.multiAccount
            ? [account(recipient), account(selected)]
            : [account(selected)],
        };
      },
      signAndSendTransactions: async ({
        transactions: [tx],
      }: {
        transactions: [Transaction];
      }) => {
        submitted(provider, tx);
        if (behavior.reject) throw { code: -3 };
        if (behavior.wrongMessage) tx.recentBlockhash = recipient.toBase58();
        tx.sign(key);
        expect(tx.verifySignatures()).toBe(true);
        const signature = base58.encode(tx.signature!);
        const message = tx.compileMessage();
        const last = tx.instructions.at(-1)!;
        const reference = last.keys.at(-1)!.pubkey.toBase58();
        wire.set(signature, {
          transaction: { message, signatures: [signature] },
          meta: {
            err: behavior.failedOnChain
              ? { InstructionError: [0, "Custom"] }
              : null,
          },
        });
        found.set(reference, [signature]);
        if (behavior.lostResponse) throw { code: "ERROR_SESSION_TIMEOUT" };
        return [signature];
      },
    });
  });
  const signer = mwaSigner(transport as unknown as typeof transact, {
    name: "AGUS test",
    uri: "https://example.com",
    icon: "favicon.ico",
  });
  const createControl = () => new WalletControl(storage, adapter, signer);
  const prepare = (provider: WalletProvider, amount = "0.01", asset = "SOL") =>
    adapter.prepare("devnet", address(provider), {
      recipient: recipient.toBase58(),
      asset,
      amount,
    });
  return {
    adapter,
    authorized,
    submitted,
    behavior,
    createControl,
    prepare,
    records,
    rpc,
    wire,
    found,
  };
}

describe("native Android MWA identity", () => {
  const backend = "https://backend.example";
  const publicOrigin = "https://wallet-test.example";

  it("uses a separate HTTPS identity and same-origin icon on a phone-test build", async () => {
    const transport = vi.fn(async (_callback, _config) => {
      throw { code: -100 };
    });
    const identity = walletControlIdentity(publicOrigin + "/", backend);
    expect(identity).toEqual({
      name: "AGUS Wallet Control",
      uri: publicOrigin,
      icon: "favicon.png",
    });
    const request = vi.fn().mockRejectedValue({ code: -1 });
    const nativeWallet = vi.fn(async (callback) =>
      callback({ authorize: request }),
    );
    const signer = mwaSigner(
      nativeWallet as unknown as typeof transact,
      identity,
    );
    await expect(signer.connect("phantom")).rejects.toThrow(
      /origin-verification/,
    );
    expect(request).toHaveBeenCalledWith({ chain: "solana:devnet", identity });
    await expect(
      mwaSigner(transport as unknown as typeof transact, identity).connect(
        "phantom",
      ),
    ).rejects.toThrow(/browser-origin attestation/);
    expect(walletControlIdentity(undefined, backend).uri).toBe(backend);
  });

  it.each([
    "http://wallet-test.example",
    publicOrigin + "/path",
    publicOrigin + "?q=1",
    publicOrigin + "#fragment",
    "https://user:pass@wallet-test.example",
  ])("rejects an unusable Digital Asset Links origin %s", (value) => {
    expect(() => walletControlIdentity(value, backend)).toThrow(
      /bare HTTPS origin/,
    );
  });
});

describe("independent Android wallet authorizations and payments", () => {
  it("deduplicates a watched address, retains two providers for one address and restores independent tokens", async () => {
    const f = fixture();
    const control = f.createControl();
    await control.addWatch("devnet", ` ${address("phantom")} `);
    await control.link("phantom");
    await control.link("solflare");
    await control.link("backpack");
    await control.addWatch("devnet", address("phantom"));
    await control.addWatch("mainnet", address("phantom"));
    expect(
      (await f.createControl().accounts()).map(
        ({ network, address, connections }) => [
          network,
          address,
          connections.map(({ provider }) => provider),
        ],
      ),
    ).toEqual([
      ["devnet", address("phantom"), ["phantom", "backpack"]],
      ["devnet", address("solflare"), ["solflare"]],
      ["mainnet", address("phantom"), []],
    ]);
    expect(
      [...f.records.values()].find((value) => value.includes('"connections"')),
    ).not.toContain("phantom-original");
    const fresh = f.createControl();
    const first = await fresh.submit("phantom", await f.prepare("phantom"));
    const second = await fresh.submit("solflare", await f.prepare("solflare"));
    expect(first.signature).not.toBe(second.signature);
    expect(f.authorized).toHaveBeenCalledWith(
      "phantom",
      expect.objectContaining({
        auth_token: "phantom-original",
        addresses: [account(phantom.publicKey).address],
      }),
    );
    expect(f.authorized).toHaveBeenCalledWith(
      "solflare",
      expect.objectContaining({
        auth_token: "solflare-original",
        addresses: [account(solflare.publicKey).address],
      }),
    );
    const reloaded = f.createControl();
    expect((await reloaded.check(first.transfer.reference)).state).toBe(
      "finalized",
    );
    expect((await reloaded.check(second.transfer.reference)).state).toBe(
      "finalized",
    );
    await reloaded.submit("phantom", await f.prepare("phantom", "0.02"));
    expect(f.authorized).toHaveBeenCalledWith(
      "phantom",
      expect.objectContaining({
        auth_token: "phantom-renewed",
      }),
    );
  });

  it("selects the requested address across returned accounts and blocks a wrong wallet or wrong account", async () => {
    const f = fixture();
    const control = f.createControl();
    await control.link("phantom");
    const draft = await f.prepare("phantom");
    await expect(control.submit("solflare", draft)).rejects.toThrow(
      /link this account/i,
    );
    f.behavior.wrongAccount = true;
    await expect(control.submit("phantom", draft)).rejects.toMatchObject({
      reason: "wrong-account",
    });
    expect(f.submitted).not.toHaveBeenCalled();
    f.behavior.wrongAccount = false;
    f.behavior.multiAccount = true;
    await expect(control.submit("phantom", draft)).resolves.toMatchObject({
      state: "pending",
    });
    expect(f.submitted).toHaveBeenCalledTimes(1);
  });

  it("reports expired/declined renewal, cancellation, and malformed reviewed transactions before broadcast", async () => {
    const f = fixture();
    const control = f.createControl();
    await control.link("phantom");
    const draft = await f.prepare("phantom");
    f.behavior.deniedRenewal = true;
    await expect(control.submit("phantom", draft)).rejects.toMatchObject({
      reason: "relink",
    });
    f.behavior.deniedRenewal = false;
    f.rpc.getBlockHeight.mockResolvedValueOnce(201);
    await expect(control.submit("phantom", draft)).rejects.toMatchObject({
      reason: "expired",
    });
    await expect(
      control.submit("phantom", { ...draft, message: "wrong" }),
    ).rejects.toThrow(/reviewed transfer/);
    expect(await control.payments()).toEqual([]);
    f.behavior.reject = true;
    await expect(control.submit("phantom", draft)).resolves.toMatchObject({
      state: "rejected",
    });
    expect((await control.payments())[0].signature).toBeUndefined();
  });

  it("reconciles a lost response by reference without sending a duplicate across a restart", async () => {
    const f = fixture();
    const control = f.createControl();
    await control.link("phantom");
    f.behavior.lostResponse = true;
    const draft = await f.prepare("phantom");
    const next = await f.prepare("phantom", "0.0100");
    const active = control.submit("phantom", draft);
    await expect(control.submit("phantom", draft)).rejects.toThrow(
      /already in progress/,
    );
    const pending = await active;
    expect(pending).toMatchObject({ state: "pending" });
    expect(pending.signature).toBeUndefined();
    const restarted = f.createControl();
    await expect(restarted.submit("phantom", draft)).rejects.toThrow(
      /review was already used/,
    );
    await expect(restarted.submit("phantom", next)).rejects.toThrow(
      /identical payment is unresolved/,
    );
    await expect(restarted.check(draft.reference)).resolves.toMatchObject({
      state: "finalized",
      signature: expect.any(String),
    });
    expect(f.submitted).toHaveBeenCalledTimes(1);
  });

  it("distinguishes execution failure, changed bytes, and expiry without a receipt", async () => {
    const f = fixture();
    const control = f.createControl();
    await control.link("phantom");
    f.behavior.failedOnChain = true;
    const failed = await control.submit("phantom", await f.prepare("phantom"));
    await expect(
      control.check(failed.transfer.reference),
    ).resolves.toMatchObject({ state: "failed" });
    f.behavior.wrongMessage = true;
    const changed = await control.submit(
      "phantom",
      await f.prepare("phantom", "0.02"),
    );
    await expect(
      control.check(changed.transfer.reference),
    ).resolves.toMatchObject({ state: "mismatch" });
    const transfer = await f.prepare("phantom", "0.03");
    const draft: Payment = { transfer, provider: "phantom", state: "pending" };
    f.rpc.getBlockHeight.mockResolvedValue(201);
    const unindexed = { ...draft, signature: failed.signature };
    f.rpc.getTransaction.mockResolvedValueOnce(null);
    await expect(f.adapter.confirm(unindexed)).resolves.toMatchObject({
      state: "pending",
    });
    await expect(f.adapter.confirm(draft)).resolves.toMatchObject({
      state: "expired",
    });
    f.rpc.getSignaturesForAddress.mockRejectedValueOnce(
      new Error("RPC unavailable"),
    );
    await expect(f.adapter.confirm(draft)).rejects.toThrow("RPC unavailable");
  });
});

describe("Solana read, review and verification boundaries", () => {
  it("rejects insufficient SOL, wrong genesis, unsupported tokens and mainnet sending", async () => {
    const f = fixture();
    await expect(f.prepare("phantom", "500")).rejects.toThrow(
      /insufficient sol/i,
    );
    await expect(f.prepare("phantom", "0.01", "USDT")).rejects.toThrow();
    await expect(
      f.prepare("phantom", "0.01", recipient.toBase58()),
    ).rejects.toThrow(/classic SPL/i);
    await expect(
      f.adapter.prepare("mainnet", address("phantom"), {
        amount: "1",
        recipient: recipient.toBase58(),
        asset: "SOL",
      }),
    ).rejects.toThrow(/only Devnet/i);
    f.rpc.getGenesisHash.mockResolvedValueOnce("wrong");
    await expect(f.prepare("phantom")).rejects.toThrow(
      /selected Solana network/i,
    );
    f.rpc.simulateTransaction.mockResolvedValueOnce({
      value: { err: "AccountNotFound" },
    });
    await expect(f.prepare("phantom")).rejects.toThrow(/simulation failed/i);
  });

  it("builds exact SOL and classic SPL instructions with a checked amount and conditional ATA rent", async () => {
    const f = fixture();
    const sol = await f.prepare("phantom");
    const parse = (draft: PreparedTransfer) =>
      Transaction.from(Buffer.from(draft.unsignedTransaction, "base64"));
    expect(parse(sol).instructions[0].programId).toEqual(
      SystemProgram.programId,
    );
    expect(parse(sol).instructions[0].data.readBigUInt64LE(4)).toBe(
      10_000_000n,
    );

    const mint = new PublicKey(CIRCLE_DEVNET_USDC_MINT);
    const source = getAssociatedTokenAddressSync(mint, phantom.publicKey);
    const mintData = Buffer.alloc(82);
    mintData[44] = 6;
    mintData[45] = 1;
    const sourceData = Buffer.alloc(165);
    mint.toBuffer().copy(sourceData, 0);
    phantom.publicKey.toBuffer().copy(sourceData, 32);
    sourceData.writeBigUInt64LE(9_000_000n, 64);
    sourceData[108] = 1;
    f.rpc.getAccountInfo.mockImplementation(async (key) => {
      const data = key.equals(mint)
        ? mintData
        : key.equals(source)
          ? sourceData
          : null;
      return data && { data, owner: TOKEN_PROGRAM_ID, executable: false };
    });
    const token = await f.prepare("phantom", "1.125", mint.toBase58());
    const instructions = parse(token).instructions;
    expect(token).toMatchObject({
      assetLabel: "Circle test USDC",
      fee: "0.000005",
      rent: "0.00203928",
      sourceTokenAccount: source.toBase58(),
      recipientTokenAccount: getAssociatedTokenAddressSync(
        mint,
        recipient,
      ).toBase58(),
    });
    expect(instructions).toHaveLength(2);
    expect(instructions[1].data.readBigUInt64LE(1)).toBe(1_125_000n);
    expect(instructions[1].keys.at(-1)).toMatchObject({
      pubkey: new PublicKey(token.reference),
      isSigner: false,
      isWritable: false,
    });
    await expect(f.prepare("phantom", "10", mint.toBase58())).rejects.toThrow(
      /insufficient token/i,
    );
  });

  it("aggregates SPL accounts by mint and values only holdings with fresh market prices", async () => {
    const f = fixture();
    const mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const holding = (id: string, atoms: string) => ({
      account: {
        data: {
          parsed: {
            info: {
              owner: address("phantom"),
              mint: id,
              tokenAmount: { amount: atoms, decimals: 6 },
            },
          },
        },
      },
    });
    f.rpc.getGenesisHash.mockResolvedValueOnce(
      "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    );
    f.rpc.getParsedTokenAccountsByOwner
      .mockResolvedValueOnce({
        value: [holding(mint, "500000"), holding(mint, "500000")],
      })
      .mockResolvedValueOnce({ value: [holding(recipient.toBase58(), "12")] });
    const snapshot = await f.adapter.balances("mainnet", address("phantom"));
    expect(snapshot.holdings.find((row) => row.id === mint)).toMatchObject({
      label: "USDC",
      atoms: 1_000_000n,
    });
    const now = Date.now();
    expect(
      portfolioValue(
        [snapshot, undefined],
        {
          solana: { usd: 150, updatedAt: now - 16 * 60_000 },
          "usd-coin": { usd: 0.99, updatedAt: now },
        },
        now,
      ),
    ).toEqual({ usd: 0.99, unpriced: 2 });
  });
});
