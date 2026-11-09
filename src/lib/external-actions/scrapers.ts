/**
 * AGUS External Actions — Product Research Scrapers
 *
 * Zero-cost product research using public web data.
 * Features:
 * - Sanitization of scraped text against prompt injection attacks
 * - Circuit breakers & per-domain rate limiting
 * - Safe HTML/JSON-LD text extraction
 * - Nigerian Naira price parsing (₦/NGN)
 * - Error isolation across scrapers
 */

import { randomUUID } from "node:crypto";
import type { ProductQuery, ProductListing } from "./types";
import { sanitizeScrapedText, sanitizeUrl } from "./sanitizer";

// ─── Rate Limiter & Circuit Breaker ─────────────────────────────────

interface DomainCircuitState {
  failures: number;
  lastFailureTime: number;
  circuitOpenUntil: number;
}

const requestTimestamps: Map<string, number[]> = new Map();
const domainCircuits: Map<string, DomainCircuitState> = new Map();

export function resetScraperState(): void {
  requestTimestamps.clear();
  domainCircuits.clear();
}

function checkCircuit(domain: string): { allowed: boolean; reason?: string } {
  const state = domainCircuits.get(domain);
  if (!state) return { allowed: true };

  const now = Date.now();
  if (state.circuitOpenUntil > now) {
    const remainingSec = Math.ceil((state.circuitOpenUntil - now) / 1000);
    return {
      allowed: false,
      reason: `Circuit open for ${domain} (${remainingSec}s cooldown remaining)`,
    };
  }

  // Cooldown expired: allow a trial request (half-open)
  return { allowed: true };
}

function recordCircuitResult(domain: string, success: boolean): void {
  const now = Date.now();
  const state = domainCircuits.get(domain) ?? {
    failures: 0,
    lastFailureTime: 0,
    circuitOpenUntil: 0,
  };

  if (success) {
    // Reset on success
    domainCircuits.delete(domain);
  } else {
    state.failures += 1;
    state.lastFailureTime = now;
    if (state.failures >= 3) {
      // Trip circuit for 60 seconds
      state.circuitOpenUntil = now + 60_000;
    }
    domainCircuits.set(domain, state);
  }
}

function rateLimitOk(domain: string, maxPerMinute: number = 10): boolean {
  const now = Date.now();
  const timestamps = requestTimestamps.get(domain) ?? [];
  const recent = timestamps.filter((t) => now - t < 60_000);
  if (recent.length >= maxPerMinute) return false;
  recent.push(now);
  requestTimestamps.set(domain, recent);
  return true;
}

// ─── Fetch with Timeout & Circuit Protection ────────────────────────

export async function safeFetch(
  url: string,
  options: {
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<{ ok: boolean; status: number; text: string }> {
  const { timeoutMs = 15_000, headers = {} } = options;

  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return { ok: false, status: 400, text: "Invalid URL" };
  }

  const circuit = checkCircuit(domain);
  if (!circuit.allowed) {
    return { ok: false, status: 503, text: circuit.reason! };
  }

  if (!rateLimitOk(domain)) {
    return { ok: false, status: 429, text: "Rate limited" };
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "AGUS-Shopping-Agent/1.0 (personal-assistant; product-research; info@agus.internal)",
        Accept: "text/html,application/json",
        ...headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });

    const text = await response.text();
    const ok = response.ok;
    recordCircuitResult(domain, ok);
    return { ok, status: response.status, text };
  } catch (error) {
    recordCircuitResult(domain, false);
    const message =
      error instanceof Error ? error.message : "Unknown fetch error";
    return { ok: false, status: 0, text: message };
  }
}

// ─── HTML Text Extraction & Currency Parsing ────────────────────────

export function extractText(html: string): string {
  const { sanitized } = sanitizeScrapedText(html, 100_000);
  return sanitized;
}

/** Extract price from Nigerian text like "₦45,000" or "NGN 45000" */
export function extractNairaPrice(text: string): number | null {
  const patterns = [
    /₦\s*([\d,]+(?:\.\d{1,2})?)/,
    /NGN\s*([\d,]+(?:\.\d{1,2})?)/i,
    /(?:^|\s)N\s*([\d,]+(?:\.\d{1,2})?)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = parseFloat(match[1].replace(/,/g, ""));
      if (amount > 0 && Number.isFinite(amount)) {
        return Math.round(amount * 100); // Convert to kobo
      }
    }
  }
  return null;
}

/** Extract USD price from text like "$45.99" */
export function extractUsdPrice(text: string): number | null {
  const match = text.match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (match) {
    const amount = parseFloat(match[1].replace(/,/g, ""));
    if (amount > 0 && Number.isFinite(amount)) {
      return Math.round(amount * 100); // cents
    }
  }
  return null;
}

// ─── Scrapers ───────────────────────────────────────────────────────

interface ScraperResult {
  listings: ProductListing[];
  errors: string[];
}

async function scrapeJiji(query: ProductQuery): Promise<ScraperResult> {
  const errors: string[] = [];
  const listings: ProductListing[] = [];
  const searchUrl = `https://jiji.ng/search?query=${encodeURIComponent(query.query)}`;

  const response = await safeFetch(searchUrl);
  if (!response.ok) {
    errors.push(
      `Jiji.ng: HTTP ${response.status} — ${response.text.slice(0, 200)}`
    );
    return { listings, errors };
  }

  const html = response.text;

  // JSON-LD structured data extraction
  const jsonLdMatches = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1]);
      if (data["@type"] === "Product" || data["@type"] === "ItemList") {
        const items = data.itemListElement ?? [data];
        for (const item of items) {
          const product = item.item ?? item;
          if (!product.name) continue;
          const price = product.offers?.price ?? product.price;
          if (!price) continue;

          const titleSan = sanitizeScrapedText(String(product.name), 200);
          const descSan = sanitizeScrapedText(product.description, 500);
          const sellerSan = sanitizeScrapedText(
            product.offers?.seller?.name ?? "Jiji Seller",
            100
          );

          const warnings: string[] = [
            "Price extracted from listing page; verify with merchant before purchase",
          ];
          let confidence: "high" | "medium" | "low" = "medium";

          if (titleSan.injectionDetected || descSan.injectionDetected) {
            warnings.push("suspicious_instruction_detected_in_listing_text");
            confidence = "low";
          }

          listings.push({
            id: randomUUID(),
            title: titleSan.sanitized,
            description: descSan.sanitized || undefined,
            priceKobo: Math.round(Number(price) * 100),
            currency: "NGN",
            condition: "used",
            merchant: {
              name: sellerSan.sanitized,
              url: sanitizeUrl(product.offers?.url),
              verified: false,
            },
            url: sanitizeUrl(product.url ?? product.offers?.url),
            imageUrl: sanitizeUrl(product.image),
            source: "jiji.ng",
            scrapedAt: new Date().toISOString(),
            confidence,
            warnings,
            sanitized: true,
          });
        }
      }
    } catch {
      // JSON-LD parse failed, continue
    }
  }

  // Fallback: extract from unstructured HTML
  if (listings.length === 0) {
    const text = extractText(html);
    const priceMatches = [
      ...text.matchAll(
        /([A-Za-z][\w\s]{2,40}?)\s*₦\s*([\d,]+(?:\.\d{1,2})?)/g
      ),
    ];

    for (const m of priceMatches.slice(0, query.maxResults)) {
      const priceKobo = Math.round(parseFloat(m[2].replace(/,/g, "")) * 100);
      if (priceKobo <= 0) continue;

      const titleSan = sanitizeScrapedText(m[1], 200);
      listings.push({
        id: randomUUID(),
        title: titleSan.sanitized,
        priceKobo,
        currency: "NGN",
        condition: "unknown",
        merchant: {
          name: "Jiji Seller",
          verified: false,
        },
        source: "jiji.ng",
        scrapedAt: new Date().toISOString(),
        confidence: "low",
        warnings: [
          "Extracted from unstructured HTML; title and price may be approximate",
        ],
        sanitized: true,
      });
    }
  }

  return { listings: listings.slice(0, query.maxResults), errors };
}

async function scrapeJumia(query: ProductQuery): Promise<ScraperResult> {
  const errors: string[] = [];
  const listings: ProductListing[] = [];
  const searchUrl = `https://www.jumia.com.ng/catalog/?q=${encodeURIComponent(query.query)}`;

  const response = await safeFetch(searchUrl);
  if (!response.ok) {
    errors.push(
      `Jumia.com.ng: HTTP ${response.status} — ${response.text.slice(0, 200)}`
    );
    return { listings, errors };
  }

  const html = response.text;

  // Structured data
  const jsonLdMatches = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1]);
      const items =
        data["@type"] === "ItemList"
          ? data.itemListElement ?? []
          : data["@type"] === "Product"
            ? [data]
            : [];

      for (const item of items) {
        const product = item.item ?? item;
        if (!product.name) continue;
        const offers = product.offers;
        const price = offers?.price ?? offers?.lowPrice;
        if (!price) continue;

        const titleSan = sanitizeScrapedText(String(product.name), 200);
        const descSan = sanitizeScrapedText(product.description, 500);
        const warnings: string[] = [
          "Price from listing page; final price may differ at checkout",
        ];
        let confidence: "high" | "medium" | "low" = "medium";

        if (titleSan.injectionDetected || descSan.injectionDetected) {
          warnings.push("suspicious_instruction_detected_in_listing_text");
          confidence = "low";
        }

        listings.push({
          id: randomUUID(),
          title: titleSan.sanitized,
          description: descSan.sanitized || undefined,
          priceKobo: Math.round(Number(price) * 100),
          currency: "NGN",
          originalPriceKobo: offers?.highPrice
            ? Math.round(Number(offers.highPrice) * 100)
            : undefined,
          condition: "new",
          merchant: {
            name: offers?.seller?.name ?? "Jumia",
            url: sanitizeUrl(product.url),
            verified: true,
            policies: {
              returnsAccepted: true,
              returnWindowDays: 7,
            },
          },
          url: sanitizeUrl(product.url),
          imageUrl: sanitizeUrl(product.image),
          inStock: offers?.availability === "https://schema.org/InStock",
          source: "jumia.com.ng",
          scrapedAt: new Date().toISOString(),
          confidence,
          warnings,
          sanitized: true,
        });
      }
    } catch {
      // Continue
    }
  }

  // Fallback card extraction
  if (listings.length === 0) {
    const cardRegex =
      /class="[^"]*prd[^"]*"[^>]*>[\s\S]*?<\/(?:article|div|a)>/gi;
    const cards = html.match(cardRegex) ?? [];

    for (const card of cards.slice(0, query.maxResults)) {
      const titleMatch = card.match(
        /(?:data-name|class="[^"]*name[^"]*")[^>]*>([^<]+)/i
      );
      const priceText = extractText(card);
      const price = extractNairaPrice(priceText);
      if (!titleMatch || !price) continue;

      const titleSan = sanitizeScrapedText(titleMatch[1], 200);
      listings.push({
        id: randomUUID(),
        title: titleSan.sanitized,
        priceKobo: price,
        currency: "NGN",
        condition: "new",
        merchant: {
          name: "Jumia",
          verified: true,
          policies: { returnsAccepted: true, returnWindowDays: 7 },
        },
        source: "jumia.com.ng",
        scrapedAt: new Date().toISOString(),
        confidence: "low",
        warnings: [
          "Extracted from unstructured HTML; verify price on product page",
        ],
        sanitized: true,
      });
    }
  }

  return { listings: listings.slice(0, query.maxResults), errors };
}

async function scrapeKonga(query: ProductQuery): Promise<ScraperResult> {
  const errors: string[] = [];
  const listings: ProductListing[] = [];
  const searchUrl = `https://www.konga.com/search?search=${encodeURIComponent(query.query)}`;

  const response = await safeFetch(searchUrl);
  if (!response.ok) {
    errors.push(
      `Konga.com: HTTP ${response.status} — ${response.text.slice(0, 200)}`
    );
    return { listings, errors };
  }

  const html = response.text;

  const jsonLdMatches = html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const match of jsonLdMatches) {
    try {
      const data = JSON.parse(match[1]);
      const items =
        data["@type"] === "ItemList"
          ? data.itemListElement ?? []
          : data["@type"] === "Product"
            ? [data]
            : [];

      for (const item of items) {
        const product = item.item ?? item;
        if (!product.name) continue;
        const price = product.offers?.price;
        if (!price) continue;

        const titleSan = sanitizeScrapedText(String(product.name), 200);
        const descSan = sanitizeScrapedText(product.description, 500);

        listings.push({
          id: randomUUID(),
          title: titleSan.sanitized,
          description: descSan.sanitized || undefined,
          priceKobo: Math.round(Number(price) * 100),
          currency: "NGN",
          condition: "new",
          merchant: {
            name: product.offers?.seller?.name ?? "Konga",
            url: sanitizeUrl(product.url),
            verified: true,
          },
          url: sanitizeUrl(product.url),
          imageUrl: sanitizeUrl(product.image),
          source: "konga.com",
          scrapedAt: new Date().toISOString(),
          confidence: "medium",
          warnings: ["Verify price on product page before purchase"],
          sanitized: true,
        });
      }
    } catch {
      // Continue
    }
  }

  return { listings: listings.slice(0, query.maxResults), errors };
}

// ─── Scraper Registry ───────────────────────────────────────────────

export interface Scraper {
  name: string;
  domain: string;
  scrape: (query: ProductQuery) => Promise<ScraperResult>;
}

export const scraperRegistry: Scraper[] = [
  { name: "Jumia Nigeria", domain: "jumia.com.ng", scrape: scrapeJumia },
  { name: "Jiji Nigeria", domain: "jiji.ng", scrape: scrapeJiji },
  { name: "Konga", domain: "konga.com", scrape: scrapeKonga },
];

/**
 * Run all scrapers in parallel with individual error isolation.
 */
export async function scrapeAll(
  query: ProductQuery,
  customScrapers?: Scraper[]
): Promise<{
  listings: ProductListing[];
  errors: string[];
  sourcesQueried: number;
  sourcesSucceeded: number;
}> {
  const scrapers = customScrapers ?? scraperRegistry;
  const results = await Promise.allSettled(scrapers.map((s) => s.scrape(query)));

  const allListings: ProductListing[] = [];
  const allErrors: string[] = [];
  let succeeded = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const scraperName = scrapers[i].name;
    if (result.status === "fulfilled") {
      allListings.push(...result.value.listings);
      allErrors.push(...result.value.errors);
      if (result.value.listings.length > 0) succeeded++;
      else if (result.value.errors.length === 0)
        allErrors.push(`${scraperName}: no results found`);
    } else {
      allErrors.push(`${scraperName}: ${result.reason}`);
    }
  }

  // Filter listings by query constraints
  let filtered = allListings;
  if (query.maxPriceKobo) {
    filtered = filtered.filter((l) => l.priceKobo <= query.maxPriceKobo!);
  }
  if (query.minPriceKobo) {
    filtered = filtered.filter((l) => l.priceKobo >= query.minPriceKobo!);
  }
  if (query.condition && query.condition !== "any") {
    filtered = filtered.filter(
      (l) => l.condition === query.condition || l.condition === "unknown"
    );
  }

  filtered.sort((a, b) => a.priceKobo - b.priceKobo);

  return {
    listings: filtered.slice(0, query.maxResults),
    errors: allErrors,
    sourcesQueried: scrapers.length,
    sourcesSucceeded: succeeded,
  };
}
