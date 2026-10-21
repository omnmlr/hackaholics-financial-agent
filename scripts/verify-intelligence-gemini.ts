/** One bounded genuine-provider campaign. Synthetic prompts and in-memory
 * fictional records only. No application DB or payment engine is imported. */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createModelLedAgent } from "../src/lib/model-led-agent/agent";
import { createGeminiToolModel } from "../src/lib/model-led-agent/model";
import {
  createRepositoryAccess,
  MemoryContextStore,
} from "../src/lib/financial-agent";
import { scrub } from "../src/lib/financial-agent/protocol";
import {
  createFixtureRepository,
  createFixtureDataSource,
  createReadTools,
  fixturePrincipal,
  FIXTURE_NOW,
} from "../src/lib/financial-data";

if (
  process.env.PAYMENT_MODE !== "fixture" ||
  process.env.FINANCIAL_DEMO_ENABLED !== "true" ||
  process.env.DATABASE_URL
)
  throw new Error("ISOLATED_FIXTURE_REQUIRED");
const path = process.argv[2] ?? "/tmp/agus-intelligence-genuine.json";
const limit = 24;
const report = {
  commit: process.env.GITHUB_SHA ?? "local",
  genuineProvider: true,
  syntheticRecords: true,
  maximumHttpAttempts: limit,
  status: "running",
  attempts: [] as Array<{
    status: number | string;
    elapsedMs: number;
    finishReason?: string;
    inputTokens?: number;
    outputTokens?: number;
  }>,
  turns: [] as Array<Record<string, unknown>>,
};
const save = async () => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(report, null, 2));
};
const realFetch = globalThis.fetch;
let stopped = false,
  lastStart = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://generativelanguage.googleapis.com/"))
    throw new Error("UNEXPECTED_EXTERNAL_REQUEST");
  if (stopped || report.attempts.length >= limit)
    throw new Error("CAMPAIGN_LIMIT");
  const wait = Math.max(0, 6500 - (Date.now() - lastStart));
  if (wait) await delay(wait, undefined, { signal: init?.signal ?? undefined });
  init?.signal?.throwIfAborted();
  if (stopped || report.attempts.length >= limit)
    throw new Error("CAMPAIGN_LIMIT");
  const attempt: (typeof report.attempts)[number] = {
    status: "started",
    elapsedMs: 0,
  };
  report.attempts.push(attempt);
  await save();
  lastStart = Date.now();
  try {
    const response = await realFetch(input, init);
    attempt.status = response.status;
    attempt.elapsedMs = Date.now() - lastStart;
    if ([401, 403, 429].includes(response.status)) stopped = true;
    if (response.ok) {
      const raw = await response.clone().json();
      attempt.finishReason = raw.candidates?.[0]?.finishReason;
      attempt.inputTokens = raw.usageMetadata?.promptTokenCount;
      attempt.outputTokens = raw.usageMetadata?.candidatesTokenCount;
    }
    await save();
    return response;
  } catch {
    attempt.status = "transport_or_timeout";
    attempt.elapsedMs = Date.now() - lastStart;
    await save();
    throw new Error("BOUNDED_PROVIDER_FAILURE");
  }
};
try {
  if (!process.env.AI_API_KEY || process.env.AI_PROVIDER !== "gemini")
    throw new Error("MODEL_CONFIGURATION_REQUIRED");
  const repository = createFixtureRepository(),
    clock = () => FIXTURE_NOW;
  const tools = createReadTools({
    repository,
    sources: [createFixtureDataSource({ repository, clock })],
    clock,
  });
  const agent = createModelLedAgent({
    tools,
    access: createRepositoryAccess(repository, clock),
    store: new MemoryContextStore(),
    clock,
    model: createGeminiToolModel(),
  });
  for (const [id, chat, text, selected] of [
    ["greeting", "casual", "How are you doing?", false],
    ["multiplication", "math", "10 times 20 is what??", false],
    [
      "weekly-savings",
      "savings",
      "if i saved 10k every week, how long until i become a millionaire 👀🥲",
      false,
    ],
    ["starting-savings", "savings", "What if I already have ₦200k?", false],
    [
      "corrected-contribution",
      "savings",
      "Actually make it ₦15k weekly.",
      false,
    ],
    ["ada-search", "records", "Find payments to Ada in October 2026", true],
    ["ada-detail", "records", "Show details for the first candidate", true],
    [
      "recipient-credit",
      "records",
      "Was the recipient actually credited?",
      true,
    ],
  ] as const) {
    if (stopped || report.attempts.length >= limit) break;
    const start = Date.now();
    const reply = await agent.turn({
      ctx: fixturePrincipal,
      conversationId: chat,
      text,
      accountIds: selected ? ["amina-current"] : [],
    });
    report.turns.push({
      id,
      question: text,
      kind: reply.kind,
      text: scrub(reply.presentation?.explanation.join("\n\n") ?? reply.text),
      narration: reply.presentation?.narration ?? null,
      evidence: reply.evidence,
      elapsedMs: Date.now() - start,
    });
    await save();
  }
  report.status = stopped
    ? "stopped_on_auth_or_quota"
    : report.turns.length === 8
      ? "complete_requires_human_review"
      : "bounded_budget_exhausted";
} catch {
  report.status = "configuration_or_harness_unavailable";
} finally {
  globalThis.fetch = realFetch;
  await save();
}
// Contains only synthetic scenario wording and scrubbed final answers. No keys,
// request bodies, authorization metadata, raw provider errors or source records.
console.log("BEGIN_AGUS_INTELLIGENCE_EVIDENCE");
console.log(JSON.stringify(report));
console.log("END_AGUS_INTELLIGENCE_EVIDENCE");
if (report.status !== "complete_requires_human_review") process.exitCode = 2;
