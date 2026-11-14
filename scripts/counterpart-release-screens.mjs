/* global document, innerWidth */
import { chromium } from "playwright";
import { URL } from "node:url";
import { X509Certificate, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const base =
    process.env.AGUS_ACCEPTANCE_ORIGIN ?? "https://agusweb.up.railway.app",
  dir = "docs/release-pass/live";
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

await mkdir(dir, { recursive: true });
const report = { url: base, screens: [], errors: [] };
try {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
    reducedMotion: "reduce",
  });
  const p = await c.newPage();
  p.on("pageerror", (e) => report.errors.push(e.message));
  await p.goto(base);
  await p.getByLabel("Operator password", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Sign in securely" }).click();
  await p.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  const nav = () => p.getByRole("complementary", { name: "Main navigation" });
  await nav().getByRole("button", { name: "Settings", exact: true }).click();
  await p.getByRole("button", { name: "Explore AGUS", exact: true }).click();
  const welcome = p.getByRole("dialog", {
    name: "Welcome to AGUS",
    exact: true,
  });
  await welcome.waitFor();
  await p.screenshot({ path: dir + "/1440-onboarding.png" });
  await welcome
    .getByRole("button", { name: "Skip for now", exact: true })
    .click();
  await p.reload();
  await p.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  if (await welcome.isVisible())
    throw Error("Onboarding completion did not persist");
  report.onboardingReopenSkipPersist = true;
  for (const width of [1440, 390, 320]) {
    await p.setViewportSize({ width, height: width === 1440 ? 1040 : 900 });
    const n = () =>
      width < 700
        ? p.getByRole("navigation", { name: "Mobile navigation" })
        : nav();
    for (const name of ["Home", "Money", "Obligations", "Activity", "AGUS"]) {
      await n().getByRole("button", { name, exact: true }).click();
      await p.evaluate(() => document.fonts.ready);
      if (name === "Money")
        await p.getByText(/Live Testnet · block/).waitFor({ timeout: 15000 });
      if (
        await p.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        )
      )
        throw Error("Overflow " + width + name);
      await p.screenshot({
        path: dir + `/${width}-${name.toLowerCase()}.png`,
        fullPage: name === "Money",
      });
      report.screens.push({ width, name, overflow: false });
    }
  }
  await p
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Money", exact: true })
    .click();
  await p.getByRole("button", { name: "Add account", exact: true }).click();
  const picker = p.getByRole("dialog", { name: "Add account", exact: true });
  await picker.waitFor();
  report.addChoices = await picker.getByRole("button").allTextContents();
  await p.screenshot({ path: dir + "/320-add-account.png" });
  await p.getByRole("button", { name: "Close dialog", exact: true }).click();
  await p
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "AGUS", exact: true })
    .click();
  await p.getByRole("button", { name: "Receive ZEC", exact: true }).click();
  await p
    .getByRole("dialog", { name: "New obligation", exact: true })
    .waitFor();
  if ((await p.getByLabel("Asset", { exact: true }).inputValue()) !== "ZEC")
    throw Error("Receive action must select ZEC");
  if (
    (await p
      .locator('[data-counterpart="true"]')
      .getAttribute("data-privacy")) !== "true"
  )
    throw Error("Receive action must activate privacy mode");
  await p.screenshot({ path: dir + "/320-zcash-receive.png" });
  report.receiveDiscoverableFromConversation = true;
  await writeFile(dir + "/screens.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
