/// <reference types="node" />
import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { base58 } from "@scure/base";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import type { components } from "@agus/api-client";

const native = vi.hoisted(() => ({
  store: new Map<string, string>(),
  transact: vi.fn(),
  send: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
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
import { walletFailure } from "../src/crypto-wallet-policy";

type Schemas = components["schemas"];
const sender = Keypair.generate().publicKey;
const target = Keypair.generate().publicKey;
const blockhash = Keypair.generate().publicKey.toBase58();
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
const testSignature = base58.encode(new Uint8Array(64).fill(13));

describe("Android Crypto MWA boundary", () => {
  beforeEach(() => {
    native.store.clear();
    native.transact.mockReset();
    native.send.mockReset();
    native.store.set(
      `agus.crypto.grant.owner.phantom.devnet.${route.address}`,
      "fixture bearer",
    );
    native.send.mockResolvedValue([testSignature]);
    native.transact.mockImplementation(async (run) =>
      run({
        authorize: async () => ({
          auth_token: "fixture rotated",
          accounts: [
            {
              address: sender.toBuffer().toString("base64"),
              chains: ["solana:devnet"],
            },
          ],
        }),
        getCapabilities: async () => ({
          supported_transaction_versions: ["legacy"],
          supports_sign_and_send_transactions: true,
        }),
        signAndSendTransactions: native.send,
      }),
    );
  });

  it("uses the selected package and sends only the decoded reviewed message", async () => {
    const signer = createCryptoSigner("owner", "https://identity.example");
    await expect(signer.handoff(claim, route, review)).resolves.toEqual({
      kind: "signature",
      signature: testSignature,
    });
    expect(native.transact.mock.calls[0][1]).toEqual({
      baseUri: "agus-mwa-package:app.phantom",
    });
    const sent = native.send.mock.calls[0][0].transactions[0] as Transaction;
    expect(sent.serializeMessage()).toEqual(tx.serializeMessage());
    expect(native.send).toHaveBeenCalledTimes(1);
  });

  it("retains the returned signature when native session cleanup fails", async () => {
    const original = native.transact.getMockImplementation()!;
    native.transact.mockImplementation(async (callback) => {
      await original(callback);
      throw new Error("native close failed");
    });
    const diagnostic = vi.fn();
    const signer = createCryptoSigner(
      "owner",
      "https://identity.example",
      diagnostic,
    );
    await expect(signer.handoff(claim, route, review)).resolves.toEqual({
      kind: "signature",
      signature: testSignature,
    });
    expect(diagnostic).toHaveBeenCalledWith({
      provider: "phantom",
      stage: "submission",
      reason: "WALLET_SESSION_CLEANUP",
    });
    expect(native.send).toHaveBeenCalledTimes(1);
  });

  it("refuses an amount changed independently of the reviewed transaction", async () => {
    const signer = createCryptoSigner("owner", "https://identity.example");
    const altered = {
      ...review,
      amount: { ...review.amount!, atoms: "2000000" },
    };
    await expect(signer.handoff(claim, route, altered)).resolves.toEqual({
      kind: "unavailable",
      reason: "REVIEW_MESSAGE_MISMATCH",
    });
    expect(native.transact).not.toHaveBeenCalled();
  });

  it("retains the launch marker after an ambiguous close without another submission", async () => {
    const signer = createCryptoSigner("owner", "https://identity.example");
    native.send.mockRejectedValue(
      Object.assign(new Error("private vendor details"), {
        code: "ERROR_ASSOCIATION_CANCELLED",
      }),
    );
    await expect(signer.handoff(claim, route, review)).resolves.toEqual({
      kind: "unknown",
      reason: "WALLET_ASSOCIATION_CANCELLED",
    });
    await expect(signer.handoff(claim, route, review)).resolves.toEqual({
      kind: "unknown",
    });
    expect(native.send).toHaveBeenCalledTimes(1);
  });

  it("records no submission on an association failure and rejects overlapping handoffs", async () => {
    const signer = createCryptoSigner("owner", "https://identity.example");
    const second = createCryptoSigner("owner", "https://identity.example");
    const marker = `agus.crypto.launch.owner.${claim.attempt.id}`;
    const association = Promise.withResolvers<never>();
    native.transact.mockReturnValueOnce(association.promise);
    const first = signer.handoff(claim, route, review);
    await vi.waitFor(() => expect(native.transact).toHaveBeenCalledTimes(1));
    await expect(second.handoff(claim, route, review)).resolves.toEqual({
      kind: "unknown",
    });
    expect(native.store.has(marker)).toBe(false);
    association.reject(
      Object.assign(new Error(), { code: "ERROR_ASSOCIATION_CANCELLED" }),
    );
    await expect(first).resolves.toEqual({ kind: "declined" });
    expect(native.send).not.toHaveBeenCalled();
    expect(native.store.has(marker)).toBe(false);
    await expect(
      second.handoff({ ...claim, launchGranted: false }, route, review),
    ).resolves.toEqual({ kind: "unknown" });
    expect(native.send).not.toHaveBeenCalled();
  });

  it("separates Battery Saver, attestation and explicit wallet decline", () => {
    expect(
      walletFailure(new Error("Low power mode"), "authorization").reason,
    ).toBe("WALLET_POWER_RESTRICTION");
    expect(walletFailure({ code: -100 }, "authorization").reason).toBe(
      "WALLET_ATTESTATION_REQUIRED",
    );
    expect(walletFailure({ code: -3 }, "submission").outcome).toEqual({
      kind: "declined",
    });
    expect(walletFailure({ code: -4 }, "submission").outcome.kind).toBe(
      "unknown",
    );
  });

  it("preserves a recoverable attempt without persisting signed bytes", () => {
    expect(
      parseSavedAttempt(
        JSON.stringify({
          id: claim.attempt.id,
          outcome: { kind: "signed", signedTransactionBase64: "fixture" },
        }),
      ),
    ).toEqual({ id: claim.attempt.id });
    expect(solAtoms("0.001")).toBe("1000000");
    expect(() => solAtoms("0.0000000001")).toThrow("INVALID_DEVNET_SOL_AMOUNT");
  });

  it("can reconcile a review interrupted before wallet handoff", () => {
    expect(canRecover("ready")).toBe(true);
    expect(canRecover("expired")).toBe(false);
  });
});
