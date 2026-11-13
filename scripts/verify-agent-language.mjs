/* global AbortSignal */
import { chromium } from "playwright";
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

  const transcripts = [];
  const post = async (text, conversationId, privacyMode = false) => {
    const response = await fetch(`${base}/api/conversation`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        conversationId,
        requestId: randomUUID(),
        text,
        accountIds: [],
        privacyMode,
      }),
      signal: AbortSignal.timeout(90000),
    });
    const data = await response.json();
    let plan;
    if (data.reply?.digitalPaymentPlanId) {
      const r = await fetch(
        `${base}/api/product/payment-plans/${data.reply.digitalPaymentPlanId}`,
        { headers },
      );
      plan = await r.json();
    }
    const record = {
      text,
      privacyMode,
      httpStatus: response.status,
      reply: data.reply?.text,
      kind: data.reply?.kind,
      execution: data.reply?.execution,
      plan: plan
        ? {
            id: plan.id,
            recipientLabel: plan.recipientLabel,
            amount: plan.amount,
            asset: plan.asset,
            rail: plan.rail,
            privacy: plan.privacy,
            state: plan.state,
            approved: !!plan.approval,
            quoted: !!plan.quote,
          }
        : null,
    };
    transcripts.push(record);
    await writeFile(
      "docs/agus2-web/genuine-language.json",
      JSON.stringify(
        {
          classification:
            "Genuine Gemini server inference; synthetic names only; no payment authorized or executed",
          model,
          transcripts,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        case: transcripts.length,
        status: response.status,
        tools: record.execution?.steps
          .filter((s) => s.state === "succeeded")
          .map((s) => s.tool),
        plan: record.plan,
      }),
    );
    if (record.execution?.reason === "MODEL_HTTP_429")
      throw new Error(
        "Model rate/quota limit: partial genuine evidence saved; remaining cases were not attempted.",
      );
    return { data, record };
  };
  await mkdir("docs/agus2-web", { recursive: true });
  const standard = randomUUID(),
    privateChat = randomUUID(),
    memoryChat = randomUUID();
  const first = await post("Abeg send Ada 10 USDC.", standard);
  const second = await post(
    "Don't send am yet, just prepare everything.",
    standard,
  );
  await post("How much I still get after the transfer?", standard);
  const privateFirst = await post(
    "Omo, I wan send Chidi 0.05 ZEC, make e private.",
    privateChat,
    true,
  );
  const revision = await post("No, na 0.02 I mean.", privateChat, true);
  await post(
    "Wetin happen to that payment we discussed yesterday?",
    privateChat,
    true,
  );
  await post("That guy still dey owe me fifty dollars.", memoryChat);
  await post("Remember say Ada go pay me next week.", memoryChat);
  await post("Send 10 USDC to Ada and tell me when it goes through.", standard);
  await post("Abeg snd Ada 5 USDC, jus prepare am.", randomUUID());
  const state = await (
    await fetch(`${base}/api/product/payment-plans`, { headers })
  ).json();
  assert.equal(
    state.plans.some(
      (p) =>
        p.approval ||
        p.candidateTransactionId ||
        ["submitting", "pending", "confirmed"].includes(p.state),
    ),
    false,
    "Language understanding must never grant payment authority",
  );
  assert.ok(
    first.record.plan?.recipientLabel === "Ada" &&
      first.record.plan.amount === "10" &&
      first.record.plan.asset === "USDC",
    "Pidgin USDC preparation failed",
  );
  assert.ok(
    privateFirst.record.plan?.recipientLabel === "Chidi" &&
      privateFirst.record.plan.amount === "0.05" &&
      privateFirst.record.plan.privacy,
    "Private Pidgin ZEC preparation failed",
  );
  assert.equal(
    revision.record.plan?.id,
    privateFirst.record.plan.id,
    "Revision must update the contextual review",
  );
  assert.equal(revision.record.plan?.amount, "0.02");
  assert.ok(second.data.reply, "Preparation-only follow-up failed");
  // Real browser -> API -> actual Gemini -> selected tools -> persisted review.
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    await context.addCookies([
      {
        name: "ha_session",
        value: cookie.slice(cookie.indexOf("=") + 1),
        url: base,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const page = await context.newPage();
    const jsErrors = [];
    page.on("pageerror", (e) => jsErrors.push(e.message));
    await page.goto(base);
    await page
      .getByRole("dialog", { name: "Welcome to AGUS" })
      .getByRole("button", { name: "Skip for now" })
      .click();
    await page
      .getByRole("dialog", { name: "Welcome to AGUS" })
      .waitFor({ state: "hidden" });
    await page
      .getByRole("textbox", { name: "Ask AGUS", exact: true })
      .fill("Abeg send Ada 10 USDC.");
    const responsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/conversation") &&
        r.request().method() === "POST",
      { timeout: 90000 },
    );
    await page.getByRole("button", { name: "Start conversation" }).click();
    const response = await responsePromise;
    const data = await response.json();
    assert.equal(response.status(), 200);
    assert.ok(
      data.reply?.execution?.steps.some(
        (s) => s.tool === "prepare_digital_payment" && s.state === "succeeded",
      ),
    );
    await page
      .getByRole("dialog", { name: "Review payment", exact: true })
      .waitFor();
    await page.screenshot({
      path: "docs/agus2-web/genuine-agent-payment-browser.png",
      fullPage: true,
    });
    await writeFile(
      "docs/agus2-web/genuine-agent-payment-browser.json",
      JSON.stringify(
        {
          classification:
            "Genuine server-side Gemini tool dispatch and saved proposal; no wallet configured; no transfer",
          model,
          execution: data.reply.execution,
          jsErrors,
        },
        null,
        2,
      ),
    );
    assert.deepEqual(jsErrors, []);
  } finally {
    await browser.close();
  }
  await writeFile(
    "docs/agus2-web/genuine-language.json",
    JSON.stringify(
      {
        classification:
          "Genuine Gemini server inference; synthetic names only; no payment authorized or executed",
        model,
        passed: true,
        transcripts,
      },
      null,
      2,
    ),
  );
} finally {
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  await rm(directory, { recursive: true, force: true });
}
