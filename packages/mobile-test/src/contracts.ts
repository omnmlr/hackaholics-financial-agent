import { z } from "zod";
import { PublicKey } from "@solana/web3.js";

export const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const packageName = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/);
export const publicKey = z.string().refine((value) => {
  try { return new PublicKey(value).toBase58() === value; } catch { return false; }
});
export const signature = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{86,88}$/);
export const atoms = z.string().regex(/^[1-9]\d{0,19}$/)
  .refine((value) => BigInt(value) <= 18_446_744_073_709_551_615n);
export const selector = z.strictObject({
  package: packageName,
  text: z.string().min(1).max(200).optional(),
  resourceId: z.string().min(1).max(200).optional(),
}).refine((value) => Boolean(value.text || value.resourceId));

const step = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("install"), apk: id }),
  z.strictObject({ action: z.literal("launch"), package: packageName }),
  z.strictObject({ action: z.literal("wait"), selector }),
  z.strictObject({ action: z.literal("tap"), selector }),
  z.strictObject({ action: z.literal("capture"), name: id }),
  z.strictObject({
    action: z.literal("sol-transfer"),
    package: packageName,
    recipient: publicKey,
    payer: publicKey.optional(),
    lamports: atoms,
    timeoutSeconds: z.number().int().min(5).max(90).default(45),
  }),
]);

const scenario = z.strictObject({
  title: z.string().min(1).max(120),
  packages: z.array(packageName).min(1).max(6),
  steps: z.array(step).min(1).max(24),
});
const device = z.strictObject({
  serial: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  kind: z.enum(["emulator", "android-device"]),
  isolated: z.literal(true),
});
const apk = z.strictObject({
  path: z.string().min(1),
  package: packageName,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const network = z.discriminatedUnion("cluster", [
  z.strictObject({ cluster: z.literal("devnet") }),
  z.strictObject({ cluster: z.literal("localnet"), genesis: publicKey }),
]);
export const configSchema = z.strictObject({
  version: z.literal(1),
  device,
  network,
  apks: z.record(id, apk),
  scenarios: z.record(id, scenario),
});
export type Config = z.infer<typeof configSchema>;
export type UiSelector = z.infer<typeof selector>;
export type Step = z.infer<typeof step>;

export const callbackSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("submitted"), payer: publicKey, signature }),
  z.strictObject({
    outcome: z.literal("failed"),
    code: z.enum(["NO_WALLET", "DECLINED", "ASSOCIATION", "PREPARE", "WALLET_ERROR"]),
  }),
]);

export const diagnosis = {
  DEVICE_UNAVAILABLE: "Reconnect the specified isolated Android device and check adb devices.",
  DEVICE_BUSY: "Wait for the active run on this local runner to finish.",
  APK_MISMATCH: "Rebuild or download the approved APK and update its operator-verified checksum.",
  ANDROID_COMMAND: "Check the device connection, launcher manifest and Android package compatibility.",
  APP_CRASH: "Review the recorded Android exception class and reproduce the failing step with a debug candidate APK.",
  START_WINDOW_TIMEOUT: "Return the test device to its launcher and check for a dialog covering the app.",
  UI_TIMEOUT: "Check the captured screen, selector package and resource ID, and whether another wallet or dialog intercepted the intent.",
  UI_AMBIGUOUS: "Use a unique resource ID or a narrower selector to choose exactly one element.",
  NO_WALLET: "Install the approved MWA test wallet and verify that Android resolves the MWA intent.",
  DECLINED: "The wallet declined the request. Check app cancellation handling and rerun only after a new reviewer action.",
  ASSOCIATION: "Inspect MWA intent resolution and the wallet association timeout or process lifecycle.",
  PREPARE: "Check the disposable payer, runner test RPC and prepared transaction generation.",
  WALLET_ERROR: "Inspect the test wallet's error and check its selected network and disposable account.",
  CALLBACK_MISSING: "Check whether the dApp received the MWA response and emitted the approved callback event before timeout.",
  CALLBACK_INVALID: "Emit exactly one valid AGUS_TEST result event from the dApp process for the wallet request.",
  WRONG_CLUSTER: "Check validator genesis or the Devnet endpoint before rerunning.",
  RPC_UNAVAILABLE: "Check the configured test RPC for availability before interpreting the outcome.",
  FINALITY_TIMEOUT: "The callback supplied a signature, but finality is unresolved. Query the same signature before starting another send.",
  CHAIN_FAILED: "Inspect the independently observed transaction error. Correct the transaction and review a new attempt.",
  CHAIN_STALE: "The callback points to activity from before this run. Remove cached signatures from the callback path.",
  CHAIN_MISMATCH: "The independently observed payer, recipient, amount or balance effects differ from the scenario contract.",
  CAPTURE_UNSAFE: "Bring an approved test app to the foreground on the dedicated device before capturing evidence.",
  RUN_INTERRUPTED: "Inspect the last recorded step and independently reconcile any wallet attempt before rerunning.",
  INTERNAL: "Check runner configuration, available storage and the local device session.",
} as const;
export type FailureCode = keyof typeof diagnosis;

export class RunFailure extends Error {
  constructor(readonly code: FailureCode) { super(diagnosis[code]); }
}
