/* global window, document, innerWidth */
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { URL } from "node:url";
import { X509Certificate, createHash } from "node:crypto";
import assert from "node:assert/strict";
const base =
    process.env.AGUS_ACCEPTANCE_ORIGIN ?? "https://agusweb.up.railway.app",
  dir = "docs/unified-agent/live";
await mkdir(dir, { recursive: true });
const { password } = JSON.parse(
  await readFile(".data/counterpart-railway/access.json"),
);
const proxy = new URL(process.env.HTTPS_PROXY);
const cert = new X509Certificate(
  await readFile(process.env.NODE_EXTRA_CA_CERTS),
);
const pin = createHash("sha256")
  .update(cert.publicKey.export({ type: "spki", format: "der" }))
  .digest("base64");
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  proxy: { server: proxy.origin },
  args: [
    `--ignore-certificate-errors-spki-list=${pin}`,
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    `--use-file-for-fake-audio-capture=/tmp/agus-speech/summary-48.wav`,
  ],
});
const result = {
  syntheticMicrophone: true,
  realMediaRecorder: true,
  realProvider: true,
  errors: [],
};
let page;
try {
  const c = await browser.newContext({
    viewport: { width: 1440, height: 1040 },
    permissions: ["microphone"],
    reducedMotion: "reduce",
  });
  page = await c.newPage();
  let conversationRequests = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/conversation") && r.method() === "POST")
      conversationRequests++;
  });
  page.on("pageerror", (e) => result.errors.push(e.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: undefined,
      configurable: true,
    });
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: undefined,
      configurable: true,
    });
  });
  await page.goto(base);
  await page.getByLabel("Operator password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  const welcome = page.getByRole("dialog", { name: "Welcome to AGUS" });
  if (await welcome.isVisible())
    await welcome.getByRole("button", { name: "Skip for now" }).click();
  const nav = () =>
    page.getByRole("complementary", { name: "Main navigation" });
  await nav().getByRole("button", { name: "AGUS", exact: true }).click();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  async function ask(text) {
    await page.getByRole("textbox", { name: "Message AGUS" }).fill(text);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/conversation") &&
        r.request().method() === "POST",
      { timeout: 90000 },
    );
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    const r = await response;
    const data = await r.json();
    assert.equal(r.status(), 200);
    await page
      .getByText("Thinking…", { exact: true })
      .waitFor({ state: "hidden", timeout: 30000 });
    return data.reply;
  }
  let task;
  if (process.env.UNIFIED_RESUME === "true") {
    Object.assign(
      result,
      JSON.parse(
        await readFile(dir + "/results.json", "utf8").catch(() =>
          readFile(dir + "/partial.json", "utf8"),
        ),
      ),
    );
    task = result.proposal;
    await page
      .getByRole("button", { name: "Saved conversations", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Conversations", exact: true })
      .getByRole("button", {
        name: /abeg you fit remind me say ada dey owe me/,
      })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "Conversations", exact: true })
      .waitFor({ state: "hidden" });
    await page
      .locator('section[aria-label="Saved agent records"]')
      .filter({ hasText: task.title })
      .getByText("active", { exact: true })
      .waitFor();
    await page.screenshot({ path: dir + "/1440-approved-responsibility.png" });
  } else {
    const before = await (
      await c.request.get(base + "/api/agent-workspace")
    ).json();
    const reply = await ask(
      "abeg you fit remind me say ada dey owe me 5 usdc tomorrow",
    );
    result.pidgin = {
      reply: reply.text,
      steps: reply.execution?.steps,
      actions: reply.workspaceActions ?? [reply.workspace],
    };
    const after = await (
      await c.request.get(base + "/api/agent-workspace")
    ).json();
    task = after.tasks.find((t) => !before.tasks.some((b) => b.id === t.id));
    assert.ok(task, "Model persisted a new proposal");
    assert.equal(task.state, "awaiting_approval");
    assert.match(task.title + " " + task.objective, /ada/i);
    assert.match(task.objective + " " + task.title, /5/);
    assert.match(task.objective + " " + task.title, /USDC/i);
    const day = (d) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: "Africa/Lagos",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(d));
    assert.equal(day(task.dueAt), day(Date.now() + 86400000));
    result.proposal = task;
    const record = page
      .locator('section[aria-label="Saved agent records"]')
      .filter({ hasText: task.title });
    await record
      .getByRole("button", { name: "Approve in-app reminder", exact: true })
      .click();
    await record.getByText("active", { exact: true }).waitFor();
    await record
      .getByRole("button", { name: "Pause responsibility", exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector(
          'section[aria-label="Saved agent records"] button',
        )?.disabled,
    );
    await page.screenshot({ path: dir + "/1440-approved-responsibility.png" });
    assert.equal(new URL(page.url()).pathname, "/");
    result.inlineApproval = true;
  }
  await nav().getByRole("button", { name: "Obligations", exact: true }).click();
  await page.getByText(task.title, { exact: true }).first().waitFor();
  await page.screenshot({ path: dir + "/1440-obligations.png" });
  result.visibleInObligations = true;
  await nav().getByRole("button", { name: "Money", exact: true }).click();
  await page.getByRole("button", { name: "Open AGUS", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("textbox", { name: "Message AGUS" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", { name: "Accounts & wallets", exact: true })
      .count(),
    1,
  );
  await page.screenshot({ path: dir + "/1440-contextual-agent.png" });
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  result.contextualPanelPreservesPage = true;
  await nav().getByRole("button", { name: "AGUS", exact: true }).click();
  if (process.env.UNIFIED_SKIP_VOICE !== "true") {
    const initial = await c.request.get(base + "/api/conversations");
    const historyBefore = await initial.json();
    const callsBeforeRecording = conversationRequests;
    const transcriptResponse = page.waitForResponse(
      (r) => r.url().endsWith("/api/voice"),
      { timeout: 90000 },
    );
    await page
      .getByRole("button", { name: "Start recording", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .waitFor();
    await new Promise((r) => setTimeout(r, 6500));
    await page
      .getByRole("button", { name: "Stop recording", exact: true })
      .click();
    const transcribed = await transcriptResponse;
    const audio = await transcribed.json();
    result.voice = {
      status: transcribed.status(),
      transcript: audio.transcript,
    };
    assert.equal(transcribed.status(), 200);
    await page.waitForFunction(
      () =>
        !document.querySelector('textarea[aria-label="Message AGUS"]').readOnly,
    );
    assert.equal(
      conversationRequests,
      callsBeforeRecording,
      "Voice transcription does not submit a conversation turn",
    );
    const draft = await page
      .getByRole("textbox", { name: "Message AGUS" })
      .inputValue();
    assert.ok(draft.trim());
    assert.equal(
      (await (await c.request.get(base + "/api/conversations")).json()).chats
        .length,
      historyBefore.chats.length,
      "Recording alone never sends a chat",
    );
    await page.screenshot({ path: dir + "/1440-voice-review.png" });
    const spokenReply = await ask(draft);
    result.voice.reply = spokenReply.text;
    result.voice.steps = spokenReply.execution?.steps;
    result.voice.explicitSend = true;
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page
      .getByRole("heading", { name: "Overview", exact: true })
      .waitFor();
    await page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("button", { name: "AGUS", exact: true })
      .click();
    await page
      .locator('section[aria-label="Saved agent records"]')
      .filter({ hasText: task.title })
      .getByText("active", { exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({ path: `${dir}/${width}-restored-agent.png` });
  }
  const existingCount = (
    await (await c.request.get(base + "/api/agent-workspace")).json()
  ).tasks.length;
  const callsBeforeRepeat = conversationRequests;
  await page
    .getByRole("textbox", { name: "Message AGUS" })
    .fill("abeg you fit remind me say ada dey owe me 5 usdc tomorrow");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "already has a saved reminder" })
    .waitFor();
  assert.equal(conversationRequests, callsBeforeRepeat);
  assert.equal(
    (await (await c.request.get(base + "/api/agent-workspace")).json()).tasks
      .length,
    existingCount,
  );
  result.repeatedRequestBlockedBeforeModel = true;
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message AGUS" })
    .fill("abeg you fit remind me say ada dey owe me 5 usdc tomorrow");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "conversation is restored" })
    .waitFor();
  assert.equal(conversationRequests, callsBeforeRepeat);
  assert.equal(
    (await (await c.request.get(base + "/api/agent-workspace")).json()).tasks
      .length,
    existingCount,
  );
  result.newChatRestoresExistingReminderInsteadOfDuplicating = true;

  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Obligations", exact: true })
    .click();
  const row = page.locator(`[data-reminder-id="${task.id}"]`);
  await row
    .getByRole("button", { name: "Cancel reminder", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Cancel reminder?",
    exact: true,
  });
  await confirmation.getByText(task.title, { exact: true }).waitFor();
  await page.screenshot({ path: dir + "/320-cancel-confirmation.png" });
  await confirmation
    .getByRole("button", { name: "Keep reminder", exact: true })
    .click();
  const current = (
    await (await c.request.get(base + "/api/agent-workspace")).json()
  ).tasks;
  result.currentAdaRecords = current
    .filter((t) => t.title === task.title)
    .map((t) => ({ id: t.id, state: t.state, version: t.version }));
  assert.equal(current.find((t) => t.id === task.id).state, "active");
  result.cancellationKeepLeavesAdaUntouched = true;
  await page.screenshot({ path: dir + "/320-independent-reminders.png" });
  result.reloadRestoresAction = true;
  assert.deepEqual(result.errors, []);
  await writeFile(dir + "/results.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  await writeFile(dir + "/partial.json", JSON.stringify(result, null, 2));
  await page?.screenshot({ path: dir + "/failure.png" }).catch(() => {});
  throw e;
} finally {
  await browser.close();
}
