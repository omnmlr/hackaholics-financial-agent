import createClient from "openapi-fetch";
import type { paths } from "./generated";
export type { components, paths } from "./generated";
/** One request per explicit call. Financial idempotency keys come from durable
 * caller intent; this client never retries a write or invents a fresh key. */
export function createApiClient(
  baseUrl: string,
  transport: typeof fetch = fetch,
) {
  return createClient<paths>({
    baseUrl,
    fetch: transport,
    credentials: "include",
  });
}
