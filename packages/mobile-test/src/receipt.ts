import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import type { Report } from "./runner";

export function sealReport(report: Report, privateKeyPem: string) {
  if (report.state === "running" || !report.finishedAt) throw new Error("A receipt requires a terminal report");
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Expected an Ed25519 runner key");
  const runnerFingerprint = createHash("sha256").update(createPublicKey(privateKey).export({ type: "spki", format: "der" })).digest("hex");
  const body = {
    version: 1 as const,
    claim: "runner_report" as const,
    runnerFingerprint,
    report,
  };
  return { ...body, signatureBase64: sign(null, Buffer.from(JSON.stringify(body)), privateKey).toString("base64") };
}

export function verifyReceipt(receipt: ReturnType<typeof sealReport>, publicKeyPem: string) {
  const publicKey = createPublicKey(publicKeyPem);
  const { signatureBase64, ...body } = receipt;
  const fingerprint = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  return publicKey.asymmetricKeyType === "ed25519" && fingerprint === body.runnerFingerprint &&
    verify(null, Buffer.from(JSON.stringify(body)), publicKey, Buffer.from(signatureBase64, "base64"));
}
