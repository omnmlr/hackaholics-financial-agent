/* global AbortSignal */
// Genuine Gemini call with isolated synthetic records. Never payment execution.
import { spawn } from "node:child_process";
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
if (!process.env.AI_API_KEY)
  throw new Error("AI_API_KEY is required through the configured environment");
const directory = await mkdtemp(join(tmpdir(), "agus-genuine-ai-"));
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const base = "http://localhost:3125";
const model = process.env.AI_MODEL || "gemini-3.5-flash-lite";
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3125",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: `pglite://${join(directory, "db")}`,
      APP_ORIGIN: base,
      OPERATOR_ID: "genuine-ai-synthetic-only",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      PAYMENT_MODE: "fixture",
      AGUS_WORKSPACE_ENABLED: "true",
      AGUS_AGENT_ARCHITECTURE: "native-gemini",
      FINANCIAL_DEMO_ENABLED: "false",
      AI_PROVIDER: "gemini",
      AI_MODEL: model,
      PAYSTACK_SECRET_KEY: "",
      LIVE_TRANSFERS_ENABLED: "false",
      LIVE_OWNER_AUTHORIZED: "false",
      PAYSTACK_TRANSFERS_ENABLED: "false",
      ZCASH_WALLET_RPC_URL: "",
      NEXT_PUBLIC_POLLAR_API_KEY: "",
      POLLAR_TESTNET_USDC_ISSUER: "",
      NEXT_TELEMETRY_DISABLED: "1",
      NODE_USE_ENV_PROXY: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (output.includes("Ready") && (await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, "Verification server did not start");
  const login = await fetch(`${base}/api/session`, {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { origin: base, cookie, "content-type": "application/json" };
  const invoice = await fetch(`${base}/api/product/invoices`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: randomUUID(),
      title: "Synthetic design project",
      counterparty: "Synthetic client",
      direction: "receivable",
      currency: "USDC",
      amount: "9",
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      note: "Synthetic verification record only; no payment action authorized.",
    }),
  });
  assert.equal(invoice.status, 201);
  const response = await fetch(`${base}/api/conversation`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversationId: randomUUID(),
      requestId: randomUUID(),
      text: "Read my AGUS financial snapshot using the available tool. What remains owed for the synthetic design project, and what is a safe next step? Do not prepare or initiate any payment.",
      accountIds: [],
      privacyMode: false,
    }),
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  const result = {
    provider: "gemini",
    model,
    httpStatus: response.status,
    genuineProviderCall: true,
    syntheticRecordsOnly: true,
    replyKind: data.reply?.kind,
    reply: data.reply?.text,
    execution: data.reply?.execution,
    noPaymentExecutionAuthorized: true,
  };
  await mkdir("docs/agus2-web", { recursive: true });
  await writeFile(
    "docs/agus2-web/genuine-ai.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
  assert.ok(response.ok, "Actual model response was unavailable");
  assert.ok(
    data.reply?.execution?.steps.some(
      (step) =>
        step.tool === "read_agus_financial_snapshot" &&
        step.state === "succeeded",
    ),
    "No successful grounded snapshot tool call observed",
  );
} finally {
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  await rm(directory, { recursive: true, force: true });
}
