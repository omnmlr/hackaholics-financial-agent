/* global document: readonly */
// Production UI + native function transport fixture. Genuine Gemini calls: zero.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = "http://127.0.0.1:3126";
const dir = await mkdtemp(join(tmpdir(), "agus-native-browser-"));
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
const report =
  process.env.NATIVE_BROWSER_REPORT ?? "/tmp/agus-native-agent-browser.json";
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/gemini-native-agent.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3126",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: `pglite://${dir}`,
      APP_ORIGIN: base,
      OPERATOR_ID: "native-fixture-operator",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "true",
      PAYSTACK_SECRET_KEY: "",
      PAYSTACK_TRANSFERS_ENABLED: "false",
      LIVE_OWNER_AUTHORIZED: "false",
      LIVE_TRANSFERS_ENABLED: "false",
      PAYMENTS_EMERGENCY_DISABLED: "false",
      AI_PROVIDER: "gemini",
      AI_MODEL: "scripted-native-fixture-only",
      AI_API_KEY: "browser-mock-inference-only",
      AGUS_AGENT_ARCHITECTURE: "native-gemini",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "",
  browser,
  lastPage;
child.stdout.on("data", (chunk) => {
  output = (output + chunk).slice(-50000);
});
child.stderr.on("data", (chunk) => {
  output = (output + chunk).slice(-50000);
});
const results = [];
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if (output.includes("Ready") && (await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch {
      /* Server starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, output);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      isMobile: viewport.width < 700,
      hasTouch: viewport.width < 700,
    });
    await context.route("**/*", (route) =>
      route.request().url().startsWith(base) ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    lastPage = page;
    page.setDefaultTimeout(15000);
    const errors = [],
      checks = [];
    let executions = 0,
      approvals = 0,
      preparations = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (request.url().endsWith("/execute")) executions++;
      if (request.url().endsWith("/approve")) approvals++;
      if (request.url().endsWith("/payment-draft")) preparations++;
    });
    const input = page.getByLabel("Message AGUS", { exact: true });
    async function idle() {
      await page.waitForFunction(
        () =>
          document
            .querySelector(".agus-composer")
            ?.getAttribute("aria-busy") === "false",
      );
    }
    async function send(text) {
      await input.fill(text);
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/conversation") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const result = await response;
      assert.equal(result.status(), 200);
      const data = await result.json();
      await idle();
      return data.reply;
    }
    await page.goto(base);
    await page
      .getByRole("heading", { name: "Let's talk money.", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .filter({ visible: true })
      .click();
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator(".agus-signin").waitFor({ state: "hidden" });
    if (viewport.width >= 1024)
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .filter({ visible: true })
        .click();

    const ordinary = await send("Tell me a short joke about robots");
    assert.equal(ordinary.kind, "general");
    assert.match(ordinary.text, /robot bring a ladder/);
    assert.equal(ordinary.evidence.modelCalls, 1);
    assert.equal(ordinary.evidence.toolCalls, 0);
    checks.push("Ordinary direct reply uses one generation and no tool");

    const calculation = await send("What is (47 plus 13) times 9?");
    assert.equal(calculation.kind, "general");
    assert.match(calculation.text, /540/);
    assert.equal(calculation.evidence.toolCalls, 1);
    await page.reload();
    await page.locator(".agus-assistant-message").last().waitFor();
    const corrected = await send("Use 18 instead of 9 and keep the rest");
    assert.equal(corrected.kind, "general");
    assert.match(corrected.text, /1,080/);
    checks.push(
      "Native calculator signature round trip and saved contextual correction after reload",
    );

    const budget = await send(
      "If my budget is ₦150,000 and rent is ₦80,000 and food is ₦25,000, what remains?",
    );
    assert.equal(budget.kind, "general");
    assert.match(budget.text, /45,000/);
    assert.equal(budget.evidence.toolCalls, 1);
    checks.push(
      "Hypothetical budget is independently calculated and final financial prose reviewed",
    );

    const missing = await send("Show my spending for October 2026");
    assert.equal(missing.accountAction, "choose_demo_account");
    await page
      .getByRole("button", { name: "Choose demo account", exact: true })
      .last()
      .click();
    await page.getByRole("dialog", { name: "Account", exact: true }).waitFor();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    const resumedResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/conversation") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Continue question", exact: true })
      .click();
    const resumed = await (await resumedResponse).json();
    await idle();
    assert.equal(resumed.reply.kind, "financial");
    assert.match(resumed.reply.text, /19,751\.51/);
    assert.match(resumed.reply.text, /FICTIONAL/);
    assert.equal(resumed.reply.citations.length, 1);
    assert.equal(resumed.reply.presentation.results.length, 1);
    checks.push(
      "Account picker resumes original request through authorized native read and source-backed cards",
    );

    const handoff = await send(
      "Prepare 500 to Ada at Wema account 0000000001 for Lunch and 600 to Chidi at Access account 0000000002 for Books",
    );
    assert.equal(handoff.kind, "handoff");
    assert.equal(handoff.handoff.kind, "existing_payment_draft");
    assert.equal(preparations, 0);
    await page
      .getByRole("button", { name: "Prepare payment draft", exact: true })
      .click();
    const card = page.locator(".agus-thread .agus-payment").last();
    await card.waitFor();
    await card.locator("summary").first().click();
    const editor = card.getByRole("region", {
      name: "Payment proposal",
      exact: true,
    });
    await editor
      .getByLabel("Recipient label", { exact: true })
      .first()
      .waitFor();
    assert.equal(await editor.locator("fieldset").count(), 2);
    await editor.getByLabel("Amount (NGN)", { exact: true }).nth(1).fill("650");
    await editor.getByLabel("Amount (NGN)", { exact: true }).nth(1).blur();
    await editor.getByText("Changes saved", { exact: true }).waitFor();
    await page.reload();
    await page.locator(".agus-thread .agus-payment").last().waitFor();
    await page
      .locator(".agus-thread .agus-payment")
      .last()
      .locator("summary")
      .first()
      .click();
    assert.equal(
      await editor
        .getByLabel("Amount (NGN)", { exact: true })
        .nth(1)
        .inputValue(),
      "650",
    );
    assert.equal(preparations, 1);
    assert.equal(approvals, 0);
    assert.equal(executions, 0);
    checks.push(
      "Explicit payment draft remains editable and persists without approval or execution",
    );
    assert.deepEqual(errors, []);
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
      false,
    );
    const screenshot = `/tmp/agus-native-agent-${viewport.width}.png`;
    await page.screenshot({ path: screenshot, fullPage: true });
    results.push({
      viewport,
      passed: true,
      checks,
      preparations,
      approvals,
      executions,
      errors,
      screenshot,
    });
    console.log(
      `PASS native ${viewport.width}px: ${checks.length} integration groups`,
    );
    await context.close();
  }
  await writeFile(
    report,
    JSON.stringify(
      {
        model: "mocked native Gemini function transport",
        genuineModelCalls: 0,
        data: "fictional",
        paymentMode: "fixture",
        results,
      },
      null,
      2,
    ) + "\n",
  );
} catch (error) {
  console.error(output);
  if (lastPage) {
    console.error(await lastPage.locator("body").innerText());
    await lastPage.screenshot({
      path: "/tmp/agus-native-agent-browser-failure.png",
    });
  }
  throw error;
} finally {
  await browser?.close();
  if (child.exitCode === null) {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await stopped;
  }
  await rm(dir, { recursive: true, force: true });
}
