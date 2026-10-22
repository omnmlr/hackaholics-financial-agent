/** Synthetic transport tests; these do not establish provider authentication. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readProviderError } from "../src/lib/provider-diagnostics";
import { createConfiguredModel } from "../src/lib/financial-agent/model";
import { createGeminiToolModel } from "../src/lib/model-led-agent/model";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
const failure = () =>
  new Response(
    JSON.stringify({
      error: {
        code: 401,
        status: "UNAUTHENTICATED",
        message: "PRIVATE prompt account secret key",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "ACCESS_TOKEN_TYPE_UNSUPPORTED",
            domain: "PRIVATE",
            metadata: { api_key: "PRIVATE", prompt: "PRIVATE" },
          },
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "PRIVATE",
          },
          { "@type": "untrusted", reason: "API_KEY_INVALID" },
        ],
      },
    }),
    { status: 401 },
  );
const env = {
  AI_PROVIDER: "gemini",
  AI_MODEL: "gemini-3.5-flash-lite",
  AI_API_KEY: "AQ.synthetic-test-credential",
};
const input = () => ({
  system: "PRIVATE",
  contents: [{ role: "user", parts: [{ text: "PRIVATE" }] }],
  declarations: [],
  signal: AbortSignal.timeout(5000),
});

describe("provider diagnostics", () => {
  it("retains only known RPC status and ErrorInfo reasons", async () => {
    const details = await readProviderError(failure());
    expect(details).toEqual({
      providerCode: 401,
      providerStatus: "UNAUTHENTICATED",
      providerReasons: ["ACCESS_TOKEN_TYPE_UNSUPPORTED"],
    });
    expect(JSON.stringify(details)).not.toContain("PRIVATE");
  });
  it.each([
    "<html>PRIVATE</html>",
    "null",
    "{}",
    JSON.stringify({
      error: {
        code: "401",
        status: "PRIVATE",
        reason: "API_KEY_INVALID",
        details: [null],
      },
    }),
    "x".repeat(8193),
  ])("withholds malformed, unknown and oversized errors", async (body) => {
    expect(
      await readProviderError(new Response(body, { status: 401 })),
    ).toEqual({});
  });
  it("cancels a stalled error body within one second", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
      status: 401,
    });
    const result = readProviderError(response);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toEqual({});
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["native", "baseline"])(
    "logs sanitized %s failures and preserves the fixed application code",
    async (adapter) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetch = vi.fn(async () => failure());
      vi.stubGlobal("fetch", fetch);
      const result =
        adapter === "native"
          ? createGeminiToolModel(env).generate(input())
          : createConfiguredModel(env).generate("general", {}, input().signal);
      await expect(result).rejects.toMatchObject({ code: "MODEL_HTTP_401" });
      expect(fetch).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledOnce();
      const record = JSON.parse(log.mock.calls[0][0]);
      expect(record).toEqual({
        event: "agus_provider_http_error",
        version: 1,
        transport: adapter === "native" ? "gemini-sdk" : "gemini-rest",
        httpStatus: 401,
        providerCode: 401,
        providerStatus: "UNAUTHENTICATED",
        providerReasons: ["ACCESS_TOKEN_TYPE_UNSUPPORTED"],
      });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE|AQ\./);
    },
  );
  it("uses explicit AI_API_KEY for authorization-style keys despite ambient Google keys", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "different-synthetic-credential");
    const fetch = vi.fn(async (_url, options) => {
      expect(new Headers(options.headers).get("x-goog-api-key")).toBe(
        env.AI_API_KEY,
      );
      expect(new Headers(options.headers).has("Authorization")).toBe(false);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              finishReason: "STOP",
              content: { role: "model", parts: [{ text: "Hello" }] },
            },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetch);
    expect(await createGeminiToolModel(env).generate(input())).toMatchObject({
      text: "Hello",
    });
    expect(fetch.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent",
    );
  });
  it("demonstrates that the installed SDK honors an ambient Gemini gateway", async () => {
    vi.stubEnv("GOOGLE_GEMINI_BASE_URL", "https://synthetic-gateway.invalid");
    const fetch = vi.fn(async (_url: unknown) => failure());
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fetch);
    await expect(
      createGeminiToolModel(env).generate(input()),
    ).rejects.toMatchObject({ code: "MODEL_HTTP_401" });
    expect(String(fetch.mock.calls[0][0])).toMatch(
      /^https:\/\/synthetic-gateway\.invalid\//,
    );
  });
});
