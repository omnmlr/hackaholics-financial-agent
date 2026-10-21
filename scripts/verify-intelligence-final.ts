/** Remaining 3 requests in the single 40-request release acceptance budget. */
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createModelLedAgent } from "../src/lib/model-led-agent/agent";
import { createGeminiToolModel } from "../src/lib/model-led-agent/model";
import {
  createRepositoryAccess,
  MemoryContextStore,
} from "../src/lib/financial-agent";
import {
  createFixtureRepository,
  createFixtureDataSource,
  createReadTools,
  fixturePrincipal,
  FIXTURE_NOW,
} from "../src/lib/financial-data";

const prior = await Promise.all(
  ["genuine-initial.json", "genuine-repair.json"].map(async (file) =>
    JSON.parse(await readFile(`docs/intelligence-motion/${file}`, "utf8")),
  ),
);
if (
  prior.reduce((n, r) => n + r.attempts.length, 0) !== 37 ||
  process.env.DATABASE_URL ||
  process.env.PAYMENT_MODE !== "fixture" ||
  process.env.FINANCIAL_DEMO_ENABLED !== "true"
)
  throw new Error("CAMPAIGN_LEDGER_OR_FIXTURE_INVALID");
const path = process.argv[2] ?? "/tmp/agus-intelligence-final.json";
const report: Record<string, unknown> = {
  commit: process.env.GITHUB_SHA,
  priorHttpAttempts: 37,
  maximumAdditionalAttempts: 3,
  aggregateMaximum: 40,
  genuineProvider: true,
  syntheticRecords: true,
};
let attempts = 0,
  last = 0,
  blocked = false;
const statuses: number[] = [],
  realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (
    !String(input instanceof Request ? input.url : input).startsWith(
      "https://generativelanguage.googleapis.com/",
    ) ||
    blocked ||
    attempts >= 3
  )
    throw new Error("CAMPAIGN_LIMIT");
  await delay(Math.max(0, 6500 - (Date.now() - last)), undefined, {
    signal: init?.signal ?? undefined,
  });
  init?.signal?.throwIfAborted();
  attempts++;
  last = Date.now();
  await writeFile(
    path,
    JSON.stringify({ ...report, attempts, status: "running" }, null, 2),
  );
  const response = await realFetch(input, init);
  statuses.push(response.status);
  if ([401, 403, 429].includes(response.status)) blocked = true;
  return response;
};
try {
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
  const reply = await agent.turn({
    ctx: fixturePrincipal,
    conversationId: "final-ada",
    text: "Find payments to Ada in October 2026",
    accountIds: ["amina-current"],
  });
  report.reply = {
    kind: reply.kind,
    narration: reply.presentation?.narration,
    explanation: reply.presentation?.explanation,
    evidence: reply.evidence,
  };
  report.status = "complete_requires_human_review";
} catch {
  report.status = "unavailable";
} finally {
  globalThis.fetch = realFetch;
  report.attempts = attempts;
  report.httpStatuses = statuses;
  await writeFile(path, JSON.stringify(report, null, 2));
}
console.log("BEGIN_AGUS_INTELLIGENCE_FINAL");
console.log(JSON.stringify(report));
console.log("END_AGUS_INTELLIGENCE_FINAL");
if (report.status !== "complete_requires_human_review") process.exitCode = 2;
