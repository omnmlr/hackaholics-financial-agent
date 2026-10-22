/** Three synthetic requests: direct REST, installed SDK, AGUS native adapter.
 * Run with AI_API_KEY/AI_MODEL injected securely. No DB or payment imports.
 * Only allowlisted diagnostics leave this process; no prompts/responses/keys.
 * On proxy-based environments launch with NODE_USE_ENV_PROXY=1 (Node 24+).
 */
import { GoogleGenAI } from "@google/genai";
import { createGeminiToolModel } from "../src/lib/model-led-agent/model";
import { readProviderError } from "../src/lib/provider-diagnostics";

const key = process.env.AI_API_KEY;
const model = process.env.AI_MODEL;
const emit = (data: object) => console.log(JSON.stringify(data));
if (!key || !model || !/^gemini-[a-z0-9.-]{1,80}$/.test(model)) {
  emit({
    event: "gemini_diagnostic_preflight",
    ready: false,
    code: key ? "AI_MODEL_REQUIRED" : "AI_API_KEY_REQUIRED",
  });
  process.exit(2);
}
emit({
  event: "gemini_diagnostic_preflight",
  ready: true,
  model,
  ambientSettingsPresent: [
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_GENAI_USE_VERTEXAI",
    "GOOGLE_GENAI_USE_ENTERPRISE",
    "GOOGLE_GEMINI_BASE_URL",
    "GOOGLE_VERTEX_BASE_URL",
  ].filter((name) => !!process.env[name]),
});
const originalFetch = globalThis.fetch;
let stage: "direct" | "sdk" | "agus" = "direct";
let attempts = 0;
let successful = 0;
let sdkValidated = false;
let adapterValidated = false;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const endpoint =
    url.hostname === "generativelanguage.googleapis.com"
      ? "gemini-developer"
      : url.hostname === "aiplatform.googleapis.com"
        ? "google-enterprise"
        : "custom";
  if (
    ++attempts > 3 ||
    endpoint === "custom" ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.port
  ) {
    emit({ stage, endpoint, code: "DIAGNOSTIC_DESTINATION_REJECTED" });
    throw new Error("DIAGNOSTIC_DESTINATION_REJECTED");
  }
  const started = performance.now();
  try {
    const response = await originalFetch(input, {
      ...init,
      redirect: "error",
      signal: AbortSignal.any([
        AbortSignal.timeout(20000),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
    const details = response.ok ? {} : await readProviderError(response);
    if (response.ok) successful++;
    emit({
      event: "gemini_diagnostic_request",
      stage,
      endpoint,
      explicitKeyUsed: new Headers(init?.headers).get("x-goog-api-key") === key,
      httpStatus: response.status,
      ...details,
      elapsedMs: Math.round(performance.now() - started),
    });
    return response.ok
      ? response
      : new Response(
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
  } catch {
    emit({
      event: "gemini_diagnostic_request",
      stage,
      endpoint,
      code: "NETWORK_OR_TIMEOUT",
      elapsedMs: Math.round(performance.now() - started),
    });
    throw new Error("DIAGNOSTIC_REQUEST_FAILED");
  }
};
try {
  const direct = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
      }),
    },
  ).catch(() => undefined);
  await direct?.body?.cancel();
  stage = "sdk";
  try {
    const result = await new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        timeout: 20000,
        retryOptions: { attempts: 1 },
        fetch: (url, init) => globalThis.fetch(url, init),
      },
    }).models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    });
    sdkValidated = !!result.text?.trim();
  } catch {
    /* All provider output is withheld; the transport emitted safe fields. */
  }
  // Authentication must work at both lower layers before AGUS acceptance.
  if (direct?.ok && sdkValidated) {
    stage = "agus";
    try {
      const result = await createGeminiToolModel({
        ...process.env,
        AI_PROVIDER: "gemini",
      }).generate({
        system: "Reply with a brief greeting.",
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        declarations: [],
        signal: AbortSignal.timeout(20000),
      });
      adapterValidated = !!result.text.trim();
    } catch {
      /* Never print SDK exception text or the model's output. */
    }
  }
} finally {
  globalThis.fetch = originalFetch;
}
emit({
  event: "gemini_diagnostic_complete",
  attempts,
  successful,
  sdkValidated,
  adapterValidated,
  fullConversationAcceptance: false,
});
process.exitCode = successful === 3 && sdkValidated && adapterValidated ? 0 : 1;
