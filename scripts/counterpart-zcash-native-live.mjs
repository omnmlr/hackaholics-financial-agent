/* global AbortSignal */
import { chromium } from "playwright";
import { URL } from "node:url";
import { X509Certificate, createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const base =
    process.env.AGUS_ACCEPTANCE_ORIGIN ?? "https://agusweb.up.railway.app",
  dir = process.env.AGUS_ZCASH_CASE
    ? `docs/zcash-native/live/${process.env.AGUS_ZCASH_CASE}`
    : "docs/zcash-native/live";
const amount = process.env.AGUS_ZCASH_AMOUNT ?? "0.125";
const title =
  process.env.AGUS_ZCASH_TITLE ?? "Hackathon receiving demonstration";
const externalFunding = process.env.ZCASH_WATCH_EXTERNAL === "true";
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
  classification:
    "REAL native wallet, real Gemini; no synthetic payment transport",
  url: base,
  errors: [],
};
const { token: walletToken } = JSON.parse(
  await readFile(".data/zcash-receiving/credentials.json"),
);
let page;
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(base);
  await page.getByLabel("Operator password", { exact: true }).fill(password);
  await page
    .getByRole("button", { name: "Sign in securely", exact: true })
    .click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  const welcome = page.getByRole("dialog", { name: "Welcome to AGUS" });
  if (await welcome.isVisible())
    await welcome.getByRole("button", { name: "Skip for now" }).click();
  report.responsibilitiesBefore = (
    await (await context.request.get(base + "/api/agent-workspace")).json()
  ).tasks.map(({ id, state, version }) => ({ id, state, version }));
  const nav = () =>
    page.getByRole("complementary", { name: "Main navigation" });
  await nav().getByRole("button", { name: "Money", exact: true }).click();
  const walletResponse = await context.request.get(
    base + "/api/product/zcash-wallet",
  );
  assert.equal(walletResponse.status(), 200);
  report.walletBefore = await walletResponse.json();
  assert.equal(report.walletBefore.signingAvailable, false);
  await page.screenshot({
    path: dir + "/1440-native-wallet.png",
    fullPage: true,
  });
  const checkpoint = process.env.AGUS_ZCASH_CASE
    ? `.data/zcash-receiving/live-invoice-${process.env.AGUS_ZCASH_CASE}.json`
    : ".data/zcash-receiving/live-invoice.json";
  let saved;
  try {
    saved = JSON.parse(await readFile(checkpoint));
  } catch {
    /* first run */
  }
  if (!saved) {
    await nav().getByRole("button", { name: "AGUS", exact: true }).click();
    await page
      .getByRole("button", { name: "New conversation", exact: true })
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
        `Abeg create a private Testnet ZEC receiving invoice for exactly ${amount} ZEC from Public Testnet faucet. Title: ${title}. This is a testnet receiving demo. Do not send money or activate a reminder.`,
      );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const reply = await response;
    const data = await reply.json();
    report.gemini = {
      status: reply.status(),
      reply: data.reply?.text,
      steps: data.reply?.execution?.steps,
    };
    assert.equal(reply.status(), 200);
    assert.ok(
      data.reply?.zcashInvoiceId,
      "Gemini generated a native receiving invoice",
    );
    assert.ok(
      data.reply.execution.steps.some(
        (s) =>
          s.tool === "create_private_zec_invoice" && s.state === "succeeded",
      ),
    );
    saved = {
      invoiceId: data.reply.zcashInvoiceId,
      conversationId: data.conversationId,
      gemini: report.gemini,
    };
    await writeFile(checkpoint, JSON.stringify(saved), { mode: 0o600 });
    await page
      .getByText("Thinking…", { exact: true })
      .waitFor({ state: "hidden", timeout: 30000 });
    await page.screenshot({ path: dir + "/1440-gemini-created-invoice.png" });
    await page
      .getByRole("button", { name: "View private invoice", exact: true })
      .last()
      .click();
  } else {
    report.gemini = saved.gemini;
    await nav()
      .getByRole("button", { name: /^Obligations(?:$|\s)/ })
      .click();
    const p = await (await context.request.get(base + "/api/product")).json();
    const inv = p.invoices.find((i) => i.id === saved.invoiceId);
    await page
      .getByRole("button")
      .filter({ hasText: inv.title })
      .first()
      .click();
  }
  let product = await (await context.request.get(base + "/api/product")).json();
  let invoice = product.invoices.find((i) => i.id === saved.invoiceId);
  let request = product.requests.find(
    (r) => r.invoiceId === invoice.id && r.nativeWallet,
  );
  assert.ok(request);
  assert.equal(request.amount, amount);
  report.invoiceId = invoice.id;
  report.requestId = request.id;
  report.address = request.recipient;
  report.initialState = request.state;
  report.acceptanceResumedAfterSettlement = request.state === "confirmed";
  report.reminderBefore = (
    await (await context.request.get(base + "/api/agent-workspace")).json()
  ).tasks.find((t) => t.id === invoice.responsibilityId)?.state;
  const native = async () => {
    const r = await fetch(
      "https://agus-zcash-receiving-production.up.railway.app/invoices/" +
        request.nativeWallet.invoiceKey,
      {
        headers: { Authorization: "Bearer " + walletToken },
        signal: AbortSignal.timeout(15000),
      },
    );
    assert.equal(r.status, 200);
    return r.json();
  };
  report.receivingWalletBefore = await native();
  if (request.state === "pending")
    await page
      .getByRole("img", { name: "Testnet payment request QR code" })
      .waitFor({ timeout: 20000 });
  if (request.state === "pending")
    await page.screenshot({ path: dir + "/1440-private-request-qr.png" });
  await page.setViewportSize({ width: 390, height: 900 });
  if (request.state === "pending") {
    await page
      .getByRole("img", { name: "Testnet payment request QR code" })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: dir + "/390-private-request-qr.png" });
  }
  await writeFile(
    dir + "/receiving-acceptance.json",
    JSON.stringify(report, null, 2),
  );
  if (process.env.ZCASH_FUND_FROM_FAUCET !== "true" && !externalFunding) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const claimPath = ".data/zcash-receiving/faucet-claim.json";
    let claim = externalFunding
      ? {
          status: 202,
          address: request.recipient,
          data: { id: "external-funding" },
        }
      : undefined;
    try {
      if (!externalFunding) claim = JSON.parse(await readFile(claimPath));
    } catch {
      /* only claim once */
    }
    if (!claim) {
      const response = await fetch(
        "https://faucet.testnet.valargroup.dev/api/claim",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: request.recipient }),
          signal: AbortSignal.timeout(20000),
        },
      );
      claim = {
        status: response.status,
        data: await response.json(),
        address: request.recipient,
        requestedAt: new Date().toISOString(),
      };
      await writeFile(claimPath, JSON.stringify(claim), { mode: 0o600 });
    }
    assert.equal(
      claim.address,
      request.recipient,
      "Do not fund another invoice by accident",
    );
    report.faucet = externalFunding
      ? JSON.parse(
          await readFile(".data/zcash-receiving/pow-faucet-claim.json"),
        )
      : claim;
    await writeFile(
      dir + "/receiving-acceptance.json",
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        event: externalFunding ? "native-wallet-monitor-start" : "faucet-claim",
        status: claim.status,
        claimId: externalFunding ? report.faucet.claimId : claim.data.id,
        invoiceId: invoice.id,
        address: request.recipient,
      }),
    );
    if (claim.status !== 202)
      throw Error("Faucet did not accept funding; no settlement claimed");
    for (let round = 0; round < 80; round++) {
      await new Promise((r) => setTimeout(r, 10000));
      const response = !externalFunding
        ? await fetch(
            "https://faucet.testnet.valargroup.dev/api/claim/" + claim.data.id,
            { signal: AbortSignal.timeout(15000) },
          )
        : null;
      report.faucetObservation = externalFunding
        ? {
            classification:
              "Native-wallet-only monitoring; provider proof recorded separately",
          }
        : { status: response.status, data: await response.json() };
      const observation = await native();
      report.receivingWalletAfter = observation;
      product = await (await context.request.get(base + "/api/product")).json();
      request = product.requests.find((r) => r.id === request.id);
      invoice = product.invoices.find((i) => i.id === invoice.id);
      console.log(
        JSON.stringify({
          event: "independent-wallet-poll",
          round,
          claim: externalFunding
            ? "independent native-wallet observation"
            : report.faucetObservation.data.status,
          outputs: observation.outputs.map((o) => ({
            txid: o.transactionId,
            amountAtoms: o.amountAtoms,
            confirmations: o.confirmations,
            pool: o.pool,
          })),
          request: request.state,
          invoice: invoice.state,
        }),
      );
      if (
        !externalFunding &&
        report.faucetObservation.data.status === "failed" &&
        observation.outputs.length === 0
      ) {
        report.externalBlocker = report.faucetObservation.data.message;
        await writeFile(
          dir + "/receiving-acceptance.json",
          JSON.stringify(report, null, 2),
        );
        throw Error(
          "Faucet definitively failed; invoice remains unpaid: " +
            report.externalBlocker,
        );
      }
      if (request.state === "confirmed") {
        assert.equal(invoice.state, "settled");
        assert.equal(request.evidence.source, "zcash-receiving-wallet");
        assert.ok(request.evidence.confirmations >= 3);
        assert.equal(request.evidence.amount, amount);
        assert.ok(
          observation.outputs.some(
            (o) =>
              o.transactionId === request.evidence.transactionId &&
              BigInt(o.amountAtoms) ===
                BigInt(Math.round(Number(amount) * 100000000)) &&
              o.confirmations >= 3,
          ),
        );
        report.receipt = request;
        report.invoice = invoice;
        report.reminderAfter = (
          await (
            await context.request.get(base + "/api/agent-workspace")
          ).json()
        ).tasks.find((t) => t.id === invoice.responsibilityId);
        assert.equal(report.reminderAfter.state, "completed");
        const workspaceAfter = await (
          await context.request.get(base + "/api/agent-workspace")
        ).json();
        report.reminderAudit = workspaceAfter.events.filter(
          (e) => e.task === invoice.responsibilityId,
        );
        assert.ok(
          report.reminderAudit.some((e) => e.kind === "settlement_verified"),
        );
        for (const original of report.responsibilitiesBefore) {
          if (original.id === invoice.responsibilityId) continue;
          const current = workspaceAfter.tasks.find(
            (t) => t.id === original.id,
          );
          assert.equal(current.state, original.state);
          assert.equal(current.version, original.version);
        }
        report.existingResponsibilitiesUntouched = true;
        report.automaticSettlementWithoutManualVerification = true;
        report.audit = product.events.filter((e) => e.invoiceId === invoice.id);
        report.walletAfter = await (
          await context.request.get(base + "/api/product/zcash-wallet")
        ).json();
        const historyResponse = await context.request.get(
          base +
            "/api/conversations?id=" +
            encodeURIComponent(saved.conversationId),
        );
        assert.equal(historyResponse.status(), 200);
        const history = await historyResponse.json();
        assert.ok(
          history.turns.some(
            (turn) => turn.reply?.zcashInvoiceId === invoice.id,
          ),
        );
        report.savedConversationRestored = true;
        report.verifiedApplicationCommit = process.env.AGUS_VERIFIED_COMMIT;
        const receiptDialog = page.getByRole("dialog");
        assert.equal(
          await receiptDialog
            .getByText("Awaiting payment evidence", { exact: true })
            .count(),
          0,
        );
        assert.equal(
          await receiptDialog
            .getByText(/This request is not a receipt/)
            .count(),
          0,
        );
        await page
          .getByRole("heading", {
            name: `${amount} ZEC received on testnet`,
            exact: true,
          })
          .waitFor({ timeout: 45000 });
        await page
          .getByRole("heading", {
            name: `${amount} ZEC received on testnet`,
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: dir + "/390-real-native-receipt.png" });
        await page.setViewportSize({ width: 1440, height: 1040 });
        await page
          .getByRole("heading", {
            name: `${amount} ZEC received on testnet`,
            exact: true,
          })
          .scrollIntoViewIfNeeded();
        await page.screenshot({ path: dir + "/1440-real-native-receipt.png" });
        await writeFile(
          dir + "/receiving-acceptance.json",
          JSON.stringify(report, null, 2),
        );
        console.log(
          "REAL native-wallet receipt and automatic AGUS settlement verified",
        );
        break;
      }
      await writeFile(
        dir + "/receiving-acceptance.json",
        JSON.stringify(report, null, 2),
      );
      if (round === 79)
        throw Error(
          "No independently verified receipt before acceptance timeout",
        );
    }
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = error.message;
  await writeFile(
    dir + "/receiving-acceptance.json",
    JSON.stringify(report, null, 2),
  );
  await page
    ?.screenshot({ path: dir + "/acceptance-failure.png" })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
}
