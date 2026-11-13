import test from "node:test";
import assert from "node:assert/strict";
import {
  validateZcashAddress,
  buildZip321Uri,
  parseZip321Uri,
} from "../src/lib/zcash/zip321";
import {
  zatoshisToZec,
  zecToZatoshis,
  ZATOSHIS_PER_ZEC,
} from "../src/lib/zcash/types";

test("Zcash Address Validation (ZIP 316 / Transparent / Sapling)", () => {
  // Valid Testnet Unified Address
  const testnetUa =
    "utest157q45z9fwy7349t5r7w4d0tpmdzhw6xvuwm4ucqq80ysftk9wxryrru0l7puxpdlujnkmj5d9ewzaxz5x6slfg3xys4egayx7vry57wd";
  const resUa = validateZcashAddress(testnetUa, "testnet");
  assert.equal(resUa.valid, true);
  assert.equal(resUa.pool, "unified");

  // Valid Testnet Sapling Address
  const testnetSapling =
    "ztestsapling10vhqlx304f32630kphvkn346jhpt9r8p8v25g4f6y92h0k3x772q8j42p4t7y36u7f6z5g82s7";
  const resSapling = validateZcashAddress(testnetSapling, "testnet");
  assert.equal(resSapling.valid, true);
  assert.equal(resSapling.pool, "sapling");

  // Valid Testnet Transparent Address
  const testnetTaddr = "tm9iMLAuYMzJ6kWYtUAgAWehWacWa1jyG7a";
  const resTaddr = validateZcashAddress(testnetTaddr, "testnet");
  assert.equal(resTaddr.valid, true);
  assert.equal(resTaddr.pool, "transparent");

  // Mainnet address on testnet should fail validation
  const mainnetUa =
    "u157q45z9fwy7349t5r7w4d0tpmdzhw6xvuwm4ucqq80ysftk9wxryrru0l7puxpdlujnkmj5d9ewzaxz5x6slfg3xys4egayx7vry57wd";
  const resMainnetOnTest = validateZcashAddress(mainnetUa, "testnet");
  assert.equal(resMainnetOnTest.valid, false);

  // Invalid garbage string
  assert.equal(validateZcashAddress("invalid_address_format", "testnet").valid, false);
});

test("Zcash Zatoshis & Decimal Conversions (scale 8 exact arithmetic)", () => {
  assert.equal(zatoshisToZec(100_000_000n), "1");
  assert.equal(zatoshisToZec(50_000_000n), "0.5");
  assert.equal(zatoshisToZec(10_000n), "0.0001");
  assert.equal(zatoshisToZec(1n), "0.00000001");
  assert.equal(zatoshisToZec(250_000_000n), "2.5");

  assert.equal(zecToZatoshis("1"), 100_000_000n);
  assert.equal(zecToZatoshis("0.5"), 50_000_000n);
  assert.equal(zecToZatoshis("0.0001"), 10_000n);
  assert.equal(zecToZatoshis("0.00000001"), 1n);
  assert.equal(zecToZatoshis("2.5"), 250_000_000n);

  assert.throws(() => zecToZatoshis("1.123456789")); // exceeds 8 decimals
  assert.throws(() => zecToZatoshis("abc"));
});

test("ZIP 321 Payment URI Builder & Parser with AGUS Memo Binding", () => {
  const testnetUa =
    "utest157q45z9fwy7349t5r7w4d0tpmdzhw6xvuwm4ucqq80ysftk9wxryrru0l7puxpdlujnkmj5d9ewzaxz5x6slfg3xys4egayx7vry57wd";
  const amountAtoms = 125_000_000n; // 1.25 ZEC

  const agusMemo = {
    magic: "AGUS",
    version: 1,
    requestId: "11111111-2222-3333-4444-555555555555",
    reference: "zec_req_abcdef0123456789",
    digest: "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
  };

  const uri = buildZip321Uri({
    address: testnetUa,
    amountAtoms,
    agusMemo,
    message: "Contract milestone 2",
    label: "Dev Payout",
    network: "testnet",
  });

  assert.match(uri, /^zcash:utest1/);
  assert.match(uri, /amount=1\.25/);
  assert.match(uri, /memo=/);
  assert.match(uri, /message=Contract\+milestone\+2/);

  // Parse back the URI
  const parsed = parseZip321Uri(uri, "testnet");
  assert.equal(parsed.address, testnetUa);
  assert.equal(parsed.network, "testnet");
  assert.equal(parsed.amountAtoms, "125000000");
  assert.equal(parsed.displayAmount, "1.25");
  assert.ok(parsed.agusMemo);
  assert.equal(parsed.agusMemo.magic, "AGUS");
  assert.equal(parsed.agusMemo.requestId, "11111111-2222-3333-4444-555555555555");
  assert.equal(parsed.agusMemo.reference, "zec_req_abcdef0123456789");
  assert.equal(parsed.agusMemo.digest, "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0");
});

test("ZIP 321 Rejects Memos Exceeding 512 bytes", () => {
  const testnetUa =
    "utest157q45z9fwy7349t5r7w4d0tpmdzhw6xvuwm4ucqq80ysftk9wxryrru0l7puxpdlujnkmj5d9ewzaxz5x6slfg3xys4egayx7vry57wd";
  const giantMemo = "A".repeat(513);

  assert.throws(() => {
    buildZip321Uri({
      address: testnetUa,
      amountAtoms: 1000000n,
      memo: giantMemo,
      network: "testnet",
    });
  }, /MEMO_EXCEEDS_512_BYTES/);
});
