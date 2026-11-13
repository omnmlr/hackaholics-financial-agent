import { test } from "node:test";
import assert from "node:assert/strict";
import { ZcashWalletService } from "../src/lib/zcash/wallet-service.js";
import { assertNoCanaryLeak } from "../src/lib/zcash/trust-boundary.js";

const VALID_UNIFIED_ADDR =
  "utest1z9e4jkvw9quh68n49y5wqvvdg4d6qcf568q4g89z4v5348q79tve470m7e5w5886576p8r857w7sq68y2qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9y4a02";
const VALID_SAPLING_ADDR =
  "ztestsapling104523d45678901234567890123456789012345678901234567890123456789012345678901234567";
const VALID_TRANSPARENT_ADDR = "tm9x9k9m9l9p9q9r9s9t9u9v9w9x9y9z9a9";

test("Shielded Send — Complete Flow: Prepare, Review, Authorize, Submit", async () => {
  const service = new ZcashWalletService("testnet");
  const owner = "operator-alice";

  // Provide sufficient balance: 10 ZEC = 1,000,000,000 zatoshis
  service.setWalletBalance(owner, 1_000_000_000n);

  // 1. Prepare Intent
  const prepared = service.preparePaymentIntent({
    owner,
    recipient: VALID_UNIFIED_ADDR,
    recipientAlias: "Daniel",
    amountZec: "0.2",
    memoText: "Freelance design audit",
  });

  assert.ok(prepared.intent.intentId);
  assert.equal(prepared.intent.status, "pending_approval");
  assert.equal(prepared.intent.privacyLevel, "shielded_orchard");
  assert.equal(prepared.intent.amountZec, "0.2");
  assert.equal(prepared.intent.feeZec, "0.0001"); // ZIP-317 10,000 zatoshis
  assert.equal(prepared.intent.totalZec, "0.2001");
  assert.ok(prepared.intent.termsDigest);

  // Model-facing view conforms to data policy
  assert.equal(prepared.modelView.recipientAlias, "Daniel");
  assert.equal(prepared.modelView.amountZec, "0.2");
  assert.equal(prepared.modelView.status, "pending_approval");
  assert.equal(prepared.modelView.requiresOwnerApproval, true);

  // 2. Owner Authorizes with credential
  const auth = service.authorizeIntent(
    prepared.intent.intentId,
    owner,
    "valid-step-up-secret-token",
  );
  assert.ok(auth.authorizationToken);
  assert.equal(auth.modelView.status, "approved");

  // 3. Submit Transaction to Network
  const submission = await service.executeShieldedPayment(
    prepared.intent.intentId,
    auth.authorizationToken,
    "txid_testnet_shielded_sample_abc123",
  );

  assert.equal(submission.txid, "txid_testnet_shielded_sample_abc123");
  assert.equal(submission.intent.status, "submitting");
  assert.equal(submission.modelView.status, "submitting");

  // 4. Finalize
  const finalized = service.markFinalized(prepared.intent.intentId);
  assert.equal(finalized.status, "chain_finalized");

  // Balance should reflect deduction (10 ZEC - 0.2001 ZEC)
  const remaining = service.getBalance(owner);
  assert.equal(remaining.spendableAtoms, 1_000_000_000n - 20_010_000n);
});

test("Shielded Send — Invariant: Rejects Mainnet Transfer for Safety", () => {
  const service = new ZcashWalletService("mainnet");
  assert.throws(
    () => {
      service.preparePaymentIntent({
        owner: "alice",
        recipient: VALID_UNIFIED_ADDR,
        amountZec: "1.0",
        network: "mainnet",
      });
    },
    /MAINNET_TRANSFERS_DISABLED_FOR_SAFETY/,
    "Must strictly reject mainnet payment preparation during hackathon",
  );
});

test("Shielded Send — Invariant: Rejects Insufficient Funds", () => {
  const service = new ZcashWalletService("testnet");
  const owner = "poor-operator";
  service.setWalletBalance(owner, 10_000n); // only 0.0001 ZEC (fee only)

  assert.throws(
    () => {
      service.preparePaymentIntent({
        owner,
        recipient: VALID_UNIFIED_ADDR,
        amountZec: "0.5",
      });
    },
    /INSUFFICIENT_FUNDS/,
  );
});

test("Shielded Send — Invariant: Rejects Authorization Token Replay", async () => {
  const service = new ZcashWalletService("testnet");
  const owner = "operator-replay-test";
  service.setWalletBalance(owner, 500_000_000n);

  const prepared = service.preparePaymentIntent({
    owner,
    recipient: VALID_UNIFIED_ADDR,
    amountZec: "0.1",
  });

  const auth = service.authorizeIntent(
    prepared.intent.intentId,
    owner,
    "step-up-token-12345",
  );

  // First submission succeeds
  await service.executeShieldedPayment(
    prepared.intent.intentId,
    auth.authorizationToken,
    "txid_first_broadcast",
  );

  // Attempting second submission with identical token MUST be blocked
  await assert.rejects(
    async () => {
      await service.executeShieldedPayment(
        prepared.intent.intentId,
        auth.authorizationToken,
      );
    },
    /AUTHORIZATION_TOKEN_ALREADY_USED_PREVENTING_DUPLICATE_PAYMENT|CANNOT_SUBMIT_UNAPPROVED_INTENT/,
  );
});

test("Shielded Send — Invariant: Detects Tampered Recipient or Amount After Approval", async () => {
  const service = new ZcashWalletService("testnet");
  const owner = "operator-tamper-test";
  service.setWalletBalance(owner, 500_000_000n);

  const prepared = service.preparePaymentIntent({
    owner,
    recipient: VALID_UNIFIED_ADDR,
    amountZec: "0.1",
  });

  const auth = service.authorizeIntent(
    prepared.intent.intentId,
    owner,
    "step-up-token-tamper",
  );

  // Maliciously tamper with the recipient address in memory after owner authorized it
  const intent = service.getIntent(prepared.intent.intentId);
  assert.ok(intent);
  intent.recipientAddress = "utest1tampered_address_attacker_destination_999999999999999999999999";

  await assert.rejects(
    async () => {
      await service.executeShieldedPayment(
        prepared.intent.intentId,
        auth.authorizationToken,
      );
    },
    /TERMS_TAMPER_DETECTED/,
    "Must detect modified terms digest and abort broadcast",
  );
});

test("Shielded Send — Invariant: Isolates Unauthorized Owners", () => {
  const service = new ZcashWalletService("testnet");
  service.setWalletBalance("alice", 500_000_000n);

  const prepared = service.preparePaymentIntent({
    owner: "alice",
    recipient: VALID_UNIFIED_ADDR,
    amountZec: "0.1",
  });

  // Bob attempts to authorize Alice's payment intent
  assert.throws(
    () => {
      service.authorizeIntent(
        prepared.intent.intentId,
        "bob-attacker",
        "bob-credential",
      );
    },
    /UNAUTHORIZED_OWNER_MISMATCH/,
  );
});
