import { createHash, randomUUID, sign } from "node:crypto";
import { base58 } from "@scure/base";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TOKEN_PROGRAM_ID } from "../src/lib/solana/classic-spl";
import { activity, syncWalletActivity } from "../src/server/crypto/activity";
import { reconcileCrypto } from "../src/server/crypto/execution";
import { portfolio, sol } from "../src/server/crypto/portfolio";
import { priceHoldings } from "../src/server/crypto/prices";
import {
  associate,
  challenge,
  unlink,
  watch,
} from "../src/server/crypto/registry";
import { SOLANA_NETWORKS } from "../src/server/crypto/rpc";
import { sharedPlatform } from "./helpers/shared-platform";

const address = () => Keypair.generate().publicKey.toBase58();
const signature = (value: number) => base58.encode(Buffer.alloc(64, value));

it("uses exact quoted USD values and keeps Devnet and unpriced assets separate", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) => {
      if (String(url).includes("SOL-USD"))
        return Response.json({
          data: { base: "SOL", currency: "USD", amount: "71.125" },
        });
      return Response.json({
        data: { base: "USDT", currency: "USD", amount: "1.00" },
      });
    });
  const walletId = randomUUID();
  const base = {
    walletId,
    valuation: null,
    spendable: false,
    tokenAccount: null,
  };
  const holdings = [
    { ...base, amount: sol("mainnet-beta", 1_000_000_001n), symbol: "SOL" },
    { ...base, amount: sol("devnet", 1_000_000_001n), symbol: "SOL" },
    {
      ...base,
      tokenAccount: address(),
      symbol: "USDC",
      amount: {
        asset: {
          cluster: "mainnet-beta" as const,
          kind: "token" as const,
          program: TOKEN_PROGRAM_ID.toBase58(),
          mint: SOLANA_NETWORKS["mainnet-beta"].usdc,
        },
        decimals: 6,
        atoms: "1000000",
      },
    },
  ];
  try {
    const [result, simultaneous] = await Promise.all([
      priceHoldings(holdings),
      priceHoldings(holdings),
    ]);
    expect(result).toEqual(simultaneous);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      result.holdings.map(({ valuation }) => valuation?.valueUsd ?? null),
    ).toEqual(["71.125000071125", null, null]);
    expect(result.subtotal).toBe("71.125000071125");
    expect(result.holdings[0].valuation?.provider).toBe("Coinbase spot");
    vi.advanceTimersByTime(15_001);
    await priceHoldings(holdings);
    expect(fetcher).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(60_001);
    fetcher.mockRejectedValue(new Error("provider unavailable"));
    expect((await priceHoldings(holdings)).subtotal).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(5);
  } finally {
    fetcher.mockRestore();
    vi.useRealTimers();
  }
});

describe.skipIf(!process.env.AGUS_TEST_DATABASE_URL)(
  "AGUS wallet reliability with PostgreSQL",
  () => {
    let fixture: Awaited<ReturnType<typeof sharedPlatform>>;
    beforeAll(async () => {
      fixture = await sharedPlatform(2);
    });
    afterAll(async () => {
      await fixture?.close();
    });

    it("uses current wallet authorization with a cached finalized balance", async () => {
      const user = fixture.users[0];
      const key = Keypair.generate();
      const recipient = key.publicKey.toBase58();
      const scope = { cluster: "devnet" as const };
      const watched = await watch(
        user,
        {
          ...scope,
          address: recipient,
          label: "Authorization fixture",
          ownDeclared: false,
        },
        randomUUID(),
      );
      const getAccountInfoAndContext = vi.fn(async () => ({
        context: { slot: 1236 },
        value: {
          owner: SystemProgram.programId,
          data: Buffer.alloc(0),
          lamports: 1_000_000,
        },
      }));
      const chain = {
        getAccountInfoAndContext,
        getParsedTokenAccountsByOwner: async () => ({
          context: { slot: 1236 },
          value: [],
        }),
      } as unknown as Connection;
      const read = () =>
        portfolio(
          user.id,
          { ...scope, walletIds: [watched.id] },
          async () => chain,
        );
      vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
      vi.stubEnv("AGUS_CRYPTO_DEVNET_ROUTES", "phantom");
      try {
        expect((await read()).holdings[0].spendable).toBe(false);
        const issued = await challenge(
          user,
          { ...scope, address: recipient, provider: "phantom" },
          randomUUID(),
        );
        const proof = sign(null, Buffer.from(issued.messageBase64, "base64"), {
          key: Buffer.concat([
            Buffer.from("302e020100300506032b657004220420", "hex"),
            Buffer.from(key.secretKey.subarray(0, 32)),
          ]),
          format: "der",
          type: "pkcs8",
        });
        const linked = await associate(
          user,
          { challengeId: issued.id, signature: base58.encode(proof) },
          randomUUID(),
        );
        expect((await read()).holdings[0].spendable).toBe(true);
        await unlink(user, linked.id, linked.routes[0].id, randomUUID());
        expect((await read()).holdings[0].spendable).toBe(false);
        expect(getAccountInfoAndContext).toHaveBeenCalledTimes(1);
      } finally {
        vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", undefined);
        vi.stubEnv("AGUS_CRYPTO_DEVNET_ROUTES", undefined);
      }
    });

    it("discovers a closed classic token account, deduplicates its history and excludes later unrelated ownership", async () => {
      const ownerAddress = address();
      const otherOwner = address();
      const closed = address();
      const mint = SOLANA_NETWORKS.devnet.usdc;
      const closeSig = signature(70),
        earlierSig = signature(71),
        unrelatedSig = signature(72);
      function historyEntry(
        sig: string,
        slot: number,
        tokenOwner: string,
        ownerInMessage = false,
      ) {
        return {
          blockTime: Math.floor(Date.now() / 1000) - 1,
          slot,
          transaction: {
            signatures: [sig],
            message: {
              accountKeys: (ownerInMessage
                ? [closed, ownerAddress]
                : [closed]
              ).map((key) => ({ pubkey: new PublicKey(key) })),
              instructions: [],
            },
          },
          meta: {
            fee: 5000,
            err: null,
            preTokenBalances: [
              {
                accountIndex: 0,
                mint,
                owner: tokenOwner,
                programId: TOKEN_PROGRAM_ID.toBase58(),
                uiTokenAmount: { decimals: 6 },
              },
            ],
          },
        } as unknown as ParsedTransactionWithMeta;
      }
      const events = new Map([
        [closeSig, historyEntry(closeSig, 1234, ownerAddress, true)],
        [earlierSig, historyEntry(earlierSig, 1233, ownerAddress)],
        [unrelatedSig, historyEntry(unrelatedSig, 1235, otherOwner)],
      ]);
      const fetchEvents = vi.fn(async (keys: string[]) =>
        keys.map((key) => events.get(key)),
      );
      const chain = {
        getAccountInfoAndContext: async () => ({
          context: { slot: 1236 },
          value: null,
        }),
        getParsedTokenAccountsByOwner: async () => ({
          context: { slot: 1236 },
          value: [],
        }),
        getSignaturesForAddress: async (key: PublicKey) => {
          const keys =
            key.toBase58() === ownerAddress
              ? [closeSig]
              : key.toBase58() === closed
                ? [unrelatedSig, closeSig, earlierSig]
                : [];
          return keys.map((id) => ({
            signature: id,
            slot: events.get(id)!.slot,
            blockTime: events.get(id)!.blockTime,
          }));
        },
        getParsedTransactions: fetchEvents,
      } as unknown as Connection;
      for (const [index, owner] of fixture.users.entries()) {
        const wallet = await watch(
          owner,
          {
            cluster: "devnet",
            address: ownerAddress,
            label: "History fixture",
            ownDeclared: false,
          },
          randomUUID(),
        );
        await syncWalletActivity(owner.id, wallet, async () => chain);
        expect(
          (
            await fixture.admin.query(
              "SELECT address FROM agus_crypto_token_accounts WHERE owner=$1 AND wallet_id=$2",
              [owner.id, wallet.id],
            )
          ).rows,
        ).toEqual([{ address: closed }]);
        await fixture.admin.query(
          "UPDATE agus_crypto_scan_status SET checked_at=now()-interval '1 minute' WHERE owner=$1 AND wallet_id=$2",
          [owner.id, wallet.id],
        );
        await syncWalletActivity(owner.id, wallet, async () => chain);
        const page = await activity(owner.id, {
          cluster: "devnet",
          walletIds: [wallet.id],
        });
        expect(page.items.map(({ signature }) => signature)).toEqual([
          closeSig,
          earlierSig,
        ]);
        expect(page.items[0]).not.toHaveProperty("tokenAccounts");
        if (index === 0) {
          await expect(
            activity(fixture.users[1].id, {
              cluster: "devnet",
              walletIds: [wallet.id],
            }),
          ).rejects.toThrow("NOT_FOUND");
        }
      }
      expect(fetchEvents).toHaveBeenCalledTimes(2);
    });

    it("requires independent agreement on unrelated finalized transactions before releasing an expired attempt", async () => {
      const user = fixture.users[0];
      const sender = Keypair.generate();
      const wallet = await watch(
        user,
        {
          cluster: "devnet",
          address: sender.publicKey.toBase58(),
          label: "Expiry fixture",
          ownDeclared: false,
        },
        randomUUID(),
      );
      const reference = address(),
        unrelatedSig = signature(75),
        olderSig = signature(76);
      const reviewId = randomUUID(),
        attemptId = randomUUID(),
        fingerprint = "expiry-history-fixture";
      const transaction = new Transaction({
        feePayer: sender.publicKey,
        recentBlockhash: address(),
      }).add(
        SystemProgram.transfer({
          fromPubkey: sender.publicKey,
          toPubkey: new PublicKey(address()),
          lamports: 57,
        }),
      );
      const message = transaction.compileMessage();
      const unrelatedDigest = createHash("sha256")
        .update(message.serialize())
        .digest("hex");
      const review = {
        id: reviewId,
        revision: 0,
        reviewDigest: "f".repeat(64),
        routeId: randomUUID(),
        cluster: "devnet",
        expectedSigner: wallet.address,
        sourceWalletId: wallet.id,
        reference,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
        minContextSlot: 1000,
        lastValidBlockHeight: 500,
        messageDigest: "7".repeat(64),
      };
      await fixture.admin.query(
        "INSERT INTO agus_crypto_reviews VALUES($1,$2,$3,$4,$5::jsonb)",
        [user.id, reviewId, wallet.id, fingerprint, JSON.stringify(review)],
      );
      await fixture.admin.query(
        "INSERT INTO agus_crypto_attempts(owner,id,review_id,fingerprint,state,reason) VALUES($1,$2,$3,$4,'unknown','CALLBACK_UNKNOWN')",
        [user.id, attemptId, reviewId, fingerprint],
      );
      const recent = { signature: unrelatedSig, slot: 1001 };
      const marker = { signature: olderSig, slot: 850 };
      const unrelated = {
        slot: recent.slot,
        transaction: { signatures: [unrelatedSig], message },
      };
      let primaryRecords: (typeof unrelated | null)[] = [null];
      const variants = {
        getBlockHeight: async () => 501,
        getFirstAvailableBlock: async () => 800,
        getSignaturesForAddress: async (key: PublicKey) =>
          key.toBase58() === reference ? [] : [recent, marker],
      };
      const verifier = {
        ...variants,
        getTransaction: async () => unrelated,
      } as unknown as Connection;
      const primary = {
        ...variants,
        getTransactions: async () => primaryRecords,
      } as unknown as Connection;
      const read = async (_cluster: string, independent?: boolean) =>
        independent ? verifier : primary;
      vi.stubEnv("AGUS_DEVNET_VERIFY_RPC", "https://verify.fixture.invalid");
      try {
        expect((await reconcileCrypto(user.id, attemptId, read)).state).toBe(
          "unknown",
        );
        primaryRecords = [unrelated];
        await fixture.admin.query(
          "UPDATE agus_crypto_reviews SET review=jsonb_set(review,'{messageDigest}',$3::jsonb) WHERE owner=$1 AND id=$2",
          [user.id, reviewId, JSON.stringify(unrelatedDigest)],
        );
        expect((await reconcileCrypto(user.id, attemptId, read)).state).toBe(
          "unknown",
        );
        await fixture.admin.query(
          "UPDATE agus_crypto_reviews SET review=$3::jsonb WHERE owner=$1 AND id=$2",
          [user.id, reviewId, JSON.stringify(review)],
        );
        expect(await reconcileCrypto(user.id, attemptId, read)).toMatchObject({
          state: "expired",
          reason: "BLOCKHASH_EXPIRED_WITH_MATCHED_HISTORY",
          receiptId: null,
        });
      } finally {
        vi.stubEnv("AGUS_DEVNET_VERIFY_RPC", undefined);
      }
    });

    it.skipIf(process.env.AGUS_CRYPTO_LIVE_PRICE_CHECK !== "true")(
      "prices a real read-only Mainnet wallet with live Coinbase spot evidence",
      async () => {
        const user = fixture.users[0];
        const wallet = await watch(
          user,
          {
            cluster: "mainnet-beta",
            address: "So11111111111111111111111111111111111111112",
            label: "Public SOL mint",
            ownDeclared: false,
          },
          randomUUID(),
        );
        const snapshot = await portfolio(user.id, {
          cluster: "mainnet-beta",
          walletIds: [wallet.id],
        });
        const native = snapshot.holdings.find(({ symbol }) => symbol === "SOL");
        expect(snapshot.source.mode).toBe("public-rpc");
        expect(native?.valuation?.provider).toBe("Coinbase spot");
        expect(BigInt(native!.amount.atoms)).toBeGreaterThan(0n);
        expect(Number(native?.valuation?.valueUsd)).toBeGreaterThan(0);
        console.info(
          JSON.stringify({
            slot: snapshot.source.slot,
            holding: native?.amount.atoms,
            valuation: native?.valuation,
            subtotal: snapshot.pricedSubtotalUsd,
          }),
        );
      },
    );
  },
);
