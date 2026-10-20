// Local, persistent, fictional preview. Never use a deployment database or key.
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const port = Number(process.env.FIXTURE_PREVIEW_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid FIXTURE_PREVIEW_PORT");
const dir = resolve(".data/finals-fixture-preview");
await mkdir(dir, { recursive: true, mode: 0o700 });
const passwordFile = join(dir, "operator-password");
let password;
try {
  password = await readFile(passwordFile, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  password = randomBytes(24).toString("hex");
  await writeFile(passwordFile, password, { flag: "wx", mode: 0o600 });
}
const salt = randomBytes(16).toString("hex");
const origin = `http://127.0.0.1:${port}`;
// Whitelist child environment. A caller's DATABASE_URL/provider/payment secrets
// can never leak into this preview. The scripted provider intercepts all Gemini
// requests; a network guard additionally denies every non-loopback fetch.
const env = {
  PATH: process.env.PATH,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: `pglite://${join(dir, "db")}`,
  APP_ORIGIN: origin,
  OPERATOR_ID: "finals-isolated-fixture",
  OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  PAYMENT_MODE: "fixture",
  FINANCIAL_DEMO_ENABLED: "true",
  PAYSTACK_SECRET_KEY: "",
  PAYSTACK_TRANSFERS_ENABLED: "false",
  LIVE_TRANSFERS_ENABLED: "false",
  LIVE_OWNER_AUTHORIZED: "false",
  LIVE_WEBHOOK_VALIDATED: "false",
  LIVE_RECONCILIATION_VALIDATED: "false",
  LIVE_BENEFICIARY_ALLOWLIST: "",
  AI_PROVIDER: "gemini",
  AI_MODEL: "scripted-native-fixture-only",
  AI_API_KEY: "browser-mock-inference-only",
  AGUS_AGENT_ARCHITECTURE: "native-gemini",
};
console.log(`Fictional preview: ${origin}`);
console.log(
  "Model responses are scripted; this preview makes zero provider calls.",
);
console.log(`Private local sign-in password file: ${passwordFile}`);
console.log(`Persistent isolated records: ${dir}`);
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/preview-network-guard.mjs",
    "--import",
    "./scripts/fixtures/gemini-native-agent.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  { env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.once("error", () => {
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
