import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
const temp = await mkdtemp(join(tmpdir(), "agus2-http-"));
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const server = spawn(
  process.execPath,
  [
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
      DATABASE_URL: `pglite://${temp}`,
      PAYMENT_MODE: "fixture",
      AI_PROVIDER: "none",
      AI_API_KEY: "",
      PAYSTACK_SECRET_KEY: "",
      AGUS_WORKSPACE_ENABLED: "true",
      AGUS_SOLANA_DEVNET_ENABLED: "false",
      APP_ORIGIN: base,
      OPERATOR_ID: "workspace-smoke",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    },
    stdio: "ignore",
  },
);
let cookie = "",
  browser;
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return { status: response.status, data: await response.json() };
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Startup. */
    }
    await delay(200);
  }
  assert.equal((await api("/api/agent-workspace")).status, 401);
  assert.equal((await api("/api/agent-workspace/solana")).status, 401);
  assert.equal((await api("/api/session", { password })).status, 200);
  const request = {
    action: "create_task",
    input: {
      requestId: randomUUID(),
      title: "Review agreement",
      objective: "Review terms with Gerald; do not pay",
      dueAt: "2026-01-01T00:00:00Z",
    },
  };
  const task = (await api("/api/agent-workspace", request)).data.result;
  assert.equal(
    (await api("/api/agent-workspace", request)).data.result.id,
    task.id,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "run_due",
        acknowledged: true,
      })
    ).data.result.delivered,
    0,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "approve",
        id: task.id,
        version: 0,
        acknowledged: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "cancel",
        id: task.id,
        version: 0,
        acknowledged: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "run_due",
        acknowledged: true,
      })
    ).data.result.delivered,
    1,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "run_due",
        acknowledged: true,
      })
    ).data.result.delivered,
    0,
  );
  const memory = (
    await api("/api/agent-workspace", {
      action: "propose_memory",
      input: { text: "Gerald proposed Friday", category: "agreement" },
    })
  ).data.result;
  assert.equal(memory.confirmed, false);
  await api("/api/agent-workspace", {
    action: "confirm_memory",
    id: memory.id,
    acknowledged: true,
  });
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
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/responsibilities");
  await page.getByText(/User-confirmed statement/).waitFor();
  assert.equal(
    await page.getByText("Review agreement", { exact: true }).count(),
    2,
  );
  await page.getByRole("button", { name: "Forget", exact: true }).click();
  await page
    .getByText("Gerald proposed Friday", { exact: true })
    .waitFor({ state: "detached" });
  await page.goto(base + "/devnet");
  await page
    .getByRole("heading", { name: "Your wallet. Your approval.", exact: true })
    .waitFor();
  assert.equal((await api("/api/agent-workspace/solana")).status, 503);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual production HTTP/browser auth, task approval/idempotency, due delivery, stale rejection, memory confirmation/forget, mobile routes, disabled devnet boundary; zero provider or chain calls.",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
  await rm(temp, { recursive: true, force: true });
}
