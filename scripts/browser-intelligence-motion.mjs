/* global document: readonly, window: readonly, getComputedStyle: readonly, requestAnimationFrame: readonly, Event: readonly */
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
const directory = await mkdtemp(join(tmpdir(), "agus-motion-"));
const outputDir = resolve(
  process.env.PREMIUM_SCREENSHOTS ?? "docs/intelligence-motion/screenshots",
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
      reducedMotion: "no-preference",
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
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter(
              (a) => a.effect?.getComputedTiming().iterations !== Infinity,
            )
            .map((a) => a.finished.catch(() => {})),
        );
      });
      if (/ada|savings/.test(name))
        await page
          .locator(".agus-turn")
          .last()
          .evaluate((el) => {
            const scroller = document.querySelector(".agus-scroll");
            scroller.scrollTop +=
              el.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top -
              16;
          });
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
    await page
      .locator('.agus-financial-backdrop[data-motion="active"]')
      .waitFor();
    const pointPositions = () =>
      page.locator(".agus-data-point").evaluateAll((points) =>
        points.map((el) => {
          const m = el.getCTM();
          return { x: m.e, y: m.f };
        }),
      );
    async function recordMotion(name, seconds) {
      if (width !== 1440 || process.env.CAPTURE_MOTION_VIDEO !== "1") return;
      const frameDir = join(directory, name);
      await mkdir(frameDir);
      const started = Date.now();
      for (let n = 0; n < seconds * 10; n++) {
        await page.screenshot({
          path: join(frameDir, `${String(n).padStart(3, "0")}.png`),
        });
        await page.waitForTimeout(
          Math.max(0, started + (n + 1) * 100 - Date.now()),
        );
      }
      await new Promise((resolve, reject) => {
        const encoder = spawn(
          "ffmpeg",
          [
            "-y",
            "-loglevel",
            "error",
            "-framerate",
            "10",
            "-i",
            join(frameDir, "%03d.png"),
            "-vf",
            "scale=960:-2",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            join(outputDir, `${name}.mp4`),
          ],
          { stdio: "ignore" },
        );
        encoder.on("error", reject);
        encoder.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error("Motion clip encoding failed")),
        );
      });
    }
    const beforeMotion = await pointPositions();
    await capture("motion-t0");
    await page.waitForTimeout(1800); // Deliberately sample observable movement, not a network wait.
    const afterMotion = await pointPositions();
    await capture("motion-t1");
    assert.ok(
      beforeMotion.every(
        (p, i) =>
          Math.hypot(afterMotion[i].x - p.x, afterMotion[i].y - p.y) > 2,
      ),
    );
    checks.push(
      "All three existing blue points visibly travel along the existing curves",
    );
    await recordMotion("welcome-motion", 6);
    const metricsSession = await context.newCDPSession(page);
    await metricsSession.send("Performance.enable");
    if (width === 390)
      await metricsSession.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const metricsBefore = await metricsSession.send("Performance.getMetrics");
    const frames = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const intervals = [];
          let previous;
          function sample(now) {
            if (previous) intervals.push(now - previous);
            previous = now;
            if (intervals.length < 90) requestAnimationFrame(sample);
            else resolve(intervals);
          }
          requestAnimationFrame(sample);
        }),
    );
    const sorted = [...frames].sort((a, b) => a - b);
    const metricsAfter = await metricsSession.send("Performance.getMetrics");
    if (width === 390)
      await metricsSession.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const performanceDelta = Object.fromEntries(
      ["TaskDuration", "ScriptDuration", "LayoutCount", "RecalcStyleCount"].map(
        (name) => [
          name,
          metricsAfter.metrics.find((m) => m.name === name).value -
            metricsBefore.metrics.find((m) => m.name === name).value,
        ],
      ),
    );
    await metricsSession.detach();
    const frameSample = {
      cpuThrottle: width === 390 ? 4 : 1,
      performanceDelta,
      frames: frames.length,
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      over50ms: frames.filter((ms) => ms > 50).length,
    };
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        get: () => true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await page
        .locator(".agus-financial-backdrop")
        .evaluate((el) => el.animationsPaused()),
      true,
    );
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await page
        .locator(".agus-financial-backdrop")
        .evaluate((el) => el.animationsPaused()),
      false,
    );
    checks.push(
      "Visibility event pauses and resumes decorative SVG motion (simulated page visibility)",
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(
      () => document.querySelectorAll("animateMotion").length === 0,
    );
    await capture("welcome");
    await axe("welcome-reduced-motion");
    assert.equal(
      await page
        .locator(".agus-data-bars")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    const reducedBefore = await pointPositions();
    await page.waitForTimeout(100);
    assert.deepEqual(await pointPositions(), reducedBefore);
    checks.push(
      "Reduced motion removes SVG travel and CSS animation; static approved points remain",
    );
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page
      .getByRole("button", { name: "Sign in to AGUS", exact: true })
      .click();
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator(".agus-signin").waitFor({ state: "hidden" });
    const savings = await send(
      "if i saved 10k every week, how long until i become a millionaire 👀🥲",
    );
    assert.equal(savings.reply.kind, "general");
    assert.match(savings.reply.text, /100 weeks, roughly 1 year and 11 months/);
    assert.doesNotMatch(savings.reply.text, /Hypothetical|ceil\(/);
    await capture("savings");
    assert.equal(
      await page
        .locator(".agus-financial-backdrop")
        .evaluate((el) => el.animationsPaused()),
      true,
    );
    const initialSavings = savings.reply.text;
    const existing = await send("What if I already have ₦200k?");
    assert.match(existing.reply.text, /80 weeks/);
    const correction = await send("Actually make it ₦15k weekly.");
    assert.match(correction.reply.text, /54 weeks/);
    await page.reload();
    await page.locator(".agus-turn").last().waitFor();
    assert.ok(
      (await page.locator("body").innerText()).includes(initialSavings),
    );
    checks.push(
      "Savings answers use verified time units, follow-up corrections and persisted dialogue",
    );
    await page
      .getByRole("button", { name: /^Choose records account:/ })
      .click();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    const matches = await send("Find payments to Ada in October 2026");
    assert.equal(matches.reply.presentation.narration, "ai");
    await capture("ada-matches");
    const sources = page.locator(".agus-sources").last();
    assert.equal(await sources.getAttribute("open"), null);
    await sources.locator(":scope > summary").click();
    assert.equal(
      await sources.getByText("Original response", { exact: true }).count(),
      0,
    );
    assert.equal(await sources.locator("pre:visible").count(), 0);
    await sources.getByText("Technical references", { exact: true }).click();
    assert.equal(await sources.locator("pre:visible").count(), 1);
    await capture("evidence");
    await sources.locator(":scope > summary").click();
    await page
      .getByRole("button", { name: /^Show Ada Obi/ })
      .last()
      .click();
    assert.equal(
      await input.inputValue(),
      "Show details for the first candidate",
    );
    await send(await input.inputValue());
    await page
      .locator(".agus-prose")
      .last()
      .getByText(/This record is for Ada Obi/)
      .waitFor();
    assert.match(
      await page.locator(".agus-prose").last().innerText(),
      /₦7,500.00/,
    );
    await capture("ada-detail");
    const credit = await send("Was the recipient actually credited?");
    assert.match(
      credit.reply.presentation.explanation.join(" "),
      /cannot confirm recipient bank credit|does not confirm/,
    );
    checks.push(
      "Reviewed Ada narration, fresh candidate detail and explicit credit boundary; technical evidence disclosed once",
    );
    await axe("financial");
    // Hold delivery to inspect genuine client pending state and processing motion.
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const hold = async (route) => {
      const response = await route.fetch();
      await gate;
      try {
        await route.fulfill({ response });
      } catch {
        /* Cancelled delivery. */
      }
    };
    await page.route("**/api/conversation", hold);
    await input.fill("10 times 20 is what??");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Stop response", exact: true })
      .waitFor();
    assert.equal(await page.locator(".agus-processing-mark i").count(), 3);
    assert.match(
      await page.locator(".agus-thinking").innerText(),
      /Preparing your response/,
    );
    assert.doesNotMatch(
      await page.locator(".agus-thinking").innerText(),
      /checking.*bank|verifying.*payment/i,
    );
    await capture("processing");
    await recordMotion("processing-motion", 2);
    await axe("processing");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".agus-processing-mark i")
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    release();
    await idle();
    await page.unroute("**/api/conversation", hold);
    await send(
      "Prepare 500 to Ada at Wema account 0000000001 for Lunch and 600 to Chidi at Access account 0000000002 for Books",
    );
    await page
      .getByRole("button", { name: "Prepare payment draft", exact: true })
      .last()
      .click();
    const card = page.locator(".agus-thread .agus-payment").last();
    await card.waitFor();
    await card.locator("summary").first().click();
    await card.getByLabel("Amount (NGN)", { exact: true }).first().waitFor();
    await capture("payment-draft");
    await axe("payment-draft");
    assert.equal(approvalCalls, 0);
    assert.equal(executionCalls, 0);
    assert.deepEqual(errors, []);
    results.push({
      width,
      checks,
      beforeMotion,
      afterMotion,
      frameSample,
      accessibility,
      approvalCalls,
      executionCalls,
      errors,
    });
    console.log(
      `PASS motion/intelligence ${width}px: ${checks.length} groups, frame p95 ${frameSample.p95Ms.toFixed(1)}ms`,
    );
    await context.close();
  }
  await writeFile(
    join(outputDir, "motion-results.json"),
    JSON.stringify(
      { model: "scripted transport; zero genuine calls", results },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(logs);
  if (lastPage) {
    console.error(await lastPage.locator("body").innerText());
    await lastPage.screenshot({ path: join(outputDir, "motion-failure.png") });
  }
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
