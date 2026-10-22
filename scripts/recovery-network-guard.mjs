/* global URL: readonly, Request: readonly */
// Genuine inference only, bounded and isolated from payment/provider services.
// Loaded exclusively by verify-production-recovery.mjs in its local child.
if (
  process.env.PAYMENT_MODE !== "fixture" ||
  process.env.FINANCIAL_DEMO_ENABLED !== "true" ||
  !process.env.DATABASE_URL?.startsWith("pglite://") ||
  process.env.LIVE_TRANSFERS_ENABLED !== "false" ||
  process.env.PAYSTACK_TRANSFERS_ENABLED !== "false"
)
  throw new Error("ISOLATED_RECOVERY_ENV_REQUIRED");
const original = globalThis.fetch;
let attempts = 0;
let blocked = false;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    blocked ||
    ++attempts > 40 ||
    url.origin !== "https://generativelanguage.googleapis.com" ||
    !/^\/v1beta\/models\/gemini-[a-z0-9.-]+:generateContent$/.test(
      url.pathname,
    ) ||
    url.search ||
    url.username ||
    url.password
  )
    throw new Error("RECOVERY_DESTINATION_OR_BUDGET_REJECTED");
  const attempt = attempts;
  console.info(
    JSON.stringify({
      event: "recovery_provider_request",
      status: "pending",
      attempt,
    }),
  );
  let response;
  try {
    response = await original(input, { ...init, redirect: "error" });
  } catch {
    console.info(
      JSON.stringify({
        event: "recovery_provider_result",
        status: "network_or_timeout",
        attempt,
      }),
    );
    throw new Error("RECOVERY_TRANSPORT_FAILED");
  }
  if ([401, 403, 429].includes(response.status)) blocked = true;
  console.info(
    JSON.stringify({
      event: "recovery_provider_result",
      status: response.status,
      attempt,
    }),
  );
  if (response.ok) {
    const data = await response.clone().json();
    console.info(
      JSON.stringify({
        event: "recovery_synthetic_content",
        parts: (data.candidates?.[0]?.content?.parts ?? [])
          .filter((p) => !p.thought)
          .map((p) =>
            p.functionCall
              ? { functionCall: p.functionCall }
              : { text: p.text },
          ),
      }),
    );
  }
  return response;
};
