import { createHash, randomUUID, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
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
  readSource,
} from "../src/server/crypto/registry";
import {
  beginCrypto,
  getAttempt,
  reconcileCrypto,
} from "../src/server/crypto/execution";
import {
  addAlertRule,
  evaluateAlertRule,
  listAlerts,
} from "../src/server/crypto/alerts";
import { cryptoRpc } from "../src/server/crypto/rpc";
import { DEVNET_GENESIS } from "../src/lib/solana/contracts";
import { CIRCLE_DEVNET_USDC_MINT } from "../src/lib/solana/assets";
import { TOKEN_PROGRAM_ID } from "../src/lib/solana/classic-spl";
import { portfolio, sol, syncWalletBalances } from "../src/server/crypto/portfolio";
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
  email?: string;
}

interface TestHarness {
  users: TestUser[];
  admin: {
    query: (
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: Record<string, unknown>[] }>;
  };
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
  // NEG-02: Cluster, Genesis, and Signer Mismatch Rejection
  // ==========================================================================
  describe("NEG-02: Cluster, genesis, and signer mismatch rejection", () => {
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

    it("rejects transaction during reconciliation when signer mismatches review.expectedSigner or numRequiredSignatures !== 1", async () => {
      const user1 = harness.users[1];
      const expectedKey = Keypair.generate();
      const rogueSigner = Keypair.generate();
      const coSigner = Keypair.generate();
      const wallet = await associateWallet(1, expectedKey);
      const route = wallet.routes[0];

      // Case A: rogueSigner signs instead of expectedSigner (message.staticAccountKeys[0] !== review.expectedSigner)
      const rogueTx = new Transaction();
      rogueTx.feePayer = rogueSigner.publicKey;
      rogueTx.recentBlockhash = mockOutsider;
      rogueTx.add(
        SystemProgram.transfer({
          fromPubkey: rogueSigner.publicKey,
          toPubkey: mockRecipient.publicKey,
          lamports: 1_000_000n,
        }),
      );
      rogueTx.instructions[0].keys.push({
        pubkey: new PublicKey(mockOutsider),
        isSigner: false,
        isWritable: false,
      });
      rogueTx.sign(rogueSigner);

      const rogueSig = base58.encode(rogueTx.signature!);
      const rogueReviewId = randomUUID();
      const rogueReviewDigest = createHash("sha256")
        .update("signer-mismatch-review")
        .digest("hex");
      const rogueReview = {
        id: rogueReviewId,
        revision: 0,
        reviewDigest: rogueReviewDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet.address,
        sourceWalletId: wallet.id,
        reference: mockOutsider,
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        // Match messageDigest intentionally to isolate the expectedSigner check at execution.ts:633
        messageDigest: createHash("sha256")
          .update(rogueTx.serializeMessage())
          .digest("hex"),
        recipient: mockRecipient.publicKey.toBase58(),
        sourceTokenAccount: null,
        destinationTokenAccount: null,
        amount: sol(devnet, 1_000_000n),
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          user1.id,
          rogueReviewId,
          wallet.id,
          `fingerprint-${randomUUID()}`,
          JSON.stringify(rogueReview),
        ],
      );

      const beginRes = await POST(
        apiRequest(1, `reviews/${rogueReviewId}/begin`, {
          revision: 0,
          reviewDigest: rogueReviewDigest,
        }),
      );
      expect(beginRes.status).toBe(200);
      const attemptA = await beginRes.json();

      await POST(apiRequest(1, `attempts/${attemptA.id}/handoff`, {}, randomUUID()));
      await POST(
        apiRequest(1, `attempts/${attemptA.id}/wallet-outcome`, {
          kind: "signature",
          signature: rogueSig,
        }),
      );

      const mockRogueChain = {
        getSignaturesForAddress: async () => [{ signature: rogueSig }],
        getTransaction: async () => ({
          version: "legacy",
          slot: 2100,
          meta: {
            err: null,
            fee: 5000,
            preBalances: [2_000_000, 0, 0],
            postBalances: [995_000, 1_000_000, 0],
          },
          transaction: {
            signatures: [rogueSig],
            message: rogueTx.compileMessage(),
          },
        }),
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "finalized", slot: 2100, err: null }],
        }),
        getParsedTransaction: async () =>
          parsedTransfer(
            rogueSigner.publicKey.toBase58(),
            rogueReview.recipient,
            rogueSig,
            1_000_000,
            2100,
          ),
      } as unknown as Connection;

      const outcomeA = await reconcileCrypto(
        user1.id,
        attemptA.id,
        async () => mockRogueChain,
      );
      expect(outcomeA.state).not.toBe("finalized");
      expect(outcomeA.receiptId).toBeNull();

      // Case B: Multi-signer transaction (numRequiredSignatures === 2 !== 1)
      const multiTx = new Transaction();
      multiTx.feePayer = expectedKey.publicKey;
      multiTx.recentBlockhash = mockOutsider;
      multiTx.add(
        SystemProgram.transfer({
          fromPubkey: expectedKey.publicKey,
          toPubkey: mockRecipient.publicKey,
          lamports: 1_000_000n,
        }),
      );
      multiTx.instructions[0].keys.push({
        pubkey: coSigner.publicKey,
        isSigner: true,
        isWritable: false,
      });
      multiTx.sign(expectedKey, coSigner);

      const multiSig = base58.encode(multiTx.signatures[0].signature!);
      const multiReviewId = randomUUID();
      const multiReviewDigest = createHash("sha256")
        .update("multi-signer-review")
        .digest("hex");
      const multiReview = {
        ...rogueReview,
        id: multiReviewId,
        reviewDigest: multiReviewDigest,
        messageDigest: createHash("sha256")
          .update(multiTx.serializeMessage())
          .digest("hex"),
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          user1.id,
          multiReviewId,
          wallet.id,
          `fingerprint-${randomUUID()}`,
          JSON.stringify(multiReview),
        ],
      );

      const beginMultiRes = await POST(
        apiRequest(1, `reviews/${multiReviewId}/begin`, {
          revision: 0,
          reviewDigest: multiReviewDigest,
        }),
      );
      expect(beginMultiRes.status).toBe(200);
      const attemptB = await beginMultiRes.json();

      await POST(apiRequest(1, `attempts/${attemptB.id}/handoff`, {}, randomUUID()));
      await POST(
        apiRequest(1, `attempts/${attemptB.id}/wallet-outcome`, {
          kind: "signature",
          signature: multiSig,
        }),
      );

      const mockMultiChain = {
        getSignaturesForAddress: async () => [{ signature: multiSig }],
        getTransaction: async () => ({
          version: "legacy",
          slot: 2105,
          meta: {
            err: null,
            fee: 5000,
            preBalances: [2_000_000, 0, 0],
            postBalances: [995_000, 1_000_000, 0],
          },
          transaction: {
            signatures: multiTx.signatures.map((s) => base58.encode(s.signature!)),
            message: multiTx.compileMessage(),
          },
        }),
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "finalized", slot: 2105, err: null }],
        }),
        getParsedTransaction: async () =>
          parsedTransfer(
            wallet.address,
            multiReview.recipient,
            multiSig,
            1_000_000,
            2105,
          ),
      } as unknown as Connection;

      const outcomeB = await reconcileCrypto(
        user1.id,
        attemptB.id,
        async () => mockMultiChain,
      );
      expect(outcomeB.state).not.toBe("finalized");
      expect(outcomeB.receiptId).toBeNull();
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

  // ==========================================================================
  // NEG-08: Missing Callback Recovery and Premature Outcome Rejection
  // ==========================================================================
  describe("NEG-08: Missing callback recovery and premature outcome rejection", () => {
    it("rejects reportWalletOutcome while attempt is in ready state with 403 APPROVAL_REQUIRED", async () => {
      const user0 = harness.users[0];
      const senderKey = Keypair.generate();
      const wallet = await associateWallet(0, senderKey);
      const route = wallet.routes[0];
      const reviewId = randomUUID();
      const reviewDigest = createHash("sha256")
        .update("premature-outcome-review")
        .digest("hex");

      const review = {
        id: reviewId,
        revision: 0,
        reviewDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet.address,
        sourceWalletId: wallet.id,
        reference: Keypair.generate().publicKey.toBase58(),
        expiresAt: new Date(Date.now() + 120_000).toISOString(),
        messageDigest: "f".repeat(64),
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

      // Reporting wallet-outcome before handoffCrypto must fail with 403 APPROVAL_REQUIRED
      const prematureRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/wallet-outcome`, {
          kind: "unknown",
        }),
      );
      expect(prematureRes.status).toBe(403);
      const data = await prematureRes.json();
      expect(data.error.code).toBe("APPROVAL_REQUIRED");
    });

    it("discovers and finalizes transaction via review.reference when mobile callback is dropped", async () => {
      const user0 = harness.users[0];
      const senderKey = Keypair.generate();
      const wallet = await associateWallet(0, senderKey);
      const route = wallet.routes[0];
      const uniqueReference = Keypair.generate().publicKey.toBase58();
      const reviewId = randomUUID();
      const reviewDigest = createHash("sha256")
        .update("missing-callback-reference-discovery")
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
        pubkey: new PublicKey(uniqueReference),
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
        reference: uniqueReference,
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
      const attempt = await beginRes.json();

      await POST(apiRequest(0, `attempts/${attempt.id}/handoff`, {}, randomUUID()));

      // Client reports 'unknown' with no signature (simulating dropped Android MWA deep-link callback)
      const outcomeRes = await POST(
        apiRequest(0, `attempts/${attempt.id}/wallet-outcome`, {
          kind: "unknown",
        }),
      );
      expect(outcomeRes.status).toBe(200);
      const afterOutcome = await outcomeRes.json();
      expect(afterOutcome.state).toBe("unknown");
      expect(afterOutcome.signature).toBeNull();

      let queriedAddress: string | null = null;
      const mockChain = {
        getSignaturesForAddress: async (pubkey: PublicKey) => {
          queriedAddress = pubkey.toBase58();
          return [{ signature: finalSig }];
        },
        getTransaction: async () => ({
          version: "legacy",
          slot: 3600,
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
          value: [{ confirmationStatus: "finalized", slot: 3600, err: null }],
        }),
        getParsedTransaction: async () =>
          parsedTransfer(
            wallet.address,
            review.recipient,
            finalSig,
            1_000_000,
            3600,
          ),
      } as unknown as Connection;

      const reconciled = await reconcileCrypto(
        user0.id,
        attempt.id,
        async () => mockChain,
      );
      expect(queriedAddress).toBe(uniqueReference);
      expect(reconciled.state).toBe("finalized");
      expect(reconciled.receiptId).toBeTruthy();
      expect(reconciled.signature).toBe(finalSig);
    });
  });

  // ==========================================================================
  // NEG-09: Replayed Alert Deduplication & Uniqueness Enforcement
  // ==========================================================================
  describe("NEG-09: Replayed alert deduplication and uniqueness enforcement", () => {
    it("deduplicates replayed alert evaluations and rejects duplicate alert inserts", async () => {
      const user0 = harness.users[0];
      const alertKey = Keypair.generate();
      const alertWallet = await associateWallet(0, alertKey);

      const rule = await addAlertRule(
        user0,
        {
          walletId: alertWallet.id,
          kind: "external_inflow",
          min: sol(devnet, 500_000n),
        },
        randomUUID(),
      );

      const inflowSig = base58.encode(Buffer.alloc(64, 88));
      const futureBlockTime = new Date(Date.now() + 10_000).toISOString();
      const inflowEvent = {
        id: `${devnet}:${inflowSig}`,
        signature: inflowSig,
        slot: 4200,
        blockTime: futureBlockTime,
        source: readSource(devnet, 4200, futureBlockTime),
        finality: "finalized" as const,
        status: "success" as const,
        legs: [
          {
            id: `${devnet}:${inflowSig}:0`,
            instructionPath: "0",
            kind: "transfer" as const,
            from: mockOutsider,
            to: alertWallet.address,
            fromOwner: mockOutsider,
            toOwner: alertWallet.address,
            amount: sol(devnet, 1_500_000n),
          },
        ],
        explorerUrl: `https://explorer.solana.com/tx/${inflowSig}?cluster=devnet`,
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_chain_events(cluster, signature, slot, block_time, event) VALUES($1,$2,$3,$4,$5::jsonb)",
        [devnet, inflowSig, 4200, futureBlockTime, JSON.stringify(inflowEvent)],
      );
      await harness.admin.query(
        "INSERT INTO agus_crypto_wallet_events(owner, wallet_id, cluster, signature) VALUES($1,$2,$3,$4)",
        [user0.id, alertWallet.id, devnet, inflowSig],
      );

      // First evaluation emits exactly 1 alert and 1 observation
      await evaluateAlertRule(user0.id, devnet, rule.id);
      const afterFirst = await listAlerts(user0.id, {
        cluster: devnet,
        walletIds: [alertWallet.id],
      });
      expect(afterFirst.items).toHaveLength(1);
      expect(afterFirst.items[0].dedupeKey).toBe(
        `${rule.id}:${devnet}:${inflowSig}:${alertWallet.id}`,
      );

      // Replay evaluation: observation index skips re-emission
      await evaluateAlertRule(user0.id, devnet, rule.id);
      const afterReplay = await listAlerts(user0.id, {
        cluster: devnet,
        walletIds: [alertWallet.id],
      });
      expect(afterReplay.items).toHaveLength(1);

      // Simulate race bypassing observation table: UNIQUE(owner, rule_id, cluster, signature) + ON CONFLICT prevents duplicate
      await harness.admin.query(
        "DELETE FROM agus_crypto_alert_observations WHERE owner=$1 AND rule_id=$2",
        [user0.id, rule.id],
      );
      await evaluateAlertRule(user0.id, devnet, rule.id);
      const afterObsReset = await listAlerts(user0.id, {
        cluster: devnet,
        walletIds: [alertWallet.id],
      });
      expect(afterObsReset.items).toHaveLength(1);

      // Verify raw duplicate insert without ON CONFLICT is rejected by schema UNIQUE constraint
      await expect(
        harness.admin.query(
          "INSERT INTO agus_crypto_alerts(owner, id, rule_id, cluster, signature) VALUES($1,$2,$3,$4,$5)",
          [user0.id, randomUUID(), rule.id, devnet, inflowSig],
        ),
      ).rejects.toThrow(/duplicate key|unique constraint/i);
    });
  });

  // ==========================================================================
  // NEG-10: Stale, Partial, and Disputed Portfolio Coverage Handling
  // ==========================================================================
  describe("NEG-10: Stale, partial, and disputed portfolio coverage handling", () => {
    it("surfaces stale coverage when RPC fails over expired cache and blocks partial overwrite of complete snapshot", async () => {
      const user2 = harness.users[2];
      const staleKey = Keypair.generate();
      const staleWallet = await associateWallet(2, staleKey);

      const expiredAt = new Date(Date.now() - 300_000).toISOString();
      const cachedSol = {
        kind: "sol" as const,
        slot: 5000,
        observedAt: expiredAt,
        partial: false,
        holdings: [
          {
            walletId: staleWallet.id,
            tokenAccount: null,
            amount: sol(devnet, 2_000_000n),
            symbol: "SOL",
            valuation: null,
            spendable: true,
          },
        ],
      };
      const cachedToken = {
        kind: "token" as const,
        slot: 5000,
        observedAt: expiredAt,
        partial: false,
        holdings: [],
      };

      await harness.admin.query(
        "INSERT INTO agus_crypto_balances(owner, wallet_id, kind, observed_at, slot, value) VALUES($1,$2,'sol',$3,$4,$5::jsonb), ($1,$2,'token',$3,$4,$6::jsonb)",
        [
          user2.id,
          staleWallet.id,
          expiredAt,
          5000,
          JSON.stringify(cachedSol),
          JSON.stringify(cachedToken),
        ],
      );

      const failingRpc = {
        getAccountInfoAndContext: async () => {
          throw new Error("RPC_TIMEOUT");
        },
        getParsedTokenAccountsByOwner: async () => {
          throw new Error("RPC_TIMEOUT");
        },
      } as unknown as Connection;

      const stalePortfolio = await portfolio(
        user2.id,
        { cluster: devnet, walletIds: [staleWallet.id] },
        async () => failingRpc,
      );
      const balancesCov = stalePortfolio.coverage.find(
        (c) => c.walletId === staleWallet.id && c.kind === "balances",
      );
      expect(balancesCov).toBeDefined();
      expect(balancesCov!.state).toBe("stale");
      expect(balancesCov!.reason).toBe("provider_failure");

      // Partial RPC response (malformed/mismatched token account owner) must NOT overwrite complete token cache
      const partialRpc = {
        getAccountInfoAndContext: async () => ({
          context: { slot: 5100 },
          value: {
            lamports: 3_000_000,
            owner: SystemProgram.programId,
            data: Buffer.alloc(0),
          },
        }),
        getParsedTokenAccountsByOwner: async () => ({
          context: { slot: 5100 },
          value: [
            {
              pubkey: Keypair.generate().publicKey,
              account: {
                owner: TOKEN_PROGRAM_ID,
                data: {
                  parsed: {
                    info: {
                      // Wrong owner triggers partial = true in portfolio.ts:108
                      owner: mockOutsider,
                      mint: CIRCLE_DEVNET_USDC_MINT,
                      tokenAmount: { amount: "1000000", decimals: 6 },
                      state: "initialized",
                    },
                  },
                },
              },
            },
          ],
        }),
      } as unknown as Connection;

      const synced = await syncWalletBalances(
        user2.id,
        staleWallet,
        async () => partialRpc,
      );
      const tokenSnapshot = synced.find((b) => b.kind === "token");
      expect(tokenSnapshot).toBeDefined();
      expect(tokenSnapshot!.slot).toBe(5000);
      expect(tokenSnapshot!.partial).toBe(false);
    });

    it("excludes disputed token account shared across two wallets at same slot and flags rpc_lag", async () => {
      const user2 = harness.users[2];
      const walletD1 = await associateWallet(2, Keypair.generate());
      const walletD2 = await associateWallet(2, Keypair.generate());
      const sharedTokenAccount = Keypair.generate().publicKey;

      const disputedRpc = {
        getAccountInfoAndContext: async () => ({
          context: { slot: 6000 },
          value: {
            lamports: 2_000_000,
            owner: SystemProgram.programId,
            data: Buffer.alloc(0),
          },
        }),
        getParsedTokenAccountsByOwner: async (ownerPubkey: PublicKey) => ({
          context: { slot: 6000 },
          value: [
            {
              pubkey: sharedTokenAccount,
              account: {
                owner: TOKEN_PROGRAM_ID,
                data: {
                  parsed: {
                    info: {
                      owner: ownerPubkey.toBase58(),
                      mint: CIRCLE_DEVNET_USDC_MINT,
                      tokenAmount: { amount: "5000000", decimals: 6 },
                      state: "initialized",
                    },
                  },
                },
              },
            },
          ],
        }),
      } as unknown as Connection;

      const result = await portfolio(
        user2.id,
        { cluster: devnet, walletIds: [walletD1.id, walletD2.id] },
        async () => disputedRpc,
      );

      // Ambiguous token account must be omitted from holdings
      expect(
        result.holdings.some(
          (h) => h.tokenAccount === sharedTokenAccount.toBase58(),
        ),
      ).toBe(false);

      // Coverage for both wallets must degrade to partial with reason 'rpc_lag'
      for (const wid of [walletD1.id, walletD2.id]) {
        const cov = result.coverage.find(
          (c) => c.walletId === wid && c.kind === "balances",
        );
        expect(cov).toBeDefined();
        expect(cov!.state).toBe("partial");
        expect(cov!.reason).toBe("rpc_lag");
      }
    });
  });

  // ==========================================================================
  // NEG-11: SQL Least-Privilege Immutability & Text Owner RLS Verification
  // ==========================================================================
  describe("NEG-11: SQL least-privilege immutability and text owner RLS verification", () => {
    it("revokes UPDATE and DELETE from agus_runtime on ledger/audit tables and enforces text owner RLS", async () => {
      const pg = new PGlite();
      try {
        const sqlAdapter: Sql = {
          exec: (text) => pg.exec(text),
          query: (text, params) => pg.query(text, params),
        };
        await migrate(sqlAdapter, join(process.cwd(), "migrations"), false);

        // Step 1: Apply baseline runtime-role.sql and verify the pre-remediation flaw
        const baselineSql = readFileSync(
          join(process.cwd(), "scripts/sql/runtime-role.sql"),
          "utf8",
        );
        await pg.exec(baselineSql);

        const ownerId = "better-auth-user-text-id-001";
        const otherOwnerId = "better-auth-user-text-id-002";
        const walletId = randomUUID();
        const reviewId = randomUUID();
        const attemptId = randomUUID();
        const receiptId = randomUUID();
        const auditId = randomUUID();
        const sig = base58.encode(Buffer.alloc(64, 91));

        await pg.query(
          "INSERT INTO agus_users(id, name, email) VALUES($1, 'Owner One', 'one@fixture.invalid'), ($2, 'Owner Two', 'two@fixture.invalid')",
          [ownerId, otherOwnerId],
        );
        await pg.query(
          "INSERT INTO agus_crypto_wallets(owner, id, cluster, address, label) VALUES($1, $2, 'devnet', $3, 'W1'), ($4, $5, 'devnet', $6, 'W2')",
          [
            ownerId,
            walletId,
            Keypair.generate().publicKey.toBase58(),
            otherOwnerId,
            randomUUID(),
            Keypair.generate().publicKey.toBase58(),
          ],
        );
        await pg.query(
          "INSERT INTO agus_crypto_chain_events(cluster, signature, slot, event) VALUES('devnet', $1, 100, '{}'::jsonb)",
          [sig],
        );
        await pg.query(
          "INSERT INTO agus_crypto_wallet_events(owner, wallet_id, cluster, signature) VALUES($1, $2, 'devnet', $3)",
          [ownerId, walletId, sig],
        );
        await pg.query(
          "INSERT INTO agus_crypto_reviews(owner, id, wallet_id, fingerprint, review) VALUES($1, $2, $3, 'fp-1', '{}'::jsonb)",
          [ownerId, reviewId, walletId],
        );
        await pg.query(
          "INSERT INTO agus_crypto_attempts(owner, id, review_id, fingerprint, state) VALUES($1, $2, $3, 'fp-1', 'finalized')",
          [ownerId, attemptId, reviewId],
        );
        await pg.query(
          "INSERT INTO agus_crypto_receipts(owner, id, attempt_id, cluster, signature, receipt) VALUES($1, $2, $3, 'devnet', $4, '{}'::jsonb)",
          [ownerId, receiptId, attemptId, sig],
        );
        await pg.query(
          "INSERT INTO agus_audit(id, owner, resource_type, resource_id, action) VALUES($1, $2, 'crypto_attempt', $3, 'crypto.approved')",
          [auditId, ownerId, attemptId],
        );

        // Before remediation: agus_runtime CAN update agus_crypto_receipts (demonstrating the flaw)
        await pg.exec("SET ROLE agus_runtime;");
        await expect(
          pg.query(
            "UPDATE agus_crypto_receipts SET cluster='devnet' WHERE id=$1",
            [receiptId],
          ),
        ).resolves.toBeDefined();
        await pg.exec("RESET ROLE;");

        // Exercise the published audit proposal in this disposable engine.
        // The deployed grant script is separately guarded by owner and database.
        const remediationSql = readFileSync(
          join(process.cwd(), "docs/agus-crypto/engineering/evidence/ag-03-proposed.sql.txt"),
          "utf8",
        );
        await pg.exec(remediationSql);

        // Step 3: Verify agus_runtime can SELECT and INSERT, but CANNOT UPDATE or DELETE immutable tables
        await pg.exec("SET ROLE agus_runtime;");

        const sig2 = base58.encode(Buffer.alloc(64, 92));
        await expect(
          pg.query("SELECT id FROM agus_crypto_receipts WHERE id=$1", [receiptId]),
        ).resolves.toMatchObject({ rows: [{ id: receiptId }] });

        await expect(
          pg.query(
            "INSERT INTO agus_crypto_chain_events(cluster, signature, slot, event) VALUES('devnet', $1, 101, '{}'::jsonb)",
            [sig2],
          ),
        ).resolves.toBeDefined();
        await expect(
          pg.query(
            "INSERT INTO agus_crypto_wallet_events(owner, wallet_id, cluster, signature) VALUES($1, $2, 'devnet', $3)",
            [ownerId, walletId, sig2],
          ),
        ).resolves.toBeDefined();
        await expect(
          pg.query(
            "INSERT INTO agus_audit(id, owner, resource_type, resource_id, action) VALUES($1, $2, 'crypto_attempt', $3, 'crypto.handoff')",
            [randomUUID(), ownerId, attemptId],
          ),
        ).resolves.toBeDefined();

        // UPDATE and DELETE must be denied on all 5 immutable financial/audit tables
        await expect(
          pg.query("UPDATE agus_crypto_chain_events SET slot=999 WHERE signature=$1", [sig]),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          pg.query("DELETE FROM agus_crypto_chain_events WHERE signature=$1", [sig]),
        ).rejects.toThrow(/permission denied/i);

        await expect(
          pg.query("UPDATE agus_crypto_wallet_events SET cluster='devnet' WHERE signature=$1", [sig]),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          pg.query("DELETE FROM agus_crypto_wallet_events WHERE signature=$1", [sig]),
        ).rejects.toThrow(/permission denied/i);

        await expect(
          pg.query("UPDATE agus_crypto_receipts SET cluster='devnet' WHERE id=$1", [receiptId]),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          pg.query("DELETE FROM agus_crypto_receipts WHERE id=$1", [receiptId]),
        ).rejects.toThrow(/permission denied/i);

        await expect(
          pg.query("UPDATE agus_crypto_reviews SET fingerprint='tampered' WHERE id=$1", [reviewId]),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          pg.query("DELETE FROM agus_crypto_reviews WHERE id=$1", [reviewId]),
        ).rejects.toThrow(/permission denied/i);

        await expect(
          pg.query("UPDATE agus_audit SET action='tampered' WHERE id=$1", [auditId]),
        ).rejects.toThrow(/permission denied/i);
        await expect(
          pg.query("DELETE FROM agus_audit WHERE id=$1", [auditId]),
        ).rejects.toThrow(/permission denied/i);

        await pg.exec("RESET ROLE;");

        // Step 4: Verify the documented text-typed RLS policy executes cleanly and isolates Better Auth string IDs
        await pg.exec(`
          ALTER TABLE agus_crypto_wallets ENABLE ROW LEVEL SECURITY;
          CREATE POLICY crypto_tenant_isolation ON agus_crypto_wallets
            FOR ALL
            TO agus_runtime
            USING (owner = NULLIF(current_setting('app.current_user_id', true), ''))
            WITH CHECK (owner = NULLIF(current_setting('app.current_user_id', true), ''));
        `);

        await pg.exec("SET ROLE agus_runtime;");
        // Unset session context fails closed (0 rows visible)
        const unsetRows = await pg.query("SELECT owner FROM agus_crypto_wallets");
        expect(unsetRows.rows).toHaveLength(0);

        // Tenant-scoped session context reveals only ownerId's wallet
        await pg.query("SELECT set_config('app.current_user_id', $1, false)", [
          ownerId,
        ]);
        const scopedRows = await pg.query("SELECT owner FROM agus_crypto_wallets");
        expect(scopedRows.rows).toEqual([{ owner: ownerId }]);
        await pg.exec("RESET ROLE;");
      } finally {
        await pg.close();
      }
    });
  });
});
