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
const results = [];
const errors = [];
const requests = [];
try {
  for (const direction of ["orbit", "margin"]) {
    for (const width of [320, 390, 768, 1440, 1920]) {
      const page = await browser.newPage({
        viewport: { width, height: width < 700 ? 844 : 1000 },
        reducedMotion: "reduce",
      });
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => requests.push(request.url()));
      for (const view of [
        "home",
        "assistant",
        "money",
        "obligations",
        "activity",
      ]) {
        await page.goto(
          `http://127.0.0.1:4173/?direction=${direction}&view=${view}`,
        );
        await page.evaluate(() => document.fonts.ready);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          ),
          false,
          `${direction}/${width}/${view}: horizontal overflow`,
        );
        const nav = page.getByRole("navigation", {
          name: width < 700 ? "Mobile navigation" : "Main navigation",
        });
        assert.equal(await nav.getByRole("button").count(), 5);
        if (view === "assistant") {
          const composer = await page.locator(".composer").boundingBox();
          const navigation = await nav.boundingBox();
          if (width < 700)
            assert.ok(
              composer.y + composer.height <= navigation.y,
              "Composer overlaps mobile navigation",
            );
          await page
            .getByRole("button", { name: "Choose a payment method" })
            .click();
          assert.ok(
            (await page
              .getByRole("dialog")
              .getByText("Not integrated", { exact: false })
              .count()) === 2,
          );
          await page.keyboard.press("Escape");
        }
        results.push({
          direction,
          width,
          view,
          horizontalOverflow: false,
          navigationDestinations: 5,
        });
      }
      await page.goto(`http://127.0.0.1:4173/?direction=${direction}`);
      await page
        .getByRole("textbox", { name: "Message AGUS" })
        .fill("Help me think about a payment");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      assert.equal(
        await page.locator(".user-message>p").first().textContent(),
        "Help me think about a payment",
      );
      await page
        .getByRole("textbox", { name: "Message AGUS" })
        .fill("<img src=x onerror=alert(1)>");
      await page
        .getByRole("button", { name: "Send message", exact: true })
        .click();
      await page
        .getByText("This is a scripted visual exploration.", { exact: false })
        .waitFor();
      assert.equal(
        await page.locator("#extra-messages img").count(),
        0,
        "User input must remain plain text",
      );
      if (width < 700) {
        await page.getByRole("button", { name: "Saved conversations" }).click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "New conversation" })
          .click();
        assert.ok(
          await page.getByText("What shall we figure out?").isVisible(),
        );
      }
      await page.goto(`http://127.0.0.1:4173/?direction=${direction}`);
      await page.getByRole("button", { name: "Companion states" }).click();
      for (const state of [
        "Idle",
        "Listening",
        "Thinking",
        "Analyzing",
        "Privacy",
        "Completed",
      ]) {
        const button = page.locator(`[data-state="${state.toLowerCase()}"]`);
        await button.click();
        assert.ok(
          (await button.getAttribute("class")).includes("state-selected"),
        );
      }
      const animations = await page
        .locator(".mascot")
        .evaluateAll((nodes) =>
          nodes
            .flatMap((n) =>
              [...n.querySelectorAll("*")].map(
                (e) => getComputedStyle(e).animationName,
              ),
            )
            .filter((name) => name !== "none"),
        );
      assert.deepEqual(animations, [], "Reduced motion must disable animation");
      await page.keyboard.press("Escape");
      assert.equal(await page.getByRole("dialog").count(), 0);
      await page.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.ok(
    requests.every((url) => url.startsWith("http://127.0.0.1:4173/")),
    "Prototype must remain local and self-contained",
  );
  assert.ok(
    !requests.some((url) => url.includes("/api/")),
    "Prototype must never call financial APIs",
  );
  await writeFile(
    new URL("./previews/verification-results.json", import.meta.url),
    JSON.stringify(
      {
        checks: results,
        interactionChecks: [
          "Home composer preserves submitted text",
          "Scripted reply is explicitly labeled",
          "Message input is escaped as plain text",
          "Payment-method discovery labels proposed networks",
          "Mobile saved conversations and new conversation",
          "Six companion states",
          "Reduced motion disables animation",
          "Escape closes dialogs",
          "Composer stays above mobile navigation",
        ],
        browserErrors: errors,
        externalRequests: [],
        financialApiRequests: [],
        result: "passed",
      },
      null,
      2,
    ),
  );
  console.log(
    `Passed ${results.length} viewport/view combinations and interaction checks. No browser errors, external requests or financial API calls.`,
  );
} finally {
  await browser.close();
}
