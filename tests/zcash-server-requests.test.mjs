import test from "node:test";
import assert from "node:assert/strict";
import {
  createZcashPaymentRequest,
  instructionDigest,
} from "../src/server/zcash-requests";

test("Server Zcash Requests — Create Shielded Unified Request with QR Code", async () => {
  const owner = "operator_user_123";
  const invoiceId = "550e8400-e29b-41d4-a716-446655440000";
  const testnetUa =
    "utest157q45z9fwy7349t5r7w4d0tpmdzhw6xvuwm4ucqq80ysftk9wxryrru0l7puxpdlujnkmj5d9ewzaxz5x6slfg3xys4egayx7vry57wd";

  const request = await createZcashPaymentRequest(owner, {
    recipient: testnetUa,
    amountAtoms: "50000000", // 0.5 ZEC
    network: "testnet",
    invoiceId,
    label: "Freelance Frontend Milestone",
    message: "Invoice #1042",
  });

  assert.equal(request.id, invoiceId);
  assert.ok(request.reference.startsWith("zec_req_"));
  assert.equal(request.recipient, testnetUa);
  assert.equal(request.pool, "unified");
  assert.equal(request.network, "testnet");
  assert.equal(request.amountAtoms, "50000000");
  assert.equal(request.displayAmount, "0.5");
  assert.equal(request.amount.currency, "ZEC");
  assert.equal(request.amount.scale, 8);

  // Check terms digest
  assert.equal(typeof request.digest, "string");
  assert.equal(request.digest.length, 64);

  // Check QR Code
  assert.ok(request.qrCodeDataUrl.startsWith("data:image/png;base64,"));

  // Check AGUS structured memo
  assert.equal(request.agusMemo.magic, "AGUS");
  assert.equal(request.agusMemo.version, 1);
  assert.equal(request.agusMemo.requestId, invoiceId);
  assert.equal(request.agusMemo.reference, request.reference);
  assert.equal(request.agusMemo.digest, request.digest);

  // Check privacy properties
  assert.equal(request.privacy.isShielded, true);
  assert.ok(request.privacy.guarantees.length >= 4);

  // Check URI
  assert.match(request.uri, /^zcash:utest1/);
  assert.match(request.uri, /amount=0\.5/);
  assert.match(request.uri, /memo=/);
});

test("Server Zcash Requests — Transparent Address Triggers Privacy Warning", async () => {
  const owner = "operator_user_123";
  const invoiceId = "550e8400-e29b-41d4-a716-446655440001";
  const transparentAddr = "tm9iMLAuYMzJ6kWYtUAgAWehWacWa1jyG7a";

  const request = await createZcashPaymentRequest(owner, {
    recipient: transparentAddr,
    amountAtoms: "10000000",
    network: "testnet",
    invoiceId,
  });

  assert.equal(request.pool, "transparent");
  assert.equal(request.privacy.isShielded, false);
  assert.ok(
    request.privacy.guarantees.some((g) => g.includes("WARNING: Transparent address selected")),
  );
});

test("Server Zcash Requests — Deterministic Terms Digest", () => {
  const data1 = { a: 1, b: "hello", c: [1, 2] };
  const data2 = { c: [1, 2], b: "hello", a: 1 }; // key order swapped

  assert.equal(
    instructionDigest(data1),
    instructionDigest(data2),
    "instructionDigest must be canonical and invariant to object key order",
  );
});
