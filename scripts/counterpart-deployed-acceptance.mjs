/* global document, innerWidth */
import { chromium } from "playwright";
import { URL } from "node:url";
import { randomUUID, X509Certificate, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base =
    process.env.AGUS_ACCEPTANCE_ORIGIN ?? "https://agusweb.up.railway.app",
  dir = "docs/counterpart-deployment";
const { password } = JSON.parse(
  await readFile(".data/counterpart-railway/access.json", "utf8"),
);
const proxyUrl = process.env.HTTPS_PROXY
  ? new URL(process.env.HTTPS_PROXY)
  : null;
const proxyCertificate = process.env.NODE_EXTRA_CA_CERTS
  ? new X509Certificate(await readFile(process.env.NODE_EXTRA_CA_CERTS))
  : null;
const proxyPin = proxyCertificate
  ? createHash("sha256")
      .update(
        proxyCertificate.publicKey.export({ type: "spki", format: "der" }),
      )
      .digest("base64")
  : null;
const browser = await chromium.launch({
  proxy: proxyUrl
    ? {
        server: proxyUrl.origin,
        username: decodeURIComponent(proxyUrl.username),
        password: decodeURIComponent(proxyUrl.password),
      }
    : undefined,
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: [
    ...(proxyPin ? [`--ignore-certificate-errors-spki-list=${proxyPin}`] : []),
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ],
});
const results = {
  base,
  deployedCommit: "76a6349772326387cb2de9e90652f8c8a02adf58",
  screens: [],
  errors: [],
};
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
    reducedMotion: "reduce",
    permissions: ["microphone"],
  });
  page = await context.newPage();
  page.on("pageerror", (e) => results.errors.push(e.message));
  const unauth = await context.request.get(base + "/api/product");
  assert.equal(unauth.status(), 401);
  results.serverAuthentication = true;
  await page.goto(base);
  await page.getByLabel("Operator password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  let welcome = page.getByRole("dialog", { name: "Welcome to AGUS" });
  if (await welcome.isVisible()) {
    await page.screenshot({ path: dir + "/desktop-onboarding.png" });
    await welcome.getByRole("button", { name: "Skip for now" }).click();
  }
  await page.reload();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  assert.equal(await welcome.count(), 0);
  results.onboardingPersists = true;
  const state = await page.evaluate(async () =>
    (await fetch("/api/product")).json(),
  );
  assert.equal(state.accounts.length, 0);
  results.noSeededBalances = true;
  results.capabilities = state.capabilities;
  const desktopNav = () =>
    page.getByRole("complementary", { name: "Main navigation" });
  await desktopNav().getByRole("button", { name: "AGUS", exact: true }).click();
  if (state.capabilities.ai.configured) {
    const pending = page
      .waitForResponse(
        (r) =>
          r.url().endsWith("/api/conversation") &&
          r.request().method() === "POST",
        { timeout: 90000 },
      )
      .then(
        async (r) => ({ status: r.status(), data: await r.json() }),
        (e) => ({ error: String(e) }),
      );
    await page
      .getByRole("textbox", { name: "Message AGUS" })
      .fill(
        "Abeg, read my financial snapshot and tell me whether I have any imported accounts. Do not create or send any payment.",
      );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const reply = await pending;
    results.gemini = reply.status
      ? {
          status: reply.status,
          reply: reply.data.reply?.text,
          error: reply.data.error,
          steps: reply.data.reply?.execution?.steps?.map((s) => ({
            tool: s.tool,
            state: s.state,
          })),
        }
      : reply;
    await page
      .getByText("Thinking…", { exact: true })
      .waitFor({ state: "hidden", timeout: 90000 });
  } else
    results.gemini = {
      available: false,
      reason: state.capabilities.ai.unavailableReason,
    };
  await page.screenshot({ path: dir + "/desktop-agus-response.png" });
  const storage = await context.storageState();
  for (const width of [1440, 390, 320]) {
    const c = await browser.newContext({
      viewport: { width, height: width === 1440 ? 1040 : 900 },
      storageState: storage,
      isMobile: width < 700,
      hasTouch: width < 700,
      reducedMotion: "reduce",
    });
    const p = await c.newPage();
    p.on("pageerror", (e) => results.errors.push(e.message));
    await p.goto(base);
    await p.getByRole("heading", { name: "Overview", exact: true }).waitFor();
    const nav = () =>
      width < 700
        ? p.getByRole("navigation", { name: "Mobile navigation" })
        : p.getByRole("complementary", { name: "Main navigation" });
    for (const name of ["Home", "Money", "AGUS", "Obligations", "Activity"]) {
      await nav()
        .getByRole("button", { name: new RegExp("^" + name + "(?:$|\\s)") })
        .click();
      await p.evaluate(() => document.fonts.ready);
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await p.screenshot({ path: `${dir}/${width}-${name.toLowerCase()}.png` });
      results.screens.push({ width, name, overflow: false });
    }
    await nav().getByRole("button", { name: "Money", exact: true }).click();
    await p.getByRole("button", { name: "Add account", exact: true }).click();
    const picker = p.getByRole("dialog", { name: "Add account", exact: true });
    assert.ok(
      await picker
        .getByRole("button", { name: /Link Nigerian bank/ })
        .isDisabled(),
    );
    await p.screenshot({ path: `${dir}/${width}-account-picker.png` });
    await picker
      .getByRole("button", { name: /Zcash receiving options/ })
      .click();
    assert.ok(
      await p
        .getByRole("button", { name: /Send ZEC · unavailable/ })
        .isDisabled(),
    );
    await nav()
      .getByRole("button", { name: "Obligations", exact: true })
      .click();
    await p
      .getByRole("main")
      .getByRole("button", { name: "New obligation", exact: true })
      .click();
    await p.getByLabel("What’s it for?").waitFor();
    await p.getByRole("button", { name: "Close dialog", exact: true }).click();
    await c.close();
  }
  await desktopNav()
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Explore AGUS", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Welcome to AGUS" })
    .getByRole("button", { name: "Make a payment" })
    .click();
  assert.equal(
    await page.getByRole("textbox", { name: "Message AGUS" }).inputValue(),
    "Send ",
  );
  results.onboardingReplay = true;
  const existingPlans = await (
    await context.request.get(base + "/api/product/payment-plans")
  ).json();
  const existingDraft = existingPlans.plans.find(
    (p) => p.recipientLabel === "Acceptance check",
  );
  const draft = existingDraft
    ? { status: () => 200, ok: () => true }
    : await context.request.post(base + "/api/product/payment-plans", {
        headers: { origin: base },
        data: {
          id: randomUUID(),
          text: "Send Acceptance check 1 USDC",
          privacyMode: false,
        },
      });
  results.paymentDraftStatus = draft.status();
  assert.ok(draft.ok());
  await desktopNav().getByRole("button", { name: "Home", exact: true }).click();
  await page
    .getByRole("button", { name: "Refresh workspace", exact: true })
    .click()
    .catch(() => {});
  await page.reload();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.screenshot({ path: dir + "/desktop-payment-review.png" });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  results.paymentReview = true;
  await page.goto(base + "/conversation");
  const record = page.getByRole("button", {
    name: "Start recording",
    exact: true,
  });
  results.voice = {
    counterpartComposerControl: false,
    legacyRoute: "/conversation",
    recordButtonPresent: await record.count(),
  };
  if (await record.isVisible()) {
    await record.click();
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .waitFor({ timeout: 15000 });
    await page.screenshot({ path: dir + "/legacy-voice-recording.png" });
    const cancel = page.getByRole("button", {
      name: "Cancel recording",
      exact: true,
    });
    if (await cancel.isVisible()) {
      await cancel.click({ timeout: 2000 });
      results.voice.cancelled = true;
    } else results.voice.browserRecognitionEnded = true;
    results.voice.syntheticRecordingStateObserved = true;
    results.voice.transcriptionTested = false;
  }
  await writeFile(dir + "/acceptance.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} catch (e) {
  await page?.screenshot({ path: dir + "/failure.png" }).catch(() => {});
  await writeFile(dir + "/partial.json", JSON.stringify(results, null, 2));
  throw e;
} finally {
  await browser.close();
}
