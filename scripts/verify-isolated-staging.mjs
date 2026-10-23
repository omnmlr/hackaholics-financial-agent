// Genuine public staging acceptance. No mocked inference or payment execution.
// Read credentials from the protected local configuration file; never log them.
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import sharp from "sharp";

const privateConfig = JSON.parse(
  await readFile("/workspace/work/isolated-staging-private.json", "utf8"),
);
const base = "https://staging--agus-ai-isolated-staging-20261023.netlify.app";
assert.equal(privateConfig.origin, base);
assert.equal(privateConfig.siteId, "b9f8d2af-8aba-494b-a012-4d0424df33c8");
const output = process.argv[2] ?? "/workspace/work/staging-acceptance.json";
const persistenceOnly = process.argv.includes("--persistence-only");
const resume = process.argv.includes("--resume");
const previous =
  persistenceOnly || resume
    ? JSON.parse(await readFile(output, "utf8"))
    : undefined;
const report = {
  origin: base,
  model: "gemini-3.5-flash-lite",
  genuine: true,
  maximumConcurrentGenerations: 1,
  providerCallBudget: 18,
  minimumPauseBetweenTurnsMs: 15000,
  capacityEstablished: false,
  paymentExecution: false,
  results: resume ? previous.results : [],
  attempts: resume ? previous.attempts : [],
  saved: previous?.saved ?? [],
};
let browser,
  lastPage,
  checkpoint = "browser-start",
  calls = resume
    ? previous.observedModelCalls
    : Number(process.env.STAGING_PRIOR_MODEL_CALLS ?? "0"),
  lastFinished = 0;
const pass = (id, details = {}) => {
  if (report.results.some((result) => result.id === id && result.passed))
    return;
  const result = { id, passed: true, ...details };
  report.results.push(result);
  console.log(JSON.stringify(result));
};
const checkState = (state) => {
  assert.equal(state.mode, "fixture");
  assert.equal(state.liveEnabled, false);
  assert.equal(state.emergencyDisabled, true);
  assert.equal(state.aiEnabled, true);
  assert.equal(state.aiProvider, "gemini");
  assert.equal(state.batches.length, 0);
  assert.ok(
    !state.audit.some((event) =>
      /approved|execut|transfer\.submitted/.test(event.action),
    ),
  );
  assert.ok(!JSON.stringify(state.messages).includes("data:image"));
};
const pace = async () => {
  const wait = 15000 - (performance.now() - lastFinished);
  if (lastFinished && wait > 0)
    await new Promise((resolve) => setTimeout(resolve, wait));
};
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    args: ["--no-sandbox"],
    proxy: process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY }
      : undefined,
  });
  const context = await browser.newContext({
    proxy: process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY }
      : undefined,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const api = async (path, data) => {
    const response = await context.request.fetch(`${base}/api/${path}`, {
      method: data === undefined ? "GET" : "POST",
      headers: { Origin: base },
      ...(data === undefined ? {} : { data }),
      timeout: 90000,
    });
    return { status: response.status(), data: await response.json() };
  };
  checkpoint = "public-authentication-boundary";
  assert.equal((await api("state")).status, 401);
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(45000);
  let browserErrors = 0;
  page.on("pageerror", () => browserErrors++);
  const hydrated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/conversations") &&
      response.request().method() === "GET",
  );
  await page.goto(`${base}/conversation`, { waitUntil: "domcontentloaded" });
  await hydrated;
  await page.waitForFunction(
    () =>
      document.querySelector(".agus-composer")?.getAttribute("aria-busy") ===
      "false",
  );
  checkpoint = "ui-sign-in-open";
  await page
    .getByRole("button", { name: "Sign in to AGUS", exact: true })
    .click();
  checkpoint = "ui-sign-in-password";
  await page
    .getByLabel("Operator password", { exact: true })
    .fill(privateConfig.operatorPassword);
  checkpoint = "ui-sign-in-submit";
  const signingIn = page.waitForResponse(
    (r) => r.url().endsWith("/api/session") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  assert.equal((await signingIn).status(), 200);
  checkpoint = "ui-sign-in-close";
  await page.locator("#agus-password").waitFor({ state: "hidden" });
  pass("public-ui-sign-in");
  checkpoint = "fixture-safety-preflight";
  const accounts = await api("financial-agent");
  assert.equal(accounts.status, 200);
  assert.ok(accounts.data.accounts.length > 0);
  assert.ok(
    accounts.data.accounts.every(
      (account) =>
        account.simulated &&
        account.source.provider === "fixture" &&
        account.source.mode === "fixture",
    ),
  );
  checkState((await api("state")).data);
  pass("synthetic-accounts-and-disabled-transfers", {
    accountCount: accounts.data.accounts.length,
  });
  const input = page.getByLabel("Message AGUS", { exact: true });
  if (resume) {
    const id = report.saved[0].conversationId;
    const history = await api(`conversations?id=${id}`);
    const attempt = previous.attempts.find(
      (item) => item.id === "authorized-spending",
    );
    if (
      attempt?.httpStatus === 200 &&
      attempt.reply.kind === "financial" &&
      /19,751\.51/.test(attempt.reply.text) &&
      attempt.reply.evidence.toolCalls > 0
    ) {
      const turn = history.data.turns.find(
        (turn) => turn.reply.text === attempt.reply.text,
      );
      assert.ok(turn);
      report.saved.push({
        conversationId: id,
        turnId: turn.id,
        text: turn.reply.text,
      });
      pass("authorized-spending", {
        httpStatus: 200,
        modelCalls: turn.reply.evidence.modelCalls,
        toolCalls: turn.reply.evidence.toolCalls,
        narration: turn.reply.presentation.narration,
        narrationCode: turn.reply.evidence.narrationCode,
        recoveredWithoutNewInference: true,
      });
    }
    await page.goto(`${base}/conversation?chat=${id}`);
    await input.waitFor();
  }
  const send = async (id, text, check) => {
    if (
      resume &&
      report.results.some((result) => result.id === id && result.passed)
    )
      return;
    checkpoint = id;
    // Native application cap is six calls per turn. Reserve that before sending.
    assert.ok(calls + 6 <= report.providerCallBudget - 2, "BUDGET_RESERVATION");
    await pace();
    await input.fill(text);
    const responsePending = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/conversation") &&
        r.request().method() === "POST",
      { timeout: 90000 },
    );
    const started = performance.now();
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const response = await responsePending;
    lastFinished = performance.now();
    const data = await response.json();
    report.attempts.push({
      id,
      httpStatus: response.status(),
      reply: data.reply,
    });
    calls += data.reply?.evidence?.modelCalls ?? 0;
    assert.equal(response.status(), 200);
    assert.ok(data.turn && data.reply);
    assert.ok(calls <= report.providerCallBudget - 2);
    assert.ok(check(data.reply));
    await page.waitForFunction(
      () =>
        document.querySelector(".agus-composer")?.getAttribute("aria-busy") ===
        "false",
    );
    report.saved.push({
      conversationId: data.conversationId,
      turnId: data.turn.id,
      text: data.reply.text,
    });
    pass(id, {
      httpStatus: response.status(),
      modelCalls: data.reply.evidence.modelCalls,
      toolCalls: data.reply.evidence.toolCalls,
      kind: data.reply.kind,
      narration: data.reply.presentation?.narration,
      narrationCode: data.reply.evidence.narrationCode,
      elapsedMs: Math.round(lastFinished - started),
    });
    return data;
  };
  if (!persistenceOnly) {
    await send(
      "ordinary-conversation",
      "Tell me a short joke about robots in two separate paragraphs.",
      (r) =>
        r.kind === "general" &&
        r.evidence.modelCalls > 0 &&
        r.evidence.toolCalls === 0 &&
        r.text.length > 20,
    );
    await send(
      "sequential-ordinary-conversation",
      "Explain compound interest simply in two sentences.",
      (r) =>
        r.kind === "general" &&
        r.evidence.modelCalls > 0 &&
        r.evidence.toolCalls === 0 &&
        /interest/i.test(r.text),
    );
    await send(
      "account-permission-gate",
      "Show my spending from 2026-10-01 to 2026-11-01",
      (r) => r.accountAction === "choose_demo_account",
    );
    await page
      .getByRole("button", { name: "Choose records account:", exact: false })
      .click();
    await page.getByLabel("Account (optional)").selectOption("amina-current");
    await page
      .getByRole("button", { name: "Close account", exact: true })
      .click();
    await send(
      "authorized-spending",
      "Show my spending from 2026-10-01 to 2026-11-01",
      (r) =>
        r.kind === "financial" &&
        r.evidence.toolCalls > 0 &&
        ["ai", "factual_fallback"].includes(r.presentation?.narration) &&
        /19,751\.51/.test(r.text),
    );
    await send(
      "authorized-financial-search",
      "Find Ada payments on amina-current for October 2026.",
      (r) =>
        ["financial", "clarify"].includes(r.kind) &&
        r.evidence.toolCalls > 0 &&
        ["ai", "factual_fallback"].includes(r.presentation?.narration) &&
        r.citations.length > 0 &&
        /Ada/i.test(r.text),
    );
    checkpoint = "screenshot-payment-preparation";
    assert.ok(calls + 2 <= report.providerCallBudget);
    await pace();
    await page
      .locator(".agus-header")
      .getByRole("button", { name: "New chat", exact: true })
      .click();
    const image = await sharp(
      Buffer.from(
        '<svg width="900" height="300"><rect width="900" height="300" fill="white"/><g fill="black" font-size="28"><text x="24" y="60">FICTIONAL PAYMENT INSTRUCTIONS</text><text x="24" y="130">Ada: Wema 0000000001, NGN 500</text><text x="24" y="200">Chidi: Access 0000000002, NGN 600</text></g></svg>',
      ),
    )
      .png()
      .toBuffer();
    await page
      .getByRole("button", { name: "Add attachment", exact: true })
      .click();
    const pickerPending = page.waitForEvent("filechooser");
    await page
      .getByRole("menuitem", { name: "Choose image", exact: false })
      .click();
    await (
      await pickerPending
    ).setFiles({
      name: "synthetic-payment.png",
      mimeType: "image/png",
      buffer: image,
    });
    await page.getByAltText("Local payment image preview").waitFor();
    const uploadPending = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/extract") && r.request().method() === "POST",
      { timeout: 90000 },
    );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const uploaded = await uploadPending,
      imageResult = await uploaded.json();
    lastFinished = performance.now();
    assert.equal(uploaded.status(), 200);
    assert.equal(imageResult.turn.reply.kind, "handoff");
    calls += imageResult.turn.reply.evidence.modelCalls;
    assert.ok(calls <= report.providerCallBudget);
    report.saved.push({
      conversationId: imageResult.conversationId,
      turnId: imageResult.turn.id,
      text: imageResult.turn.reply.text,
    });
    const editor = page
      .getByRole("region", { name: "Payment proposal", exact: true })
      .last();
    await editor.locator("fieldset").nth(1).waitFor();
    assert.equal(await editor.locator("fieldset").count(), 2);
    assert.deepEqual(
      await editor
        .getByLabel("Amount (NGN)", { exact: true })
        .evaluateAll((fields) => fields.map((field) => field.value)),
      ["500", "600"],
    );
    assert.deepEqual(
      await editor
        .getByLabel("Account number", { exact: true })
        .evaluateAll((fields) => fields.map((field) => field.value)),
      ["0000000001", "0000000002"],
    );
    const draftInput = {
      conversationId: imageResult.conversationId,
      turnId: imageResult.turn.id,
    };
    const first = await api("conversation/payment-draft", draftInput),
      repeated = await api("conversation/payment-draft", draftInput);
    assert.equal(first.status, 200);
    assert.equal(repeated.status, 200);
    assert.equal(first.data.id, repeated.data.id);
    assert.deepEqual(first.data.proposals, repeated.data.proposals);
    report.paymentDraft = {
      ...draftInput,
      id: first.data.id,
      proposals: first.data.proposals,
    };
    await mkdir("/workspace/work/staging-screenshots", { recursive: true });
    await page.screenshot({
      path: "/workspace/work/staging-screenshots/payment-preparation.png",
    });
    pass("genuine-screenshot-editable-payment-draft", {
      modelCalls: imageResult.turn.reply.evidence.modelCalls,
      proposals: first.data.proposals.length,
      idempotentReopen: true,
    });
  }
  checkpoint = "saved-conversation-persistence";
  const chats = await api("conversations");
  assert.equal(chats.status, 200);
  for (const saved of report.saved) {
    assert.ok(
      chats.data.chats.some((chat) => chat.id === saved.conversationId),
    );
    const history = await api(`conversations?id=${saved.conversationId}`);
    assert.equal(history.status, 200);
    assert.ok(
      history.data.turns.some(
        (turn) => turn.id === saved.turnId && turn.reply.text === saved.text,
      ),
    );
  }
  const ordinary = report.saved[0];
  await page.goto(`${base}/conversation?chat=${ordinary.conversationId}`);
  const paragraphs = ordinary.text
    .split(/\n\n/)
    .filter((paragraph) => paragraph.trim());
  for (const paragraph of paragraphs)
    await page.getByText(paragraph, { exact: true }).waitFor();
  await page.reload();
  for (const paragraph of paragraphs)
    await page.getByText(paragraph, { exact: true }).waitFor();
  const fresh = await browser.newContext({
    proxy: process.env.HTTPS_PROXY
      ? { server: process.env.HTTPS_PROXY }
      : undefined,
  });
  const login = await fresh.request.post(`${base}/api/session`, {
    headers: { Origin: base },
    data: { password: privateConfig.operatorPassword },
  });
  assert.equal(login.status(), 200);
  const recovered = await fresh.request.get(
    `${base}/api/conversations?id=${ordinary.conversationId}`,
  );
  assert.equal(recovered.status(), 200);
  assert.ok(
    (await recovered.json()).turns.some(
      (turn) =>
        turn.id === ordinary.turnId && turn.reply.text === ordinary.text,
    ),
  );
  if (persistenceOnly) {
    const draft = await api("conversation/payment-draft", {
      conversationId: previous.paymentDraft.conversationId,
      turnId: previous.paymentDraft.turnId,
    });
    assert.equal(draft.status, 200);
    assert.equal(draft.data.id, previous.paymentDraft.id);
    assert.deepEqual(draft.data.proposals, previous.paymentDraft.proposals);
    report.paymentDraft = previous.paymentDraft;
  }
  checkState((await api("state")).data);
  assert.equal(browserErrors, 0);
  pass(
    persistenceOnly
      ? "persistence-after-redeployment"
      : "saved-chats-browser-reload-and-fresh-session",
    { turns: report.saved.length, browserErrors },
  );
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL";
  report.failureType = error.name;
  report.failureSelectors = [
    "Sign in to AGUS",
    "Operator password",
    "Continue",
    "#agus-password",
    "Message AGUS",
  ].filter((selector) => error.message.includes(selector));
  if (lastPage) {
    await mkdir("/workspace/work/staging-screenshots", { recursive: true });
    await lastPage
      .screenshot({
        path: "/workspace/work/staging-screenshots/acceptance-failure.png",
      })
      .catch(() => {});
  }
  report.failureStage = checkpoint;
  process.exitCode = 1;
} finally {
  await browser?.close();
  report.observedModelCalls = calls;
  await writeFile(
    persistenceOnly ? output.replace(/\.json$/, "-persistence.json") : output,
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      failureStage: report.failureStage,
      observedModelCalls: calls,
    }),
  );
}
