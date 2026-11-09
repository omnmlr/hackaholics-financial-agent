/** Real authenticated route + official Gemini SDK serialization + SQL, intercepted transport.
 * Fictional inputs/scripted model responses: not genuine-provider quality evidence. */
import { randomUUID, randomBytes, scryptSync } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { login } from "../src/lib/auth";
import { db } from "../src/lib/db";
import { POST } from "../src/app/api/conversation/route";
import { GET as chats } from "../src/app/api/conversations/route";
import { GET as runs, POST as control } from "../src/app/api/agent-runs/route";
import { runJournal } from "../src/lib/personal-agent/journal";
import { workspace } from "../src/lib/agent-workspace/store";
const base = "http://localhost:3000";
let token: string;
function req(path: string, body?: unknown, origin = base, cookie = token) {
  return new Request(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      origin,
      cookie: `ha_session=${cookie}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
beforeAll(async () => {
  const password = randomBytes(24).toString("hex"),
    salt = randomBytes(16).toString("hex");
  Object.assign(process.env, {
    DATABASE_URL: "pglite://:memory:",
    PAYMENT_MODE: "fixture",
    FINANCIAL_DEMO_ENABLED: "false",
    AGUS_WORKSPACE_ENABLED: "true",
    AGUS_AGENT_ARCHITECTURE: "native-gemini",
    AGUS_SOLANA_DEVNET_ENABLED: "false",
    AI_PROVIDER: "gemini",
    AI_API_KEY: "scripted-transport-not-a-real-key",
    AI_MODEL: "gemini-3.5-flash-lite",
    APP_ORIGIN: base,
    OPERATOR_ID: "engine-http",
    OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  });
  token = await login(password);
});
afterAll(() => vi.unstubAllGlobals());
function transport(outputs: unknown[]) {
  let index = 0;
  const mock = vi.fn(async (url: unknown, init?: RequestInit) => {
    expect(String(url)).toContain("generativelanguage.googleapis.com");
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction.parts[0].text).toContain("AGUS");
    const review =
      body.generationConfig?.responseMimeType === "application/json";
    const parts = review ? [{ text: '{"grounded":true}' }] : outputs[index++];
    if (!parts) throw new Error("scripted provider outage");
    return new Response(
      JSON.stringify({
        candidates: [
          { content: { role: "model", parts }, finishReason: "STOP" },
        ],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
it("runs a compound goal through Gemini function calls with the financial fixture disabled, records approvals, and replays without duplicate effects", async () => {
  const requestId = randomUUID(),
    conversationId = "native-general-http";
  const wire = transport([
    [
      {
        functionCall: {
          id: "plan-id",
          name: "update_plan",
          args: {
            steps: [
              {
                id: "estimate",
                description: "Calculate supplied costs",
                kind: "tool",
                status: "in_progress",
              },
              {
                id: "remember",
                description: "Prepare a preference note",
                kind: "tool",
                status: "pending",
              },
            ],
          },
        },
      },
    ],
    [
      {
        functionCall: {
          id: "calc-id",
          name: "calculate",
          args: {
            expression: "2500*4+1500",
            description: "Supplied estimate",
            unit: "naira",
            assumptions: ["User-stated hypothetical costs"],
          },
        },
      },
    ],
    [
      {
        functionCall: {
          id: "memory-id",
          name: "save_memory_proposal",
          args: {
            text: "Review flexible commitments with Gerald",
            category: "preference",
          },
        },
      },
      {
        functionCall: {
          id: "task-id",
          name: "prepare_responsibility",
          args: {
            title: "Review supplied estimate",
            objective: "Review the terms; do not pay",
            dueAt: "2026-11-11T10:00:00Z",
          },
        },
      },
    ],
    [
      {
        text: "The supplied costs total ₦11,500. I prepared your preference and reminder for review; neither is confirmed or active. Calling and bank payments are not available here, but the estimate and preparation are saved.",
      },
    ],
  ]);
  const input = {
    conversationId,
    requestId,
    text: "Estimate four items at 2500 each plus 1500 delivery, save my preference to review flexible commitments with Gerald, and prepare a reminder for 11 November at 10:00 UTC. Don't pay.",
    accountIds: [],
  };
  const response = await POST(req("/api/conversation", input));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.financialSimulation).toBeNull();
  expect(body.simulation).toBeUndefined();
  expect(body.reply.text).toContain("11,500");
  expect(body.reply.execution.state).toBe("waiting_user");
  expect(
    body.reply.workspaceActions.map((a: { kind: string }) => a.kind),
  ).toEqual(["memory", "responsibility"]);
  const sent = wire.mock.calls.map((c) => JSON.parse(String(c[1]?.body)));
  const reminderDeclaration = sent[0].tools[0].functionDeclarations.find(
    (d: { name: string }) => d.name === "prepare_responsibility",
  );
  expect(
    reminderDeclaration.parametersJsonSchema.properties,
  ).not.toHaveProperty("requestId");
  const finalRequest = sent[sent.length - 2];
  expect(JSON.stringify(finalRequest.contents)).toContain('"id":"memory-id"');
  expect(JSON.stringify(finalRequest.contents)).toContain('"functionResponse"');
  expect(JSON.stringify(finalRequest.contents)).toContain('"value":"11500"');
  const firstCalls = wire.mock.calls.length;
  const retry = await POST(req("/api/conversation", input));
  const replay = await retry.json();
  expect(retry.status).toBe(200);
  expect(replay.reply.execution.replayed).toBe(true);
  expect(wire).toHaveBeenCalledTimes(firstCalls);
  expect(replay.turn.id).toBe(body.turn.id);
  const snapshot = await workspace("engine-http").snapshot();
  expect(snapshot.tasks).toHaveLength(1);
  expect(snapshot.tasks[0].state).toBe("awaiting_approval");
  expect(snapshot.memories).toHaveLength(1);
  expect(snapshot.memories[0].confirmed).toBe(false);
  const history = await (
    await chats(req(`/api/conversations?id=${conversationId}`))
  ).json();
  expect(history.turns).toHaveLength(1);
  const metadata = await (
    await runs(req(`/api/agent-runs?id=${requestId}`))
  ).json();
  expect(metadata.runs[0].steps).toHaveLength(4);
  expect(metadata.runs[0].version).toBeGreaterThan(0);
  expect(JSON.stringify(metadata)).not.toContain(
    "scripted-transport-not-a-real-key",
  );
  const tables = await (
    await db()
  ).execute(sql`SELECT to_regclass('fm_accounts') AS financial_table`);
  expect(tables.rows[0].financial_table).toBeNull();
});
it("retrieves confirmed context across conversations without promoting a memory statement to bank evidence", async () => {
  const memory = await workspace("engine-http").proposeMemory({
    text: "Prefer concise comparisons with explicit assumptions",
    category: "preference",
  });
  await workspace("engine-http").memoryAction(memory.id, "confirm");
  const wire = transport([
    [
      {
        text: "I will compare the alternatives concisely and state the assumptions.",
      },
    ],
  ]);
  const response = await POST(
    req("/api/conversation", {
      conversationId: "new-context",
      text: "Help me reason through a difficult choice",
      accountIds: [],
    }),
  );
  expect(response.status).toBe(200);
  const sent = JSON.parse(String(wire.mock.calls[0][1]?.body));
  expect(JSON.stringify(sent.contents)).toContain("Prefer concise comparisons");
  expect(sent.systemInstruction.parts[0].text).toContain(
    "not independently verified truth",
  );
  expect(wire).toHaveBeenCalledTimes(1);
});
it("keeps provider failures inspectable and resumes the same run through the original authenticated conversation route", async () => {
  const requestId = randomUUID();
  transport([]);
  const input = {
    conversationId: "recover-http",
    requestId,
    text: "Explain how to prioritize competing commitments",
    accountIds: [],
  };
  const interrupted = await (
    await POST(req("/api/conversation", input))
  ).json();
  expect(interrupted.reply.execution.state).toBe("interrupted");
  const saved = await runJournal("engine-http").read(requestId);
  transport([
    [
      {
        text: "Rank the commitments by urgency, impact and reversibility, then choose the smallest useful next step.",
      },
    ],
  ]);
  const resumed = await control(
    req("/api/agent-runs", {
      action: "resume",
      id: requestId,
      version: saved.version,
      acknowledged: true,
    }),
  );
  const body = await resumed.json();
  expect(resumed.status).toBe(200);
  expect(body.reply.execution.id).toBe(requestId);
  expect(body.reply.execution.state).toBe("completed");
  const history = await (
    await chats(req("/api/conversations?id=recover-http"))
  ).json();
  expect(history.turns).toHaveLength(1);
  expect(history.turns[0].reply.execution.state).toBe("completed");
});
it("rejects identity conflicts, untrusted control origins, missing authentication, stale versions and foreign run access", async () => {
  const foreign = await runJournal("different-owner").create({
    conversationId: "foreign",
    goal: "Private goal",
    accountIds: [],
  });
  expect((await runs(req(`/api/agent-runs?id=${foreign.id}`))).status).toBe(
    404,
  );
  expect(
    (await runs(req("/api/agent-runs", undefined, base, "invalid"))).status,
  ).toBe(401);
  expect(
    (
      await control(
        req(
          "/api/agent-runs",
          { action: "cancel", id: foreign.id, version: 0, acknowledged: true },
          "https://elsewhere.invalid",
        ),
      )
    ).status,
  ).toBe(403);
  const run = await runJournal("engine-http").create({
    conversationId: "control-test",
    goal: "Safe planning",
    accountIds: [],
  });
  const paused = await control(
    req("/api/agent-runs", {
      action: "pause",
      id: run.id,
      version: 0,
      acknowledged: true,
    }),
  );
  expect(paused.status).toBe(200);
  expect(
    (
      await control(
        req("/api/agent-runs", {
          action: "cancel",
          id: run.id,
          version: 0,
          acknowledged: true,
        }),
      )
    ).status,
  ).toBe(409);
  await expect(
    runJournal("engine-http").create({
      id: run.id,
      conversationId: run.conversationId,
      goal: "Different instructions",
      accountIds: [],
    }),
  ).rejects.toMatchObject({ status: 409 });
});

it("composes a focused financial specialist using authorized fixture sources and retains the original source presentation", async () => {
  process.env.FINANCIAL_DEMO_ENABLED = "true";
  const { runPersonalConversation } =
    await import("../src/lib/personal-agent/conversation");
  const { AgentError } = await import("../src/lib/financial-agent/protocol");
  let rootCalls = 0,
    childCalls = 0;
  const model: import("../src/lib/model-led-agent/model").ToolModel = {
    provider: "scripted",
    model: "scripted",
    async generate(input) {
      if (input.responseJsonSchema) {
        const text = '{"grounded":true}';
        return {
          text,
          content: { role: "model", parts: [{ text }] },
          calls: [],
        };
      }
      if (
        input.system.includes("intelligent conversational financial assistant")
      ) {
        expect(JSON.stringify(input.contents)).toContain(
          "Financial subtask selected by the coordinator",
        );
        expect(
          input.declarations.some((d) => d.name === "prepare_payment_draft"),
        ).toBe(false);
        if (childCalls++) throw new AgentError("MODEL_NETWORK");
        const call = {
          name: "get_account_summary",
          args: { accountIds: ["amina-current"] },
        };
        return {
          text: "",
          content: { role: "model", parts: [{ functionCall: call }] },
          calls: [call],
        };
      }
      if (rootCalls++ === 0) {
        const call = {
          name: "analyze_finances",
          args: {
            focus:
              "Inspect the current selected account summary and report source limitations",
          },
        };
        return {
          text: "",
          content: { role: "model", parts: [{ functionCall: call }] },
          calls: [call],
        };
      }
      const text =
        "The selected account summary is attached from the authorized fictional records. These fixture records are not a live bank connection. I can use verified information to help compare the available options.";
      return { text, content: { role: "model", parts: [{ text }] }, calls: [] };
    },
  };
  try {
    const result = await runPersonalConversation(
      req("/api/conversation"),
      {
        conversationId: "financial-composition",
        text: "Check the selected account summary and help me compare my options",
        accountIds: ["amina-current"],
      },
      model,
    );
    expect(result.execution?.state).toBe("completed");
    expect(result.presentation?.results[0].type).toBe("get_account_summary");
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.presentation?.explanation.join(" ")).toContain(
      "compare the available options",
    );
    expect(result.handoff).toBeUndefined();
    expect(childCalls).toBe(2);
  } finally {
    process.env.FINANCIAL_DEMO_ENABLED = "false";
  }
});
