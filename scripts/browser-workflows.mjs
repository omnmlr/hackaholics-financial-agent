/* global document: readonly, window: readonly */
// Actual production application, disposable PostgreSQL, scripted Gemini only.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
const reservation = createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const base = `http://127.0.0.1:${port}`;
const dir = await mkdtemp(join(tmpdir(), "agus-workflows-"));
const output = resolve(
  process.env.WORKFLOW_SCREENSHOTS ?? "docs/agus-next-release/screenshots",
);
await mkdir(output, { recursive: true });
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const server = spawn(
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
  {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: `pglite://${join(dir, "db")}`,
      APP_ORIGIN: base,
      OPERATOR_ID: "workflows-fictional-operator",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "true",
      LIVE_TRANSFERS_ENABLED: "false",
      PAYSTACK_TRANSFERS_ENABLED: "false",
      PAYSTACK_SECRET_KEY: "",
      AI_PROVIDER: "gemini",
      AI_MODEL: "scripted-native-fixture-only",
      AI_API_KEY: "browser-mock-inference-only",
      AGUS_AGENT_ARCHITECTURE: "native-gemini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "",
  browser;
server.stdout.on("data", (x) => (logs = (logs + x).slice(-15000)));
server.stderr.on("data", (x) => (logs = (logs + x).slice(-15000)));
const report = {
  transport: "scripted Gemini; zero genuine provider or bank requests",
  widths: [],
};
try {
  for (let n = 0; n < 150; n++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch { /* Server is starting. */ }
    if (n === 149) throw Error(logs);
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  for (const width of [1440, 820, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: width > 600 ? 1000 : 844 },
      isMobile: width < 600,
      hasTouch: width < 600,
      reducedMotion: "reduce",
    });
    await context.route("**/*", (r) =>
      r.request().url().startsWith(base) ? r.continue() : r.abort(),
    );
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(20000);
    const login = await context.request.post(`${base}/api/session`, {
      data: { password },
      headers: { Origin: base },
    });
    assert.equal(login.status(), 200);
    await page.goto(`${base}/conversation`);
    await page
      .getByRole("button", { name: "Choose records account:", exact: false })
      .waitFor();
    const input = page.getByLabel("Message AGUS", { exact: true });
    const capture = async (name) => {
      await page.screenshot({ path: join(output, `${width}-${name}.png`) });
    };
    const send = async (text) => {
      await input.fill(text);
      const pending = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/conversation") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const response = await pending;
      const data = await response.json();
      assert.ok(data.turn, JSON.stringify(data));
      await page.waitForFunction(
        () =>
          document
            .querySelector(".agus-composer")
            ?.getAttribute("aria-busy") === "false",
      );
      return data.turn.reply;
    };
    await capture("welcome");
    await page
      .getByRole("button", { name: "Choose records account:", exact: false })
      .click();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    const balance = await send("What's my fictional account balance?");
    assert.match(balance.text, /123,456\.78/);
    assert.match(balance.text, /124,456\.78/);
    await capture("account");
    const zero = await send("If I save 10k weekly to 1m");
    assert.equal(zero.savings.periods, 100);
    const existing = await send(
      "Use my existing balance as the starting point",
    );
    assert.equal(existing.savings.periods, 88);
    assert.equal(existing.savings.startingAmount, 123456.78);
    const corrected = await send("Make it 20k weekly instead");
    assert.equal(corrected.savings.periods, 44);
    await capture("savings");
    await page.reload();
    await input.waitFor();
    await page
      .getByRole("button", { name: "Choose records account:", exact: false })
      .click();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    const reset = await send("Actually calculate from zero");
    assert.equal(reset.savings.periods, 50);
    const slang = await send("Save 5h daily until I become a millionaire");
    assert.equal(slang.savings.periods, 2000);
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(scan.violations, []);
    assert.deepEqual(errors, []);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    report.widths.push({
      width,
      checks: 8,
      axeViolations: scan.violations.length,
      pageErrors: errors,
      examples: [
        balance.text,
        zero.text,
        existing.text,
        corrected.text,
        reset.text,
        slang.text,
      ],
    });
    await context.close();
  }
  await writeFile(
    join(output, "workflows.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(join(output, "failure.log"), `${error.stack}\n${logs}`);
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  await rm(dir, { recursive: true, force: true });
}
