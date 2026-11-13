import { EventEmitter } from "node:events";
import http2 from "node:http2";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LightwalletdClient } from "../src/lib/zcash/lightwalletd-client";
import {
  buildZip321Uri,
  parseZip321Uri,
  validateZcashAddress,
} from "../src/lib/zcash/zip321";
import { bech32 } from "@scure/base";
import {
  isIssuerAddress,
  STELLAR_TESTNET_USDC_ISSUER,
} from "../src/lib/pollar/network";

// Explicitly mocked HTTP/2 transport; these tests do not attest any live settlement.
function grpc(
  payload: Buffer,
  options: { status?: number; grpc?: string; truncated?: boolean } = {},
) {
  const stream = new EventEmitter() as EventEmitter & { end: () => void };
  const connection = new EventEmitter() as EventEmitter & {
    request: () => typeof stream;
    destroy: () => void;
  };
  connection.destroy = vi.fn();
  connection.request = () => stream;
  stream.end = () =>
    queueMicrotask(() => {
      stream.emit("response", { ":status": options.status ?? 200 });
      const frame = Buffer.alloc(5 + payload.length);
      frame.writeUInt32BE(payload.length + (options.truncated ? 1 : 0), 1);
      payload.copy(frame, 5);
      stream.emit("data", frame);
      stream.emit("trailers", { "grpc-status": options.grpc ?? "0" });
      stream.emit("end");
    });
  vi.spyOn(http2, "connect").mockReturnValue(
    connection as unknown as ReturnType<typeof http2.connect>,
  );
  return connection;
}
const block = Buffer.concat([
  Buffer.from([8, 100, 18, 32]),
  Buffer.alloc(32, 7),
]);
afterEach(() => vi.restoreAllMocks());
describe("Reviewed sponsor protocol integration", () => {
  it("reads complete gRPC block IDs and closes the connection", async () => {
    const connection = grpc(block);
    expect(await new LightwalletdClient().getLatestBlock()).toEqual({
      height: 100,
      hash: "07".repeat(32),
    });
    expect(connection.destroy).toHaveBeenCalled();
  });
  it.each([{ status: 503 }, { grpc: "14" }, { truncated: true }])(
    "rejects unsuccessful or malformed gRPC replies: %j",
    async (options) => {
      grpc(block, options);
      await expect(new LightwalletdClient().getLatestBlock()).rejects.toThrow();
    },
  );
  it("does not synthesize a network or block identity from empty or malformed protobuf", async () => {
    grpc(Buffer.from([18, 255]));
    await expect(new LightwalletdClient().getLatestBlock()).rejects.toThrow(
      "TRUNCATED_PROTOBUF",
    );
    vi.restoreAllMocks();
    grpc(Buffer.alloc(0));
    await expect(new LightwalletdClient().getLightdInfo()).rejects.toThrow(
      "INVALID_LIGHTD_INFO",
    );
  });
  it("never equates a public chain tip with receiving-wallet settlement evidence", async () => {
    grpc(block);
    const health = await new LightwalletdClient().checkHealth();
    expect(health.live).toBe(false); // Block metadata is not GetLightdInfo.
    expect(health).not.toHaveProperty("receipt");
  });
  it("uses checksum validation and roundtrips exact ZIP 321 amounts and memo bytes", () => {
    const address = bech32.encode(
      "ztestsapling",
      bech32.toWords(new Uint8Array(43).fill(7)),
      200,
    );
    const uri = buildZip321Uri({
      address,
      amountAtoms: 1n,
      memo: "AGUS-request-123",
    });
    expect(parseZip321Uri(uri)).toMatchObject({
      address,
      amountAtoms: "1",
      memo: "AGUS-request-123",
    });
    expect(validateZcashAddress(address.slice(0, -1) + "q").valid).toBe(false);
    expect(validateZcashAddress("utest1" + "a".repeat(100)).valid).toBe(false);
    expect(() => parseZip321Uri(uri + "&amount=2")).toThrow();
    expect(() => parseZip321Uri(uri + "&req-extra=1")).toThrow();
    expect(() => buildZip321Uri({ address, amountAtoms: 0n })).toThrow();
  });
  it("rejects the canonical issuer as a recipient even with a different configured asset issuer", () => {
    expect(
      isIssuerAddress(STELLAR_TESTNET_USDC_ISSUER, "different-issuer"),
    ).toBe(true);
    expect(isIssuerAddress("configured-issuer", "configured-issuer")).toBe(
      true,
    );
    expect(isIssuerAddress("separate-recipient", "configured-issuer")).toBe(
      false,
    );
  });
});
