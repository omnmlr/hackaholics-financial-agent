/* global document, innerWidth */
// Actual local production server. Synthetic records stay in the isolated preview
// database. One optional genuine Gemini request; never payment execution.
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const base = "http://localhost:3140";
const evidence = "docs/counterpart-implementation";
await mkdir(evidence, { recursive: true });
const password = await readFile(
  ".data/agus-web-preview/operator-password",
  "utf8",
);
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
});
const results = [];
let contextProof;
try {
  contextProof = JSON.parse(
    await readFile(`${evidence}/genuine-context.json`, "utf8"),
  );
} catch {
  /* optional genuine evidence */
}
let inspectedPage;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  inspectedPage = page;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.screenshot({ path: `${evidence}/desktop-sign-in.png` });
  await page.getByLabel("Operator password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  const onboarding = page.getByRole("dialog", { name: "Welcome to AGUS" });
  if (await onboarding.isVisible())
    await onboarding.getByRole("button", { name: "Skip for now" }).click();
  const state = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  assert.equal(state.mode, "fixture");
  assert.equal(
    state.operator,
    "agus-web-preview-operator",
    "Refuse to seed a non-preview owner",
  );
  const config = await page.evaluate(async () =>
    (await fetch("/api/product")).json(),
  );
  await page.screenshot({
    path: `${evidence}/desktop-home-${config.accounts.length ? "imported" : "empty"}.png`,
  });
  // Explicit opt-in import, through the real UI, into this preview owner only.
  if (
    process.env.COUNTERPART_IMPORT_SAMPLE === "true" &&
    !config.accounts.length
  ) {
    await page
      .getByRole("button", { name: "Add account", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Add account", exact: true })
      .getByRole("button", { name: /Import bank statement/ })
      .click();
    const importer = page.getByRole("dialog", {
      name: "Import statement",
      exact: true,
    });
    await importer
      .getByLabel("Account label")
      .fill("Fictional preview account");
    await importer.getByLabel("Institution").fill("Synthetic statement only");
    await importer.getByLabel("Last four digits").fill("1234");
    await importer
      .getByLabel("CSV statement")
      .setInputFiles("public/demo/sample-statement.csv");
    await importer
      .getByRole("button", { name: "Import statement", exact: true })
      .click();
    await importer.waitFor({ state: "hidden" });
    const imported = await page.evaluate(async () =>
      (await fetch("/api/product")).json(),
    );
    assert.ok(
      imported.accounts.some(
        (account) => account.label === "Fictional preview account",
      ),
    );
  }
  if (process.env.COUNTERPART_GENUINE_AI === "true") {
    await page.evaluate(
      async ({ id }) => {
        const r = await fetch("/api/product/invoices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            title: "Synthetic Counterpart invoice",
            counterparty: "Acceptance records only",
            direction: "payable",
            currency: "USDC",
            amount: "9",
            dueAt: new Date(Date.now() + 86400000).toISOString(),
            note: "Synthetic acceptance record in isolated preview; no payment authorized.",
          }),
        });
        if (!r.ok) throw new Error("Synthetic invoice could not be created");
      },
      { id: randomUUID() },
    );
    await page
      .getByRole("complementary", { name: "Main navigation" })
      .getByRole("button", { name: "AGUS", exact: true })
      .click();
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/conversation") &&
        r.request().method() === "POST",
      { timeout: 90000 },
    );
    await page
      .getByRole("textbox", { name: "Message AGUS" })
      .fill(
        "Abeg, read my AGUS financial snapshot. Wetin I owe for the Synthetic Counterpart invoice? No prepare or send any payment.",
      );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const reply = await response;
    const data = await reply.json();
    const report = {
      genuineProviderRequest: true,
      model: config.capabilities.ai.model,
      httpStatus: reply.status(),
      reply: data.reply?.text,
      steps: data.reply?.execution?.steps.map((s) => ({
        tool: s.tool,
        state: s.state,
      })),
      noPaymentExecutionAuthorized: true,
      syntheticRecordsOnly: true,
    };
    await writeFile(
      `${evidence}/genuine-gemini.json`,
      JSON.stringify(report, null, 2),
    );
    // A provider/quota failure is recorded honestly. There is no inference retry.
    await page.screenshot({ path: `${evidence}/desktop-genuine-agent.png` });
    if (reply.ok()) {
      await page.reload();
      await page
        .getByRole("heading", { name: "Overview", exact: true })
        .waitFor();
      await page
        .getByRole("complementary", { name: "Main navigation" })
        .getByRole("button", { name: "AGUS", exact: true })
        .click();
      await page
        .getByText(data.reply.text, { exact: true })
        .waitFor({ timeout: 15000 });
      results.push({
        genuineGemini: true,
        conversationReload: true,
        steps: report.steps,
      });
    } else
      results.push({
        genuineGemini: false,
        httpStatus: reply.status(),
        automaticRetry: false,
      });
  }
  if (process.env.COUNTERPART_VERIFY_CONTEXT === "true") {
    await page
      .getByRole("complementary", { name: "Main navigation" })
      .getByRole("button", { name: "AGUS", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Saved conversations", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Conversations", exact: true })
      .getByRole("button", { name: /Abeg, read my AGUS financial snapshot/ })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "Conversations", exact: true })
      .waitFor({ state: "hidden" });
    console.log("Opened saved conversation for a context check.");
    const response = page
      .waitForResponse(
        (r) =>
          r.url().endsWith("/api/conversation") &&
          r.request().method() === "POST",
        { timeout: 90000 },
      )
      .then(
        (reply) => ({ reply }),
        (failure) => ({ failure: String(failure) }),
      );
    await page
      .getByRole("textbox", { name: "Message AGUS" })
      .fill(
        "How much was that invoice again, and in which currency? Use our previous conversation. No prepare or send any payment.",
      );
    await page.screenshot({ path: `${evidence}/context-before-send.png` });
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const result = await response;
    if (!result.reply) throw new Error(result.failure);
    const reply = result.reply;
    const data = await reply.json();
    await writeFile(
      `${evidence}/genuine-context.json`,
      JSON.stringify(
        {
          genuineProviderRequest: true,
          httpStatus: reply.status(),
          reply: data.reply?.text,
          steps: data.reply?.execution?.steps.map((s) => ({
            tool: s.tool,
            state: s.state,
          })),
          noPaymentExecutionAuthorized: true,
          automaticRetry: false,
        },
        null,
        2,
      ),
    );
    if (reply.ok()) {
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .waitFor();
      await page
        .getByText("Thinking…", { exact: true })
        .waitFor({ state: "hidden" });
      await page.reload();
      await page
        .getByRole("heading", { name: "Overview", exact: true })
        .waitFor();
      await page
        .getByRole("complementary", { name: "Main navigation" })
        .getByRole("button", { name: "AGUS", exact: true })
        .click();
      await page
        .getByText(data.reply.text.replaceAll("**", ""), { exact: true })
        .waitFor();
      results.push({ genuineContext: true, conversationReload: true });
    } else
      results.push({
        genuineContext: false,
        httpStatus: reply.status(),
        automaticRetry: false,
      });
  }
  const storage = await context.storageState();
  for (const width of [1440, 390, 320]) {
    const c = await browser.newContext({
      viewport: { width, height: width === 1440 ? 1040 : 900 },
      storageState: storage,
      reducedMotion: "reduce",
      isMobile: width < 700,
      hasTouch: width < 700,
    });
    const p = await c.newPage();
    p.on("pageerror", (error) => errors.push(error.message));
    await p.goto(base);
    await p.getByRole("heading", { name: "Overview", exact: true }).waitFor();
    for (const name of ["Home", "AGUS", "Money", "Obligations", "Activity"]) {
      const nav =
        width < 700
          ? p.getByRole("navigation", { name: "Mobile navigation" })
          : p.getByRole("complementary", { name: "Main navigation" });
      await nav
        .getByRole("button", { name: new RegExp(`^${name}(?:$|\\s)`) })
        .click();
      if (name === "AGUS") {
        const history = p.getByRole("button", {
          name: "Saved conversations",
          exact: true,
        });
        await history.click();
        const saved = p
          .getByRole("dialog", { name: "Conversations", exact: true })
          .getByRole("button", {
            name: /Abeg, read my AGUS financial snapshot/,
          })
          .first();
        if (await saved.count()) {
          await saved.click();
          await p
            .getByRole("dialog", { name: "Conversations", exact: true })
            .waitFor({ state: "hidden" });
          if (contextProof?.httpStatus === 200) {
            await p
              .getByText(contextProof.reply.replaceAll("**", ""), {
                exact: true,
              })
              .waitFor();
            results.push({ width, genuineContextRestored: true });
          }
        } else
          await p
            .getByRole("button", { name: "Close dialog", exact: true })
            .click();
      }
      await p.evaluate(() => document.fonts.ready);
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${width}/${name} overflow`,
      );
      await p.screenshot({
        path: `${evidence}/${width}-${name.toLowerCase()}.png`,
        fullPage: false,
      });
      results.push({ width, view: name, overflow: false });
      if (name === "Money") {
        await p
          .getByRole("button", { name: "Add account", exact: true })
          .click();
        await p.screenshot({ path: `${evidence}/${width}-add-account.png` });
        await p
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
      }
    }
    await c.close();
  }
  await writeFile(
    `${evidence}/preview.json`,
    JSON.stringify(
      {
        base,
        configuration: config.capabilities.ai,
        results,
        browserErrors: errors,
        records:
          "Isolated preview only. No Counterpart concept data is seeded.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ results, browserErrors: errors }, null, 2));
  assert.deepEqual(errors, []);
} catch (error) {
  await inspectedPage
    ?.screenshot({ path: `${evidence}/capture-failure.png` })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
