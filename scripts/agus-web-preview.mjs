// Persistent single-process preview. No production bank credentials or live flags.
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const port = Number(process.env.AGUS_PREVIEW_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid preview port");
const directory = resolve(".data/agus-web-preview");
await mkdir(directory, { recursive: true, mode: 0o700 });
const passwordFile = join(directory, "operator-password");
let password;
try {
  password = await readFile(passwordFile, "utf8");
} catch (e) {
  if (e.code !== "ENOENT") throw e;
  password = randomBytes(24).toString("base64url");
  await writeFile(passwordFile, password, { flag: "wx", mode: 0o600 });
}
const salt = randomBytes(16).toString("hex");
const origin = process.env.AGUS_PREVIEW_ORIGIN ?? `http://localhost:${port}`;
const env = {
  ...process.env,
  DATABASE_URL: `pglite://${join(directory, "db")}`,
  APP_ORIGIN: origin,
  OPERATOR_ID: "agus-web-preview-operator",
  OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  PAYMENT_MODE: "fixture",
  AGUS_WORKSPACE_ENABLED: "true",
  AGUS_AGENT_ARCHITECTURE: "native-gemini",
  FINANCIAL_DEMO_ENABLED: "false",
  PAYSTACK_SECRET_KEY: "",
  PAYSTACK_TRANSFERS_ENABLED: "false",
  LIVE_TRANSFERS_ENABLED: "false",
  LIVE_OWNER_AUTHORIZED: "false",
  LIVE_WEBHOOK_VALIDATED: "false",
  LIVE_RECONCILIATION_VALIDATED: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  AI_PROVIDER:
    process.env.AGUS_PREVIEW_AI === "true"
      ? (process.env.AI_PROVIDER ?? "gemini")
      : "none",
  AI_API_KEY:
    process.env.AGUS_PREVIEW_AI === "true"
      ? (process.env.AI_API_KEY ?? "")
      : "",
};
console.log(`AGUS web preview: ${origin}`);
console.log(`Private sign-in password file: ${passwordFile}`);
console.log(
  "Naira statements are imported, sponsor payments are testnet only. No fixture records are seeded.",
);
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "0.0.0.0",
    "--port",
    String(port),
  ],
  { env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
