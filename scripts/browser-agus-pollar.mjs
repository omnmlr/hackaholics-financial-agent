/* global URL */
// Actual official SDK + browser/API/SQL. All provider/network HTTP is MOCKED.
// No genuine credentials, signing keys, blockchain submissions or balances.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Account,
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-base";
import assert from "node:assert/strict";
const dir = await mkdtemp(join(tmpdir(), "agus-pollar-browser-"));
const evidence = join(process.cwd(), "docs/agus2-web/acceptance");
await mkdir(evidence, { recursive: true });
const fixtureFile = join(dir, "network.json");
await writeFile(fixtureFile, "{}");
const base = "http://localhost:3124",
  password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
// Random public keys only. The test never signs.
const source = Keypair.random().publicKey(),
  recipient = Keypair.random().publicKey(),
  issuer = Keypair.random().publicKey();
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/agus-web-network.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3124",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: `pglite://${join(dir, "db")}`,
      APP_ORIGIN: base,
      OPERATOR_ID: "pollar-browser-only",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      PAYMENT_MODE: "fixture",
      AGUS_WORKSPACE_ENABLED: "true",
      AGUS_AGENT_ARCHITECTURE: "native-gemini",
      FINANCIAL_DEMO_ENABLED: "false",
      AI_PROVIDER: "none",
      AI_API_KEY: "",
      NEXT_PUBLIC_POLLAR_API_KEY: "pk_mock_transport_only",
      POLLAR_TESTNET_USDC_ISSUER: issuer,
      AGUS_TEST_TRANSPORT_FILE: fixtureFile,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "",
  browser,
  page,
  sends = 0,
  quote,
  plan,
  capturedNonce;
const paths = [],
  errors = [];
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try {
      if (output.includes("Ready") && (await fetch(base)).ok) {
        ready = true;
        break;
      }
    } catch { /* production server is starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.ok(ready, output);
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    reducedMotion: "reduce",
  });
  await context.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (url.origin === base) return route.continue();
    if (url.origin !== "https://sdk.api.pollar.xyz") return route.abort();
    if (request.method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": base,
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    paths.push(path);
    let content = {},
      code = "SDK_TEST_TRANSPORT";
    if (path.endsWith("/applications/config")) {
      content = {
        application: {
          name: "Explicit mocked acceptance",
          network: "testnet",
          chains: ["STELLAR"],
        },
        styles: {},
      };
    } else if (path.endsWith("/auth/session")) {
      content = { clientSessionId: "mock-browser-session" };
    } else if (path.endsWith("/auth/email")) {
      content = {};
    } else if (path.endsWith("/auth/email/verify-code")) {
      code = "SDK_EMAIL_CODE_VERIFIED";
    } else if (path.includes("/auth/session/status/"))
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "access-control-allow-origin": base,
        },
        body: 'data: {"status":"READY"}\n\n',
      });
    else if (path.endsWith("/auth/login")) {
      code = "SDK_LOGIN_SUCCESS";
      content = {
        clientSessionId: "mock-browser-session",
        userId: "mock-user",
        status: "READY",
        token: {
          accessToken: "test-transport-not-a-real-token",
          refreshToken: "test-refresh-not-real",
          expiresAt: Date.now() + 3600000,
        },
        user: { id: "mock-user", ready: true },
        wallet: {
          type: "internal",
          address: source,
          chain: "STELLAR",
          provisioning: "READY",
          existsOnStellar: true,
        },
      };
    } else if (path.endsWith("/wallet/balance")) {
      content = {
        chains: [
          {
            chain: "STELLAR",
            network: "testnet",
            exists: true,
            balances: [
              {
                type: "credit_alphanum4",
                code: "USDC",
                issuer,
                balance: "50.0000000",
                available: "50.0000000",
                enabledInApp: true,
              },
            ],
          },
        ],
      };
    } else if (path.endsWith("/cosign/requests")) {
      content = { requests: [] };
    } else if (path.endsWith("/wallet/assets")) {
      content = { chains: [{ chain: "STELLAR", exists: true, assets: [] }] };
    } else if (path.endsWith("/tx/build")) {
      const body = request.postDataJSON();
      assert.equal(body.address, source);
      assert.equal(body.params.destination, recipient);
      assert.equal(body.params.amount, "10");
      assert.equal(body.options.memo.value, plan.memo);
      const tx = new TransactionBuilder(new Account(source, "1"), {
        fee: "100",
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(
          Operation.payment({
            destination: recipient,
            amount: "10",
            asset: new Asset("USDC", issuer),
          }),
        )
        .addMemo(Memo.text(plan.memo))
        .setTimeout(180)
        .build();
      quote = {
        unsignedXdr: tx.toXDR(),
        networkPassphrase: Networks.TESTNET,
        transactionHash: tx.hash().toString("hex"),
      };
      content = quote;
      await writeFile(
        fixtureFile,
        JSON.stringify({
          outgoing: true,
          confirmed: false,
          transactionHash: quote.transactionHash,
          memo: plan.memo,
        }),
      );
    } else if (path.endsWith("/tx/sign-and-send")) {
      sends++;
      assert.equal(request.postDataJSON().unsignedXdr, quote.unsignedXdr);
      assert.equal(sends, 1);
      // Provider success alone MUST NOT settle the obligation.
      content = { hash: quote.transactionHash, status: "SUCCESS" };
    } else if (path.endsWith("/auth/logout")) {
      content = {};
    } else
      return route.fulfill({
        status: 404,
        json: { success: false, code: "UNEXPECTED_MOCK_PATH" },
      });
    return route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": base },
      json: { success: true, code, content },
    });
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", async (response) => {
    if (response.url().endsWith("/approve") && response.ok())
      capturedNonce = (await response.json()).nonce;
  });
  await page.goto(base);
  await page.getByLabel("Operator password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page
    .getByRole("dialog", { name: "Welcome to AGUS" })
    .getByRole("button", { name: "Skip for now" })
    .click();
  const invoice = await context.request.post(`${base}/api/product/invoices`, {
    headers: { origin: base },
    data: {
      id: randomUUID(),
      title: "Fictional browser payable",
      counterparty: "Example recipient",
      direction: "payable",
      currency: "USDC",
      amount: "10",
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      note: "Mocked transport acceptance only",
    },
  });
  assert.equal(invoice.status(), 201);
  const savedInvoice = await invoice.json();
  await page.reload();
  await page
    .getByRole("heading", { name: "Your money", exact: true })
    .waitFor();
  await page
    .getByRole("textbox", { name: "Ask AGUS", exact: true })
    .fill("Send Example recipient 10 USDC");
  await page.getByRole("button", { name: "Start conversation" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Review payment",
    exact: true,
  });
  await dialog.waitFor();
  await dialog
    .getByLabel("Exact recipient address", { exact: true })
    .fill(recipient);
  await dialog
    .getByLabel("Linked obligation", { exact: true })
    .selectOption(savedInvoice.id);
  await dialog
    .getByRole("checkbox", { name: "I checked the recipient address" })
    .check();
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  plan = (
    await (
      await context.request.get(`${base}/api/product/payment-plans`)
    ).json()
  ).plans[0];
  assert.equal(plan.state, "ready_for_quote");
  await dialog.getByRole("button", { name: "Connect with Pollar" }).click();
  await dialog
    .getByLabel("Your email", { exact: true })
    .fill("fictional@example.test");
  await dialog.getByRole("button", { name: "Continue with email" }).click();
  await dialog.getByLabel("Email verification code").fill("123456");
  await dialog.getByRole("button", { name: "Verify Pollar code" }).click();
  await dialog.getByRole("button", { name: "Get provider quote" }).click();
  await dialog
    .getByRole("button", { name: "Approve exact test payment" })
    .waitFor();
  await dialog.getByRole("checkbox", { name: /I approve 10/ }).check();
  await dialog
    .getByLabel("Re-enter operator password", { exact: true })
    .fill("incorrect-owner-password");
  await dialog
    .getByRole("button", { name: "Approve exact test payment" })
    .click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(sends, 0, "Wrong password never reaches provider signing");
  await dialog
    .getByLabel("Re-enter operator password", { exact: true })
    .fill(password);
  await dialog
    .getByRole("button", { name: "Approve exact test payment" })
    .click();
  await dialog
    .getByRole("button", { name: "Sign & send approved test payment" })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm wallet signing", exact: true })
    .click();
  await dialog.getByRole("button", { name: "Check settlement" }).waitFor();
  let state = await (await context.request.get(`${base}/api/product`)).json();
  assert.equal(
    state.invoices.find((i) => i.id === savedInvoice.id).state,
    "open",
  );
  const afterSend = (
    await (
      await context.request.get(`${base}/api/product/payment-plans`)
    ).json()
  ).plans[0];
  assert.equal(afterSend.state, "pending");
  assert.equal(sends, 1);
  await page.screenshot({
    path: join(evidence, "1440-mocked-pollar-submitted-pending.png"),
    fullPage: true,
  });
  const replay = await context.request.post(
    `${base}/api/product/payment-plans/${plan.id}/submit`,
    { headers: { origin: base }, data: { nonce: capturedNonce } },
  );
  assert.equal(replay.status(), 403);
  await writeFile(
    fixtureFile,
    JSON.stringify({
      outgoing: true,
      confirmed: true,
      transactionHash: quote.transactionHash,
      memo: plan.memo,
    }),
  );
  await dialog.getByRole("button", { name: "Check settlement" }).click();
  await dialog
    .getByText("10 USDC confirmed on testnet", { exact: true })
    .waitFor();
  state = await (await context.request.get(`${base}/api/product`)).json();
  assert.equal(
    state.invoices.find((i) => i.id === savedInvoice.id).state,
    "settled",
  );
  assert.equal(sends, 1);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: join(evidence, "1440-mocked-pollar-approved-confirmed.png"),
    fullPage: true,
  });
  const result = {
    classification:
      "MOCKED provider and Horizon HTTP; real official SDK/browser/API/SQL; no real funds or settlement",
    sdk: "@pollar/core@0.12.0",
    passed: true,
    wrongPasswordBlocked: true,
    singleProviderSigningCall: sends,
    nonceReplayStatus: replay.status(),
    providerSuccessWithoutHorizonRemainedPending: true,
    linkedObligationSettledOnlyAfterMockedNetworkEvidence: true,
    paths,
    jsErrors: errors,
  };
  await writeFile(
    join(evidence, "pollar-sdk-browser.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page)
    await page
      .screenshot({
        path: join(evidence, "pollar-browser-failure.png"),
        fullPage: true,
      })
      .catch(() => {});
  console.error(JSON.stringify({ sends, paths, errors }));
  console.error(output);
  throw error;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  await rm(dir, { recursive: true, force: true });
}
