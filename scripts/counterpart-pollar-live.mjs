/* global location */
import { chromium } from "playwright";
import { URL } from "node:url";
import { X509Certificate, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const base =
    process.env.AGUS_ACCEPTANCE_ORIGIN ?? "https://agusweb.up.railway.app",
  dir = process.env.AGUS_POLLAR_EVIDENCE_DIR ?? "docs/release-pass/pollar";
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
  report.requests = [];
  report.responses = [];
  report.failures = [];
  p.on("request", async (request) => {
    if (request.url().includes("pollar.xyz")) {
      const h = await request.allHeaders();
      report.requests.push({
        method: request.method(),
        url: request.url().split("?")[0],
        origin: h.origin,
        referer: h.referer,
        keyFingerprint: h["x-pollar-api-key"]
          ? createHash("sha256")
              .update(h["x-pollar-api-key"])
              .digest("hex")
              .slice(0, 12)
          : undefined,
      });
    }
  });
  p.on("requestfailed", (request) => {
    if (request.url().includes("pollar.xyz"))
      report.failures.push({
        url: request.url().split("?")[0],
        error: request.failure()?.errorText,
      });
  });
  p.on("response", async (response) => {
    if (response.url().includes("pollar.xyz")) {
      const d = await response.json().catch(() => null);
      report.responses.push({
        url: response.url().split("?")[0],
        status: response.status(),
        code: d?.code,
      });
    }
  });

  p.on("response", async (r) => {
    if (
      r.url().includes("sdk.api.pollar.xyz") &&
      r.url().includes("/applications/config")
    ) {
      const data = await r.json().catch(() => null);
      report.remoteConfigStatus = r.status();
      const app = data?.content?.application;
      report.remoteApplication = app
        ? {
            name: app.name,
            id: app.id,
            network: app.network,
            chains: app.chains,
          }
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
  report.keyFingerprint = createHash("sha256")
    .update(data.capabilities.pollar.publicKey ?? "")
    .digest("hex")
    .slice(0, 12);
  report.browserOrigin = await p.evaluate(() => location.origin);
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
