// Provider text, metadata and headers may contain credentials or financial data.
// Retain only closed vocabularies, never arbitrary error messages or reasons.
const statuses = new Set([
  "INVALID_ARGUMENT",
  "FAILED_PRECONDITION",
  "OUT_OF_RANGE",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "RESOURCE_EXHAUSTED",
  "CANCELLED",
  "UNKNOWN",
  "INTERNAL",
  "UNIMPLEMENTED",
  "UNAVAILABLE",
  "DEADLINE_EXCEEDED",
]);
const reasons = new Set([
  "ACCESS_TOKEN_TYPE_UNSUPPORTED",
  "ACCESS_TOKEN_EXPIRED",
  "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
  "CREDENTIALS_MISSING",
  "API_KEY_INVALID",
  "API_KEY_EXPIRED",
  "API_KEY_NOT_FOUND",
  "API_KEY_SERVICE_BLOCKED",
  "API_KEY_IP_ADDRESS_BLOCKED",
  "API_KEY_HTTP_REFERRER_BLOCKED",
  "API_KEY_ANDROID_APP_BLOCKED",
  "API_KEY_IOS_APP_BLOCKED",
  "SERVICE_DISABLED",
  "BILLING_DISABLED",
  "CONSUMER_INVALID",
  "IAM_PERMISSION_DENIED",
  "RATE_LIMIT_EXCEEDED",
  "QUOTA_EXCEEDED",
  "RESOURCE_EXHAUSTED",
]);

export type ProviderErrorDetails = {
  providerCode?: number;
  providerStatus?: string;
  providerReasons?: string[];
};

/** Consume only failed responses, at most 8 KiB and one second. The SDK receives
 * a fixed replacement envelope; the original error never enters its exception. */
export async function readProviderError(
  response: Response,
): Promise<ProviderErrorDetails> {
  const reader = response.body?.getReader();
  if (!reader) return {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("DIAGNOSTIC_TIMEOUT")), 1000);
    });
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await Promise.race([reader.read(), timeout]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8192) return {};
      chunks.push(part.value);
    }
    const error = JSON.parse(Buffer.concat(chunks).toString("utf8"))?.error;
    const safeReasons: string[] = Array.isArray(error?.details)
      ? [
          ...new Set<string>(
            error.details.flatMap((detail: Record<string, unknown>) =>
              detail?.["@type"] ===
                "type.googleapis.com/google.rpc.ErrorInfo" &&
              typeof detail.reason === "string" &&
              reasons.has(detail.reason)
                ? [detail.reason]
                : [],
            ),
          ),
        ].slice(0, 4)
      : [];
    return {
      ...(Number.isInteger(error?.code) &&
      error.code >= 100 &&
      error.code <= 599
        ? { providerCode: error.code }
        : {}),
      ...(statuses.has(error?.status) ? { providerStatus: error.status } : {}),
      ...(safeReasons.length ? { providerReasons: safeReasons } : {}),
    };
  } catch {
    return {};
  } finally {
    if (timer) clearTimeout(timer);
    // A hostile/stalled stream must not extend the diagnostic deadline.
    void reader.cancel().catch(() => {});
  }
}

export async function diagnoseProviderFailure(
  response: Response,
  transport: "gemini-sdk" | "gemini-rest" | "openai-rest",
) {
  const details = await readProviderError(response);
  console.error(
    JSON.stringify({
      event: "agus_provider_http_error",
      version: 1,
      transport,
      httpStatus: response.status,
      ...details,
    }),
  );
  return details;
}
