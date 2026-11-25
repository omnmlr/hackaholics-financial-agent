/// <reference types="node" />
import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { base58 } from "@scure/base";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import type { components } from "@agus/api-client";
import type {
  WalletDiagnostic,
  WalletStage,
} from "../src/crypto-wallet-policy";

// Mocks for React Native, Expo, and Auth modules in isolated Node test environment
const native = vi.hoisted(() => {
  process.env.EXPO_PUBLIC_API_URL ??= "https://api.example";
  return {
    store: new Map<string, string>(),
    transact: vi.fn(),
    send: vi.fn(),
    authenticateAsync: vi.fn(async () => ({ success: true })),
    hasHardwareAsync: vi.fn(async () => true),
    isEnrolledAsync: vi.fn(async () => true),
  };
});

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: (_algorithm: string, bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest(),
}));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "fixture",
  getItem: (key: string) => native.store.get(key) ?? null,
  getItemAsync: async (key: string) => native.store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    native.store.set(key, value);
  },
  setItemAsync: async (key: string, value: string) => {
    native.store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    native.store.delete(key);
  },
}));

vi.mock("expo-local-authentication", () => ({
  hasHardwareAsync: native.hasHardwareAsync,
  isEnrolledAsync: native.isEnrolledAsync,
  authenticateAsync: native.authenticateAsync,
}));

vi.mock("better-auth/react", () => ({
  createAuthClient: () => ({
    getCookie: async () => "agus.session=fixture",
    signIn: { email: vi.fn() },
  }),
}));

vi.mock("better-auth/client/plugins", () => ({
  twoFactorClient: () => ({}),
}));

vi.mock("@better-auth/expo/client", () => ({
  expoClient: () => ({}),
}));

vi.mock("@solana-mobile/mobile-wallet-adapter-protocol-web3js", () => ({
  transact: native.transact,
}));

import { createCryptoSigner } from "../src/crypto-signer";
import {
  canRecover,
  parseSavedAttempt,
  solAtoms,
} from "../src/crypto-device-state";
import { WalletRouteError, walletFailure } from "../src/crypto-wallet-policy";
vi.mock("expo/fetch", () => ({ fetch: globalThis.fetch }));

import { api, lockSession, unlockSession } from "../src/session";

type Schemas = components["schemas"];

type MockAuthorizeParams = {
  chain?: string;
  identity?: { name?: string; uri?: string; icon?: string };
  addresses?: string[];
  auth_token?: string;
};

type MockMwaWallet = {
  authorize: ReturnType<typeof vi.fn<(params: MockAuthorizeParams) => Promise<{
    auth_token: string;
    accounts: Array<{ address: string; chains?: string[] }>;
  }>>>;
  getCapabilities: ReturnType<typeof vi.fn<() => Promise<{
    supported_transaction_versions: string[];
    supports_sign_and_send_transactions: boolean;
  }>>>;
  signAndSendTransactions: typeof native.send;
  signMessages: ReturnType<typeof vi.fn>;
  deauthorize: ReturnType<typeof vi.fn>;
};

describe("AG-02 Standalone Regression Test Suite: Android & External Wallet", () => {
  const sender = Keypair.generate().publicKey;
  const target = Keypair.generate().publicKey;
  const blockhash = Keypair.generate().publicKey.toBase58();
  const rawSignatureBytes = new Uint8Array(64).fill(42);
  const validBase58Signature = base58.encode(rawSignatureBytes);

  const route: Schemas["CryptoRoute"] = {
    id: randomUUID(),
    provider: "phantom",
    cluster: "devnet",
    address: sender.toBase58(),
    operations: ["transfer"],
    status: "available",
    reason: null,
  };

  const now = new Date().toISOString();
  const tx = new Transaction({
    recentBlockhash: blockhash,
    feePayer: sender,
  }).add(
    SystemProgram.transfer({
      fromPubkey: sender,
      toPubkey: target,
      lamports: 1_000_000n,
    }),
  );

  const review: Schemas["CryptoReview"] = {
    id: randomUUID(),
    revision: 0,
    operation: "transfer",
    cluster: "devnet",
    sourceWalletId: randomUUID(),
    routeId: route.id,
    expectedSigner: route.address,
    feePayer: route.address,
    recipient: target.toBase58(),
    sourceTokenAccount: null,
    destinationTokenAccount: null,
    amount: {
      asset: { cluster: "devnet", kind: "sol" },
      atoms: "1000000",
      decimals: 9,
    },
    estimatedFeeLamports: "5000",
    estimatedRentLamports: "0",
    quote: null,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    blockhash,
    lastValidBlockHeight: 50,
    reference: null,
    minContextSlot: 3,
    messageDigest: createHash("sha256")
      .update(tx.serializeMessage())
      .digest("hex"),
    reviewDigest: "1".repeat(64),
    transactionVersion: "legacy",
    unsignedTransactionBase64: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    simulation: { passed: true, slot: 3, observedAt: now },
    source: {
      mode: "fixture",
      cluster: "devnet",
      provider: "test",
      observedAt: now,
      slot: 3,
    },
  };

  const claim: Schemas["CryptoHandoff"] = {
    launchGranted: true,
    attempt: {
      id: randomUUID(),
      reviewId: review.id,
      revision: 0,
      reviewDigest: review.reviewDigest,
      state: "handoff",
      cluster: "devnet",
      routeId: route.id,
      expectedSigner: route.address,
      reference: null,
      signature: null,
      createdAt: now,
      updatedAt: now,
      reason: null,
      receiptId: null,
    },
  };

  function createMockWallet(
    overrides?: Partial<MockMwaWallet>,
  ): MockMwaWallet {
    return {
      authorize: vi.fn(async () => ({
        auth_token: "refreshed-auth-token",
        accounts: [
          {
            address: sender.toBuffer().toString("base64"),
            chains: ["solana:devnet"],
          },
        ],
      })),
      getCapabilities: vi.fn(async () => ({
        supported_transaction_versions: ["legacy"],
        supports_sign_and_send_transactions: true,
      })),
      signAndSendTransactions: native.send,
      signMessages: vi.fn(async () => [rawSignatureBytes]),
      deauthorize: vi.fn(async () => ({})),
      ...overrides,
    };
  }

  beforeEach(() => {
    native.store.clear();
    native.transact.mockReset();
    native.send.mockReset();
    native.authenticateAsync.mockClear();
    native.hasHardwareAsync.mockClear();
    native.isEnrolledAsync.mockClear();
    lockSession();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("1. MWA v3.0.2 Authorize & Reauthorization Semantics (createCryptoSigner)", () => {
    it("calls wallet.authorize with chain, identity, addresses, and cached auth_token and rotates stored token", async () => {
      const grantKey = `agus.crypto.grant.owner.phantom.devnet.${route.address}`;
      native.store.set(grantKey, "cached-auth-token-xyz");
      native.send.mockResolvedValue([validBase58Signature]);

      const wallet = createMockWallet();
      native.transact.mockImplementation(async (callback) => callback(wallet));

      const signer = createCryptoSigner("owner", "https://identity.example");
      const result = await signer.handoff(claim, route, review);

      expect(result).toEqual({
        kind: "signature",
        signature: validBase58Signature,
      });
      expect(wallet.authorize).toHaveBeenCalledWith({
        chain: "solana:devnet",
        identity: {
          name: "AGUS",
          uri: "https://identity.example",
          icon: "favicon.png",
        },
        addresses: [sender.toBuffer().toString("base64")],
        auth_token: "cached-auth-token-xyz",
      });
      expect(native.store.get(grantKey)).toBe("refreshed-auth-token");
    });

    it("maps revoked/expired auth_token (MWA code -1) to WALLET_RECONNECT_REQUIRED in handoff and signProof", async () => {
      const grantKey = `agus.crypto.grant.owner.phantom.devnet.${route.address}`;
      native.store.set(grantKey, "expired-auth-token");

      const wallet = createMockWallet({
        authorize: vi.fn(async () => {
          throw Object.assign(new Error("authorization failed"), { code: -1 });
        }),
      });
      native.transact.mockImplementation(async (callback) => callback(wallet));

      const diagnostics: WalletDiagnostic[] = [];
      const signer = createCryptoSigner("owner", "https://identity.example", (d) =>
        diagnostics.push(d),
      );

      const handoffOutcome = await signer.handoff(claim, route, review);
      expect(handoffOutcome).toEqual({
        kind: "unavailable",
        reason: "WALLET_RECONNECT_REQUIRED",
      });
      expect(diagnostics).toContainEqual({
        provider: "phantom",
        stage: "authorization",
        reason: "WALLET_RECONNECT_REQUIRED",
      });

      const challenge: Schemas["CryptoChallenge"] = {
        id: randomUUID(),
        messageBase64: Buffer.from("agus-proof-challenge").toString("base64"),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
      await expect(
        signer.signProof("phantom", "devnet", route.address, challenge),
      ).rejects.toMatchObject({
        name: "Error",
        reason: "WALLET_RECONNECT_REQUIRED",
      });
    });

    it("returns WALLET_ACCOUNT_CHANGED when wallet.authorize returns a different account or mismatched chain", async () => {
      const grantKey = `agus.crypto.grant.owner.phantom.devnet.${route.address}`;
      native.store.set(grantKey, "cached-auth-token-xyz");

      const wrongSigner = Keypair.generate().publicKey;
      const wallet = createMockWallet({
        authorize: vi.fn(async () => ({
          auth_token: "rotated",
          accounts: [
            {
              address: wrongSigner.toBuffer().toString("base64"),
              chains: ["solana:devnet"],
            },
          ],
        })),
      });
      native.transact.mockImplementation(async (callback) => callback(wallet));

      const signer = createCryptoSigner("owner", "https://identity.example");
      const result = await signer.handoff(claim, route, review);

      expect(result).toEqual({
        kind: "unavailable",
        reason: "WALLET_ACCOUNT_CHANGED",
      });
    });
  });

  describe("2. Signature Validation & Saved Attempt Persistence", () => {
    it("rejects empty or wrong-length base58 signatures returned by signAndSendTransactions", async () => {
      const grantKey = `agus.crypto.grant.owner.phantom.devnet.${route.address}`;
      native.store.set(grantKey, "cached-auth-token-xyz");
      // Short base58 signature (4 bytes instead of 64 bytes)
      native.send.mockResolvedValue([base58.encode(new Uint8Array(4).fill(1))]);

      const wallet = createMockWallet();
      native.transact.mockImplementation(async (callback) => callback(wallet));

      const signer = createCryptoSigner("owner", "https://identity.example");
      const result = await signer.handoff(claim, route, review);

      // Failure occurs during stage === "submission", so walletFailure maps to unknown
      expect(result).toEqual({
        kind: "unknown",
        reason: "WALLET_SIGNATURE_UNAVAILABLE",
      });
    });

    it("verifies parseSavedAttempt accepts 64-byte base58 signatures and drops invalid or signed outcomes", () => {
      const attemptId = randomUUID();
      const validPayload = JSON.stringify({
        id: attemptId,
        outcome: {
          kind: "signature",
          signature: validBase58Signature,
        },
      });
      expect(parseSavedAttempt(validPayload)).toEqual({
        id: attemptId,
        outcome: {
          kind: "signature",
          signature: validBase58Signature,
        },
      });

      const invalidSignaturePayload = JSON.stringify({
        id: attemptId,
        outcome: {
          kind: "signature",
          signature: "not_base58_invalid_characters!!!",
        },
      });
      expect(parseSavedAttempt(invalidSignaturePayload)).toEqual({
        id: attemptId,
      });

      const signedBytesPayload = JSON.stringify({
        id: attemptId,
        outcome: {
          kind: "signed",
          signedTransactionBase64: "AQID",
        },
      });
      expect(parseSavedAttempt(signedBytesPayload)).toEqual({
        id: attemptId,
      });
    });
  });

  describe("3. Pre-submission marker and lifecycle diagnostics", () => {
    it("leaves no submission marker after association cancellation", async () => {
      const grantKey = `agus.crypto.grant.owner.phantom.devnet.${route.address}`;
      native.store.set(grantKey, "fixture-token");

      // Simulate user cancelling during association stage (transact rejects before callback runs)
      native.transact.mockRejectedValue({
        code: "ERROR_ASSOCIATION_CANCELLED",
        message: "User declined to associate",
      });

      const signer = createCryptoSigner("owner", "https://identity.example");

      const firstResult = await signer.handoff(claim, route, review);
      expect(firstResult).toEqual({ kind: "declined" });

      expect(native.store.has(`agus.crypto.launch.owner.${claim.attempt.id}`)).toBe(false);
      const retryResult = await signer.handoff({ ...claim, launchGranted: false }, route, review);
      expect(retryResult).toEqual({ kind: "unknown" });
      expect(native.transact).toHaveBeenCalledTimes(1);
    });

    it("leaves no submission marker after association timeout", async () => {
      const grantKey = `agus.crypto.grant.owner.phantom.devnet.${route.address}`;
      native.store.set(grantKey, "fixture-token");

      native.transact.mockRejectedValue({
        code: "ERROR_ASSOCIATION_TIMEOUT",
        message: "Timed out waiting for local association",
      });

      const signer = createCryptoSigner("owner", "https://identity.example");

      const firstResult = await signer.handoff(claim, route, review);
      expect(firstResult).toEqual({
        kind: "unavailable",
        reason: "WALLET_ASSOCIATION_TIMEOUT",
      });

      expect(native.store.has(`agus.crypto.launch.owner.${claim.attempt.id}`)).toBe(false);
      const retryResult = await signer.handoff({ ...claim, launchGranted: false }, route, review);
      expect(retryResult).toEqual({ kind: "unknown" });
      expect(native.transact).toHaveBeenCalledTimes(1);
    });

    it("emits typed WalletStage diagnostics and retains returned signature when native teardown throws", async () => {
      const grantKey = `agus.crypto.grant.owner.phantom.devnet.${route.address}`;
      native.store.set(grantKey, "fixture-token");
      native.send.mockResolvedValue([validBase58Signature]);

      const wallet = createMockWallet();
      native.transact.mockImplementation(async (callback) => {
        await callback(wallet);
        throw new Error("native session teardown failed");
      });

      const observedStages: WalletStage[] = [];
      const signer = createCryptoSigner("owner", "https://identity.example", (event) => {
        observedStages.push(event.stage);
      });

      const outcome = await signer.handoff(claim, route, review);
      expect(outcome).toEqual({
        kind: "signature",
        signature: validBase58Signature,
      });
      expect(observedStages).toEqual([
        "association",
        "authorization",
        "capabilities",
        "submission",
        "submission",
        "submission",
      ]);
    });
  });

  describe("4. Real Session Lock Boundary (apps/mobile/src/session.ts)", () => {
    it("throws LOCAL_SESSION_LOCKED when api.POST runs while session is locked and restores access after unlockSession()", async () => {
      const fetchMock = vi.fn(async () =>
        new Response(JSON.stringify({ id: claim.attempt.id, state: "pending" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      // AppState "background" invokes lockSession() (CryptoDeviceHarness.tsx:215)
      lockSession();

      // Immediate recover() -> reportOutcome() -> api.POST throws LOCAL_SESSION_LOCKED (session.ts:70),
      // which CryptoDeviceHarness.tsx:548 catches inside run() and sets as notice.
      await expect(
        api.POST("/api/v1/crypto/attempts/{id}/wallet-outcome", {
          params: {
            header: { "Idempotency-Key": claim.attempt.id },
            path: { id: claim.attempt.id },
          },
          body: { kind: "signature", signature: validBase58Signature },
        }),
      ).rejects.toThrow("LOCAL_SESSION_LOCKED");
      expect(fetchMock).not.toHaveBeenCalled();

      // User taps "Unlock and resume" (CryptoDeviceHarness.tsx:436-444)
      const unlocked = await unlockSession();
      expect(unlocked).toBe(true);

      const response = await api.POST(
        "/api/v1/crypto/attempts/{id}/wallet-outcome",
        {
          params: {
            header: { "Idempotency-Key": claim.attempt.id },
            path: { id: claim.attempt.id },
          },
          body: { kind: "signature", signature: validBase58Signature },
        },
      );
      expect(response.response.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("5. Diagnostic Reason, Error Policy, and Device State Helpers", () => {
    it("classifies Low Power Mode, association errors, and MWA protocol error codes across WalletStage", () => {
      const associationStage: WalletStage = "association";
      const submissionStage: WalletStage = "submission";

      const solflareError = new Error(
        "Your device is in low power mode. Deactivate it to enable connection and signing.",
      );
      expect(walletFailure(solflareError, associationStage)).toEqual({
        reason: "WALLET_POWER_RESTRICTION",
        outcome: { kind: "unavailable", reason: "WALLET_POWER_RESTRICTION" },
      });

      expect(
        walletFailure({ code: "ERROR_ASSOCIATION_TIMEOUT" }, associationStage),
      ).toEqual({
        reason: "WALLET_ASSOCIATION_TIMEOUT",
        outcome: { kind: "unavailable", reason: "WALLET_ASSOCIATION_TIMEOUT" },
      });

      expect(
        walletFailure({ code: "ERROR_ASSOCIATION_CANCELLED" }, associationStage),
      ).toEqual({
        reason: "WALLET_ASSOCIATION_CANCELLED",
        outcome: { kind: "declined" },
      });

      expect(walletFailure({ code: -3 }, submissionStage)).toEqual({
        reason: "WALLET_DECLINED",
        outcome: { kind: "declined" },
      });

      expect(walletFailure({ code: -4 }, submissionStage)).toEqual({
        reason: "WALLET_SUBMISSION_UNCERTAIN",
        outcome: { kind: "unknown", reason: "WALLET_SUBMISSION_UNCERTAIN" },
      });

      expect(
        walletFailure(new WalletRouteError("WALLET_ATTESTATION_REQUIRED"), "authorization"),
      ).toEqual({
        reason: "WALLET_ATTESTATION_REQUIRED",
        outcome: { kind: "unavailable", reason: "WALLET_ATTESTATION_REQUIRED" },
      });
    });

    it("validates solAtoms and canRecover state transitions", () => {
      expect(solAtoms("0.001")).toBe("1000000");
      expect(solAtoms("1")).toBe("1000000000");
      expect(() => solAtoms("-0.1")).toThrow("INVALID_DEVNET_SOL_AMOUNT");
      expect(() => solAtoms("abc")).toThrow("INVALID_DEVNET_SOL_AMOUNT");
      expect(() => solAtoms("0")).toThrow("INVALID_DEVNET_SOL_AMOUNT");

      expect(canRecover("ready")).toBe(true);
      expect(canRecover("handoff")).toBe(true);
      expect(canRecover("pending")).toBe(true);
      expect(canRecover("unknown")).toBe(true);
      expect(canRecover("finalized")).toBe(false);
      expect(canRecover("expired")).toBe(false);
    });
  });
});
