import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
const followupMode = process.argv.includes("--followup");
const runnerMode = process.argv.includes("--runner");
if (followupMode && runnerMode)
  throw new Error(
    "Do not run automatic public RPC against the submitted-draft fixture.",
  );
const draftId = randomUUID();
const temp = await mkdtemp(join(tmpdir(), "agus2-http-"));
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const base = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
if (followupMode) {
  // Explicitly fictional submitted draft. Seed before PGlite opens in the server.
  const seed = spawnSync(
    process.execPath,
    [
      "--import=tsx",
      "--input-type=module",
      "-e",
      `
    import {createHash} from 'node:crypto';
    import {durableDraftStore} from './src/lib/solana/store.ts';
    import {draftDigest} from './src/lib/solana/service.ts';
    import {DEVNET_RPC,DEVNET_GENESIS} from './src/lib/solana/contracts.ts';
    import {db} from './src/lib/db.ts';
    const at=new Date().toISOString();
    const draft={id:process.env.FIXTURE_DRAFT_ID,owner:'workspace-smoke',revision:0,network:'devnet',rpcEndpoint:DEVNET_RPC,genesisHash:DEVNET_GENESIS,
      state:'unknown',sender:'2URn9ic3aMGQgGXzPcKMPjdwUJgj9Efumr2bTq4jWNAb',recipient:'11111111111111111111111111111111',asset:'SOL',mint:null,decimals:9,
      amount:'0.001',amountAtoms:'1000000',sourceTokenAccount:null,recipientTokenAccount:null,createsRecipientTokenAccount:false,feeLamports:'5000',estimatedRentLamports:'0',totalSolRequiredLamports:'1005000',
      blockhash:'11111111111111111111111111111111',lastValidBlockHeight:1000,preparedAt:at,expiresAt:at,unsignedTransactionBase64:'AA==',messageBase64:'AA==',
      messageDigest:createHash('sha256').update(Buffer.from([0])).digest('hex'),digest:'',approval:null,submission:{claimId:'fixture-only',claimedAt:at,signature:'fixture-only-not-a-chain-transaction'},confirmation:null,failureCode:'SUBMISSION_UNCERTAIN'};
    draft.digest=draftDigest(draft);
    await durableDraftStore().create(draft,{action:'fixture_only',at});
    await (await db()).$client.close();
  `,
    ],
    {
      encoding: "utf8",
      timeout: 20000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        PAYMENT_MODE: "fixture",
        DATABASE_URL: `pglite://${temp}`,
        AGUS_SOLANA_DEVNET_ENABLED: "true",
        FIXTURE_DRAFT_ID: draftId,
      },
    },
  );
  if (seed.status !== 0)
    throw new Error(`Follow-up fixture seed failed: ${seed.stderr}`);
}
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    String(port),
  ],
  {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      DATABASE_URL: `pglite://${temp}`,
      PAYMENT_MODE: "fixture",
      AI_PROVIDER: "none",
      AI_API_KEY: "",
      PAYSTACK_SECRET_KEY: "",
      AGUS_WORKSPACE_ENABLED: "true",
      AGUS_RESPONSIBILITY_RUNNER_ENABLED: runnerMode ? "true" : "false",
      AGUS_SOLANA_DEVNET_ENABLED: followupMode ? "true" : "false",
      APP_ORIGIN: base,
      OPERATOR_ID: "workspace-smoke",
      OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    },
    stdio: "ignore",
  },
);
let cookie = "",
  browser;
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie").split(";")[0];
  return { status: response.status, data: await response.json() };
}
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      /* Startup. */
    }
    await delay(200);
  }
  assert.equal((await api("/api/agent-workspace")).status, 401);
  assert.equal((await api("/api/agent-workspace/solana")).status, 401);
  assert.equal((await api("/api/session", { password })).status, 200);
  const request = {
    action: "create_task",
    input: {
      requestId: randomUUID(),
      title: "Review agreement",
      objective: "Review terms with Gerald; do not pay",
      dueAt: "2026-01-01T00:00:00Z",
    },
  };
  const task = (await api("/api/agent-workspace", request)).data.result;
  assert.equal(
    (await api("/api/agent-workspace", request)).data.result.id,
    task.id,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "run_due",
        acknowledged: true,
      })
    ).data.result.delivered,
    0,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "approve",
        id: task.id,
        version: 0,
        acknowledged: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "cancel",
        id: task.id,
        version: 0,
        acknowledged: true,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "run_due",
        acknowledged: true,
      })
    ).data.result.delivered,
    1,
  );
  assert.equal(
    (
      await api("/api/agent-workspace", {
        action: "run_due",
        acknowledged: true,
      })
    ).data.result.delivered,
    0,
  );
  const memory = (
    await api("/api/agent-workspace", {
      action: "propose_memory",
      input: { text: "Gerald proposed Friday", category: "agreement" },
    })
  ).data.result;
  assert.equal(memory.confirmed, false);
  await api("/api/agent-workspace", {
    action: "confirm_memory",
    id: memory.id,
    acknowledged: true,
  });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  await context.addCookies([
    {
      name: "ha_session",
      value: cookie.slice("ha_session=".length),
      url: base,
    },
  ]);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/responsibilities");
  await page.getByText(/User-confirmed statement/).waitFor();
  assert.equal(
    await page.getByText("Review agreement", { exact: true }).count(),
    2,
  );
  await page.getByRole("button", { name: "Forget", exact: true }).click();
  await page
    .getByText("Gerald proposed Friday", { exact: true })
    .waitFor({ state: "detached" });
  // Real chat-shell -> authenticated workspace -> versioned human actions -> persisted recovery.
  await api("/api/agent-workspace", {
    action: "create_task",
    input: {
      title: "Chat workspace acceptance",
      objective: "Review only; no external action",
      dueAt: "2026-12-01T12:00:00Z",
    },
  });
  await api("/api/agent-workspace", {
    action: "propose_memory",
    input: { text: "Chat memory acceptance", category: "preference" },
  });
  // Fixture mode serves AgusWorkspace at /. This test exercises the legacy
  // conversation drawer and its agent workspace on their dedicated route.
  await page.goto(base + "/conversation");
  // Wait for session/history initialization, which can close the initial drawer.
  await page
    .getByRole("button", { name: /^Choose records account:/ })
    .waitFor();
  await page
    .getByRole("button", { name: "Open conversations", exact: true })
    .click();
  await page
    .locator("dialog[open]")
    .getByRole("button", { name: "Wallet & responsibilities", exact: true })
    .click();
  const workspaceDialog = page.getByRole("dialog", {
    name: "Your agent workspace",
    exact: true,
  });
  await workspaceDialog
    .getByText("Chat workspace acceptance", { exact: true })
    .waitFor();
  const taskCard = workspaceDialog.locator("article").filter({
    has: page.getByRole("heading", {
      name: "Chat workspace acceptance",
      exact: true,
    }),
  });
  await taskCard
    .getByRole("button", { name: "Approve in-app reminder", exact: true })
    .click();
  await taskCard
    .getByRole("button", { name: "Pause responsibility", exact: true })
    .click();
  await taskCard
    .getByRole("button", { name: "Resume responsibility", exact: true })
    .click();
  await taskCard
    .getByRole("button", { name: "Cancel responsibility", exact: true })
    .click();
  await taskCard.getByText(/cancelled/).waitFor();
  await workspaceDialog
    .getByRole("button", { name: "Confirm memory", exact: true })
    .click();
  await workspaceDialog
    .getByText("User-confirmed statement", { exact: true })
    .waitFor();
  assert.equal(
    await workspaceDialog.evaluate((el) => el.scrollWidth <= el.clientWidth),
    true,
  );
  await workspaceDialog
    .getByRole("button", { name: "Solana devnet wallet", exact: true })
    .click();
  await workspaceDialog
    .getByRole("heading", { name: "Your wallet. Your approval.", exact: true })
    .waitFor();
  if (followupMode) {
    await workspaceDialog
      .getByLabel("Saved draft", { exact: true })
      .selectOption(draftId);
    await workspaceDialog
      .getByRole("button", { name: "Prepare status follow-up", exact: true })
      .click();
    const followup = workspaceDialog.locator("article").filter({
      has: page.getByRole("heading", {
        name: "Verify devnet transaction outcome",
        exact: true,
      }),
    });
    await followup
      .getByRole("button", {
        name: "Approve read-only devnet follow-up",
        exact: true,
      })
      .click();
    assert.equal(
      (
        await api("/api/agent-workspace", {
          action: "run_due",
          acknowledged: true,
        })
      ).data.result.delivered,
      0,
    );
    await followup
      .getByRole("button", { name: "Pause responsibility", exact: true })
      .click();
    await followup
      .getByRole("button", { name: "Resume responsibility", exact: true })
      .click();
    await followup
      .getByRole("button", { name: "Cancel responsibility", exact: true })
      .click();
    await followup.getByText(/cancelled/).waitFor();
    const task = (await api("/api/agent-workspace")).data.tasks.find(
      (t) => t.id === draftId,
    );
    assert.equal(task.scope, "solana_devnet_reconciliation_only");
    assert.equal(task.state, "cancelled");
  }

  await workspaceDialog
    .getByRole("button", { name: "Responsibilities & memory", exact: true })
    .click();
  await workspaceDialog
    .getByText(/cancelled/)
    .first()
    .waitFor();
  await page.keyboard.press("Escape");
  await workspaceDialog.waitFor({ state: "hidden" });
  await page.goto(base + "/devnet");
  await page
    .getByRole("heading", { name: "Your wallet. Your approval.", exact: true })
    .waitFor();
  assert.equal(
    (await api("/api/agent-workspace/solana")).status,
    followupMode ? 200 : 503,
  );
  if (runnerMode) {
    const task = (
      await api("/api/agent-workspace", {
        action: "create_task",
        input: {
          title: "Automatic local server check",
          objective: "Reminder only; no network or payments",
          dueAt: new Date().toISOString(),
        },
      })
    ).data.result;
    await api("/api/agent-workspace", {
      action: "approve",
      id: task.id,
      version: task.version,
      acknowledged: true,
    });
    let saved;
    for (let tries = 0; tries < 75; tries++) {
      saved = (await api("/api/agent-workspace")).data;
      if (saved.tasks.find((t) => t.id === task.id)?.state === "completed")
        break;
      await delay(200);
    }
    assert.equal(saved.tasks.find((t) => t.id === task.id)?.state, "completed");
    assert.equal(
      saved.notifications.filter((n) => n.taskId === task.id).length,
      1,
    );
    console.log(
      "PASS: opt-in actual Next.js server runner shares PGlite with HTTP, delivers one approved reminder automatically; zero provider/chain calls.",
    );
  }
  assert.deepEqual(errors, []);
  if (followupMode)
    console.log(
      "PASS: owned submitted-draft FIXTURE -> real HTTP proposal -> in-chat human read-only approval/pause/resume/cancel. Zero model/chain calls; no signed transfer claimed.",
    );
  console.log(
    `PASS: actual production HTTP/browser auth, task approval/idempotency, due delivery, stale rejection, memory confirmation/forget, mobile routes, in-chat approval/pause/resume/cancel, lazy wallet, persisted recovery, ${followupMode ? "enabled devnet draft fixture" : "disabled devnet boundary"}; zero provider or chain calls.`,
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((resolve) =>
    server.exitCode !== null ? resolve() : server.once("exit", resolve),
  );
  await rm(temp, { recursive: true, force: true });
}
