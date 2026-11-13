import { test } from "node:test";
import assert from "node:assert/strict";
import { ZcashReceiverVerifier } from "../src/lib/zcash/receiver-verification.js";

const terms = {
  requestId: "123e4567-e89b-12d3-a456-426614174000",
  reference: "zec_req_999998888877777",
  recipient: "utest1z9e4jkvw9quh68n49y5wqvvdg4d6qcf568q4g89z4v5348q79tve470m7e5w5886576p8r857w7sq68y2qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9y4a02",
  amountAtoms: "20000000", // 0.2 ZEC
  digest: "sha256_mock_terms_digest_12345",
  network: "testnet",
};

test("Receiver Verifier — Verified Shielded Payment with Note Matching", async () => {
  const verifier = new ZcashReceiverVerifier();

  const observation = {
    chain: "testnet",
    endpoint: "testnet.zec.rocks:443",
    chainTipHeight: 4620000,
    chainTipHash: "00000000mocktiphash",
    observedBlockHeight: 4619990,
    observedBlockHash: "00000000mockobservedhash",
    confirmations: 10,
    txid: "txid_verified_shielded_receipt_123",
    pool: "orchard",
    amountAtoms: "20000000",
    isSimulated: true, // simulated observation in test
  };

  const proof = {
    viewingKeyType: "unified_full_viewing_key",
    recipientMatched: true,
    decryptedMemo: `AGUS:v1:${terms.requestId}:${terms.reference}:${terms.digest}`,
  };

  const audit = await verifier.verifyShieldedSettlement(terms, observation, proof);

  assert.equal(audit.verified, true);
  assert.equal(audit.status, "simulated");
  assert.equal(audit.confirmations, 10);
  assert.ok(audit.receipt);
  assert.equal(audit.receipt.memoMatched, true);
  assert.equal(audit.receipt.privacy.isShielded, true);
  assert.equal(audit.receipt.privacy.pool, "orchard");
});

test("Receiver Verifier — Invariant: Rejects Zero Confirmation Transactions", async () => {
  const verifier = new ZcashReceiverVerifier();

  const zeroConfObservation = {
    chain: "testnet",
    endpoint: "testnet.zec.rocks:443",
    chainTipHeight: 4620000,
    chainTipHash: "00000000mocktiphash",
    observedBlockHeight: 0,
    observedBlockHash: "",
    confirmations: 0, // unconfirmed mempool output
    txid: "txid_mempool_unconfirmed",
    pool: "orchard",
    amountAtoms: "20000000",
    isSimulated: true,
  };

  const audit = await verifier.verifyShieldedSettlement(terms, zeroConfObservation);
  assert.equal(audit.verified, false);
  assert.equal(audit.status, "pending_confirmations");
  assert.ok(audit.rejectionReason.includes("CONFIRMATIONS_PENDING"));
});

test("Receiver Verifier — Invariant: Rejects Amount or Network Mismatch", async () => {
  const verifier = new ZcashReceiverVerifier();

  const wrongAmountObservation = {
    chain: "testnet",
    endpoint: "testnet.zec.rocks:443",
    chainTipHeight: 4620000,
    chainTipHash: "00000000mocktiphash",
    observedBlockHeight: 4619990,
    observedBlockHash: "00000000mockhash",
    confirmations: 3,
    txid: "txid_wrong_amount",
    pool: "orchard",
    amountAtoms: "10000000", // 0.1 ZEC instead of 0.2 ZEC
    isSimulated: true,
  };

  const audit = await verifier.verifyShieldedSettlement(terms, wrongAmountObservation);
  assert.equal(audit.verified, false);
  assert.equal(audit.status, "rejected");
  assert.ok(audit.rejectionReason.includes("AMOUNT_MISMATCH"));
});

test("Receiver Verifier — Invariant: Rejects Forged Viewing Key or Mismatched Memo", async () => {
  const verifier = new ZcashReceiverVerifier();

  const observation = {
    chain: "testnet",
    endpoint: "testnet.zec.rocks:443",
    chainTipHeight: 4620000,
    chainTipHash: "00000000mocktiphash",
    observedBlockHeight: 4619990,
    observedBlockHash: "00000000mockhash",
    confirmations: 2,
    txid: "txid_forged_memo",
    pool: "orchard",
    amountAtoms: "20000000",
    isSimulated: true,
  };

  const forgedProof = {
    viewingKeyType: "unified_full_viewing_key",
    recipientMatched: true,
    decryptedMemo: "Some completely unrelated invoice memo",
  };

  const audit = await verifier.verifyShieldedSettlement(terms, observation, forgedProof);
  assert.equal(audit.verified, false);
  assert.equal(audit.status, "rejected");
  assert.ok(audit.rejectionReason.includes("MEMO_REFERENCE_MISMATCH"));
});
