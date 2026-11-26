import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { invariant } from "./errors";
type Box = { iv: string; tag: string; ciphertext: string };
export type Envelope = {
  version: 1;
  keyVersion: string;
  wrappedKey: Box;
  data: Box;
};
function crypt(key: Buffer, plaintext: Buffer, aad: string): Box {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}
function decrypt(key: Buffer, box: Box, aad: string) {
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(box.iv, "base64"),
  );
  cipher.setAAD(Buffer.from(aad));
  cipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(box.ciphertext, "base64")),
    cipher.final(),
  ]);
}
function master(version: string) {
  let keys: Record<string, string>;
  try {
    keys = JSON.parse(process.env.AGUS_ENCRYPTION_KEYS ?? "{}");
  } catch {
    invariant(false, "ENCRYPTION_KEY_UNAVAILABLE", 503);
  }
  /* key lookup is by explicit version, including during rotation. */
  const key = Buffer.from(keys[version] ?? "", "base64");
  invariant(key.length === 32, "ENCRYPTION_KEY_UNAVAILABLE", 503);
  return key;
}
export function assertEncryptionReady() {
  master(process.env.AGUS_ENCRYPTION_ACTIVE_KEY ?? "");
}
export function seal(owner: string, purpose: string, value: unknown): Envelope {
  const keyVersion = process.env.AGUS_ENCRYPTION_ACTIVE_KEY ?? "";
  const key = randomBytes(32),
    aad = JSON.stringify([owner, purpose, keyVersion]);
  try {
    return {
      version: 1,
      keyVersion,
      wrappedKey: crypt(master(keyVersion), key, aad),
      data: crypt(key, Buffer.from(JSON.stringify(value)), aad),
    };
  } finally {
    key.fill(0);
  }
}
export function unseal<T>(
  owner: string,
  purpose: string,
  envelope: Envelope,
): T {
  invariant(envelope.version === 1, "ENCRYPTION_VERSION_UNSUPPORTED", 503);
  const aad = JSON.stringify([owner, purpose, envelope.keyVersion]);
  const key = decrypt(master(envelope.keyVersion), envelope.wrappedKey, aad);
  try {
    return JSON.parse(decrypt(key, envelope.data, aad).toString("utf8")) as T;
  } finally {
    key.fill(0);
  }
}
