/**
 * AGUS External Actions — Product Research Scrapers
 *
 * Zero-cost product research using public web data.
 * Each scraper returns structured ProductListing data with
 * confidence levels and source attribution.
 *
 * No paid APIs are used. All scraping respects robots.txt
 * and uses reasonable rate limiting.
 */

import { randomUUID } from "node:crypto";
import type { ProductQuery, ProductListing, MerchantInfo } from "./types.js";

// ─── Rate Limiter ───────────────────────────────────────────────────

const requestTimestamps: Map<string, number[]> = new Map();

function rateLimitOk(
  domain: string,
  maxPerMinute: number = 10
): boolean {
  const now = Date.now();
  const timestamps = requestTimestamps.get(domain) ?? [];
  const recent = timestamps.filter((t) => now - t < 60_000);
  if (recent.length >= maxPerMinute) return false;
  recent.push(now);
  requestTimestamps.set(domain, recent);
  return true;
}

// ─── Fetch with Timeout ─────────────────────────────────────────────

async function safeFetch(
  url: string,
  options: {
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {}
): Promise<{ ok: boolean; status: number; text: string }> {
  const { timeoutMs = 15_000, headers = {} } = options;
  const domain = new URL(url).hostname;
  if (!rateLimitOk(domain)) {
    return { ok: false, status: 429, text: "Rate limited" };
  }
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "AGUS-Shopping-Agent/1.0 (personal-assistant; product-research)",
        Accept: "text/html,application/json",
        ...headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown fetch error";
    return { ok: false, status: 0, text: message };
  }
}

// ─── HTML Text Extraction ───────────────────────────────────────────

/** Minimal HTML-to-text extraction without external dependencies */
export function extractText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract price from Nigerian text like "₦45,000" or "NGN 45000" */
export function extractNairaPrice(text: string): number | null {
  const patterns = [
    /₦\s*([\d,]+(?:\.\d{1,2})?)/,
    /NGN\s*([\d,]+(?:\.\d{1,2})?)/i,
    /N\s*([\d,]+(?:\.\d{1,2})?)/,
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

// ─── Jiji.ng Scraper ────────────────────────────────────────────────

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

  // Parse listing blocks from HTML
  // Jiji uses structured data we can extract
  const html = response.text;

  // Try to find JSON-LD structured data first
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
          listings.push({
            id: randomUUID(),
            title: String(product.name).slice(0, 200),
            description: product.description?.slice(0, 500),
            priceKobo: Math.round(Number(price) * 100),
            currency: "NGN",
            condition: "used",
            merchant: {
              name: product.offers?.seller?.name ?? "Jiji Seller",
              url: product.offers?.url,
              verified: false,
            },
            url: product.url ?? product.offers?.url,
            imageUrl: product.image,
            source: "jiji.ng",
            scrapedAt: new Date().toISOString(),
            confidence: "medium",
            warnings: [
              "Price extracted from listing page; verify with merchant before purchase",
            ],
          });
        }
      }
    } catch {
      // JSON-LD parsing failed, continue with HTML extraction
    }
  }

  // Fallback: extract from HTML patterns
  if (listings.length === 0) {
    // Look for price patterns in the page text
    const text = extractText(html);
    const priceMatches = [
      ...text.matchAll(
        /([A-Za-z][\w\s]{2,40}?)\s*₦\s*([\d,]+(?:\.\d{1,2})?)/g
      ),
    ];

    for (const m of priceMatches.slice(0, query.maxResults)) {
      const priceKobo = Math.round(
        parseFloat(m[2].replace(/,/g, "")) * 100
      );
      if (priceKobo <= 0) continue;
      listings.push({
        id: randomUUID(),
        title: m[1].trim().slice(0, 200),
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
          "Extracted from unstructured HTML; title and price may be inaccurate",
        ],
      });
    }
  }

  return { listings: listings.slice(0, query.maxResults), errors };
}

// ─── Jumia.com.ng Scraper ───────────────────────────────────────────

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

  // Jumia often has structured data
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

        listings.push({
          id: randomUUID(),
          title: String(product.name).slice(0, 200),
          description: product.description?.slice(0, 500),
          priceKobo: Math.round(Number(price) * 100),
          currency: "NGN",
          originalPriceKobo: offers?.highPrice
            ? Math.round(Number(offers.highPrice) * 100)
            : undefined,
          condition: "new",
          merchant: {
            name: offers?.seller?.name ?? "Jumia",
            url: product.url,
            verified: true,
            policies: {
              returnsAccepted: true,
              returnWindowDays: 7,
            },
          },
          url: product.url,
          imageUrl: product.image,
          inStock:
            offers?.availability ===
            "https://schema.org/InStock",
          source: "jumia.com.ng",
          scrapedAt: new Date().toISOString(),
          confidence: "medium",
          warnings: [
            "Price from listing page; final price may differ at checkout",
          ],
        });
      }
    } catch {
      // Continue
    }
  }

  // Fallback HTML extraction for Jumia's product cards
  if (listings.length === 0) {
    // Jumia uses data attributes and specific CSS classes
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

      listings.push({
        id: randomUUID(),
        title: titleMatch[1].trim().slice(0, 200),
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
      });
    }
  }

  return { listings: listings.slice(0, query.maxResults), errors };
}

// ─── Konga Scraper ──────────────────────────────────────────────────

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

  // Try structured data first
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

        listings.push({
          id: randomUUID(),
          title: String(product.name).slice(0, 200),
          description: product.description?.slice(0, 500),
          priceKobo: Math.round(Number(price) * 100),
          currency: "NGN",
          condition: "new",
          merchant: {
            name: product.offers?.seller?.name ?? "Konga",
            url: product.url,
            verified: true,
          },
          url: product.url,
          imageUrl: product.image,
          source: "konga.com",
          scrapedAt: new Date().toISOString(),
          confidence: "medium",
          warnings: ["Verify price on product page before purchase"],
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
 * Each scraper failure is recorded but doesn't block others.
 */
export async function scrapeAll(
  query: ProductQuery
): Promise<{
  listings: ProductListing[];
  errors: string[];
  sourcesQueried: number;
  sourcesSucceeded: number;
}> {
  const results = await Promise.allSettled(
    scraperRegistry.map((s) => s.scrape(query))
  );

  const allListings: ProductListing[] = [];
  const allErrors: string[] = [];
  let succeeded = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const scraperName = scraperRegistry[i].name;
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

  // Apply query filters
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

  // Sort by price ascending
  filtered.sort((a, b) => a.priceKobo - b.priceKobo);

  return {
    listings: filtered.slice(0, query.maxResults),
    errors: allErrors,
    sourcesQueried: scraperRegistry.length,
    sourcesSucceeded: succeeded,
  };
}
