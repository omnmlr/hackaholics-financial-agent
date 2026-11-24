import { createHash, randomUUID, sign } from "node:crypto";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { base58 } from "@scure/base";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { GET, POST } from "../src/app/api/v1/crypto/[[...path]]/route";
import {
  associate,
  challenge,
  listWallets,
  approvedCryptoProviders,
} from "../src/server/crypto/registry";
import {
  beginCrypto,
  getAttempt,
  reconcileCrypto,
} from "../src/server/crypto/execution";
import { cryptoRpc } from "../src/server/crypto/rpc";
import { DEVNET_GENESIS } from "../src/lib/solana/contracts";
import { sol } from "../src/server/crypto/portfolio";
import { createIdentity, type Principal } from "../src/server/auth";
import { migrate } from "../src/server/migrations";
import { sharedPlatform } from "./helpers/shared-platform";
import type { Sql } from "../src/server/sql";

const devnet = "devnet";
const mockSender = Keypair.generate();
const mockRecipient = Keypair.generate();
const mockOutsider = Keypair.generate().publicKey.toBase58();
const testSignature = base58.encode(Buffer.alloc(64, 55));

function proof(key: Keypair, message: string) {
  return base58.encode(
    sign(null, Buffer.from(message, "base64"), {
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(key.secretKey.subarray(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    }),
  );
}

function parsedTransfer(
  from: string,
  to: string,
  sig = testSignature,
  lamports = 1_000_000,
  slot = 1234,
) {
  return {
    blockTime: Math.trunc(Date.now() / 1000),
    slot,
    transaction: {
      signatures: [sig],
      message: {
        accountKeys: [
          { pubkey: new PublicKey(from) },
          { pubkey: new PublicKey(to) },
        ],
        instructions: [
          {
            programId: SystemProgram.programId,
            parsed: {
              type: "transfer",
              info: { source: from, destination: to, lamports },
            },
          },
        ],
      },
    },
    meta: { fee: 5000, err: null },
  } as unknown as ParsedTransactionWithMeta;
}

interface TestUser extends Principal {
  cookie: string;
  email: string;
}

interface TestHarness {
  users: TestUser[];
  admin: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
  close: () => Promise<void>;
}

describe("AG-03 Adversarial Financial Security & Reliability Audit", () => {
  let harness: TestHarness;
  const origin = "http://localhost:3000";

  beforeAll(async () => {
    vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
    vi.stubEnv("AGUS_CRYPTO_DEVNET_ROUTES", "phantom");
    vi.stubEnv("AGUS_CRYPTO_MONITORING", "true");

    if (process.env.AGUS_TEST_DATABASE_URL) {
      const sp = await sharedPlatform(3);
      harness = {
        users: sp.users,
        admin: sp.admin,
        close: async () => {
          await sp.close();
        },
      };
    } else {
      // In-memory disposable PGlite environment
      vi.stubEnv("DATABASE_URL", "pglite://:memory:");
      vi.stubEnv("BETTER_AUTH_URL", origin);
      vi.stubEnv("APP_ORIGIN", origin);
      vi.stubEnv(
        "BETTER_AUTH_SECRET",
        "fixture-market-auth-secret-at-least-32-characters",
      );
      vi.stubEnv("PAYMENT_MODE", "fixture");
      vi.stubEnv("AI_PROVIDER", "none");
      vi.stubEnv("AI_API_KEY", "");
      vi.stubEnv("AGUS_ENCRYPTION_ACTIVE_KEY", "fixture");
      vi.stubEnv(
        "AGUS_ENCRYPTION_KEYS",
        JSON.stringify({ fixture: Buffer.alloc(32, 9).toString("base64") }),
      );

      const { db } = await import("../src/lib/db");
      const client = (await db()).$client as unknown as Sql;
      await migrate(client, join(process.cwd(), "migrations"), false);

      const auth = await createIdentity();
      const users: TestUser[] = [];

      for (let i = 0; i < 3; i++) {
        const email = `adversary${i}@fixture.invalid`;
        await client.query(
          "INSERT INTO agus_invitations(email,expires_at,created_by) VALUES($1,now()+interval '1 hour','adversarial-fixture')",
          [email],
        );
        const signupRes = await auth.handler(
          new Request(`${origin}/api/auth/sign-up/email`, {
            method: "POST",
            headers: {
              origin,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              email,
              password: "AdversarialPassword123!",
              name: `Adversary ${i}`,
            }),
          }),
        );
        const setCookie = signupRes.headers.get("set-cookie");
        const cookie = setCookie ? setCookie.split(";")[0] : "";
        const session = await auth.api.getSession({
          headers: new Headers({ cookie }),
        });
        users.push({
          id: session!.user.id,
          sessionId: session!.session.id,
          role: session!.user.role ?? "user",
          twoFactorEnabled: false,
          cookie,
          email,
        });
      }

      harness = {
        users,
        admin: client,
        close: async () => {},
      };
    }
  });

  afterAll(async () => {
    await harness?.close();
  });

  function apiRequest(
    userIndex: number | null,
    path: string,
    body?: unknown,
    idempotencyKey = randomUUID(),
  ) {
    const url = `${origin}/api/v1/crypto/${path}`;
    const headers: Record<string, string> = {
      origin,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    };
    if (userIndex !== null) {
      headers["cookie"] = harness.users[userIndex].cookie;
    }
    return new Request(url, {
      method: body === undefined ? "GET" : "POST",
      headers,
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  }

  async function associateWallet(userIndex: number, keypair: Keypair) {
    const user = harness.users[userIndex];
    const issued = await challenge(
      user,
      {
        address: keypair.publicKey.toBase58(),
        cluster: devnet,
        provider: "phantom",
      },
      randomUUID(),
    );
    return associate(
      user,
      {
        challengeId: issued.id,
        signature: proof(keypair, issued.messageBase64),
      },
      randomUUID(),
    );
  }

  // ==========================================================================
  // NEG-01: Cross-Tenant Access Rejection
  // ==========================================================================
  describe("NEG-01: Cross-tenant access rejection", () => {
    it("rejects unauthenticated requests with 401 SESSION_REQUIRED", async () => {
      const response = await GET(apiRequest(null, "wallets?cluster=devnet"));
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error.code).toBe("SESSION_REQUIRED");
    });

    it("rejects unauthorized tenant reading another tenant's wallet with 404", async () => {
      // User 0 associates a wallet
      const walletA = await associateWallet(0, mockSender);
      expect(walletA).toBeDefined();

      // User 1 tries to query User 0's wallet by ID
      const crossRead = await GET(
        apiRequest(1, `wallets?cluster=devnet&walletIds=${walletA.id}`),
      );
      expect(crossRead.status).toBe(404);
      const data = await crossRead.json();
      expect(data.error.code).toBe("NOT_FOUND");
    });

    it("rejects unauthorized tenant reading non-attributed chain event with 404", async () => {
      const user0 = harness.users[0];
      const wallet0 = await listWallets(user0.id, { cluster: devnet }, true);
      const sig = base58.encode(Buffer.alloc(64, 71));

      // Insert event into agus_crypto_chain_events and attribute only to User 0's wallet
      const event = parsedTransfer(wallet0[0].address, mockOutsider, sig, 1_000_000, 100);
      await harness.admin.query(
        "INSERT INTO agus_crypto_chain_events(cluster, signature, slot, block_time, event) VALUES($1,$2,$3,to_timestamp($4),$5::jsonb)",
        [devnet, sig, event.slot, event.blockTime, JSON.stringify(event)],
      );
      await harness.admin.query(
        "INSERT INTO agus_crypto_wallet_events(owner, wallet_id, cluster, signature) VALUES($1,$2,$3,$4)",
        [user0.id, wallet0[0].id, devnet, sig],
      );

      // User 1 attempts to fetch this event
      const eventLookup = await GET(
        apiRequest(1, `activity/devnet:${sig}?cluster=devnet`),
      );
      expect(eventLookup.status).toBe(404);
      const data = await eventLookup.json();
      expect(data.error.code).toBe("NOT_FOUND");
    });

    it("rejects forged or cross-tenant HMAC pagination cursors with 400 INVALID_CURSOR", async () => {
      // Malformed / forged cursor
      const forgedCursor = "eyJhbGciOiJIUzI1NiJ9.forged_signature_tag";
      const forgedReq = await GET(
        apiRequest(0, `activity?cluster=devnet&cursor=${forgedCursor}`),
      );
      expect(forgedReq.status).toBe(400);
      const forgedData = await forgedReq.json();
      expect(forgedData.error.code).toBe("INVALID_CURSOR");

      // Valid cursor structure with invalid context signature
      const fakePayload = Buffer.from(
        JSON.stringify({
          from: new Date().toISOString(),
          to: new Date().toISOString(),
          slot: 100,
          signature: testSignature,
        }),
      ).toString("base64url");
      const badTag = Buffer.from("wrong_hmac_signature_bytes_32").toString(
        "base64url",
      );
      const tamperCursor = `${fakePayload}.${badTag}`;

      const tamperReq = await GET(
        apiRequest(0, `activity?cluster=devnet&cursor=${tamperCursor}`),
      );
      expect(tamperReq.status).toBe(400);
      const tamperData = await tamperReq.json();
      expect(tamperData.error.code).toBe("INVALID_CURSOR");
    });
  });

  // ==========================================================================
  // NEG-02: Cluster and Genesis Mismatch Rejection
  // ==========================================================================
  describe("NEG-02: Cluster and genesis mismatch rejection", () => {
    it("throws CHAIN_IDENTITY_MISMATCH (503) when RPC genesis hash does not match devnet", async () => {
      const spy = vi
        .spyOn(Connection.prototype, "getGenesisHash")
        .mockResolvedValue("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d");
      vi.stubEnv("AGUS_DEVNET_RPC", "https://mismatch-rpc.invalid");

      try {
        await expect(cryptoRpc(devnet)).rejects.toMatchObject({
          code: "CHAIN_IDENTITY_MISMATCH",
          status: 503,
        });
      } finally {
        spy.mockRestore();
        vi.stubEnv("AGUS_DEVNET_RPC", "");
      }
    });

    it("verifies expected DEVNET_GENESIS constant pinning", () => {
      expect(DEVNET_GENESIS).toBe(
        "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
      );
    });

    it("rejects unapproved crypto providers for mainnet-beta", () => {
      const providers = approvedCryptoProviders("mainnet-beta");
      expect(providers).toEqual([]);
    });
  });

  // ==========================================================================
  // NEG-03: Tampered Review Digest and Revision Rejection
  // ==========================================================================
  describe("NEG-03: Tampered review digest and revision rejection", () => {
    it("throws REVISION_CHANGED (409) when reviewDigest is tampered or revision is mismatched", async () => {
      const user0 = harness.users[0];
      const wallet0 = (
        await listWallets(user0.id, { cluster: devnet }, true)
      )[0];
      const route = wallet0.routes[0];
      const reviewId = randomUUID();
      const validDigest = createHash("sha256")
        .update("canonical_review_content")
        .digest("hex");

      const review = {
        id: reviewId,
        revision: 0,
        reviewDigest: validDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet0.address,
        sourceWalletId: wallet0.id,
        reference: mockOutsider,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        messageDigest: "b".repeat(64),
        recipient: mockRecipient.publicKey.toBase58(),
        sourceTokenAccount: null,
        destinationTokenAccount: null,
        amount: sol(devnet, 1_000_000n),
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          user0.id,
          reviewId,
          wallet0.id,
          `fingerprint-${randomUUID()}`,
          JSON.stringify(review),
        ],
      );

      // Attempt 1: Tampered reviewDigest
      const tamperedDigest = "0".repeat(64);
      const resTampered = await POST(
        apiRequest(0, `reviews/${reviewId}/begin`, {
          revision: 0,
          reviewDigest: tamperedDigest,
        }),
      );
      expect(resTampered.status).toBe(409);
      const dataTampered = await resTampered.json();
      expect(dataTampered.error.code).toBe("REVISION_CHANGED");

      // Attempt 2: Mismatched revision
      const resMismatchRevision = await POST(
        apiRequest(0, `reviews/${reviewId}/begin`, {
          revision: 99,
          reviewDigest: validDigest,
        }),
      );
      expect(resMismatchRevision.status).toBe(409);
      const dataMismatchRevision = await resMismatchRevision.json();
      expect(dataMismatchRevision.error.code).toBe("REVISION_CHANGED");
    });
  });

  // ==========================================================================
  // NEG-04: Modified Transaction Bytes Rejection
  // ==========================================================================
  describe("NEG-04: Modified transaction bytes rejection", () => {
    it("skips transaction reconciliation when serialized message bytes do not match review.messageDigest", async () => {
      const user0 = harness.users[0];
      const wallet0 = (
        await listWallets(user0.id, { cluster: devnet }, true)
      )[0];
      const route = wallet0.routes[0];
      const reviewId = randomUUID();
      const reviewDigest = createHash("sha256")
        .update("legitimate-review")
        .digest("hex");

      // Original transaction: 1 SOL transfer
      const tx = new Transaction();
      tx.feePayer = mockSender.publicKey;
      tx.recentBlockhash = mockOutsider;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: mockSender.publicKey,
          toPubkey: mockRecipient.publicKey,
          lamports: 1_000_000n,
        }),
      );
      tx.sign(mockSender);

      const legitimateMessageDigest = createHash("sha256")
        .update(tx.serializeMessage())
        .digest("hex");

      const review = {
        id: reviewId,
        revision: 0,
        reviewDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet0.address,
        sourceWalletId: wallet0.id,
        reference: mockOutsider,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        messageDigest: legitimateMessageDigest,
        recipient: mockRecipient.publicKey.toBase58(),
        sourceTokenAccount: null,
        destinationTokenAccount: null,
        amount: sol(devnet, 1_000_000n),
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          user0.id,
          reviewId,
          wallet0.id,
          `fingerprint-${randomUUID()}`,
          JSON.stringify(review),
        ],
      );

      // Begin attempt
      const beginRes = await POST(
        apiRequest(0, `reviews/${reviewId}/begin`, {
          revision: 0,
          reviewDigest,
        }),
      );
      expect(beginRes.status).toBe(200);
      const attempt = await beginRes.json();

      // Hand off attempt
      const handoffRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/handoff`, {}, randomUUID()),
      );
      expect(handoffRes.status).toBe(200);

      // Report wallet outcome unknown
      const outcomeRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/wallet-outcome`, {
          kind: "unknown",
        }),
      );
      expect(outcomeRes.status).toBe(200);

      // Attacker constructs altered transaction: modified lamports to 5,000,000n
      const alteredTx = new Transaction();
      alteredTx.feePayer = mockSender.publicKey;
      alteredTx.recentBlockhash = mockOutsider;
      alteredTx.add(
        SystemProgram.transfer({
          fromPubkey: mockSender.publicKey,
          toPubkey: mockRecipient.publicKey,
          lamports: 5_000_000n,
        }),
      );
      alteredTx.sign(mockSender);

      const alteredSig = base58.encode(alteredTx.signature!);
      const mockChain = {
        getSignaturesForAddress: async () => [{ signature: alteredSig }],
        getTransaction: async () => ({
          version: "legacy",
          slot: 2000,
          meta: {
            err: null,
            fee: 5000,
            preBalances: [10_000_000, 0],
            postBalances: [4_995_000, 5_000_000],
          },
          transaction: {
            signatures: [alteredSig],
            message: alteredTx.compileMessage(),
          },
        }),
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "finalized", slot: 2000, err: null }],
        }),
        getParsedTransaction: async () =>
          parsedTransfer(
            wallet0.address,
            review.recipient,
            alteredSig,
            5_000_000,
            2000,
          ),
      } as unknown as Connection;

      // Reconcile attempt: altered message digest causes transaction to be skipped
      const outcome = await reconcileCrypto(
        user0.id,
        attempt.id,
        async () => mockChain,
      );
      expect(outcome.state).not.toBe("finalized");
      expect(outcome.receiptId).toBeNull();
    });

    it("holds state in unknown with SETTLEMENT_EFFECTS_UNVERIFIED when recipient leg is altered", async () => {
      const user0 = harness.users[0];
      const wallet0 = (
        await listWallets(user0.id, { cluster: devnet }, true)
      )[0];
      const route = wallet0.routes[0];
      const reviewId = randomUUID();
      const reviewDigest = createHash("sha256")
        .update("legitimate-review-2")
        .digest("hex");

      const rogueRecipient = Keypair.generate();
      const tx = new Transaction();
      tx.feePayer = mockSender.publicKey;
      tx.recentBlockhash = mockOutsider;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: mockSender.publicKey,
          toPubkey: rogueRecipient.publicKey,
          lamports: 1_000_000n,
        }),
      );
      tx.instructions[0].keys.push({
        pubkey: new PublicKey(mockOutsider),
        isSigner: false,
        isWritable: false,
      });
      tx.sign(mockSender);

      const review = {
        id: reviewId,
        revision: 0,
        reviewDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet0.address,
        sourceWalletId: wallet0.id,
        reference: mockOutsider,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        messageDigest: createHash("sha256")
          .update(tx.serializeMessage())
          .digest("hex"),
        recipient: mockRecipient.publicKey.toBase58(), // Expected recipient differs from on-chain recipient
        sourceTokenAccount: null,
        destinationTokenAccount: null,
        amount: sol(devnet, 1_000_000n),
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          user0.id,
          reviewId,
          wallet0.id,
          `fingerprint-${randomUUID()}`,
          JSON.stringify(review),
        ],
      );

      const beginRes = await POST(
        apiRequest(0, `reviews/${reviewId}/begin`, {
          revision: 0,
          reviewDigest,
        }),
      );
      const attempt = await beginRes.json();

      // Hand off attempt
      const handoffRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/handoff`, {}, randomUUID()),
      );
      expect(handoffRes.status).toBe(200);

      // Report wallet outcome unknown
      const outcomeRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/wallet-outcome`, {
          kind: "unknown",
        }),
      );
      expect(outcomeRes.status).toBe(200);

      const finalSig = base58.encode(tx.signature!);
      const mockChain = {
        getSignaturesForAddress: async () => [{ signature: finalSig }],
        getTransaction: async () => ({
          version: "legacy",
          slot: 2005,
          meta: {
            err: null,
            fee: 5000,
            preBalances: [2_000_000, 0],
            postBalances: [995_000, 1_000_000],
          },
          transaction: {
            signatures: [finalSig],
            message: tx.compileMessage(),
          },
        }),
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "finalized", slot: 2005, err: null }],
        }),
        getParsedTransaction: async () =>
          parsedTransfer(
            wallet0.address,
            rogueRecipient.publicKey.toBase58(),
            finalSig,
            1_000_000,
            2005,
          ),
      } as unknown as Connection;

      const outcome = await reconcileCrypto(
        user0.id,
        attempt.id,
        async () => mockChain,
      );
      expect(outcome.state).toBe("unknown");
      expect(outcome.reason).toBe("SETTLEMENT_EFFECTS_UNVERIFIED");
      expect(outcome.receiptId).toBeNull();
    });
  });

  // ==========================================================================
  // NEG-05: Expired Challenge Proof and Expired Review Rejection
  // ==========================================================================
  describe("NEG-05: Expired challenge proof and expired review rejection", () => {
    it("rejects challenge when expired with CHALLENGE_EXPIRED (410)", async () => {
      const user0 = harness.users[0];
      const keypair = Keypair.generate();

      const issued = await challenge(
        user0,
        {
          address: keypair.publicKey.toBase58(),
          cluster: devnet,
          provider: "phantom",
        },
        randomUUID(),
      );

      // Force challenge expiry in database
      await harness.admin.query(
        "UPDATE agus_crypto_challenges SET expires_at=now()-interval '1 minute' WHERE id=$1",
        [issued.id],
      );

      await expect(
        associate(
          user0,
          {
            challengeId: issued.id,
            signature: proof(keypair, issued.messageBase64),
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({
        code: "CHALLENGE_EXPIRED",
        status: 410,
      });
    });

    it("rejects challenge consumed under a different sessionId with 403", async () => {
      const user0 = harness.users[0];
      const keypair = Keypair.generate();

      const issued = await challenge(
        user0,
        {
          address: keypair.publicKey.toBase58(),
          cluster: devnet,
          provider: "phantom",
        },
        randomUUID(),
      );

      // Attempt associate with mismatched sessionId
      const tamperedPrincipal: Principal = {
        ...user0,
        sessionId: randomUUID(),
      };

      await expect(
        associate(
          tamperedPrincipal,
          {
            challengeId: issued.id,
            signature: proof(keypair, issued.messageBase64),
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({
        code: "OWNERSHIP_PROOF_REQUIRED",
        status: 403,
      });
    });

    it("rejects replaying an already consumed challenge proof with 403", async () => {
      const user0 = harness.users[0];
      const keypair = Keypair.generate();

      const issued = await challenge(
        user0,
        {
          address: keypair.publicKey.toBase58(),
          cluster: devnet,
          provider: "phantom",
        },
        randomUUID(),
      );

      const payload = {
        challengeId: issued.id,
        signature: proof(keypair, issued.messageBase64),
      };

      // First consumption succeeds
      const first = await associate(user0, payload, randomUUID());
      expect(first).toBeDefined();

      // Second consumption with new idempotency key fails
      await expect(
        associate(user0, payload, randomUUID()),
      ).rejects.toMatchObject({
        code: "OWNERSHIP_PROOF_REQUIRED",
        status: 403,
      });
    });

    it("rejects beginCrypto when review has expired with REVIEW_EXPIRED (410)", async () => {
      const user0 = harness.users[0];
      const wallet0 = (
        await listWallets(user0.id, { cluster: devnet }, true)
      )[0];
      const route = wallet0.routes[0];
      const reviewId = randomUUID();
      const reviewDigest = createHash("sha256").update("expired").digest("hex");

      const expiredReview = {
        id: reviewId,
        revision: 0,
        reviewDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet0.address,
        sourceWalletId: wallet0.id,
        reference: mockOutsider,
        expiresAt: new Date(Date.now() - 10_000).toISOString(), // Expired 10s ago
        messageDigest: "c".repeat(64),
        recipient: mockRecipient.publicKey.toBase58(),
        sourceTokenAccount: null,
        destinationTokenAccount: null,
        amount: sol(devnet, 1_000_000n),
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          user0.id,
          reviewId,
          wallet0.id,
          `fingerprint-${randomUUID()}`,
          JSON.stringify(expiredReview),
        ],
      );

      await expect(
        beginCrypto(
          user0,
          reviewId,
          { revision: 0, reviewDigest },
          randomUUID(),
        ),
      ).rejects.toMatchObject({
        code: "REVIEW_EXPIRED",
        status: 410,
      });
    });

    it("rejects handoffCrypto when review expires before handoff with REVIEW_EXPIRED (410)", async () => {
      const user0 = harness.users[0];
      const wallet0 = (
        await listWallets(user0.id, { cluster: devnet }, true)
      )[0];
      const route = wallet0.routes[0];
      const reviewId = randomUUID();
      const reviewDigest = createHash("sha256")
        .update("short-lived")
        .digest("hex");

      const shortLivedReview = {
        id: reviewId,
        revision: 0,
        reviewDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet0.address,
        sourceWalletId: wallet0.id,
        reference: mockOutsider,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        messageDigest: "d".repeat(64),
        recipient: mockRecipient.publicKey.toBase58(),
        sourceTokenAccount: null,
        destinationTokenAccount: null,
        amount: sol(devnet, 1_000_000n),
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          user0.id,
          reviewId,
          wallet0.id,
          `fingerprint-${randomUUID()}`,
          JSON.stringify(shortLivedReview),
        ],
      );

      const beginRes = await POST(
        apiRequest(0, `reviews/${reviewId}/begin`, {
          revision: 0,
          reviewDigest,
        }),
      );
      expect(beginRes.status).toBe(200);
      const attempt = await beginRes.json();

      // Now expire the review in the database
      shortLivedReview.expiresAt = new Date(Date.now() - 5000).toISOString();
      await harness.admin.query(
        "UPDATE agus_crypto_reviews SET review=$1::jsonb WHERE id=$2",
        [JSON.stringify(shortLivedReview), reviewId],
      );

      const handoffRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/handoff`, {}, randomUUID()),
      );
      expect(handoffRes.status).toBe(410);
      const data = await handoffRes.json();
      expect(data.error.code).toBe("REVIEW_EXPIRED");
    });
  });

  // ==========================================================================
  // NEG-06: Repeat Handoff Replay Rejection
  // ==========================================================================
  describe("NEG-06: Repeat handoff replay rejection", () => {
    it("grants launch exactly once and returns launchGranted: false on duplicate or replayed handoffs", async () => {
      const user0 = harness.users[0];
      const wallet0 = (
        await listWallets(user0.id, { cluster: devnet }, true)
      )[0];
      const route = wallet0.routes[0];
      const reviewId = randomUUID();
      const reviewDigest = createHash("sha256")
        .update("handoff-replay-test")
        .digest("hex");

      const review = {
        id: reviewId,
        revision: 0,
        reviewDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet0.address,
        sourceWalletId: wallet0.id,
        reference: mockOutsider,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        messageDigest: "e".repeat(64),
        recipient: mockRecipient.publicKey.toBase58(),
        sourceTokenAccount: null,
        destinationTokenAccount: null,
        amount: sol(devnet, 1_000_000n),
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          user0.id,
          reviewId,
          wallet0.id,
          `fingerprint-${randomUUID()}`,
          JSON.stringify(review),
        ],
      );

      const beginRes = await POST(
        apiRequest(0, `reviews/${reviewId}/begin`, {
          revision: 0,
          reviewDigest,
        }),
      );
      expect(beginRes.status).toBe(200);
      const attempt = await beginRes.json();

      const idempotencyKey = randomUUID();

      // First handoff call: MUST grant launch
      const firstHandoffRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/handoff`, {}, idempotencyKey),
      );
      expect(firstHandoffRes.status).toBe(200);
      const firstHandoff = await firstHandoffRes.json();
      expect(firstHandoff.launchGranted).toBe(true);

      // Replayed handoff call with SAME idempotency key: MUST return launchGranted: false
      const replaySameKeyRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/handoff`, {}, idempotencyKey),
      );
      expect(replaySameKeyRes.status).toBe(200);
      const replaySameKey = await replaySameKeyRes.json();
      expect(replaySameKey.launchGranted).toBe(false);

      // Subsequent handoff call with NEW idempotency key: MUST return launchGranted: false (state locked)
      const freshKeyHandoffRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/handoff`, {}, randomUUID()),
      );
      expect(freshKeyHandoffRes.status).toBe(200);
      const freshKeyHandoff = await freshKeyHandoffRes.json();
      expect(freshKeyHandoff.launchGranted).toBe(false);

      // Verify attempt state is locked in 'handoff'
      const attemptState = await getAttempt(user0.id, attempt.id);
      expect(attemptState.state).toBe("handoff");
    });
  });

  // ==========================================================================
  // NEG-07: Incomplete Confirmation / False Finality Rejection
  // ==========================================================================
  describe("NEG-07: Incomplete confirmation / false finality rejection", () => {
    it("refuses to finalize transactions at processed or confirmed commitment levels", async () => {
      const user0 = harness.users[0];
      const senderKey = Keypair.generate();
      const wallet = await associateWallet(0, senderKey);
      const route = wallet.routes[0];
      const reviewId = randomUUID();
      const reviewDigest = createHash("sha256")
        .update("finality-test")
        .digest("hex");

      const tx = new Transaction();
      tx.feePayer = senderKey.publicKey;
      tx.recentBlockhash = mockOutsider;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: senderKey.publicKey,
          toPubkey: mockRecipient.publicKey,
          lamports: 1_000_000n,
        }),
      );
      tx.instructions[0].keys.push({
        pubkey: new PublicKey(mockOutsider),
        isSigner: false,
        isWritable: false,
      });
      tx.sign(senderKey);

      const finalSig = base58.encode(tx.signature!);

      const review = {
        id: reviewId,
        revision: 0,
        reviewDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet.address,
        sourceWalletId: wallet.id,
        reference: mockOutsider,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        messageDigest: createHash("sha256")
          .update(tx.serializeMessage())
          .digest("hex"),
        recipient: mockRecipient.publicKey.toBase58(),
        sourceTokenAccount: null,
        destinationTokenAccount: null,
        amount: sol(devnet, 1_000_000n),
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          user0.id,
          reviewId,
          wallet.id,
          `fingerprint-${randomUUID()}`,
          JSON.stringify(review),
        ],
      );

      const beginRes = await POST(
        apiRequest(0, `reviews/${reviewId}/begin`, {
          revision: 0,
          reviewDigest,
        }),
      );
      expect(beginRes.status).toBe(200);
      const attempt = await beginRes.json();

      // Hand off attempt
      const handoffRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/handoff`, {}, randomUUID()),
      );
      expect(handoffRes.status).toBe(200);

      // Report wallet outcome submitted with signature so it transitions to pending
      const outcomeRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/wallet-outcome`, {
          kind: "signature",
          signature: finalSig,
        }),
      );
      expect(outcomeRes.status).toBe(200);

      // Phase 1: RPC returns 'confirmed' (NOT 'finalized')
      let currentConfirmationStatus: "confirmed" | "finalized" = "confirmed";

      const mockChain = {
        getSignaturesForAddress: async () => [{ signature: finalSig }],
        getTransaction: async () => ({
          version: "legacy",
          slot: 3500,
          meta: {
            err: null,
            fee: 5000,
            preBalances: [2_000_000, 0, 0, 0],
            postBalances: [995_000, 1_000_000, 0, 0],
          },
          transaction: {
            signatures: [finalSig],
            message: tx.compileMessage(),
          },
        }),
        getSignatureStatuses: async () => ({
          value: [
            {
              confirmationStatus: currentConfirmationStatus,
              slot: 3500,
              err: null,
            },
          ],
        }),
        getParsedTransaction: async () =>
          parsedTransfer(wallet.address, review.recipient, finalSig, 1_000_000, 3500),
      } as unknown as Connection;

      // Reconcile at 'confirmed' level: must NOT finalize
      const pendingOutcome = await reconcileCrypto(
        user0.id,
        attempt.id,
        async () => mockChain,
      );
      expect(pendingOutcome.state).not.toBe("finalized");
      expect(pendingOutcome.receiptId).toBeNull();

      // Verify no receipt exists in the database yet
      const receiptsPre = await harness.admin.query(
        "SELECT 1 FROM agus_crypto_receipts WHERE attempt_id=$1",
        [attempt.id],
      );
      expect(receiptsPre.rows).toHaveLength(0);

      // Phase 2: RPC advances to 'finalized'
      currentConfirmationStatus = "finalized";

      const finalizedOutcome = await reconcileCrypto(
        user0.id,
        attempt.id,
        async () => mockChain,
      );
      expect(finalizedOutcome.state).toBe("finalized");
      expect(finalizedOutcome.receiptId).toBeTruthy();

      // Verify receipt exists now in the database
      const receiptsPost = await harness.admin.query(
        "SELECT signature FROM agus_crypto_receipts WHERE attempt_id=$1",
        [attempt.id],
      );
      expect(receiptsPost.rows).toHaveLength(1);
      expect(receiptsPost.rows[0].signature).toBe(finalSig);
    });
  });
});
