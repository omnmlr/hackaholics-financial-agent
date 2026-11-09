/** Actual production app/browser, real local tools/SQL, SCRIPTED Gemini transport. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
const directory = await mkdtemp(join(tmpdir(), "agus-engine-browser-"));
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`,
  password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const server = spawn(
  process.execPath,
  [
    "--import",
    resolve("scripts/fixtures/personal-agent-model.mjs"),
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: `pglite://${directory}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "false",
      AGUS_WORKSPACE_ENABLED: "true",
      AGUS_AGENT_ARCHITECTURE: "native-gemini",
      AGUS_SOLANA_DEVNET_ENABLED: "false",
      AGUS_RESPONSIBILITY_RUNNER_ENABLED: "false",
      AI_PROVIDER: "gemini",
      AI_MODEL: "gemini-3.5-flash-lite",
      AI_API_KEY: "scripted-model-not-a-provider-credential",
      APP_ORIGIN: base,
      OPERATOR_ID: "engine-browser",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    },
    stdio: "ignore",
  },
);
let browser,
  cookie = "";
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: globalThis.AbortSignal.timeout(20000),
  });
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return { status: response.status, data: await response.json() };
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if (
        (await fetch(base, { signal: globalThis.AbortSignal.timeout(2000) })).ok
      )
        break;
    } catch {
      /* Await local startup. */
    }
    await delay(200);
  }
  assert.equal((await api("/api/session", { password })).status, 200);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies([
    {
      name: "ha_session",
      value: cookie.slice("ha_session=".length),
      url: base,
    },
  ]);
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page
    .getByRole("button", { name: /^Choose records account:/ })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Message AGUS", exact: true })
    .fill(
      "Compare my supplied costs: four items at 2500 plus delivery of 1500. Remember that I prefer reversible commitments and prepare a reminder to review the estimate tomorrow. Don't pay or message anyone.",
    );
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByText(/Your supplied costs total ₦11,500/)
    .waitFor({ timeout: 30000 });
  await page
    .getByRole("button", { name: "Review memory", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm memory", exact: true })
    .click();
  await page.getByText("User-confirmed statement", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Review responsibility", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve in-app reminder", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Pause responsibility", exact: true })
    .waitFor();
  const snapshot = (await api("/api/agent-workspace")).data;
  assert.equal(snapshot.memories.length, 1);
  assert.equal(snapshot.memories[0].confirmed, true);
  assert.equal(snapshot.tasks.length, 1);
  assert.equal(snapshot.tasks[0].state, "active");
  const saved = (await api("/api/agent-runs")).data.runs[0];
  assert.equal(saved.state, "waiting_user");
  assert.equal(saved.steps.length, 4);
  assert.ok(saved.steps.every((s) => s.state === "succeeded"));
  assert.equal((await api("/api/financial-agent")).status, 503);
  await page.reload();
  await page
    .getByRole("button", { name: /^Choose records account:/ })
    .waitFor();
  await page.getByText(/Your supplied costs total ₦11,500/).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual production mobile browser -> SDK native calls (SCRIPTED transport) -> dynamic plan/calculation -> real SQL memory/reminder -> human confirmation/activation -> durable conversation reload and run report, with financial fixture OFF. Zero genuine model or external network calls; no payment.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
  await rm(directory, { recursive: true, force: true });
}
