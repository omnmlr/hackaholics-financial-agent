// Loaded BEFORE scripted transports, so their fallback cannot reach a provider.
import { URL } from "node:url";
const localFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string" || input instanceof URL ? input : input.url,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  )
    throw new Error("Isolated fixture preview blocks external requests");
  // Redirects must not turn an allowed loopback request into external egress.
  return localFetch(input, { ...init, redirect: "error" });
};
