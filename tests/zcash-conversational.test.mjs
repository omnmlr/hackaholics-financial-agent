import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractZcashConversationalIntent,
  processConversationalPaymentRequest,
  DEMO_ZCASH_CONTACTS,
} from "../src/lib/zcash/conversational-payment.js";
import { ZcashWalletService } from "../src/lib/zcash/wallet-service.js";

test("Conversational Payments — Parse 'send Daniel 0.2 ZEC privately'", () => {
  const utterance = "AGUS, send Daniel 0.2 ZEC privately.";
  const extracted = extractZcashConversationalIntent(utterance);

  assert.ok(extracted);
  assert.equal(extracted.recipientRaw, "Daniel");
  assert.equal(extracted.recipientAlias, "Daniel");
  assert.equal(extracted.recipientAddress, DEMO_ZCASH_CONTACTS.daniel.address);
  assert.equal(extracted.amountZec, "0.2");
  assert.equal(extracted.isPrivate, true);
  assert.equal(extracted.confidence, "high");
});

test("Conversational Payments — Parse 'Pay 0.5 ZEC to Ada shielded for design audit'", () => {
  const utterance = "Pay 0.5 ZEC to Ada shielded for design audit";
  const extracted = extractZcashConversationalIntent(utterance);

  assert.ok(extracted);
  assert.equal(extracted.recipientAlias, "Ada");
  assert.equal(extracted.amountZec, "0.5");
  assert.equal(extracted.memoHint, "design audit");
  assert.equal(extracted.isPrivate, true);
});

test("Conversational Payments — Full End-to-End Conversational Orchestration", () => {
  const walletService = new ZcashWalletService("testnet");
  const owner = "operator-conversational";
  walletService.setWalletBalance(owner, 1_000_000_000n); // 10 ZEC

  const res = processConversationalPaymentRequest(
    owner,
    "AGUS, send Daniel 0.2 ZEC privately.",
    walletService,
  );

  assert.equal(res.success, true);
  assert.ok(res.intent);
  assert.equal(res.intent.amountZec, "0.2");
  assert.equal(res.intent.recipientAlias, "Daniel");
  assert.equal(res.intent.privacyLevel, "shielded_orchard");

  // Verify sanitized model narration
  const modelOut = res.modelOutput;
  assert.equal(modelOut.amountZec, "0.2");
  assert.equal(modelOut.recipientAlias, "Daniel");
  assert.equal(modelOut.currency, "ZEC");
  assert.equal(modelOut.requiresOwnerApproval, true);
  assert.ok(!JSON.stringify(modelOut).includes(DEMO_ZCASH_CONTACTS.daniel.address)); // Address masked from model

  // Verify full owner review card has unredacted details
  const ownerReview = res.ownerReview;
  assert.ok(ownerReview);
  assert.equal(ownerReview.recipientAddress, DEMO_ZCASH_CONTACTS.daniel.address);
  assert.equal(ownerReview.feeZec, "0.0001");
  assert.equal(ownerReview.totalAtoms, "20010000");
});

test("Conversational Payments — Missing Amount Triggers Clarification", () => {
  const walletService = new ZcashWalletService("testnet");
  const res = processConversationalPaymentRequest(
    "operator",
    "AGUS, send Daniel some ZEC privately.",
    walletService,
  );

  assert.equal(res.success, false);
  assert.equal(res.modelOutput.requiresClarification, true);
  assert.ok(res.modelOutput.message.includes("How much ZEC"));
});

test("Conversational Payments — Unknown Recipient Prompts for Unified Address", () => {
  const walletService = new ZcashWalletService("testnet");
  const res = processConversationalPaymentRequest(
    "operator",
    "AGUS, send Satoshi 1.5 ZEC privately.",
    walletService,
  );

  assert.equal(res.success, false);
  assert.equal(res.modelOutput.requiresClarification, true);
  assert.ok(res.modelOutput.message.includes("Unified Address"));
});
