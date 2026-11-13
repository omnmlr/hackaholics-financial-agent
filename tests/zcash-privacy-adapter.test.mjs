import { test } from "node:test";
import assert from "node:assert/strict";
import { DefaultZcashPrivacyAdapter } from "../src/lib/zcash/privacy-adapter.js";

const VALID_UNIFIED =
  "utest1z9e4jkvw9quh68n49y5wqvvdg4d6qcf568q4g89z4v5348q79tve470m7e5w5886576p8r857w7sq68y2qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9y4a02";
const VALID_TRANSPARENT = "tm9x9k9m9l9p9q9r9s9t9u9v9w9x9y9z9a9";

test("Codex Privacy Adapter — Discover Capabilities & Live Tip", async () => {
  const adapter = new DefaultZcashPrivacyAdapter();
  const caps = await adapter.discoverCapabilities();

  assert.ok(caps.lightwalletdHealthy);
  assert.equal(caps.activeNetwork, "testnet");
  assert.ok(caps.chainTipHeight > 4_600_000, `Expected testnet block > 4.6M, got ${caps.chainTipHeight}`);
  assert.ok(caps.chainTipHash.length > 20);
  assert.ok(caps.privacyGuarantees.length >= 3);
});

test("Codex Privacy Adapter — Privacy Capability Assessment", () => {
  const adapter = new DefaultZcashPrivacyAdapter();

  // Unified Address Assessment
  const unifiedAssessment = adapter.assessPrivacyCapabilities(VALID_UNIFIED);
  assert.equal(unifiedAssessment.isShielded, true);
  assert.equal(unifiedAssessment.pool, "unified");
  assert.equal(unifiedAssessment.privacyLevel, "shielded_orchard");
  assert.ok(unifiedAssessment.guarantees.length >= 2);
  assert.equal(unifiedAssessment.warnings.length, 0);

  // Transparent Address Assessment
  const transparentAssessment = adapter.assessPrivacyCapabilities(VALID_TRANSPARENT);
  assert.equal(transparentAssessment.isShielded, false);
  assert.equal(transparentAssessment.pool, "transparent");
  assert.equal(transparentAssessment.privacyLevel, "transparent_warning");
  assert.ok(transparentAssessment.warnings.length > 0);
});

test("Codex Privacy Adapter — Create Payment Request with ZIP-321 & QR Code", async () => {
  const adapter = new DefaultZcashPrivacyAdapter();
  const owner = "operator-codex-test";

  const request = await adapter.createPaymentRequest(owner, {
    recipient: VALID_UNIFIED,
    amountAtoms: "50000000", // 0.5 ZEC
    invoiceId: "b0b2e8f1-c452-4e6f-99ab-87f54c330011",
    label: "BlockchainUNN Milestone",
    network: "testnet",
  });

  assert.equal(request.displayAmount, "0.5");
  assert.ok(request.uri.startsWith("zcash:utest1"));
  assert.ok(request.qrCodeDataUrl.startsWith("data:image/png;base64,"));
  assert.equal(request.privacy.isShielded, true);
  assert.ok(request.digest);
});

test("Codex Privacy Adapter — Full Lifecycle: Prepare, Authorize, Submit, Inspect", async () => {
  const adapter = new DefaultZcashPrivacyAdapter();
  const owner = "operator-lifecycle";

  // 1. Prepare Intent
  const prepared = adapter.preparePaymentIntent({
    owner,
    recipient: VALID_UNIFIED,
    recipientAlias: "Daniel",
    amountZec: "0.25",
    memoText: "Audit review",
  });

  assert.ok(prepared.intent.intentId);
  assert.equal(prepared.modelView.status, "pending_approval");
  assert.equal(prepared.ownerReview.feeZec, "0.0001");

  // 2. Authorize Payment
  const auth = adapter.authorizePayment(
    prepared.intent.intentId,
    owner,
    "secure-operator-password-hash",
  );
  assert.ok(auth.authorizationToken);
  assert.equal(auth.modelView.status, "approved");

  // 3. Submit Shielded Payment
  const submission = await adapter.submitShieldedPayment(
    prepared.intent.intentId,
    auth.authorizationToken,
  );
  assert.ok(submission.txid);
  assert.equal(submission.modelView.status, "submitting");

  // 4. Inspect Status
  const inspected = adapter.inspectPaymentStatus(prepared.intent.intentId);
  assert.ok(inspected);
  assert.equal(inspected.status, "submitting");

  // 5. Model-facing view remains strictly sanitized
  const modelOutput = adapter.getSanitizedModelOutput(prepared.intent.intentId);
  assert.ok(modelOutput);
  assert.equal(modelOutput.currency, "ZEC");
  assert.equal(modelOutput.recipientAlias, "Daniel");
  assert.equal(modelOutput.amountZec, "0.25");
});
