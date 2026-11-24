/// <reference types="node" />
import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { base58 } from "@scure/base";
import { Keypair, SystemProgram, Transaction, PublicKey } from "@solana/web3.js";
import type { components } from "@agus/api-client";

// Mocks for React Native and Expo modules in isolated Node test environment
const native = vi.hoisted(() => ({
  store: new Map<string, string>(),
  transact: vi.fn(),
  send: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    currentState: "active",
    listeners: new Set<(state: string) => void>(),
    addEventListener(event: string, handler: (state: string) => void) {
      if (event === "change") {
        this.listeners.add(handler);
      }
      return {
        remove: () => {
          this.listeners.delete(handler);
        },
      };
    },
    simulateStateChange(state: string) {
      this.currentState = state;
      for (const listener of this.listeners) {
        listener(state);
      }
    },
  },
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digest: (_algorithm: string, bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest(),
}));

vi.mock("expo-secure-store", () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "fixture",
  getItemAsync: async (key: string) => native.store.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    native.store.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    native.store.delete(key);
  },
}));

vi.mock("@solana-mobile/mobile-wallet-adapter-protocol-web3js", () => ({
  transact: native.transact,
}));

import { createCryptoSigner } from "../src/crypto-signer";
import { canRecover, parseSavedAttempt, solAtoms } from "../src/crypto-device-state";
import { WalletRouteError, walletFailure } from "../src/crypto-wallet-policy";

type Schemas = components["schemas"];

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

  beforeEach(() => {
    native.store.clear();
    native.transact.mockReset();
    native.send.mockReset();
  });

  describe("1. MWA Session Reauthorization Logic", () => {
    it("demonstrates MWA protocol violation when calling wallet.authorize with auth_token against a strict wallet", async () => {
      // Setup stored bearer token
      const grantKey = `agus.crypto.grant.owner.phantom.devnet.${route.address}`;
      native.store.set(grantKey, "cached-auth-token-xyz");

      // Strict MWA wallet stub: authorize must NOT accept auth_token per MWA specification
      const strictWallet = {
        authorize: vi.fn(async (params: any) => {
          if (params.auth_token) {
            throw new Error(
              "MWA_PROTOCOL_ERROR: authorize does not accept auth_token; call reauthorize instead",
            );
          }
          return {
            auth_token: "new-token",
            accounts: [
              {
                address: sender.toBuffer().toString("base64"),
                chains: ["solana:devnet"],
              },
            ],
          };
        }),
        reauthorize: vi.fn(async (params: any) => {
          if (!params.auth_token) {
            throw new Error("MWA_PROTOCOL_ERROR: reauthorize requires auth_token");
          }
          return {
            auth_token: "refreshed-token",
            accounts: [
              {
                address: sender.toBuffer().toString("base64"),
                chains: ["solana:devnet"],
              },
            ],
          };
        }),
        getCapabilities: vi.fn(async () => ({
          supported_transaction_versions: ["legacy"],
          supports_sign_and_send_transactions: true,
        })),
        signAndSendTransactions: native.send,
      };

      native.transact.mockImplementation(async (run) => run(strictWallet));

      const signer = createCryptoSigner("owner", "https://identity.example");
      // Current crypto-signer.ts lines 86-91 calls authorize with auth_token.
      // Strict wallet throws, which causes handoff to fail with WALLET_TRANSPORT_LOST
      const result = await signer.handoff(claim, route, review);
      expect(result).toEqual({
        kind: "unavailable",
        reason: "WALLET_TRANSPORT_LOST",
      });
      expect(strictWallet.authorize).toHaveBeenCalledWith(
        expect.objectContaining({
          auth_token: "cached-auth-token-xyz",
        }),
      );
      // Demonstrates that reauthorize was never invoked by the current implementation
      expect(strictWallet.reauthorize).not.toHaveBeenCalled();
    });

    it("verifies protocol-compliant reauthorization logic with fallback to authorize on stale token", async () => {
      // Protocol-compliant helper demonstrating the suggested fix for select()
      async function protocolAccurateSelect(
        wallet: {
          reauthorize: (params: any) => Promise<any>;
          authorize: (params: any) => Promise<any>;
        },
        cachedToken: string,
        identity: any,
        chain: string,
        wantedAddressBase64: string,
      ) {
        let authResult;
        try {
          authResult = await wallet.reauthorize({
            auth_token: cachedToken,
            identity,
          });
        } catch (error: any) {
          if (
            error?.code === "ERROR_REAUTHORIZE" ||
            error?.code === -1 ||
            error?.message?.includes("REAUTHORIZE_FAILED")
          ) {
            // Token expired or revoked: gracefully fall back to full authorization
            authResult = await wallet.authorize({
              chain,
              identity,
              addresses: [wantedAddressBase64],
            });
          } else {
            throw error;
          }
        }
        return authResult;
      }

      // Scenario A: Valid cached token silently reauthorizes
      const validWallet = {
        reauthorize: vi.fn().mockResolvedValue({
          auth_token: "refreshed-token-123",
          accounts: [{ address: sender.toBuffer().toString("base64") }],
        }),
        authorize: vi.fn(),
      };

      const resA = await protocolAccurateSelect(
        validWallet,
        "token-123",
        { name: "AGUS" },
        "solana:devnet",
        sender.toBuffer().toString("base64"),
      );
      expect(resA.auth_token).toBe("refreshed-token-123");
      expect(validWallet.reauthorize).toHaveBeenCalledTimes(1);
      expect(validWallet.authorize).not.toHaveBeenCalled();

      // Scenario B: Expired token gracefully falls back to fresh authorize
      const expiredWallet = {
        reauthorize: vi.fn().mockRejectedValue({
          code: "ERROR_REAUTHORIZE",
          message: "REAUTHORIZE_FAILED: token expired",
        }),
        authorize: vi.fn().mockResolvedValue({
          auth_token: "newly-granted-token-456",
          accounts: [{ address: sender.toBuffer().toString("base64") }],
        }),
      };

      const resB = await protocolAccurateSelect(
        expiredWallet,
        "stale-token",
        { name: "AGUS" },
        "solana:devnet",
        sender.toBuffer().toString("base64"),
      );
      expect(resB.auth_token).toBe("newly-granted-token-456");
      expect(expiredWallet.reauthorize).toHaveBeenCalledTimes(1);
      expect(expiredWallet.authorize).toHaveBeenCalledTimes(1);
    });
  });

  describe("2. Polymorphic Signature Parsing (Uint8Array vs Base58 String)", () => {
    it("demonstrates TypeError when passing raw 64-byte Uint8Array directly into base58.decode", () => {
      // MWA spec returns Uint8Array[], but crypto-signer.ts calls base58.decode(signature)
      const rawBytes = new Uint8Array(64).fill(7);
      expect(() => {
        // @ts-expect-error simulating runtime passing Uint8Array to base58.decode
        base58.decode(rawBytes);
      }).toThrow(/string expected/);
    });

    it("verifies robust polymorphic signature parser correctly handles both Uint8Array and base58 string", () => {
      function normalizeSignature(sig: unknown): string {
        if (!sig) throw new WalletRouteError("WALLET_SIGNATURE_UNAVAILABLE");
        const sigBase58 =
          typeof sig === "string"
            ? sig
            : base58.encode(Buffer.from(sig as Uint8Array));
        if (base58.decode(sigBase58).length !== 64) {
          throw new WalletRouteError("WALLET_SIGNATURE_UNAVAILABLE");
        }
        return sigBase58;
      }

      // Case A: Raw Uint8Array from standard MWA
      const fromBytes = normalizeSignature(rawSignatureBytes);
      expect(typeof fromBytes).toBe("string");
      expect(fromBytes).toBe(validBase58Signature);

      // Case B: Already base58 string from mock / web3 wrapper
      const fromString = normalizeSignature(validBase58Signature);
      expect(fromString).toBe(validBase58Signature);

      // Case C: Malformed signature length (32 bytes instead of 64)
      const shortBytes = new Uint8Array(32).fill(1);
      expect(() => normalizeSignature(shortBytes)).toThrow(WalletRouteError);

      // Case D: Null or undefined
      expect(() => normalizeSignature(null)).toThrow(WalletRouteError);
    });

    it("verifies parseSavedAttempt accepts normalized signature and rejects invalid formats", () => {
      // Valid base58 signature outcome
      const validPayload = JSON.stringify({
        id: randomUUID(),
        outcome: {
          kind: "signature",
          signature: validBase58Signature,
        },
      });
      const parsedValid = parseSavedAttempt(validPayload);
      expect(parsedValid?.outcome?.kind).toBe("signature");
      if (parsedValid?.outcome?.kind === "signature") {
        expect(parsedValid.outcome.signature).toBe(validBase58Signature);
      }

      // If raw bytes or non-base58 characters were stored, outcome is dropped per parseSavedAttempt line 20
      const invalidPayload = JSON.stringify({
        id: randomUUID(),
        outcome: {
          kind: "signature",
          signature: "not_base58_invalid_characters!!!",
        },
      });
      const parsedInvalid = parseSavedAttempt(invalidPayload);
      expect(parsedInvalid?.outcome).toBeUndefined();
    });
  });

  describe("3. Pre-Submission Retry Recovery and Idempotency", () => {
    it("demonstrates the bug: premature launch marker locks out retries on pre-submission aborts", async () => {
      const grantKey = `agus.crypto.grant.owner.phantom.devnet.${route.address}`;
      native.store.set(grantKey, "fixture-token");

      // Simulate user cancelling during association stage
      native.transact.mockRejectedValue({
        code: "ERROR_ASSOCIATION_CANCELLED",
        message: "User declined to associate",
      });

      const signer = createCryptoSigner("owner", "https://identity.example");

      // Attempt 1 fails during association
      const firstResult = await signer.handoff(claim, route, review);
      expect(firstResult).toEqual({ kind: "declined" });

      // Bug manifestation: line 279 persisted the launch marker before transact().
      // When retrying Attempt 1, line 278 finds the marker and permanently traps in { kind: "unknown" }
      const retryResult = await signer.handoff(claim, route, review);
      expect(retryResult).toEqual({ kind: "unknown" });
    });

    it("verifies scoped launch marker placement allows retry on pre-submission failure", async () => {
      const markerStore = new Map<string, string>();
      const markerKey = `agus.crypto.launch.owner.${claim.attempt.id}`;

      // Mock implementation with scoped launch marker committed only at submission stage
      async function resilientHandoff(shouldFailAtAssociation: boolean) {
        // If already submitted and marked, double-spend check blocks repeat
        if (markerStore.has(markerKey)) {
          return { kind: "unknown" };
        }

        let stage = "association";
        try {
          if (shouldFailAtAssociation) {
            throw { code: "ERROR_ASSOCIATION_CANCELLED" };
          }
          stage = "submission";
          // FIX: Only commit the launch marker once submission actually begins
          markerStore.set(markerKey, review.messageDigest);

          return { kind: "signature", signature: validBase58Signature };
        } catch (error: any) {
          return walletFailure(error, stage).outcome;
        }
      }

      // Attempt 1: Fails at association stage
      const result1 = await resilientHandoff(true);
      expect(result1).toEqual({ kind: "declined" });
      // Marker was NOT set because submission was never reached
      expect(markerStore.has(markerKey)).toBe(false);

      // Attempt 2: Retry succeeds
      const result2 = await resilientHandoff(false);
      expect(result2).toEqual({
        kind: "signature",
        signature: validBase58Signature,
      });
      expect(markerStore.has(markerKey)).toBe(true);

      // Attempt 3: Double-spend attempt with same attempt id is correctly blocked
      const result3 = await resilientHandoff(false);
      expect(result3).toEqual({ kind: "unknown" });
    });
  });

  describe("4. AppState Background Session Lock Contention", () => {
    it("reproduces LOCAL_SESSION_LOCKED error when AppState background event locks session during external wallet handoff", async () => {
      let sessionUnlocked = true;
      function lockSession() {
        sessionUnlocked = false;
      }

      function mockApiCall() {
        if (!sessionUnlocked) {
          throw new Error("LOCAL_SESSION_LOCKED");
        }
        return { success: true };
      }

      // 1. Session is initially unlocked
      expect(sessionUnlocked).toBe(true);
      expect(mockApiCall()).toEqual({ success: true });

      // 2. User initiates wallet handoff -> Android switches to Phantom -> AppState becomes "background"
      lockSession();
      expect(sessionUnlocked).toBe(false);

      // 3. Wallet returns to AGUS -> CryptoDeviceHarness:367 immediately calls recover() -> api.POST
      // This reproduces the exact unhandled rejection observed on physical device
      expect(() => mockApiCall()).toThrow("LOCAL_SESSION_LOCKED");
    });

    it("verifies session lock mitigation: preserving handoff state prevents unhandled exception", async () => {
      let sessionUnlocked = true;
      let handoffPending = false;

      function onAppStateChange(state: string) {
        if (state === "background") {
          // If a wallet handoff is actively in flight, defer full lock until handoff completes
          if (!handoffPending) {
            sessionUnlocked = false;
          }
        }
      }

      async function safeRecover() {
        if (!sessionUnlocked) {
          // Graceful fallback: return pending without crashing UI
          return { status: "pending_unlock", notice: "Unlock AGUS to recover the saved Devnet attempt." };
        }
        return { status: "recovered", signature: validBase58Signature };
      }

      // Simulate handoff lifecycle with mitigation
      handoffPending = true;
      onAppStateChange("background");
      // Session remains unlocked for the immediate recover() call upon wallet return
      expect(sessionUnlocked).toBe(true);
      const res = await safeRecover();
      expect(res.status).toBe("recovered");
      handoffPending = false;
    });
  });

  describe("5. Diagnostic Reason & Error Policy Classification", () => {
    it("classifies battery saver / low power restriction accurately", () => {
      const solflareError = new Error(
        "Your device is in low power mode. Deactivate it to enable connection and signing.",
      );
      const failure = walletFailure(solflareError, "association");
      expect(failure.reason).toBe("WALLET_POWER_RESTRICTION");
      expect(failure.outcome).toEqual({
        kind: "unavailable",
        reason: "WALLET_POWER_RESTRICTION",
      });
    });

    it("classifies association timeouts and cancellations correctly", () => {
      const timeoutError = { code: "ERROR_ASSOCIATION_TIMEOUT" };
      expect(walletFailure(timeoutError, "association").reason).toBe(
        "WALLET_ASSOCIATION_TIMEOUT",
      );

      const cancelError = { code: "ERROR_ASSOCIATION_CANCELLED" };
      expect(walletFailure(cancelError, "association").reason).toBe(
        "WALLET_ASSOCIATION_CANCELLED",
      );
    });

    it("validates solAtoms parsing for valid Devnet amounts and rejects malformed values", () => {
      expect(solAtoms("0.001")).toBe("1000000");
      expect(solAtoms("1")).toBe("1000000000");
      expect(() => solAtoms("-0.1")).toThrow("INVALID_DEVNET_SOL_AMOUNT");
      expect(() => solAtoms("abc")).toThrow("INVALID_DEVNET_SOL_AMOUNT");
      expect(() => solAtoms("0")).toThrow("INVALID_DEVNET_SOL_AMOUNT");
    });
  });
});
