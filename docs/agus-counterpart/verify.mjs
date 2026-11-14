/* global console, document, innerWidth, getComputedStyle */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { URL } from "node:url";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const results = [],
  errors = [],
  requests = [];
try {
  for (const width of [320, 390, 768, 1024, 1440]) {
    const page = await browser.newPage({
      viewport: { width, height: width < 700 ? 900 : 1040 },
      reducedMotion: "reduce",
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => requests.push(r.url()));
    for (const screen of [
      "home",
      "conversation",
      "accounts",
      "obligations",
      "activity",
      "review",
    ]) {
      await page.goto(`http://127.0.0.1:4190/?screen=${screen}`);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `Horizontal overflow: ${width}/${screen}`,
      );
      const nav = page.getByRole("navigation", {
        name: width < 700 ? "Mobile navigation" : "Main navigation",
      });
      assert.equal(await nav.getByRole("button").count(), 5);
      if (screen === "home") {
        const fits = await page.locator(".total-amount").evaluate((el) => {
          const parent = el.closest(".position-panel").getBoundingClientRect();
          return [...el.children].every(
            (child) => child.getBoundingClientRect().right <= parent.right - 10,
          );
        });
        assert.ok(fits, `Financial total is clipped: ${width}`);
      }
      if (screen === "accounts") {
        await page.locator(".wallet-card.usdc").click();
        assert.ok(
          await page
            .getByRole("dialog")
            .getByText("Polygon · USDC", { exact: true })
            .isVisible(),
        );
        await page.keyboard.press("Escape");
        await page.locator(".wallet-card.zec").click();
        assert.ok(
          await page
            .getByRole("dialog")
            .getByText("Zcash · Shielded pool", { exact: true })
            .isVisible(),
        );
        await page.keyboard.press("Escape");
      }
      assert.ok(
        await page.locator("body").evaluate((el) => {
          const c = getComputedStyle(el).backgroundColor.match(/\d+/g);
          return c.slice(0, 3).every((v) => Number(v) < 25);
        }),
        `Expected black canvas: ${width}/${screen}`,
      );
      assert.ok(
        await page.locator("h1").evaluate((el) => {
          const c = getComputedStyle(el).color.match(/\d+/g);
          return c.slice(0, 3).every((v) => Number(v) > 210);
        }),
        `Expected white heading: ${width}/${screen}`,
      );
      if (screen === "obligations") {
        await page
          .getByRole("button", { name: "Owed to you 1", exact: true })
          .click();
        assert.ok(
          await page
            .locator(".obligations-register")
            .getByText("Kora Studio", { exact: true })
            .isVisible(),
        );
      }
      if (screen === "activity") {
        await page
          .getByRole("textbox", { name: "Search activity" })
          .fill("Kemi");
        assert.equal(
          await page.locator(".activity-feed-row:visible").count(),
          1,
        );
        await page
          .getByRole("textbox", { name: "Search activity" })
          .fill("nothing-matches");
        assert.ok(
          await page
            .getByText("No matching activity.", { exact: true })
            .isVisible(),
        );
        await page.getByRole("textbox", { name: "Search activity" }).fill("");
        await page
          .getByRole("button", { name: "Wallets", exact: true })
          .click();
        assert.equal(
          await page.locator(".activity-feed-row:visible").count(),
          1,
        );
      }
      results.push({ width, screen, overflow: false, navigation: 5 });
    }
    if (width < 700)
      await page
        .getByRole("button", { name: "Continue to authorization" })
        .click();
    const button = page.getByRole("button", {
      name: "Authorize demo payment",
      exact: true,
    });
    assert.ok(await button.isDisabled());
    const checkbox = page.getByRole("checkbox");
    await checkbox.check();
    await page
      .getByLabel("Demo authorization code", { exact: true })
      .fill("111111");
    assert.ok(
      await button.isDisabled(),
      "Incorrect demo code must not authorize",
    );
    await page
      .getByLabel("Demo authorization code", { exact: true })
      .fill("000000");
    await checkbox.uncheck();
    assert.ok(await button.isDisabled(), "Code alone must not authorize");
    await checkbox.check();
    assert.ok(await button.isEnabled());
    await button.click();
    assert.ok(
      await page
        .getByRole("heading", { name: /Authorized.*Not sent/ })
        .isVisible(),
    );
    await page.getByRole("button", { name: "Preview submission" }).click();
    assert.ok(
      await page
        .getByRole("dialog")
        .getByText("Settlement not verified", { exact: true })
        .isVisible(),
    );
    await page.keyboard.press("Escape");
    await page.goto("http://127.0.0.1:4190/?screen=home");
    await page.getByRole("button", { name: "Open in AGUS" }).click();
    assert.ok(
      await page.getByRole("heading", { name: "Studio North" }).isVisible(),
    );
    await page
      .getByRole("button", { name: "Review payment", exact: true })
      .click();
    assert.ok(
      await page.getByRole("heading", { name: "Review payment" }).isVisible(),
    );
    await page.goto("http://127.0.0.1:4190/?screen=accounts");
    await page.getByRole("button", { name: "Hide balances" }).click();
    assert.ok(
      await page
        .locator(".money-value")
        .evaluateAll((els) => els.every((el) => el.textContent === "••••••")),
    );
    await page.getByRole("button", { name: "Show balances" }).click();
    await page.goto("http://127.0.0.1:4190/?screen=conversation");
    await page.getByRole("button", { name: "Saved conversations" }).click();
    assert.ok(await page.getByRole("dialog").isVisible());
    await page.keyboard.press("Escape");
    await page
      .getByRole("textbox", { name: "Message AGUS" })
      .fill("<img src=x onerror=alert(1)>");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await page.getByText("AGUS · SCRIPTED PREVIEW", { exact: true }).waitFor();
    assert.equal(await page.locator("#new-messages img").count(), 0);
    assert.deepEqual(
      await page
        .locator(".ghost .body,.ghost .orbit")
        .evaluateAll((els) =>
          els
            .map((el) => getComputedStyle(el).animationName)
            .filter((name) => name !== "none"),
        ),
      [],
    );
    await page.close();
  }
  const finance = await browser.newPage({
    viewport: { width: 1440, height: 1040 },
  });
  const readValue = (text) => Number(text.replace(/[^0-9.-]/g, ""));
  await finance.goto("http://127.0.0.1:4190/?screen=accounts");
  const total = readValue(
    await finance.locator(".account-total .money-value").innerText(),
  );
  const banks = (
    await finance.locator(".account-balance .money-value").allTextContents()
  ).map(readValue);
  const crypto = (
    await finance.locator(".wallet-fiat .money-value").allTextContents()
  ).map(readValue);
  assert.equal(
    [...banks, ...crypto].reduce((a, b) => a + b, 0),
    total,
    "Displayed bank and crypto values must reconcile to the combined total",
  );
  await finance.goto("http://127.0.0.1:4190/?screen=home");
  const upcoming = (
    await finance.locator(".obligation-row .row-amount").allTextContents()
  ).map(readValue);
  assert.equal(
    upcoming.reduce((a, b) => a + b, 0),
    readValue(await finance.locator(".committed-total strong").innerText()),
    "Upcoming amounts must reconcile",
  );
  await finance.goto("http://127.0.0.1:4190/?screen=review");
  const debit = readValue(
    await finance.locator(".debit-total strong").innerText(),
  );
  const after = readValue(
    await finance.locator(".after-payment .money-value").innerText(),
  );
  assert.equal(
    banks[0] - debit,
    after,
    "Remaining source balance must reconcile to total debit",
  );
  const principal = readValue(
    await finance.locator(".review-amount").innerText(),
  );
  const fee = readValue(
    await finance
      .locator(".review-details>div")
      .nth(2)
      .locator("strong")
      .innerText(),
  );
  assert.equal(principal + fee, debit, "Total debit must include the fee");
  await finance.close();
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every((url) => url.startsWith("http://127.0.0.1:4190/")),
    "External request in the prototype",
  );
  assert.ok(
    !requests.some((url) => url.includes("/api/")),
    "Financial API called",
  );
  await writeFile(
    new URL("./previews/verification-results.json", import.meta.url),
    JSON.stringify(
      {
        result: "passed",
        layouts: results,
        authorization:
          "Explicit review checkbox and correct demo code required; authorization never implies submission or settlement",
        financialConsistency:
          "Bank, wallet, combined balance, upcoming obligations, fees and remaining source balance reconcile",
        browserErrors: errors,
        externalRequests: [],
        financialApiRequests: [],
      },
      null,
      2,
    ),
  );
  console.log(
    `Passed ${results.length} layout checks plus connected payment journey, wallet details, authorization gates, text handling and reduced motion. No API calls.`,
  );
} finally {
  await browser.close();
}
