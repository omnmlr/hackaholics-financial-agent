/* global document, innerWidth, getComputedStyle */
// Browser -> authenticated API -> persistent SQL -> rendering.
// Sponsor verification uses explicitly mocked transport. No real coins move.
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { base32, bech32 } from "@scure/base";
import assert from "node:assert/strict";
const directory = await mkdtemp(join(tmpdir(), "agus-web-browser-"));
const evidence = join(process.cwd(), "docs/agus2-web/acceptance");
await mkdir(evidence, { recursive: true });
const fixtureFile = join(directory, "transport.json");
await writeFile(fixtureFile, "{}");
const base = "http://localhost:3123";
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
function stellar(seed) {
  const bytes = new Uint8Array(35);
  bytes[0] = 48;
  bytes.fill(seed, 1, 33);
  let crc = 0;
  for (const byte of bytes.slice(0, 33)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++)
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  bytes[33] = crc & 255;
  bytes[34] = crc >> 8;
  return base32.encode(bytes);
}
const recipient = stellar(2),
  issuer = stellar(3);
const zaddr = bech32.encode(
  "ztestsapling",
  bech32.toWords(new Uint8Array(43).fill(5)),
  200,
);
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/agus-web-network.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3123",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: `pglite://${join(directory, "db")}`,
      APP_ORIGIN: base,
      OPERATOR_ID: "web-browser-only",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      PAYMENT_MODE: "fixture",
      AGUS_WORKSPACE_ENABLED: "true",
      AGUS_AGENT_ARCHITECTURE: "native-gemini",
      FINANCIAL_DEMO_ENABLED: "false",
      AI_PROVIDER: "none",
      AI_API_KEY: "",
      PAYSTACK_SECRET_KEY: "",
      POLLAR_TESTNET_USDC_ISSUER: issuer,
      ZCASH_WALLET_RPC_URL: "http://127.0.0.1:18232/",
      AGUS_TEST_TRANSPORT_FILE: fixtureFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
const results = [];
const accessibility = [];
let browser;
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
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
  assert.ok(ready, output);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  });
  for (const width of [1440, 820, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: width > 700 ? 1000 : 844 },
      reducedMotion: "reduce",
      isMobile: width < 700,
      hasTouch: width < 700,
    });
    await context.route("**/*", (route) =>
      route.request().url().startsWith(base) ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    const audit = async (view) => {
      if (![1440, 390].includes(width)) return;
      const report = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      const violations = report.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        targets: item.nodes.map((node) => node.target),
      }));
      accessibility.push({ width, view, violations });
      await writeFile(
        join(evidence, "accessibility.json"),
        JSON.stringify(accessibility, null, 2),
      );
      assert.deepEqual(
        violations,
        [],
        `Accessibility violations in ${width}px ${view}`,
      );
    };
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const nav = (name) =>
      width < 700
        ? page
            .getByRole("navigation", { name: "Mobile navigation" })
            .getByRole("button", { name, exact: true })
        : page
            .getByRole("complementary", { name: "Main navigation" })
            .getByRole("button", { name: new RegExp(`^${name}`) });
    const fit = async () =>
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `No ${width}px overflow`,
      );
    await page.goto(base);
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in securely" }).click();
    await page
      .getByRole("heading", { name: "Your money", exact: true })
      .waitFor();
    if (width === 1440) {
      const onboarding = page.getByRole("dialog", { name: "Welcome to AGUS" });
      await onboarding.waitFor();
      await audit("onboarding");
      await page.screenshot({
        path: join(evidence, "1440-onboarding.png"),
        fullPage: true,
      });
      await onboarding.getByRole("button", { name: "Skip for now" }).click();
      await onboarding.waitFor({ state: "hidden" });
      await page.reload();
      await page
        .getByRole("heading", { name: "Your money", exact: true })
        .waitFor();
      assert.equal(
        await onboarding.count(),
        0,
        "Onboarding completion persists after reload",
      );
      await nav("Settings").click();
      await page.getByRole("button", { name: "Explore AGUS" }).click();
      await onboarding.getByRole("button", { name: "Make a payment" }).click();
      await page.getByRole("textbox", { name: "Message AGUS" }).waitFor();
      assert.equal(
        await page.getByRole("textbox", { name: "Message AGUS" }).inputValue(),
        "Send ",
      );
      await nav("Home").click();
    }
    await fit();
    await audit("overview");
    await page
      .getByRole("button", { name: "Hide amounts", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Show amounts", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Collapse financial summary" })
      .click();
    await page
      .getByRole("button", { name: "Expand financial summary" })
      .click();
    await page.screenshot({
      path: join(evidence, `${width}-overview.png`),
      fullPage: true,
    });
    await nav("Obligations").click();
    await page
      .getByRole("main")
      .getByRole("button", { name: "New obligation" })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("What’s it for?")
      .fill(`Fictional identity project ${width}`);
    await dialog
      .getByLabel("Who’s it with?")
      .fill("Example Studio (fictional)");
    await dialog.getByLabel("Amount", { exact: true }).fill("5");
    await dialog.getByRole("button", { name: "Save obligation" }).click();
    await page
      .getByRole("heading", {
        name: `Fictional identity project ${width}`,
        exact: true,
      })
      .waitFor();
    await dialog
      .getByRole("button", { name: "Prepare payment request" })
      .click();
    await dialog
      .getByLabel("Your Stellar testnet receiving address")
      .fill(recipient);
    await dialog
      .getByRole("checkbox", { name: "I control this receiving address" })
      .check();
    await dialog
      .getByRole("button", { name: "Create testnet payment request" })
      .click();
    await dialog
      .getByRole("heading", { name: "Awaiting your client’s payment" })
      .waitFor();
    await dialog
      .getByRole("img", { name: "Testnet payment request QR code" })
      .waitFor();
    await dialog.getByLabel("Transaction ID to check").fill("0".repeat(64));
    await dialog
      .getByRole("button", { name: "Check receiving evidence" })
      .click();
    await dialog
      .getByRole("alert")
      .filter({ hasText: "not found on Stellar testnet" })
      .waitFor();
    let state = await (await context.request.get(`${base}/api/product`)).json();
    const inv = state.invoices.find(
      (i) => i.title === `Fictional identity project ${width}`,
    );
    const request = state.requests.find((r) => r.invoiceId === inv.id);
    assert.equal(inv.state, "open");
    assert.equal(request.state, "pending");
    const auth = await context.request.post(`${base}/api/product/invoices`, {
      headers: { origin: "https://hostile.invalid" },
      data: { id: "ignored" },
    });
    assert.equal(auth.status(), 403);
    await writeFile(fixtureFile, JSON.stringify(request));
    await dialog.getByLabel("Transaction ID to check").fill("a".repeat(64));
    // Use a distinct tx hash per viewport; only first verifies the mocked receipt.
    if (width === 1440) {
      await dialog
        .getByRole("button", { name: "Check receiving evidence" })
        .click();
      await dialog
        .getByRole("heading", { name: "Receiving evidence verified" })
        .waitFor();
      await dialog
        .getByRole("button", { name: "Download verified receipt" })
        .waitFor();
      state = await (await context.request.get(`${base}/api/product`)).json();
      assert.equal(
        state.invoices.find((i) => i.id === inv.id).state,
        "settled",
      );
      await page.screenshot({
        path: join(evidence, "1440-mocked-stellar-confirmed.png"),
        fullPage: true,
      });
    } else {
      await page.screenshot({
        path: join(evidence, `${width}-pending-request.png`),
        fullPage: true,
      });
    }
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await nav("Accounts").click();
    if (width === 1440) {
      await page
        .getByRole("button", { name: "Import statement", exact: true })
        .click();
      await dialog
        .getByLabel("Account label")
        .fill("Fictional imported account");
      await dialog.getByLabel("Institution").fill("Fictional sample bank");
      await dialog.getByLabel("Last four digits").fill("1234");
      await dialog
        .getByLabel("CSV statement")
        .setInputFiles("public/demo/sample-statement.csv");
      await dialog
        .getByRole("button", { name: "Import statement", exact: true })
        .click();
      await page
        .getByText("Fictional imported account", { exact: true })
        .waitFor();
    }
    await fit();
    await page.screenshot({
      path: join(evidence, `${width}-accounts.png`),
      fullPage: true,
    });
    await audit("accounts");
    await nav(width < 700 ? "AGUS" : "Ask AGUS").click();
    await page.getByRole("button", { name: "My financial summary" }).click();
    await page
      .getByText(/combined balance anchored to your imported Naira statements/)
      .waitFor();
    await fit();
    await page.screenshot({
      path: join(evidence, `${width}-assistant.png`),
      fullPage: true,
    });
    await audit("assistant");
    await nav("Home").click();
    const beforePlans = await (
      await context.request.get(`${base}/api/product/payment-plans`)
    ).json();
    await page
      .getByRole("textbox", { name: "Ask AGUS", exact: true })
      .fill("Send Daniel 10 USDC");
    await page.getByRole("button", { name: "Start conversation" }).click();
    const composer = page.getByRole("textbox", { name: "Message AGUS" });
    await dialog
      .getByRole("heading", { name: "Review payment", exact: true })
      .waitFor();
    const afterPlans = await (
      await context.request.get(`${base}/api/product/payment-plans`)
    ).json();
    assert.equal(
      afterPlans.plans.length,
      beforePlans.plans.length + 1,
      "Home creates exactly one payment proposal",
    );
    await dialog
      .getByRole("textbox", { name: "Exact recipient address", exact: true })
      .fill(recipient);
    await dialog
      .getByRole("checkbox", { name: "I checked the recipient address" })
      .check();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog
      .getByRole("heading", { name: "This payment is blocked." })
      .waitFor();
    await audit("payment-review");
    assert.equal(
      await dialog
        .getByRole("button", { name: "Approve exact test payment" })
        .count(),
      0,
    );
    await page.screenshot({
      path: join(evidence, `${width}-conversation-payment-blocked.png`),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    if (width === 390) {
      await composer.fill("Send Daniel 0.2 ZEC privately");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await dialog
        .getByRole("heading", { name: "Private payment", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Privacy Mode", exact: true })
          .getAttribute("aria-pressed"),
        "true",
      );
      const eyesClosed = await page
        .locator('[aria-label="AGUS companion"] > span')
        .first()
        .evaluate((eye) => getComputedStyle(eye).height);
      assert.equal(eyesClosed, "2px");
      await dialog
        .getByRole("textbox", { name: "Exact recipient address", exact: true })
        .fill(zaddr);
      await dialog
        .getByRole("checkbox", {
          name: "I checked the recipient address",
        })
        .check();
      await dialog
        .getByRole("button", { name: "Continue", exact: true })
        .click();
      await dialog.getByText(/Shielded sending is unavailable/).waitFor();
      assert.equal(
        await dialog
          .getByRole("button", { name: "Approve exact test payment" })
          .count(),
        0,
      );
      await page.screenshot({
        path: join(evidence, "390-privacy-mode-blocked.png"),
        fullPage: true,
      });
      await dialog.getByRole("button", { name: "Close dialog" }).click();
      await composer.fill("Send Daniel 0.2 BTC privately");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await dialog.getByText(/does not make a BTC payout private/).waitFor();
      await dialog.getByRole("button", { name: "Close dialog" }).click();
    }
    await nav("Activity").click();
    await fit();
    await page.screenshot({
      path: join(evidence, `${width}-activity.png`),
      fullPage: true,
    });
    if (width === 390) {
      await nav("Obligations").click();
      await page
        .getByRole("main")
        .getByRole("button", { name: "New obligation" })
        .click();
      await dialog
        .getByLabel("What’s it for?")
        .fill("Fictional Zcash milestone");
      await dialog.getByLabel("Who’s it with?").fill("Private demo client");
      await dialog.getByLabel("Amount", { exact: true }).fill("0.01");
      await dialog.getByLabel("Asset", { exact: true }).selectOption("ZEC");
      await dialog.getByRole("button", { name: "Save obligation" }).click();
      await dialog
        .getByRole("button", { name: "Prepare payment request" })
        .click();
      await dialog
        .getByLabel("Your Sapling testnet receiving address")
        .fill(zaddr);
      await dialog
        .getByRole("checkbox", { name: "I control this receiving address" })
        .check();
      await dialog
        .getByRole("button", { name: "Create testnet payment request" })
        .click();
      await dialog
        .getByRole("heading", { name: "Awaiting your client’s payment" })
        .waitFor();
      state = await (await context.request.get(`${base}/api/product`)).json();
      const zi = state.invoices.find(
        (i) => i.title === "Fictional Zcash milestone",
      );
      const zr = state.requests.find((r) => r.invoiceId === zi.id);
      assert.ok(zr.uri.startsWith("zcash:ztestsapling1"));
      await writeFile(fixtureFile, JSON.stringify(zr));
      await dialog.getByLabel("Transaction ID to check").fill("b".repeat(64));
      await dialog
        .getByRole("button", { name: "Check receiving evidence" })
        .click();
      await dialog
        .getByRole("heading", { name: "Receiving evidence verified" })
        .waitFor();
      await page.screenshot({
        path: join(evidence, "390-mocked-zcash-confirmed.png"),
        fullPage: true,
      });
      await dialog.getByRole("button", { name: "Close dialog" }).click();
    }
    if (width < 700)
      await page.getByRole("button", { name: "Open settings" }).click();
    else
      await page
        .getByRole("complementary")
        .getByRole("button", { name: "Settings", exact: true })
        .click();
    await page.getByRole("switch", { name: "Mask sensitive amounts" }).click();
    await fit();
    await audit("settings");
    await page
      .getByRole("main")
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await page.getByRole("button", { name: "Sign in securely" }).waitFor();
    assert.equal(
      (await context.request.get(`${base}/api/product`)).status(),
      401,
    );
    assert.deepEqual(errors, []);
    results.push({
      width,
      passed: true,
      noOverflow: true,
      jsErrors: errors,
      verificationTransport: "MOCKED; no genuine chain settlement claimed",
    });
    await context.close();
  }
  await writeFile(
    join(evidence, "results.json"),
    JSON.stringify(
      {
        results,
        note: "All sponsor settlement evidence in this browser test is mocked transport. Genuine network verification requires configured receiving wallets and real testnet transactions.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results, null, 2));
} catch (e) {
  console.error(e);
  console.error(output.slice(-5000));
  process.exitCode = 1;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  await rm(directory, { recursive: true, force: true });
}
