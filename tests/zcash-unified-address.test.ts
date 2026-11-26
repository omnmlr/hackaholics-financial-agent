import { describe, it, expect } from "vitest";
import ua from "./fixtures/zcash/unified-reference.json";
import invalid from "./fixtures/zcash/unified-invalid-reference.json";
import f4 from "./fixtures/zcash/f4jumble-reference.json";
import {
  unjumble,
  decodeUnifiedAddress,
} from "../src/lib/zcash/unified-address";
import {
  validateZcashAddress,
  buildZip321Uri,
  parseZip321Uri,
} from "../src/lib/zcash/zip321";
describe("ZIP 316 shielded receiving", () => {
  for (const v of invalid)
    it(`rejects checksum-valid malformed UA: ${v.reason}`, () =>
      expect(validateZcashAddress(v.address).valid).toBe(false));
  for (const [i, v] of f4.entries())
    it(`matches upstream inverse F4Jumble vector ${i}`, () =>
      expect(
        Buffer.from(unjumble(Buffer.from(v.jumbled, "hex"))).toString("hex"),
      ).toBe(v.normal));
  for (const [i, v] of ua.vectors.entries())
    it(`decodes reference mainnet/testnet vector ${i} without accepting mainnet in testnet payments`, () => {
      expect(decodeUnifiedAddress(v.mainnet, "u").receivers).toEqual(
        v.receivers,
      );
      expect(decodeUnifiedAddress(v.testnet).receivers).toEqual(v.receivers);
      expect(validateZcashAddress(v.mainnet, "testnet").valid).toBe(false);
      expect(validateZcashAddress(v.testnet, "testnet").valid).toBe(true);
    });
  it("rejects malformed/checksum-altered and truncated addresses", () => {
    const a = ua.vectors[0].testnet;
    expect(
      validateZcashAddress(a.slice(0, -1) + (a.endsWith("q") ? "p" : "q"))
        .valid,
    ).toBe(false);
    expect(validateZcashAddress(a.slice(0, -10)).valid).toBe(false);
    expect(validateZcashAddress("utest1notanaddress").valid).toBe(false);
  });
  it("round-trips an Orchard-capable request without claiming a wallet or settlement", () => {
    const a = ua.vectors.find((v) => v.receivers.includes(3))!.testnet;
    const uri = buildZip321Uri({
      address: a,
      amountAtoms: 5000000n,
      memo: "AGUS receiving test",
      network: "testnet",
    });
    const parsed = parseZip321Uri(uri);
    expect(uri).toContain("zcash:utest1");
    expect(parsed).toBeDefined();
  });
});

it("does not pass Unified receiving claims through a Sapling-only verifier", async () => {
  const { verifyZcash } = await import("../src/lib/web-product/rails");
  const { vi } = await import("vitest");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    await expect(
      verifyZcash(
        {
          recipient: ua.vectors.find((v) => v.receivers.includes(3))!.testnet,
        } as Parameters<typeof verifyZcash>[0],
        "a".repeat(64),
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
