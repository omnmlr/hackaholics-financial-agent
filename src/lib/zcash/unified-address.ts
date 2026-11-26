/** ZIP 316 revision-0 decoding, bounded to application-sized addresses.
 * F4Jumble follows zcash/zcash-test-vectors (unified_encoding.py/f4jumble.py).
 * A valid encoding is not proof of wallet ownership, funds or settlement.
 */
import { bech32m } from "@scure/base";
import { blake2b } from "@noble/hashes/blake2b";
const xor = (a: Uint8Array, b: Uint8Array) => a.map((v, i) => v ^ b[i]);
export function unjumble(value: Uint8Array): Uint8Array {
  if (value.length < 48 || value.length > 2048)
    throw Error("Invalid unified address length");
  const left = Math.min(64, Math.floor(value.length / 2));
  const h = (round: number, input: Uint8Array) =>
    blake2b(input, {
      dkLen: left,
      personalization: Uint8Array.from([
        ...Buffer.from("UA_F4Jumble_H"),
        round,
        0,
        0,
      ]),
    });
  const g = (round: number, input: Uint8Array) => {
    const result = new Uint8Array(value.length - left);
    for (let j = 0; j * 64 < result.length; j++) {
      const digest = blake2b(input, {
        dkLen: 64,
        personalization: Uint8Array.from([
          ...Buffer.from("UA_F4Jumble_G"),
          round,
          j & 255,
          j >> 8,
        ]),
      });
      result.set(
        digest.subarray(0, Math.min(64, result.length - j * 64)),
        j * 64,
      );
    }
    return result;
  };
  const c = value.subarray(0, left),
    d = value.subarray(left),
    y = xor(c, h(1, d)),
    x = xor(d, g(1, y)),
    a = xor(y, h(0, x)),
    b = xor(x, g(0, a));
  return Uint8Array.from([...a, ...b]);
}
export function decodeUnifiedAddress(address: string, hrp = "utest") {
  const encoded = bech32m.decode(address as `${string}1${string}`, 4096);
  if (encoded.prefix !== hrp || !["u", "utest"].includes(hrp))
    throw Error("Wrong unified network");
  const data = unjumble(bech32m.fromWords(encoded.words));
  const padding = new Uint8Array(16);
  padding.set(Buffer.from(hrp));
  if (!data.subarray(-16).every((v, i) => v === padding[i]))
    throw Error("Invalid unified padding");
  const end = data.length - 16;
  let pos = 0,
    previous = -1,
    transparent = false;
  const receivers: number[] = [];
  const compact = () => {
    if (pos >= end) throw Error("Truncated compact size");
    const first = data[pos++];
    if (first < 253) return first;
    const count = first === 253 ? 2 : first === 254 ? 4 : 8;
    if (pos + count > end) throw Error("Truncated compact size");
    let v = 0n;
    for (let i = 0; i < count; i++) v |= BigInt(data[pos++]) << BigInt(8 * i);
    if (
      v < BigInt(count === 2 ? 253 : count === 4 ? 65536 : 4294967296) ||
      v > 0x2000000n
    )
      throw Error("Noncanonical compact size");
    return Number(v);
  };
  while (pos < end) {
    const type = compact(),
      length = compact();
    if (type <= previous || length === 0 || pos + length > end)
      throw Error("Invalid unified item");
    previous = type;
    if (type <= 3 && length !== (type < 2 ? 20 : 43))
      throw Error("Invalid receiver length");
    if (type < 2) {
      if (transparent) throw Error("Duplicate transparent receiver");
      transparent = true;
    }
    // Revision 0 cannot carry MUST-understand metadata; reject future rules.
    if (type >= 0xe0 && type <= 0xfc)
      throw Error("Unsupported unified metadata");
    receivers.push(type);
    pos += length;
  }
  if (!receivers.some((type) => type === 2 || type === 3))
    throw Error("No supported shielded receiver");
  return {
    receivers,
    orchard: receivers.includes(3),
    sapling: receivers.includes(2),
  };
}
