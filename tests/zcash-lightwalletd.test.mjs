import test from "node:test";
import assert from "node:assert/strict";
import { LightwalletdClient } from "../src/lib/zcash/lightwalletd-client";

test("Zcash Lightwalletd Client — Live Testnet GetLightdInfo", async () => {
  const client = new LightwalletdClient();
  const info = await client.getLightdInfo();

  assert.ok(info, "Expected valid LightdInfo response");
  assert.equal(info.chainName, "test", "Expected chainName to be 'test' for testnet");
  assert.equal(info.saplingActivationHeight, 280000, "Sapling activation on testnet is block 280,000");
  assert.equal(info.consensusBranchId, "77190ad9", "Expected NU5/NU6 consensus branch ID 77190ad9");
  assert.ok(info.blockHeight > 4_600_000, `Block height ${info.blockHeight} should exceed 4.6M`);
  assert.ok(info.version.length > 0, "Expected non-empty lightwalletd version");
  assert.ok(info.vendor.includes("LightWalletD"), "Expected vendor string to mention LightWalletD");
});

test("Zcash Lightwalletd Client — Live Testnet GetLatestBlock & GetBlock", async () => {
  const client = new LightwalletdClient();
  const tip = await client.getLatestBlock();

  assert.ok(tip, "Expected valid block tip");
  assert.ok(tip.height > 4_600_000, `Tip height ${tip.height} should exceed 4.6M`);
  assert.equal(typeof tip.hash, "string");
  assert.equal(tip.hash.length, 64, "Block hash should be 64-character hex string (32 bytes)");

  // Query block by height
  const block = await client.getBlock(tip.height);
  assert.ok(block, "Expected valid compact block");
  assert.equal(block.height, tip.height, "Queried block height should match tip height");
});

test("Zcash Lightwalletd Client — Live Health Check", async () => {
  const client = new LightwalletdClient();
  const health = await client.checkHealth();

  assert.equal(health.live, true, "Health check should report live testnet node");
  assert.equal(health.chainName, "test");
  assert.ok(health.tipHeight > 4_600_000);
  assert.equal(health.tipHash.length, 64);
});
