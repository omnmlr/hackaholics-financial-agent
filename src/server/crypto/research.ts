import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { privateAgentText } from "../../lib/personal-agent/privacy";
import { operationalEvent } from "../observability";
import { transaction } from "../sql";

const searchEndpoint = "https://api.firecrawl.dev/v2/search";
const searchTimeoutMs = 4500;
const resultLimit = 4;
const cacheLimit = 128;
const contentLimit = 64 * 1024;

export type ResearchIntent =
  "news" | "protocol" | "security" | "regulatory" | "link";
export type ResearchCitation = {
  id: string;
  url: string;
  title: string;
  publishedAt: string | null;
  retrievedAt: string;
  kind: "web" | "news";
};
export type ResearchSource = ResearchCitation & { snippet: string };
export type ResearchResult =
  | { status: "ready"; sources: ResearchSource[]; cached: boolean }
  | {
      status:
        | "disabled"
        | "invalid_request"
        | "no_results"
        | "limited"
        | "unavailable";
    };

type ResearchRequest = {
  owner: string;
  topic: string | null;
  intent: ResearchIntent;
  url?: string;
  sensitiveValues?: readonly string[];
  signal: AbortSignal;
};
type SearchRequest = {
  query: string;
  sources: Array<ResearchCitation["kind"]>;
  tbs?: "qdr:w" | "qdr:m";
};

const providerItem = z.object({
  url: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  snippet: z.string().optional(),
  date: z.string().optional(),
  publishedDate: z.string().optional(),
  publishedAt: z.string().optional(),
});
const providerItems = z.array(z.unknown()).max(40).optional();
const providerResponse = z.object({
  success: z.literal(true),
  data: z.object({ web: providerItems, news: providerItems }),
});

function fold(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

function containsSensitive(value: string, extra: readonly string[]) {
  const normalized = fold(value);
  const words = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .join(" ");
  return (
    privateAgentText(value) !== value ||
    /\b(?:bearer|password|mnemonic|passphrase|credential|api[ _-]?key|private[ _-]?key|seed[ _-]?phrase|recovery[ _-]?phrase|access[ _-]?token)\b/i.test(
      value,
    ) ||
    /[1-9A-HJ-NP-Za-km-z]{28,}|\b[A-Za-z0-9_=-]{22,}\b/.test(value) ||
    extra.some((item) => {
      const term = fold(item.trim());
      if (term.length < 3) return false;
      const termWords = term
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean)
        .join(" ");
      return (
        normalized === term ||
        Boolean(termWords && ` ${words} `.includes(` ${termWords} `))
      );
    })
  );
}

/** Link research searches the public index. This process never fetches or
 * resolves the supplied URL, and does not follow provider redirects. */
export function normalizePublicResearchUrl(
  raw: string,
  sensitiveValues: readonly string[] = [],
) {
  const value = raw.trim();
  if (value.length > 2048 || /[\s\\\p{C}]/u.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      isIP(host) ||
      !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host) ||
      /(?:^|\.)(?:localhost|localdomain|local|internal|intranet|invalid|test|example|onion|arpa|lan|corp|home|alt)$/.test(
        host,
      )
    )
      return null;
    const path = decodeURIComponent(url.pathname).normalize("NFKC");
    if (
      /[^\p{L}\p{N}\p{M}\-._~/]/u.test(path) ||
      /(?:^|\/)(?:account|profile|dashboard|reset|sign[-_]?in|log[-_]?in|oauth|callback|invite|checkout|tx|transaction|address)(?:\/|$)/i.test(
        path,
      ) ||
      containsSensitive(`${host}${path}`, sensitiveValues)
    )
      return null;
    url.search = "";
    url.hash = "";
    return url.href.length <= 512 ? url.href : null;
  } catch {
    return null;
  }
}

function publicTopic(topic: string | null, sensitiveValues: readonly string[]) {
  if (!topic) return null;
  const value = topic.normalize("NFKC").trim().replace(/\s+/g, " ");
  const terms = value.split(" ");
  if (
    value.length < 2 ||
    value.length > 80 ||
    terms.length > 8 ||
    !terms.every((term) =>
      /^[\p{L}\p{N}\p{M}][\p{L}\p{N}\p{M}-]{0,20}$/u.test(term),
    ) ||
    terms.some((term) => !/\p{L}/u.test(term)) ||
    /\b(?:i|me|my|mine|our|wallets?|portfolios?|balance|holdings?|hold|own|salary|bought|spent|received|sent|memo|email)\b/i.test(
      value,
    ) ||
    containsSensitive(value, sensitiveValues)
  )
    return null;
  return value;
}

function prepareSearch(
  request: ResearchRequest,
): { search: SearchRequest; link: string | null } | null {
  const sensitive = request.sensitiveValues ?? [];
  const topic = publicTopic(request.topic, sensitive);
  if (request.intent === "link") {
    const link =
      request.url && normalizePublicResearchUrl(request.url, sensitive);
    if (!link) return null;
    const { hostname, pathname } = new URL(link);
    // Pass the hostname and short public title terms to the search index. The
    // complete page URL, including its path, is used only for local matching.
    const pathTerms = decodeURIComponent(pathname)
      .split(/[^\p{L}\p{M}-]+/u)
      .filter((term) => term.length >= 3 && term.length <= 20)
      .slice(-5)
      .join(" ");
    const hint = publicTopic(pathTerms, sensitive) || topic;
    return {
      search: {
        query: [`site:${hostname}`, hint].filter(Boolean).join(" "),
        sources: ["web"],
      },
      link,
    };
  }
  if (!topic) return null;
  const suffix = {
    news: "crypto market developments latest news",
    protocol: "crypto protocol official documentation",
    security: "crypto security incidents disclosures advisories",
    regulatory: "crypto regulation regulator official notice",
  }[request.intent];
  const recent = request.intent !== "protocol";
  return {
    search: {
      query: `${topic} ${suffix}`,
      sources: recent ? ["web", "news"] : ["web"],
      ...(recent && { tbs: request.intent === "news" ? "qdr:w" : "qdr:m" }),
    },
    link: null,
  };
}

function boundedLimit(
  value: string | undefined,
  fallback: number,
  max: number,
) {
  const requested = value === undefined ? fallback : Number(value);
  return Number.isSafeInteger(requested) && requested > 0 && requested <= max
    ? requested
    : 0;
}

type ResearchEnvironment = Record<string, string | undefined>;

function configuration(env: ResearchEnvironment) {
  return {
    key: env.FIRECRAWL_API_KEY?.trim(),
    userDaily: boundedLimit(env.AGUS_CRYPTO_RESEARCH_DAILY, 3, 20),
    globalDaily: boundedLimit(env.AGUS_CRYPTO_RESEARCH_GLOBAL_DAILY, 10, 100),
  };
}

export function cryptoResearchReady(env: ResearchEnvironment = process.env) {
  const { key, userDaily, globalDaily } = configuration(env);
  return Boolean(key && userDaily && globalDaily);
}

class ResearchLimited extends Error {}

async function reserveUsage(
  owner: string,
  userDaily: number,
  globalDaily: number,
) {
  try {
    return await transaction(async (sql) => {
      for (const [bucket, allowance] of [
        [`firecrawl:user:${owner}`, userDaily],
        ["firecrawl:global", globalDaily],
      ] as const) {
        const result = await sql.query(
          `INSERT INTO agus_crypto_ai_budgets(bucket,utc_day) VALUES($1,(now() AT TIME ZONE 'UTC')::date)
           ON CONFLICT(bucket,utc_day) DO UPDATE SET used=agus_crypto_ai_budgets.used+1
           WHERE agus_crypto_ai_budgets.used<$2 RETURNING used`,
          [bucket, allowance],
        );
        if (!result.rows.length) throw new ResearchLimited();
      }
      return true;
    });
  } catch (error) {
    if (error instanceof ResearchLimited) return false;
    throw error;
  }
}

async function providerJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("RESEARCH_RESPONSE_EMPTY");
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > contentLimit) {
        void reader.cancel().catch(() => {});
        throw new Error("RESEARCH_RESPONSE_LIMIT");
      }
      body += decoder.decode(value, { stream: true });
    }
    return providerResponse.parse(JSON.parse(body + decoder.decode()));
  } finally {
    reader.releaseLock();
  }
}

function plainText(value: string, maxLength: number) {
  return value
    .replace(/!\[[^\]]{0,500}\]\(https?:[^)\s]+\)/gi, " ")
    .replace(/\[([^\]]{0,500})\]\(https?:[^)\s]+\)/gi, "$1")
    .replace(/<[^>]{0,500}>/g, " ")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/[\p{C}\s]+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

function publicationDate(
  item: z.infer<typeof providerItem>,
  retrievedAt: string,
) {
  const raw = item.publishedAt || item.publishedDate || item.date;
  if (
    !raw ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      raw,
    )
  )
    return null;
  const date = Date.parse(raw);
  if (!Number.isFinite(date) || date > Date.parse(retrievedAt)) return null;
  const iso = new Date(date).toISOString();
  return raw.length === 10 && iso.slice(0, 10) !== raw ? null : iso;
}

export function researchSourceAuthority(url: string) {
  const host = new URL(url).hostname;
  if (/(?:^|\.)gov(?:\.[a-z]{2})?$|(?:^|\.)europa\.eu$/.test(host)) return 3;
  if (
    /(?:^|\.)(?:solana\.com|jup\.ag|ethereum\.org|circle\.com|bitcoin\.org|phantom\.com|solflare\.com)$/.test(
      host,
    )
  )
    return 2;
  if (/^(?:docs|developer|developers|research|security)\./.test(host)) return 1;
  return 0;
}

function normalizeSources(
  data: z.infer<typeof providerResponse>["data"],
  link: string | null,
  retrievedAt: string,
  recent?: SearchRequest["tbs"],
) {
  const sources: ResearchSource[] = [];
  for (const kind of ["web", "news"] as const) {
    for (const item of data[kind] ?? []) {
      const result = providerItem.safeParse(item);
      if (!result.success) continue;
      const url = normalizePublicResearchUrl(result.data.url);
      const title = plainText(result.data.title ?? "", 160);
      const snippet = plainText(
        result.data.description || result.data.snippet || "",
        1000,
      );
      const publishedAt = publicationDate(result.data, retrievedAt);
      if (
        !url ||
        !title ||
        !snippet ||
        (link && url.replace(/\/$/, "") !== link.replace(/\/$/, ""))
      )
        continue;
      // Provider recency search may still include archive pages or indexed metadata.
      if (recent && publishedAt) {
        const maxDays = recent === "qdr:w" ? 8 : 32;
        if (
          Date.parse(retrievedAt) - Date.parse(publishedAt) >
          maxDays * 86_400_000
        )
          continue;
      }
      sources.push({
        id: `src_${createHash("sha256").update(url).digest("hex").slice(0, 16)}`,
        url,
        title,
        snippet,
        kind,
        retrievedAt,
        publishedAt,
      });
    }
  }
  sources.sort(
    (left, right) =>
      researchSourceAuthority(right.url) - researchSourceAuthority(left.url) ||
      (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""),
  );
  const urls = new Set<string>();
  return sources
    .filter(({ url }) => {
      const canonical = url.replace(/\/$/, "");
      if (urls.has(canonical)) return false;
      urls.add(canonical);
      return true;
    })
    .slice(0, resultLimit);
}

export function createCryptoResearch({
  env = process.env,
  request = (...args: Parameters<typeof fetch>) => fetch(...args),
  reserve = reserveUsage,
  now = Date.now,
}: {
  env?: ResearchEnvironment;
  request?: typeof fetch;
  reserve?: typeof reserveUsage;
  now?: () => number;
} = {}) {
  const cache = new Map<
    string,
    { expires: number; sources: ResearchSource[] }
  >();
  return async function researchCrypto(
    question: ResearchRequest,
  ): Promise<ResearchResult> {
    const { key, userDaily, globalDaily } = configuration(env);
    if (!key || !userDaily || !globalDaily) return { status: "disabled" };
    const prepared = prepareSearch(question);
    if (!prepared) return { status: "invalid_request" };
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(prepared))
      .digest("hex");
    const stored = cache.get(fingerprint);
    if (stored && stored.expires > now()) {
      return stored.sources.length
        ? { status: "ready", sources: stored.sources, cached: true }
        : { status: "no_results" };
    }
    if (question.signal.aborted) return { status: "unavailable" };
    const started = now();
    try {
      if (!(await reserve(question.owner, userDaily, globalDaily))) {
        operationalEvent("crypto.research_limited", { code: "DAILY_LIMIT" });
        return { status: "limited" };
      }
      if (question.signal.aborted) return { status: "unavailable" };
      const response = await request(searchEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...prepared.search,
          limit: resultLimit,
          timeout: searchTimeoutMs - 500,
        }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.any([
          question.signal,
          AbortSignal.timeout(searchTimeoutMs),
        ]),
      });
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const limited = response.status === 402 || response.status === 429;
        operationalEvent("crypto.research_failed", {
          durationMs: now() - started,
          code: limited
            ? "PROVIDER_LIMIT"
            : [401, 403].includes(response.status)
              ? "PROVIDER_AUTH"
              : "PROVIDER_HTTP",
        });
        return { status: limited ? "limited" : "unavailable" };
      }
      const result = await providerJson(response);
      const sources = normalizeSources(
        result.data,
        prepared.link,
        new Date(now()).toISOString(),
        prepared.search.tbs,
      );
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value!);
      const ttl = !sources.length
        ? 60_000
        : prepared.search.tbs
          ? 5 * 60_000
          : 20 * 60_000;
      cache.set(fingerprint, { sources, expires: now() + ttl });
      operationalEvent("crypto.research_succeeded", {
        durationMs: now() - started,
      });
      return sources.length
        ? { status: "ready", sources, cached: false }
        : { status: "no_results" };
    } catch {
      operationalEvent("crypto.research_failed", {
        durationMs: now() - started,
        code: "PROVIDER_UNAVAILABLE",
      });
      return { status: "unavailable" };
    }
  };
}

export const researchCrypto = createCryptoResearch();
