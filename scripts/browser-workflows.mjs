/* global document: readonly, window: readonly */
// Actual production application, disposable PostgreSQL, scripted Gemini only.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import sharp from "sharp";
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
  browser,
  lastPage;
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
    } catch {
      /* Server is starting. */
    }
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
    lastPage = page;
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(20000);
    const login = await context.request.post(`${base}/api/session`, {
      data: { password },
      headers: { Origin: base },
    });
    assert.equal(login.status(), 200);
    const initialBatches = (
      await (await context.request.get(`${base}/api/state`)).json()
    ).batches.length;
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
    const expectedAvailable = 12345678 - initialBatches * 135000,
      expectedCurrent = 12445678 - initialBatches * 70000;
    assert.ok(
      balance.text.includes(
        (expectedAvailable / 100).toLocaleString("en-NG", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      ),
    );
    assert.ok(
      balance.text.includes(
        (expectedCurrent / 100).toLocaleString("en-NG", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
      ),
    );
    await capture("account");
    const zero = await send("If I save 10k weekly to 1m");
    assert.equal(zero.savings.periods, 100);
    const existing = await send(
      "Use my existing balance as the starting point",
    );
    assert.equal(
      existing.savings.periods,
      Math.ceil((100000000 - expectedAvailable) / 1000000),
    );
    assert.equal(existing.savings.startingAmount, expectedAvailable / 100);
    const corrected = await send("Make it 20k weekly instead");
    assert.equal(
      corrected.savings.periods,
      Math.ceil((100000000 - expectedAvailable) / 2000000),
    );
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
    let preparationChecks = 0;
    if (process.env.WORKFLOW_PHASE !== "foundation") {
      await page.getByRole("button", { name: "New chat", exact: true }).click();
      const bare = await send("500 OPay 9812345670");
      assert.equal(bare.kind, "handoff");
      const editor = page
        .getByRole("region", { name: "Payment proposal", exact: true })
        .last();
      await editor.waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector(
            '.agus-payment[open] input[placeholder="Amount required"]',
          )?.value === "500",
      );
      assert.equal(
        await editor.getByLabel("Amount (NGN)", { exact: true }).inputValue(),
        "500",
      );
      assert.equal(
        await editor.getByLabel("Account number", { exact: true }).inputValue(),
        "9812345670",
      );
      assert.equal(
        await editor
          .getByLabel("Recipient label", { exact: true })
          .inputValue(),
        "",
      );
      await capture("bare-amount-draft");
      // The image is a real raster of synthetic instructions. Only recognition
      // is scripted; decoding, upload, SQL linkage and editing are implemented.
      const image = await sharp(
        Buffer.from(
          '<svg width="900" height="300"><rect width="900" height="300" fill="white"/><g fill="black" font-size="28"><text x="24" y="60">FICTIONAL PAYMENT INSTRUCTIONS</text><text x="24" y="130">Ada: Wema 0000000001, NGN 500</text><text x="24" y="200">Chidi: Access 0000000002, NGN 600</text></g></svg>',
        ),
      )
        .png()
        .toBuffer();
      await page
        .getByLabel("Select payment image", { exact: true })
        .setInputFiles({
          name: "synthetic-instructions.png",
          mimeType: "image/png",
          buffer: image,
        });
      await page.getByAltText("Local payment image preview").waitFor();
      await capture("image-preview");
      const upload = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/extract") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      const uploaded = await (await upload).json();
      assert.ok(uploaded.turn, JSON.stringify(uploaded));
      const imageEditor = page
        .getByRole("region", { name: "Payment proposal", exact: true })
        .last();
      await imageEditor.locator("fieldset").nth(1).waitFor();
      assert.equal(await imageEditor.locator("fieldset").count(), 2);
      assert.equal(
        await imageEditor
          .getByLabel("Amount (NGN)", { exact: true })
          .nth(0)
          .inputValue(),
        "500",
      );
      assert.equal(
        await imageEditor
          .getByLabel("Amount (NGN)", { exact: true })
          .nth(1)
          .inputValue(),
        "600",
      );
      await capture("image-drafts");
      assert.equal(
        await page.getByAltText("Local payment image preview").count(),
        0,
      );
      const state = await (
        await context.request.get(`${base}/api/state`)
      ).json();
      assert.equal(state.batches.length, initialBatches);
      assert.ok(!JSON.stringify(state.messages).includes("data:image"));
      preparationChecks = 8;
      if (process.env.WORKFLOW_PHASE === "outcomes") {
        await imageEditor
          .getByLabel("Amount (NGN)", { exact: true })
          .first()
          .fill("700");
        await imageEditor
          .getByRole("button", { name: "Save draft", exact: true })
          .click();
        const card = page.locator(".agus-thread .agus-payment").last();
        await card
          .getByRole("button", { name: "Verify beneficiaries", exact: true })
          .click();
        await card.getByRole("checkbox").check();
        await card
          .getByLabel("Password to approve reviewed batch")
          .fill(password);
        await card
          .getByRole("button", { name: "Approve reviewed batch", exact: true })
          .click();
        const beforeSubmit = await (
          await context.request.get(`${base}/api/state`)
        ).json();
        assert.ok(!beforeSubmit.batches[0].approval.consumedAt);
        await card
          .getByRole("button", {
            name: "Submit simulated transfers",
            exact: true,
          })
          .click();
        const outcome = page.getByRole("region", {
          name: "Recorded payment outcome",
        });
        await outcome.waitFor();
        assert.ok((await outcome.innerText()).includes("awaiting outcome"));
        assert.equal(await outcome.getByRole("link").count(), 0);
        await capture("payment-processing");
        await outcome
          .getByRole("button", {
            name: "Check recorded provider outcome",
            exact: true,
          })
          .click();
        await page.waitForFunction(() =>
          document
            .querySelector(".agus-payment-outcome")
            ?.textContent.includes("Successful"),
        );
        assert.match(await outcome.innerText(), /No real money moved/);
        assert.match(await outcome.innerText(), /Processing/);
        await outcome.locator("summary").first().click();
        await capture("payment-outcomes");
        const confirmation = outcome.getByRole("link", {
          name: "Download simulated confirmation",
        });
        const receipt = await context.request.get(
          new URL(await confirmation.getAttribute("href"), base).href,
        );
        assert.equal(receipt.status(), 200);
        assert.match(await receipt.text(), /SIMULATED.*PAYMENT CONFIRMATION/);
        const paymentStatus = await send("Did it send?");
        assert.deepEqual(
          paymentStatus.payments.records.map((p) => p.status),
          ["successful", "processing"],
        );
        const second = await send("What happened to the second person?");
        assert.equal(second.payments.records[0].status, "processing");
        const proof = await send("Show me the receipt.");
        assert.equal(
          proof.payments.records.filter((p) => p.canConfirm).length,
          1,
        );
        await capture("payment-status");
        await page.reload();
        await page
          .getByRole("region", { name: "Recorded payment outcome" })
          .waitFor();
        const afterReload = await send("Was the recipient credited?");
        assert.match(afterReload.text, /does not prove recipient bank credit/);
        preparationChecks += 12;
      }
    }
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
      checks: 8 + preparationChecks,
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
  await lastPage?.screenshot({ path: join(output, "failure.png") });
  await writeFile(join(output, "failure.log"), `${error.stack}\n${logs}`);
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) => server.once("exit", r));
  await rm(dir, { recursive: true, force: true });
}
