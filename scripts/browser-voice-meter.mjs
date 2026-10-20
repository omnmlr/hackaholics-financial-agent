/* global window: readonly, navigator: readonly */
// Real Chromium MediaStream + AudioContext + MediaRecorder, fed a synthetic PCM
// microphone. Web Speech, model transport, transcription and playback are test
// doubles: this does NOT measure physical microphones or speech accuracy.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const base = "http://127.0.0.1:3123";
const dir = await mkdtemp(join(tmpdir(), "agus-meter-"));
const reportDir = process.env.VOICE_REPORT_DIR ?? "/tmp/agus-voice-meter";
await mkdir(reportDir, { recursive: true });
const wav = Buffer.alloc(44 + 48000 * 4 * 2);
wav.write("RIFF", 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24);
wav.writeUInt32LE(96000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36);
wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 0; i < 48000 * 4; i++) {
  const seconds = i / 48000;
  const amplitude =
    seconds < 1 ? 0 : seconds < 2 ? 0.03 : seconds < 3 ? 0.35 : 0.08;
  wav.writeInt16LE(
    Math.round(Math.sin(2 * Math.PI * 220 * seconds) * amplitude * 32767),
    44 + i * 2,
  );
}
const audio = join(dir, "varying-signal.wav");
await writeFile(audio, wav);
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const child = spawn(
  process.execPath,
  [
    "--import",
    "./scripts/fixtures/gemini-chat-payments.mjs",
    "node_modules/next/dist/bin/next",
    "start",
    "--port",
    "3123",
    "--hostname",
    "127.0.0.1",
  ],
  {
    env: {
      ...process.env,
      DATABASE_URL: `pglite://${join(dir, "db")}`,
      APP_ORIGIN: base,
      OPERATOR_ID: "meter-fixture",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
      PAYMENT_MODE: "fixture",
      FINANCIAL_DEMO_ENABLED: "true",
      PAYSTACK_SECRET_KEY: "",
      PAYSTACK_TRANSFERS_ENABLED: "false",
      LIVE_OWNER_AUTHORIZED: "false",
      LIVE_TRANSFERS_ENABLED: "false",
      AI_PROVIDER: "gemini",
      AI_API_KEY: "browser-mock-inference-only",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "",
  browser;
child.stdout.on("data", (b) => (output += b));
child.stderr.on("data", (b) => (output += b));
const checks = [];
try {
  for (let i = 0; i < 100; i++) {
    if (output.includes("Ready")) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(output.includes("Ready"), output);
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${audio}`,
    ],
  });
  async function pageFor(mode, permission = true, width = 390) {
    const context = await browser.newContext({
      viewport: { width, height: 844 },
      ...(permission ? { permissions: ["microphone"] } : {}),
    });
    await context.route("**/*", (r) =>
      r.request().url().startsWith(base) ? r.continue() : r.abort(),
    );
    await context.addInitScript((mode) => {
      window.__streams = [];
      window.__contexts = [];
      window.__spoken = [];
      const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      );
      navigator.mediaDevices.getUserMedia = async (...args) => {
        const stream = await getUserMedia(...args);
        window.__streams.push(stream);
        if (window.__delayPermission)
          await new Promise((resolve) => (window.__grant = resolve));
        return stream;
      };
      const Audio = window.AudioContext;
      window.AudioContext = class extends Audio {
        constructor(...args) {
          super(...args);
          window.__contexts.push(this);
        }
      };
      if (mode === "native")
        window.SpeechRecognition = class {
          constructor() {
            window.__recognition = this;
          }
          start() {
            setTimeout(() => this.onstart?.(), 0);
          }
          stop() {
            this.onend?.();
          }
        };
      else {
        window.SpeechRecognition = undefined;
        window.webkitSpeechRecognition = undefined;
      }
      window.speechSynthesis.speak = (utterance) => {
        window.__spoken.push({
          text: utterance.text,
          allMicrophonesStopped: window.__streams.every((s) =>
            s.getTracks().every((t) => t.readyState === "ended"),
          ),
        });
      };
    }, mode);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(
      () => !window.document.querySelector("#financial-message")?.readOnly,
    );
    await page
      .getByRole("button", { name: "Open conversations", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .filter({ visible: true })
      .click();
    await page.getByLabel("Operator password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.locator(".agus-signin").waitFor({ state: "hidden" });
    return { context, page, errors };
  }
  const button = (page, name) =>
    page.getByRole("button", { name, exact: true });
  async function released(page) {
    await page.waitForFunction(
      () =>
        window.__streams.every((s) =>
          s.getTracks().every((t) => t.readyState === "ended"),
        ) && window.__contexts.every((c) => c.state === "closed"),
    );
  }
  for (const mode of ["native", "media"]) {
    const { context, page, errors } = await pageFor(mode);
    const input = page.getByLabel("Message AGUS", { exact: true });
    let conversationPosts = 0,
      voicePosts = 0,
      releaseTranscription;
    page.on("request", (r) => {
      if (r.url().endsWith("/api/conversation") && r.method() === "POST")
        conversationPosts++;
    });
    await page.route("**/api/voice", async (route) => {
      voicePosts++;
      await new Promise((resolve) => (releaseTranscription = resolve));
      await route
        .fulfill({ json: { transcript: "Abeg help me plan my savings" } })
        .catch(() => {});
    });
    assert.equal(
      await page.getByText("About voice", { exact: true }).count(),
      0,
    );
    await input.fill("My draft");
    await button(page, "Start recording").click();
    await page.waitForFunction(
      () =>
        Number(
          window.document
            .querySelector(".agus-recording-level")
            ?.getAttribute("data-level"),
        ) > 0.05,
    );
    const levels = new Set();
    for (let i = 0; i < 15; i++) {
      levels.add(
        await page.locator(".agus-recording-level").getAttribute("data-level"),
      );
      await page.waitForTimeout(100);
    }
    assert.ok(levels.size > 2, `Real PCM levels must vary: ${[...levels]}`);
    assert.equal(await page.locator(".agus-recording-level i").count(), 24);
    if (mode === "native") {
      await page.evaluate(() =>
        window.__recognition.onresult({
          results: [{ 0: { transcript: "Abeg help me plan" }, isFinal: false }],
        }),
      );
      assert.equal(
        await page.getByLabel("Live transcript").innerText(),
        "Abeg help me plan",
      );
      assert.equal(await input.inputValue(), "My draft");
      await page.screenshot({
        path: join(reportDir, "chrome-native-waveform-390.png"),
      });
    }
    await button(page, "Stop recording").click();
    if (mode === "media") {
      await page
        .getByText("Transcribing your recording…", { exact: true })
        .waitFor();
      await released(page);
      releaseTranscription();
    }
    await page.waitForFunction(() =>
      window.document
        .querySelector("#financial-message")
        .value.startsWith("My draft Abeg"),
    );
    await released(page);
    assert.equal(conversationPosts, 0);
    checks.push(
      `${mode}: actual Chromium PCM waveform changes, preview/review, explicit Stop releases tracks/context, no automatic send`,
    );

    await input.fill("Preserve on cancel");
    await button(page, "Start recording").click();
    await page.locator(".agus-recording-level").waitFor();
    const before = voicePosts;
    await button(page, "Cancel recording").click();
    await released(page);
    assert.equal(await input.inputValue(), "Preserve on cancel");
    assert.equal(voicePosts, before);
    if (mode === "native") {
      await button(page, "Start recording").click();
      await page.locator(".agus-recording-level").waitFor();
      await page.evaluate(() =>
        window.__recognition.onerror({ error: "network" }),
      );
      await released(page);
      await page
        .getByText("The browser speech service could not be reached.", {
          exact: false,
        })
        .waitFor();
      // A permission resolution arriving after cancellation must stop its stream.
      await page.evaluate(() => (window.__delayPermission = true));
      await button(page, "Start recording").click();
      await page.waitForFunction(() => !!window.__grant);
      await button(page, "Cancel recording").click();
      await page.evaluate(() => {
        window.__grant();
        window.__delayPermission = false;
      });
      await released(page);
      checks.push(
        "native: network failure and late permission grant clean up actual microphone tracks",
      );
    } else {
      await button(page, "Start recording").click();
      await page.locator(".agus-recording-level").waitFor();
      await button(page, "Stop recording").click();
      await page
        .getByText("Transcribing your recording…", { exact: true })
        .waitFor();
      await button(page, "Cancel recording").click();
      releaseTranscription();
      await page.waitForTimeout(150);
      assert.equal(await input.inputValue(), "Preserve on cancel");
      checks.push(
        "media: cancellation during provider processing ignores its late transcript",
      );
    }
    await button(page, "Open conversations").click();
    await button(page, "Voice settings").filter({ visible: true }).click();
    await page.getByLabel("Read new replies aloud", { exact: true }).check();
    await button(page, "Close voice settings").click();
    await input.fill("Hello");
    await button(page, "Send message").click();
    await page.waitForFunction(() => window.__spoken.length > 0);
    assert.ok(
      (await page.evaluate(() => window.__spoken)).every(
        (s) => s.allMicrophonesStopped,
      ),
    );
    checks.push(
      `${mode}: spoken replies opt-in works after explicit Send, without restarting capture`,
    );
    if (mode === "native") {
      await page.evaluate(() => {
        window.__spoken = [];
      });
      let releaseReply;
      let markReplyReady;
      const replyReady = new Promise((resolve) => {
        markReplyReady = resolve;
      });
      await page.route("**/api/conversation", async (route) => {
        const response = await route.fetch();
        await new Promise((resolve) => {
          releaseReply = resolve;
          markReplyReady();
        });
        await route.fulfill({ response });
      });
      await input.fill("Hello again");
      await button(page, "Send message").click();
      await page.waitForFunction(
        () =>
          window.document
            .querySelector(".agus-composer")
            .getAttribute("aria-busy") === "true",
      );
      await button(page, "Open conversations").click();
      await button(page, "Voice settings").filter({ visible: true }).click();
      await page
        .getByLabel("Read new replies aloud", { exact: true })
        .uncheck();
      await button(page, "Close voice settings").click();
      await replyReady;
      assert.ok(releaseReply);
      releaseReply();
      await page.waitForFunction(
        () =>
          window.document
            .querySelector(".agus-composer")
            .getAttribute("aria-busy") === "false",
      );
      assert.deepEqual(await page.evaluate(() => window.__spoken), []);
      checks.push(
        "native: disabling spoken replies during an in-flight answer suppresses playback",
      );
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  const denied = await pageFor("media", false);
  await denied.page
    .getByLabel("Message AGUS", { exact: true })
    .fill("Keep this draft");
  await button(denied.page, "Start recording").click();
  await denied.page
    .getByText("Microphone access was denied.", { exact: false })
    .waitFor();
  assert.equal(
    await denied.page.getByLabel("Message AGUS", { exact: true }).inputValue(),
    "Keep this draft",
  );
  assert.equal(await denied.page.locator(".agus-recording-level").count(), 0);
  await released(denied.page);
  checks.push(
    "actual Chromium microphone permission denial retains draft and shows an error without fabricated bars",
  );
  await denied.context.close();
  await writeFile(
    join(reportDir, "results.json"),
    JSON.stringify(
      {
        mockedRecognition: true,
        mockedModel: true,
        syntheticMicrophone: true,
        physicalMicrophone: false,
        realWebAudio: true,
        checks,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: checks.length, reportDir, checks }, null, 2),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill("SIGTERM");
  });
  await rm(dir, { recursive: true, force: true });
}
