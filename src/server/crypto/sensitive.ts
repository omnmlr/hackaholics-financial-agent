import { createPrivateKey, createPublicKey } from "node:crypto";
import { base58 } from "@scure/base";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const englishWords = new Set(wordlist);
const seedLengths = [12, 15, 18, 21, 24];
const ed25519Prefix = Buffer.from("302e020100300506032b657004220420", "hex");

function isSolanaKeypair(bytes: Uint8Array) {
  if (bytes.length !== 64) return false;
  const key = createPrivateKey({
    key: Buffer.concat([ed25519Prefix, bytes.subarray(0, 32)]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(key).export({
    format: "der",
    type: "spki",
  });
  return publicKey.subarray(-32).equals(bytes.subarray(32));
}

export function containsWalletSecret(text: string): boolean {
  const candidate = text.normalize("NFKD");
  if (
    /\b(?:xprv|yprv|zprv|tprv|uprv|vprv)[1-9A-HJ-NP-Za-km-z]{80,}\b/.test(
      candidate,
    )
  )
    return true;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(candidate)) return true;
  if (
    /\b(?:seed|recovery|backup|mnemonic)\s+(?:phrase|words)\s*[:=]\s*(?:[a-z]{2,}\b[\s,.-]*){8}/i.test(
      candidate,
    )
  )
    return true;
  if (
    /\b(?:private[ _-]?key|secret[ _-]?key)\s*[:=]?\s*(?:0x)?[a-z0-9+/_-]{24,}/i.test(
      candidate,
    )
  )
    return true;
  if (
    /\[(?:\s*\d{1,3}\s*,){31}(?:\s*\d{1,3}\s*,){0,32}\s*\d{1,3}\s*\]/.test(
      candidate,
    )
  )
    return true;

  const words = candidate.toLowerCase().match(/[a-z]+/g) ?? [];
  let run = 0;
  for (let index = 0; index < words.length; index++) {
    run = englishWords.has(words[index]) ? run + 1 : 0;
    for (const count of seedLengths) {
      if (
        run >= count &&
        validateMnemonic(
          words.slice(index + 1 - count, index + 1).join(" "),
          wordlist,
        )
      )
        return true;
    }
  }

  for (const match of candidate.matchAll(
    /(?<![a-z0-9+/_-])[a-z0-9+/_-]{84,128}(?:={0,2})(?![a-z0-9+/_-])/gi,
  )) {
    const value = match[0];
    if (
      /^[0-9a-f]{128}$/i.test(value) &&
      isSolanaKeypair(Buffer.from(value, "hex"))
    )
      return true;
    if (
      /^[1-9A-HJ-NP-Za-km-z]{84,88}$/.test(value) &&
      isSolanaKeypair(base58.decode(value))
    )
      return true;
    if (isSolanaKeypair(Buffer.from(value, "base64"))) return true;
  }
  return false;
}
