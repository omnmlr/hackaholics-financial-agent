import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { configSchema, type Step } from "../src/contracts";
import { fileSha256 } from "../src/runner";

const [output, serial, labApk, walletApk, agusApk] = process.argv.slice(2);
const genesis = process.env.AGUS_TEST_LOCAL_GENESIS;
if (!output || !serial || !labApk || !walletApk || !genesis) {
  throw new Error("Set AGUS_TEST_LOCAL_GENESIS and pass output.json, serial, lab.apk, fakewallet.apk and optionally the signed AGUS Devnet APK");
}
const lab = "app.agus.testfixture";
const wallet = "com.solana.mobilewalletadapter.fakewallet";
const agus = "app.agus.prototype";
const knownWalletSha = "269c0357b05d039dc544d777a06fb10092c340d9606a89d192911d7ba82da3aa";
if (await fileSha256(walletApk) !== knownWalletSha) throw new Error("The wallet must match the pinned Solana Mobile release");

function walletSteps(mode: "send" | "decline" | "simulated") {
  const steps: Step[] = [
    { action: "install", apk: "fixture" },
    { action: "install", apk: "wallet" },
    { action: "launch", package: lab },
    { action: "capture", name: "fixture" },
    { action: "tap", selector: { package: lab, resourceId: "android:id/button1" } },
    { action: "wait", selector: { package: wallet, resourceId: wallet + ":id/btn_authorize_x3" } },
    { action: "capture", name: "wallet-authorization" },
    { action: "tap", selector: { package: wallet, resourceId: wallet + ":id/btn_authorize" } },
    { action: "wait", selector: { package: wallet, resourceId: wallet + ":id/text_sign_payloads" } },
    { action: "capture", name: "wallet-transaction" },
  ];
  const sendResource = mode === "simulated" ? "btn_simulate_transactions_submitted" : "btn_send_transaction_to_cluster";
  if (mode === "decline") {
    steps.push({ action: "tap", selector: { package: wallet, resourceId: wallet + ":id/btn_decline" } });
  } else {
    steps.push({
      action: "tap", selector: { package: wallet, resourceId: wallet + ":id/btn_authorize" },
    }, {
      action: "tap", selector: { package: wallet, resourceId: wallet + ":id/" + sendResource },
    });
  }
  steps.push({
    action: "sol-transfer", package: lab, recipient: "EMtq5F54UxgEwYx1bmZpRJXNodBPPqjFekwQZNjpzH3w",
    lamports: "1000000", timeoutSeconds: mode === "simulated" ? 10 : 45,
  }, {
    action: "wait", selector: { package: lab, text: "Wallet returned a signature" },
  }, { action: "capture", name: "returned" });
  return steps;
}
const config = configSchema.parse({
  version: 1,
  device: { serial, kind: serial.startsWith("emulator-") ? "emulator" : "android-device", isolated: true },
  network: { cluster: "localnet", genesis },
  apks: {
    fixture: { path: resolve(labApk), package: lab, sha256: await fileSha256(labApk) },
    wallet: { path: resolve(walletApk), package: wallet, sha256: knownWalletSha },
    ...(agusApk ? { "agus-crypto": { path: resolve(agusApk), package: agus, sha256: await fileSha256(agusApk) } } : {}),
  },
  scenarios: {
    "wallet-transfer": { title: "MWA: wallet return and finalized SOL transfer", packages: [lab, wallet], steps: walletSteps("send") },
    "wallet-decline": { title: "MWA: wallet rejection and callback diagnosis", packages: [lab, wallet], steps: walletSteps("decline") },
    "wallet-false-success": { title: "MWA: signed result without broadcast", packages: [lab, wallet], steps: walletSteps("simulated") },
    ...(agusApk ? {
      "agus-crypto-launch": { title: "AGUS Crypto: signed APK launch and Android evidence", packages: [agus], steps: [
        { action: "install", apk: "agus-crypto" }, { action: "launch", package: agus },
        { action: "wait", selector: { package: agus, text: "AGUS Android signing diagnostics" } },
        { action: "capture", name: "agus-diagnostics" },
      ] },
    } : {}),
  },
});
await writeFile(output, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
