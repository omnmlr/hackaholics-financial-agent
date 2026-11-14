import { chromium } from "playwright";
import { URL } from "node:url";
import { X509Certificate, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const base = "https://agus-counterpart-acceptance-production.up.railway.app",
  dir = "docs/unified-agent/pollar-real";
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
const report = {
  genuineNetwork: true,
  signingAttempted: false,
  credentialsPrinted: false,
};
try {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
    reducedMotion: "reduce",
  });
  const p = await c.newPage();
  p.on("response", async (r) => {
    if (
      r.url().includes("sdk.api.pollar.xyz") &&
      r.url().includes("/applications/config")
    ) {
      const data = await r.json().catch(() => null);
      report.remoteConfigStatus = r.status();
      const app = data?.content?.application;
      report.remoteApplication = app
        ? { name: app.name, network: app.network, chains: app.chains }
        : null;
    }
  });
  await p.goto(base);
  await p.getByLabel("Operator password", { exact: true }).fill(password);
  await p.getByRole("button", { name: "Sign in securely" }).click();
  await p.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  const data = await p.evaluate(async () =>
    (await fetch("/api/product")).json(),
  );
  report.configured = data.capabilities.pollar.configured;
  report.network = data.capabilities.pollar.network;
  report.issuer = data.capabilities.pollar.issuer;
  await p
    .getByRole("complementary", { name: "Main navigation" })
    .getByRole("button", { name: "Money", exact: true })
    .click();
  await p
    .getByRole("button", { name: "Connect with Pollar", exact: true })
    .click();
  await p
    .getByLabel("Your email", { exact: true })
    .waitFor({ timeout: 20000 })
    .catch(() => {});
  report.authenticationFormVisible = await p
    .getByLabel("Your email", { exact: true })
    .isVisible();
  report.error = await p.getByRole("alert").allTextContents();
  await p.screenshot({ path: dir + "/1440-real-onboarding.png" });
  await writeFile(dir + "/results.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
