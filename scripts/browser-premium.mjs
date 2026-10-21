/* global document: readonly, window: readonly, getComputedStyle: readonly */
// Real production UI, isolated persistent PostgreSQL, scripted Gemini transport.
// All records and payment actions are fictional. External fetch is denied.
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
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const directory = await mkdtemp(join(tmpdir(), "agus-premium-"));
const outputDir = resolve(
  process.env.PREMIUM_SCREENSHOTS ?? "docs/approved-release/screenshots",
);
await mkdir(outputDir, { recursive: true });
const password = randomBytes(24).toString("hex");
const salt = randomBytes(16).toString("hex");
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
      DATABASE_URL: `pglite://${directory}`,
      APP_ORIGIN: base,
      OPERATOR_ID: "premium-fictional-operator",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "true",
      PAYSTACK_SECRET_KEY: "",
      PAYSTACK_TRANSFERS_ENABLED: "false",
      LIVE_TRANSFERS_ENABLED: "false",
      LIVE_OWNER_AUTHORIZED: "false",
      AI_PROVIDER: "gemini",
      AI_MODEL: "scripted-native-fixture-only",
      AI_API_KEY: "browser-mock-inference-only",
      AGUS_AGENT_ARCHITECTURE: "native-gemini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let logs = "",
  browser,
  lastPage;
server.stdout.on("data", (x) => (logs = (logs + x).slice(-15000)));
server.stderr.on("data", (x) => (logs = (logs + x).slice(-15000)));
const results = [];
try {
  for (let n = 0; n < 150; n++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Isolated server is still starting. */
    }
    if (n === 149) throw new Error(logs);
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
    const page = await context.newPage();
    lastPage = page;
    page.setDefaultTimeout(15000);
    const errors = [],
      checks = [],
      accessibility = [];
    let approvalCalls = 0,
      executionCalls = 0;
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.method() === "POST") {
        if (r.url().endsWith("/approve")) approvalCalls++;
        if (r.url().endsWith("/execute")) executionCalls++;
      }
    });
    const input = page.getByLabel("Message AGUS", { exact: true });
    async function capture(name) {
      await geometry();
      await page.screenshot({ path: join(outputDir, `${width}-${name}.png`) });
    }
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
      const data = await (await response).json();
      await idle();
      return data;
    }
    async function geometry() {
      await page.waitForFunction(
        () =>
          Math.abs(
            document.querySelector(".agus-workspace").getBoundingClientRect()
              .height - window.innerHeight,
          ) < 2,
      );
      const data = await page.evaluate(() => {
        const el = document.querySelector(".agus-composer");
        const rect = el.getBoundingClientRect();
        return {
          documentWidth: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          composer: {
            x: rect.x,
            right: rect.right,
            bottom: rect.bottom,
            height: rect.height,
          },
          height: window.innerHeight,
          scrollbar: getComputedStyle(document.querySelector(".agus-scroll"))
            .overflowY,
          shellTop: document
            .querySelector(".agus-workspace")
            .getBoundingClientRect().top,
          headerTop: document
            .querySelector(".agus-header")
            .getBoundingClientRect().top,
          documentScroll: window.scrollY,
          shellScroll: document.querySelector(".agus-workspace").scrollTop,
          mainScroll: document.querySelector(".agus-main").scrollTop,
          mainOverflow: getComputedStyle(document.querySelector(".agus-main"))
            .overflowY,
        };
      });
      assert.ok(data.documentWidth <= data.viewport, JSON.stringify(data));
      assert.equal(data.documentScroll, 0, JSON.stringify(data));
      assert.ok(
        Math.abs(data.shellTop) < 2 && Math.abs(data.headerTop) < 2,
        JSON.stringify(data),
      );
      assert.ok(
        data.composer.x >= 0 && data.composer.right <= width + 1,
        JSON.stringify(data),
      );
      assert.ok(data.composer.bottom <= data.height + 1, JSON.stringify(data));
      return data;
    }
    async function axe(state) {
      const scan = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      accessibility.push({
        state,
        violations: scan.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes.map((n) => ({
            target: n.target,
            summary: n.failureSummary,
          })),
        })),
      });
    }
    await page.goto(base);
    await page
      .getByRole("heading", { name: "Let's talk money.", exact: true })
      .waitFor();
    await page.evaluate(() => document.fonts.ready);
    const initial = await geometry();
    assert.ok(
      initial.composer.height <= (width > 600 ? 104 : 76),
      JSON.stringify(initial),
    );
    await capture("welcome");
    await axe("welcome");
    assert.equal(
      await input.getAttribute("placeholder"),
      "Ask agus anything...",
    );
    assert.deepEqual(
      await page.locator(".agus-suggestions button").allTextContents(),
      ["Analyze spending", "Track a payment", "Prepare a transfer"],
    );
    const welcomeLayout = await page.evaluate(() => ({
      composerBottom: document
        .querySelector(".agus-composer")
        .getBoundingClientRect().bottom,
      suggestionsTop: document
        .querySelector(".agus-suggestions")
        .getBoundingClientRect().top,
      inventedEmblems: document.querySelectorAll(
        ".agus-welcome-emblem, .agus-signal",
      ).length,
    }));
    assert.ok(welcomeLayout.suggestionsTop > welcomeLayout.composerBottom);
    assert.equal(welcomeLayout.inventedEmblems, 0);
    if (width === 1440) {
      await page.setViewportSize({ width: 1672, height: 941 });
      await page.screenshot({
        path: join(outputDir, "1672-reference-welcome.png"),
      });
      await page.setViewportSize({ width: 1440, height: 810 });
      await capture("welcome-16x9");
      await page.setViewportSize({ width, height: 1000 });
    }
    checks.push("Compact empty composer and no horizontal overflow");
    await page
      .getByRole("button", { name: "Sign in to AGUS", exact: true })
      .click();
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator(".agus-signin").waitFor({ state: "hidden" });
    await send("Tell me a short joke about robots");
    await geometry();
    await capture("conversation");
    await page
      .getByRole("button", { name: /^Choose records account:/ })
      .click();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    await capture("account");
    await axe("account");
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    const spending = await send(
      "Show my spending from 2026-10-01 to 2026-11-01",
    );
    assert.equal(spending.reply.kind, "financial");
    assert.match(spending.reply.text, /19,751\.51/);
    await page.locator(".agus-result").last().waitFor();
    await capture("financial");
    await axe("financial");
    const sources = page.locator(".agus-sources").last();
    await sources.locator(":scope > summary").click();
    await sources.getByRole("heading", { name: "Source snapshot" }).waitFor();
    await sources.locator(":scope > summary").click();
    checks.push(
      "Authorized fictional source metrics and expandable calculation evidence",
    );
    const matches = await send("Find payments to Ada in October 2026");
    assert.ok(
      matches.reply.presentation?.results.some(
        (result) => result.records.length > 0,
      ),
    );
    await page.locator(".agus-record").last().waitFor();
    await capture("transactions");
    await axe("transactions");
    const handoff = await send(
      "Prepare 500 to Ada at Wema account 0000000001 for Lunch and 600 to Chidi at Access account 0000000002 for Books",
    );
    assert.equal(handoff.reply.kind, "handoff");
    await page
      .getByRole("button", { name: "Prepare payment draft", exact: true })
      .last()
      .click();
    const card = page.locator(".agus-thread .agus-payment").last();
    await card.waitFor();
    await card.locator("summary").first().click();
    await card.getByLabel("Amount (NGN)", { exact: true }).first().waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".agus-payment[open]").getBoundingClientRect()
          .top <=
        document.querySelector(".agus-scroll").getBoundingClientRect().top + 16,
    );
    await capture("payment-draft");
    await axe("payment-draft");
    await geometry();
    checks.push("Editable fictional payment proposal in the conversation");
    await input.fill(
      Array.from(
        { length: 12 },
        (_, i) => `Long editable thought ${i + 1}`,
      ).join("\n"),
    );
    const expanded = await geometry();
    assert.ok(expanded.composer.height < 340);
    await capture("long-draft");
    await page.setViewportSize({ width, height: 420 });
    await input.focus();
    await geometry();
    await capture("short-viewport");
    await page.setViewportSize({ width, height: width > 600 ? 1000 : 844 });
    await input.fill("");
    // Let the server finish but hold delivery. Stop must reject the late reply and
    // recover its saved state without destroying the next editable draft.
    let release, heldResponse, heldError;
    const gate = new Promise((r) => {
      release = r;
    });
    const held = async (route) => {
      try {
        heldResponse = await route.fetch();
        await gate;
        await route.fulfill({ response: heldResponse });
      } catch {
        heldError = true; // Never log HTTP headers or cookies from transport errors.
      }
    };
    await page.route("**/api/conversation", held);
    const before = await page.locator(".agus-turn").count();
    await input.fill("What is (47 plus 13) times 9?");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Stop response", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .count(),
      0,
    );
    await input.fill("Keep this next draft editable");
    await capture("generating");
    for (let i = 0; i < 100 && !heldResponse; i++)
      await new Promise((r) => setTimeout(r, 50));
    assert.ok(
      heldResponse,
      `Server reply should be held (transport failed: ${!!heldError})`,
    );
    await page
      .getByRole("button", { name: "Stop response", exact: true })
      .click();
    release();
    await idle();
    assert.equal(await input.inputValue(), "Keep this next draft editable");
    assert.equal(await page.locator(".agus-turn").count(), before);
    assert.ok(
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .isDisabled(),
    );
    await capture("stopped");
    await page.unroute("**/api/conversation", held);
    await page
      .getByRole("button", { name: "Check saved conversation", exact: true })
      .click();
    await idle();
    assert.equal(await input.inputValue(), "Keep this next draft editable");
    assert.equal(await page.locator(".agus-turn").count(), before + 1);
    checks.push(
      "Stop replaces Send; late reply ignored; committed response reconciled; next draft preserved",
    );
    // A response lost before reaching the server is a different recovery outcome.
    await input.fill("");
    await page.route("**/api/conversation", (r) => r.abort("failed"));
    await input.fill("Original question survives interruption");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Check saved conversation", exact: true })
      .waitFor();
    await page.unroute("**/api/conversation");
    await page
      .getByRole("button", { name: "Check saved conversation", exact: true })
      .click();
    await idle();
    assert.equal(
      await input.inputValue(),
      "Original question survives interruption",
    );
    assert.ok(
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .isEnabled(),
    );
    await capture("network-error");
    checks.push(
      "Network failure preserves question and checks saved state before retry",
    );
    await input.fill("");
    // Build a genuinely scrollable thread with real fixture requests.
    for (let i = 0; i < 5; i++) await send("Tell me a short joke about robots");
    await page.locator(".agus-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await send("What is (47 plus 13) times 9?");
    await page
      .getByRole("button", { name: "Latest response", exact: true })
      .waitFor();
    await capture("long-conversation");
    await page
      .getByRole("button", { name: "Latest response", exact: true })
      .click();
    checks.push(
      "Reading position retained while a reply arrives; jump to latest works",
    );
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await capture("navigation");
    await axe("navigation");
    if (width >= 1024)
      await page
        .getByRole("button", { name: "Collapse navigation", exact: true })
        .filter({ visible: true })
        .click();
    else
      await page
        .getByRole("button", { name: "Close conversations", exact: true })
        .click();
    await page.reload();
    await page.locator(".agus-turn").last().waitFor();
    assert.ok((await page.locator(".agus-turn").count()) >= before + 6);
    await geometry();
    checks.push(
      "Saved conversation survives reload; responsive navigation opens and closes",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".agus-turn")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    assert.equal(approvalCalls, 0);
    assert.equal(executionCalls, 0);
    assert.deepEqual(errors, []);
    const result = {
      width,
      checks,
      initial,
      accessibility,
      pageErrors: errors,
      approvalCalls,
      executionCalls,
    };
    results.push(result);
    await writeFile(
      join(outputDir, "browser-results.json"),
      JSON.stringify(results, null, 2),
    );
    await context.close();
  }
  const violations = results.flatMap((r) =>
    r.accessibility.flatMap((a) => a.violations),
  );
  assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
  console.log(
    JSON.stringify(
      {
        widths: results.map((r) => r.width),
        checks: results.reduce((n, r) => n + r.checks.length, 0),
        axeViolations: 0,
        report: join(outputDir, "browser-results.json"),
      },
      null,
      2,
    ),
  );
} catch (error) {
  if (lastPage && !lastPage.isClosed())
    await lastPage
      .screenshot({ path: join(outputDir, "failure.png") })
      .catch(() => {});
  console.error(logs.slice(-3000));
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const stopped = new Promise((r) => server.once("exit", r));
    server.kill("SIGTERM");
    await stopped;
  }
  await rm(directory, { recursive: true, force: true });
}
