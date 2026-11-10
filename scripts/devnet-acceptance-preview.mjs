// Explicit owner-wallet acceptance only. Banking remains fictional, model access
// is disabled, and the app never holds a wallet key or signs for the owner.
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { URL } from "node:url";

const port = Number(process.env.DEVNET_PREVIEW_PORT ?? 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid DEVNET_PREVIEW_PORT");
const origin = new URL(
  process.env.DEVNET_PREVIEW_ORIGIN ?? `http://127.0.0.1:${port}`,
);
if (
  origin.username ||
  origin.password ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  (origin.protocol !== "https:" &&
    !(
      origin.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(origin.hostname)
    ))
)
  throw new Error("Use a local HTTP or externally forwarded HTTPS origin");
const directory = resolve(".data/agus2-devnet-acceptance");
await mkdir(directory, { recursive: true, mode: 0o700 });
const passwordFile = join(directory, "operator-password");
let password;
try {
  password = await readFile(passwordFile, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  password = randomBytes(24).toString("hex");
  await writeFile(passwordFile, password, { flag: "wx", mode: 0o600 });
}
const salt = randomBytes(16).toString("hex");
const env = {
  PATH: process.env.PATH,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: `pglite://${join(directory, "db")}`,
  APP_ORIGIN: origin.origin,
  OPERATOR_ID: "devnet-acceptance-owner",
  OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  AGUS_ENVIRONMENT: "devnet",
  PAYMENT_MODE: "fixture",
  FINANCIAL_DEMO_ENABLED: "false",
  PAYSTACK_SECRET_KEY: "",
  PAYSTACK_TRANSFERS_ENABLED: "false",
  LIVE_TRANSFERS_ENABLED: "false",
  LIVE_OWNER_AUTHORIZED: "false",
  LIVE_WEBHOOK_VALIDATED: "false",
  LIVE_RECONCILIATION_VALIDATED: "false",
  AGUS_WORKSPACE_ENABLED: "true",
  AGUS_SOLANA_DEVNET_ENABLED: "true",
  AGUS_RESPONSIBILITY_RUNNER_ENABLED: "false",
  AI_PROVIDER: "none",
  AI_API_KEY: "",
  NODE_USE_ENV_PROXY: "1",
};
// Preserve the managed network proxy and certificate trust, never provider keys.
for (const name of [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
])
  if (process.env[name]) env[name] = process.env[name];
console.log(`Owner-wallet Devnet acceptance: ${origin.origin}/devnet`);
console.log(`Private local application password file: ${passwordFile}`);
console.log(
  "Banking is simulated; AI is disabled. Wallet signing requires the owner.",
);
const server = spawn(
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
  process.on(signal, () => server.kill(signal));
server.once("error", () => {
  process.exitCode = 1;
});
server.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
