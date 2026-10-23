/* global AbortSignal: readonly, performance: readonly */
// Real production build + real Gemini; disposable local DB and fictional data.
// No production DB, Netlify mutation, bank access, approval or execution.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

if (
  !process.env.AI_API_KEY ||
  !/^gemini-[a-z0-9.-]{1,80}$/.test(process.env.AI_MODEL ?? "")
) {
  console.log(
    JSON.stringify({
      status: "BLOCKED",
      code: "GEMINI_CONFIGURATION_REQUIRED",
    }),
  );
  process.exit(2);
}
const directory = await mkdtemp(join(tmpdir(), "agus-recovery-"));
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const base = "http://127.0.0.1:3139";
// Deliberate allowlist: never inherit production DB, payment or operator settings.
const inherited = Object.fromEntries(
  Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|TMPDIR|TMP|TEMP|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|http_proxy|https_proxy|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|REQUESTS_CA_BUNDLE)$/.test(
      key,
    ),
  ),
);
const env = {
  ...inherited,
  NODE_USE_ENV_PROXY: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  DATABASE_URL: `pglite://${directory}/db`,
  PAYMENT_MODE: "fixture",
  FINANCIAL_DEMO_ENABLED: "true",
  APP_ORIGIN: base,
  OPERATOR_ID: "recovery-fixture-operator",
  OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  AI_PROVIDER: "gemini",
  AI_MODEL: process.env.AI_MODEL,
  AI_API_KEY: process.env.AI_API_KEY,
  AGUS_AGENT_ARCHITECTURE: "native-gemini",
  PAYSTACK_SECRET_KEY: "",
  PAYSTACK_TRANSFERS_ENABLED: "false",
  LIVE_OWNER_AUTHORIZED: "false",
  LIVE_TRANSFERS_ENABLED: "false",
  LIVE_WEBHOOK_VALIDATED: "false",
  LIVE_RECONCILIATION_VALIDATED: "false",
};
let child,
  browser,
  cookie = "";
const providerRequests = [];
const results = [];
const syntheticContent = [];
const selected = new Set(
  (
    process.env.RECOVERY_SCENARIOS ??
    "ordinary,education,account-permission,authorized-spending,authorized-search,payment-preparation,persistence"
  ).split(","),
);
const allowedScenarios = new Set([
  "ordinary",
  "education",
  "account-permission",
  "authorized-spending",
  "authorized-search",
  "payment-preparation",
  "persistence",
]);
if (!selected.size || [...selected].some((id) => !allowedScenarios.has(id))) {
  await rm(directory, { recursive: true, force: true });
  throw new Error("INVALID_RECOVERY_SCENARIOS");
}
if (selected.has("persistence")) selected.add("ordinary");
let checkpoint = "startup";
let hasTurn = false;
const report = {
  model: env.AI_MODEL,
  genuine: true,
  productionDatabaseAccess: false,
  paymentExecution: false,
  results,
  providerRequests,
  syntheticContent,
  selectedScenarios: [...selected],
};
async function start() {
  child = spawn(
    process.execPath,
    [
      "--import",
      "./scripts/recovery-network-guard.mjs",
      "node_modules/next/dist/bin/next",
      "start",
      "--port",
      "3139",
      "--hostname",
      "127.0.0.1",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  // Never print child errors (SDK exceptions may contain sensitive material).
  let pending = "";
  const childAttempts = new Map();
  child.stdout.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split("\n");
    pending = lines.pop().slice(-8192);
    for (const line of lines) {
      try {
        const value = JSON.parse(line);
        if (value.event === "recovery_provider_request") {
          const attempt = {
            status: value.status,
            attempt: value.attempt,
          };
          childAttempts.set(value.attempt, attempt);
          providerRequests.push(attempt);
        }
        if (
          value.event === "recovery_provider_result" &&
          childAttempts.has(value.attempt)
        )
          childAttempts.get(value.attempt).status = value.status;
        if (value.event === "recovery_synthetic_content")
          syntheticContent.push(value.parts);
      } catch {
        /* non-JSON startup output */
      }
    }
  });
  child.stderr.resume();
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(base)).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("SERVER_START_FAILED");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
async function request(path, body) {
  const response = await fetch(`${base}/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90000),
  });
  if (response.headers.has("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return { status: response.status, data: await response.json() };
}
async function turn(id, conversationId, text, accountIds, check) {
  if (!selected.has(id)) return;
  // Pace before entering the app; transport delays must not consume its deadline.
  if (hasTurn) await new Promise((resolve) => setTimeout(resolve, 13000));
  hasTurn = true;
  checkpoint = id;
  const started = performance.now();
  const response = await request("conversation", {
    conversationId,
    text,
    accountIds,
  });
  const reply = response.data.reply;
  const result = {
    id,
    httpStatus: response.status,
    kind: reply?.kind,
    code: reply?.evidence?.code,
    narration: reply?.presentation?.narration,
    evidence: reply?.evidence,
    elapsedMs: Math.round(performance.now() - started),
    text: reply?.text,
    passed: false,
  };
  results.push(result);
  result.passed = response.status === 200 && !!reply && check(reply);
  console.log(JSON.stringify({ ...result, text: undefined }));
  assert.ok(result.passed, `SCENARIO_FAILED:${id}`);
  return response.data;
}
try {
  await start();
  assert.equal((await request("state")).status, 401);
  assert.equal((await request("session", { password })).status, 200);
  assert.equal((await request("financial-agent")).status, 200);
  const ordinaryId = randomUUID(),
    financeId = randomUUID(),
    paymentId = randomUUID();
  const ordinary = await turn(
    "ordinary",
    ordinaryId,
    "Tell me a short joke about robots in two separate paragraphs.",
    [],
    (r) =>
      r.kind === "general" &&
      r.evidence.modelCalls > 0 &&
      r.evidence.toolCalls === 0 &&
      r.text.length > 20,
  );
  await turn(
    "education",
    ordinaryId,
    "Explain compound interest simply in two sentences.",
    [],
    (r) =>
      r.kind === "general" &&
      r.evidence.modelCalls > 0 &&
      r.evidence.toolCalls === 0 &&
      /interest/i.test(r.text),
  );
  await turn(
    "account-permission",
    financeId,
    "Show my spending from 2026-10-01 to 2026-11-01",
    [],
    (r) => r.accountAction === "choose_demo_account",
  );
  await turn(
    "authorized-spending",
    financeId,
    "Show my spending from 2026-10-01 to 2026-11-01",
    ["amina-current"],
    (r) =>
      r.kind === "financial" &&
      r.evidence.toolCalls > 0 &&
      r.presentation?.narration === "ai" &&
      /19,751\.51/.test(r.text),
  );
  await turn(
    "authorized-search",
    financeId,
    "Find Ada payments on amina-current for October 2026.",
    ["amina-current"],
    (r) =>
      ["financial", "clarify"].includes(r.kind) &&
      r.evidence.toolCalls > 0 &&
      r.presentation?.narration === "ai" &&
      r.citations.length > 0 &&
      /Ada/i.test(r.text),
  );
  const payment = await turn(
    "payment-preparation",
    paymentId,
    "Prepare 500 naira to Ada at Wema account 0000000001 for lunch",
    [],
    (r) => r.kind === "handoff" && !!r.handoff,
  );
  if (payment) {
    checkpoint = "payment-draft-fields";
    const draft = await request("conversation/payment-draft", {
      conversationId: paymentId,
      turnId: payment.turn.id,
    });
    assert.equal(draft.status, 200);
    assert.ok(
      draft.data.proposals?.some(
        (p) => p.name === "Ada" && p.amountNaira === "500",
      ),
    );
    const duplicate = await request("conversation/payment-draft", {
      conversationId: paymentId,
      turnId: payment.turn.id,
    });
    assert.equal(duplicate.data.id, draft.data.id);
    const before = (await request("state")).data;
    assert.equal(before.batches.length, 0);
    assert.ok(
      !before.audit.some((e) =>
        /approved|execut|transfer\.submitted/.test(e.action),
      ),
    );
    results.push({ id: "draft-fields-and-idempotent-reopen", passed: true });
    await stop();
    await start();
    checkpoint = "payment-draft-after-process-restart";
    const reopened = await request("conversation/payment-draft", {
      conversationId: paymentId,
      turnId: payment.turn.id,
    });
    assert.equal(reopened.data.id, draft.data.id);
    assert.deepEqual(reopened.data.proposals, draft.data.proposals);
    results.push({ id: "draft-after-process-restart", passed: true });
  }
  if (ordinary && selected.has("persistence")) {
    checkpoint = "conversation-after-process-restart";
    await stop();
    await start();
    const saved = await request(`conversations?id=${ordinaryId}`);
    assert.equal(saved.status, 200);
    assert.ok(
      saved.data.turns.some(
        (t) =>
          t.id === ordinary.turn.id && t.reply.text === ordinary.reply.text,
      ),
    );
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
    checkpoint = "browser-history-and-reload";
    const context = await browser.newContext();
    const [name, value] = cookie.split("=");
    await context.addCookies([{ name, value, url: base }]);
    const page = await context.newPage();
    assert.ok(
      (await request("conversations")).data.chats.some(
        (chat) => chat.id === ordinaryId,
      ),
    );
    await page.goto(`${base}/conversation?chat=${ordinaryId}`);
    // General replies render one <p> per paragraph. A whole-response exact
    // locator incorrectly joins adjacent elements without a whitespace boundary.
    const paragraphs = ordinary.reply.text
      .split(/\n\n/)
      .filter((p) => p.trim());
    for (const paragraph of paragraphs)
      await page.getByText(paragraph, { exact: true }).waitFor();
    await page.reload();
    for (const paragraph of paragraphs)
      await page.getByText(paragraph, { exact: true }).waitFor();
    results.push({ id: "process-restart-and-browser-reload", passed: true });
  }
  report.status = "PASS";
} catch {
  report.status = "FAIL";
  report.failureStage = checkpoint;
  process.exitCode = 1;
} finally {
  await browser?.close();
  await stop();
  // Synthetic responses only; no passwords, headers, cookies or error objects.
  await writeFile(
    process.argv[2] ?? "/tmp/agus-production-recovery.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      providerRequests: providerRequests.length,
      passed: results.filter((r) => r.passed).length,
    }),
  );
  await rm(directory, { recursive: true, force: true });
}
