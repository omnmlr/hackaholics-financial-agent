/** Bounded genuine capacity sample for the new diagnostic credential only.
 * 24 generations: 8 text, 8 structured, 4 native tool round trips (8 calls).
 * No DB/payment modules. One request at a time, <=10 starts/minute, no retries.
 * Every request is counted before sending; stop on any HTTP/network failure.
 */
import { writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { Content } from "@google/genai";
import { createGeminiToolModel } from "../src/lib/model-led-agent/model";
import { readProviderError } from "../src/lib/provider-diagnostics";

const modelId = "gemini-3.5-flash-lite";
const output = process.argv[2] ?? "/tmp/agus-flash-lite-capacity.json";
if (!process.env.AI_API_KEY || process.env.AI_MODEL !== modelId)
  throw new Error("EXPLICIT_FLASH_LITE_CONFIGURATION_REQUIRED");
const maximumRequests = 24;
const minimumStartIntervalMs = 6500;
const attempts: Array<{
  number: number;
  scenario: string;
  startedAt: string;
  status: number | "pending" | "network_or_timeout";
  elapsedMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  providerStatus?: string;
  providerReasons?: string[];
}> = [];
const results: Array<{ id: string; passed: boolean; text?: string }> = [];
let scenario = "setup",
  stopped = false,
  lastStart = 0;
const report = {
  model: modelId,
  credential: "user-confirmed-new-key-not-production-key",
  productionChanged: false,
  genuine: true,
  syntheticInputs: true,
  databaseAccess: false,
  paymentCapability: false,
  maximumRequests,
  minimumStartIntervalMs,
  concurrency: 1,
  retries: 0,
  startedAt: new Date().toISOString(),
  status: "RUNNING",
  attempts,
  results,
  summary: {} as Record<string, unknown>,
};
const save = () =>
  writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    stopped ||
    attempts.length >= maximumRequests ||
    url.origin !== "https://generativelanguage.googleapis.com" ||
    url.pathname !== `/v1beta/models/${modelId}:generateContent` ||
    url.search ||
    url.username ||
    url.password
  )
    throw new Error("CAPACITY_DESTINATION_OR_BUDGET_REJECTED");
  const attempt: (typeof attempts)[number] = {
    number: attempts.length + 1,
    scenario,
    startedAt: new Date().toISOString(),
    status: "pending",
  };
  attempts.push(attempt);
  await save();
  const started = performance.now();
  try {
    const response = await originalFetch(input, { ...init, redirect: "error" });
    attempt.status = response.status;
    if (!response.ok) {
      stopped = true;
      const details = await readProviderError(response);
      Object.assign(attempt, details);
      return new Response(
        JSON.stringify({
          error: {
            code: response.status,
            status: details.providerStatus ?? "UNKNOWN",
            message: "Provider request failed",
          },
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    const data = await response.clone().json();
    attempt.inputTokens = Number(data.usageMetadata?.promptTokenCount ?? 0);
    attempt.outputTokens = Number(
      data.usageMetadata?.candidatesTokenCount ?? 0,
    );
    attempt.totalTokens = Number(data.usageMetadata?.totalTokenCount ?? 0);
    return response;
  } catch {
    stopped = true;
    attempt.status = "network_or_timeout";
    throw new Error("CAPACITY_TRANSPORT_FAILED");
  } finally {
    attempt.elapsedMs = Math.round(performance.now() - started);
    await save();
  }
};
const model = createGeminiToolModel({
  ...process.env,
  AI_PROVIDER: "gemini",
  AI_MODEL: modelId,
});
async function generate(
  input: Omit<Parameters<typeof model.generate>[0], "signal">,
) {
  if (stopped) throw new Error("CAPACITY_STOPPED");
  // Outside the model call: pacing never consumes AGUS's 20-second deadline.
  await delay(Math.max(0, minimumStartIntervalMs - (Date.now() - lastStart)));
  lastStart = Date.now();
  return model.generate({ ...input, signal: AbortSignal.timeout(20000) });
}
try {
  await save();
  for (let i = 1; i <= 8; i++) {
    scenario = `text-${i}`;
    const r = await generate({
      system:
        "Answer briefly and naturally. Do not claim personal records or bank access.",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `In one sentence, explain why saving regularly helps form a habit. Use a fresh wording for example ${i}.`,
            },
          ],
        },
      ],
      declarations: [],
    });
    results.push({
      id: scenario,
      passed: !r.calls.length && r.text.trim().length > 15,
      text: r.text,
    });
  }
  for (let i = 1; i <= 8; i++) {
    scenario = `structured-${i}`;
    const r = await generate({
      system:
        "Extract the synthetic draft exactly. Preparation only; nothing is verified, approved or submitted.",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: `Fictional draft: beneficiary Ada; amount ${500 + i} naira; purpose Lunch. Return these fields and prepared_only=true.`,
            },
          ],
        },
      ],
      declarations: [],
      responseJsonSchema: {
        type: "object",
        properties: {
          beneficiary: { type: "string" },
          amountNaira: { type: "integer" },
          purpose: { type: "string" },
          prepared_only: { type: "boolean" },
        },
        required: ["beneficiary", "amountNaira", "purpose", "prepared_only"],
        additionalProperties: false,
      },
    });
    let passed = false;
    try {
      const d = JSON.parse(r.text);
      passed =
        !r.calls.length &&
        d.beneficiary === "Ada" &&
        d.amountNaira === 500 + i &&
        d.purpose === "Lunch" &&
        d.prepared_only === true;
    } catch {
      /* failed quality assertion */
    }
    results.push({ id: scenario, passed, text: r.text });
  }
  for (let i = 1; i <= 4; i++) {
    scenario = `native-tool-${i}`;
    const a = 11 + i,
      b = 3 + i;
    const contents: Content[] = [
      {
        role: "user",
        parts: [
          {
            text: `Use compute_product for ${a} multiplied by ${b}. After its response state the result in one sentence.`,
          },
        ],
      },
    ];
    const declarations = [
      {
        name: "compute_product",
        description:
          "Multiply the two supplied synthetic integers using backend arithmetic.",
        parametersJsonSchema: {
          type: "object",
          properties: { a: { type: "integer" }, b: { type: "integer" } },
          required: ["a", "b"],
          additionalProperties: false,
        },
      },
    ];
    const first = await generate({
      system:
        "Call the supplied tool before answering. Treat its returned product as authoritative; never claim payment or personal account access.",
      contents,
      declarations,
    });
    const call = first.calls[0];
    const args = call?.args as { a?: number; b?: number } | undefined;
    if (
      first.calls.length !== 1 ||
      call?.name !== "compute_product" ||
      args?.a !== a ||
      args.b !== b
    ) {
      results.push({ id: scenario, passed: false });
      report.status = "STOPPED_TOOL_VALIDATION";
      break;
    }
    contents.push(first.content, {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: call.name,
            ...(call.id ? { id: call.id } : {}),
            response: { product: a * b },
          },
        },
      ],
    });
    const second = await generate({
      system: "State the backend product briefly. Do not call another tool.",
      contents,
      declarations: [],
    });
    results.push({
      id: scenario,
      passed:
        !second.calls.length && new RegExp(`\\b${a * b}\\b`).test(second.text),
      text: second.text,
    });
  }
  if (report.status === "RUNNING")
    report.status =
      attempts.length === maximumRequests && results.every((r) => r.passed)
        ? "PASS"
        : "QUALITY_FAILURE";
} catch {
  report.status = "STOPPED_PROVIDER_OR_COMPLETION_FAILURE";
} finally {
  globalThis.fetch = originalFetch;
  const latency = attempts
    .filter((a) => a.status === 200)
    .map((a) => a.elapsedMs ?? 0)
    .sort((a, b) => a - b);
  const percentile = (p: number) =>
    latency.length ? latency[Math.ceil(p * latency.length) - 1] : null;
  report.summary = {
    finishedAt: new Date().toISOString(),
    attemptedRequests: attempts.length,
    http200: attempts.filter((a) => a.status === 200).length,
    failedOrPending: attempts.filter((a) => a.status !== 200).length,
    qualityPasses: results.filter((r) => r.passed).length,
    qualityCases: results.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: latency.at(-1) ?? null,
    inputTokens: attempts.reduce((s, a) => s + (a.inputTokens ?? 0), 0),
    totalTokens: attempts.reduce((s, a) => s + (a.totalTokens ?? 0), 0),
    exactProjectQuotaVerified: false,
    productionCredentialTested: false,
  };
  await save();
  console.log(JSON.stringify({ status: report.status, ...report.summary }));
  process.exitCode = report.status === "PASS" ? 0 : 1;
}
