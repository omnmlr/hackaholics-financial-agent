import test from "node:test";
import assert from "node:assert/strict";
import { inspectZcashPaymentReceipt } from "../src/lib/zcash/receipt";

const sampleTerms = {
  requestId: "33333333-4444-5555-6666-777777777777",
  reference: "zec_req_deadbeef01234567",
  recipient:
    "utest157q45z9fwy7349t5r7w4d0tpmdzhw6xvuwm4ucqq80ysftk9wxryrru0l7puxpdlujnkmj5d9ewzaxz5x6slfg3xys4egayx7vry57wd",
  amountAtoms: "250000000", // 2.5 ZEC
  digest: "8888888888888888888888888888888888888888888888888888888888888888",
  network: "testnet",
};

test("Zcash Receipt — Genuine Shielded Finalized Payment", () => {
  const observation = {
    chain: "testnet",
    endpoint: "https://testnet.zec.rocks:443",
    chainTipHeight: 4615980,
    chainTipHash: "001c466ea7bb51ffcf4fd6de410f46aefa9e14d752e767cf8f9916292c27b54b",
    observedBlockHeight: 4615975,
    observedBlockHash: "002d577fb8cc62aadf5fe7ef521f57bf0ba025e863f878df9f00273a3d38c65c",
    confirmations: 5,
    txid: "9f8e7d6c5b4a3928171605f4e3d2c1b0a9f8e7d6c5b4a3928171605f4e3d2c1b",
    pool: "orchard",
    amountAtoms: "250000000",
    isSimulated: false,
  };

  const proof = {
    viewingKeyType: "incoming_viewing_key",
    decryptedMemo: `AGUS:v1:${sampleTerms.requestId}:${sampleTerms.reference}:${sampleTerms.digest}`,
    recipientMatched: true,
  };

  const receipt = inspectZcashPaymentReceipt(sampleTerms, observation, proof);

  assert.equal(receipt.requestId, sampleTerms.requestId);
  assert.equal(receipt.reference, sampleTerms.reference);
  assert.equal(receipt.verification, "chain_finalized");
  assert.equal(receipt.pool, "orchard");
  assert.equal(receipt.amount.atoms, "250000000");
  assert.equal(receipt.amount.displayAmount, "2.5");
  assert.equal(receipt.amount.currency, "ZEC");
  assert.equal(receipt.memoMatched, true);
  assert.equal(receipt.memoDigest, sampleTerms.digest);

  // Privacy guarantees check
  assert.equal(receipt.privacy.isShielded, true);
  assert.equal(receipt.privacy.amountsHiddenOnChain, true);
  assert.equal(receipt.privacy.addressesHiddenOnChain, true);
  assert.equal(receipt.privacy.memoEncryptedOnChain, true);
  assert.equal(receipt.privacy.selectiveDisclosureMechanism, "incoming_viewing_key");
});

test("Zcash Receipt — Invariant: Simulated Observations MUST NOT Yield chain_finalized", () => {
  const simObservation = {
    chain: "testnet",
    endpoint: "fixture",
    chainTipHeight: 4615980,
    chainTipHash: "mock_hash",
    observedBlockHeight: 4615975,
    observedBlockHash: "mock_block",
    confirmations: 6,
    txid: "mock_txid_0000000000000000000000000000000000000000000000000000000000000",
    pool: "orchard",
    amountAtoms: "250000000",
    isSimulated: true, // EXPLICIT SIMULATION
  };

  const receipt = inspectZcashPaymentReceipt(sampleTerms, simObservation);
  assert.equal(receipt.verification, "simulated", "Simulated observation MUST report 'simulated'");
  assert.notEqual(receipt.verification, "chain_finalized");
});

test("Zcash Receipt — Invariant: Rejects Amount or Network Mismatch", () => {
  const wrongAmountObservation = {
    chain: "testnet",
    endpoint: "https://testnet.zec.rocks:443",
    chainTipHeight: 4615980,
    chainTipHash: "mock_hash",
    observedBlockHeight: 4615975,
    observedBlockHash: "mock_block",
    confirmations: 5,
    txid: "9f8e7d6c5b4a3928171605f4e3d2c1b0a9f8e7d6c5b4a3928171605f4e3d2c1b",
    pool: "orchard",
    amountAtoms: "100000000", // 1.0 ZEC instead of 2.5 ZEC!
    isSimulated: false,
  };

  assert.throws(
    () => inspectZcashPaymentReceipt(sampleTerms, wrongAmountObservation),
    /AMOUNT_MISMATCH/,
  );

  const wrongNetworkObservation = {
    ...wrongAmountObservation,
    chain: "mainnet",
    amountAtoms: "250000000",
  };

  assert.throws(
    () => inspectZcashPaymentReceipt(sampleTerms, wrongNetworkObservation),
    /NETWORK_MISMATCH/,
  );
});

test("Zcash Receipt — Invariant: Rejects Zero-Confirmation Transactions", () => {
  const zeroConfObservation = {
    chain: "testnet",
    endpoint: "https://testnet.zec.rocks:443",
    chainTipHeight: 4615980,
    chainTipHash: "mock_hash",
    observedBlockHeight: 4615980,
    observedBlockHash: "mock_block",
    confirmations: 0, // Unconfirmed / mempool only
    txid: "9f8e7d6c5b4a3928171605f4e3d2c1b0a9f8e7d6c5b4a3928171605f4e3d2c1b",
    pool: "orchard",
    amountAtoms: "250000000",
    isSimulated: false,
  };

  assert.throws(
    () => inspectZcashPaymentReceipt(sampleTerms, zeroConfObservation),
    /TRANSACTION_CONFIRMATIONS_PENDING/,
  );
});
