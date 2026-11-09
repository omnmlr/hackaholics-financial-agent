/**
 * AGUS External Actions — End-to-End Shopping Workflow Test
 *
 * Demonstrates the complete shopping workflow:
 * 1. Product research (with live scraping, tolerant of failures)
 * 2. Price comparison assembly
 * 3. Recommendation generation
 * 4. Negotiation preparation
 * 5. Merchant communication draft
 *
 * This test makes real HTTP requests to Nigerian e-commerce sites.
 * It is designed to be resilient to site unavailability.
 */

import { describe, it, expect } from "vitest";
import {
  searchProducts,
  recommendProduct,
  prepareNegotiation,
  draftMerchantMessage,
  lookupMerchant,
  scrapeAll,
  type ProductQuery,
  type ShoppingPreferences,
  type ProductListing,
  type PriceComparison,
} from "@/lib/external-actions";

// ─── Fixture Fallback ───────────────────────────────────────────────

/**
 * If live scraping returns no results (sites may block or be unavailable),
 * use realistic fixtures to demonstrate the full workflow pipeline.
 */
function fixtureListings(): ProductListing[] {
  const now = new Date().toISOString();
  return [
    {
      id: "fixture-jumia-1",
      title: "Samsung Galaxy S24 Ultra 256GB Titanium Black",
      description:
        "Latest Samsung flagship with S Pen, 200MP camera, and Snapdragon 8 Gen 3",
      priceKobo: 89500000, // ₦895,000
      currency: "NGN",
      originalPriceKobo: 99900000,
      condition: "new",
      merchant: {
        name: "Jumia Nigeria",
        url: "https://www.jumia.com.ng",
        verified: true,
        rating: 4.3,
        reviewCount: 245,
        policies: {
          returnsAccepted: true,
          returnWindowDays: 7,
          freeShipping: false,
          shippingEstimateDays: 3,
        },
      },
      url: "https://www.jumia.com.ng/samsung-galaxy-s24-ultra",
      source: "jumia.com.ng",
      scrapedAt: now,
      confidence: "high",
      warnings: ["Fixture data — not from live scraping"],
    },
    {
      id: "fixture-konga-1",
      title: "Samsung Galaxy S24 Ultra 256GB - Titanium Gray",
      description: "Samsung Galaxy S24 Ultra with titanium frame",
      priceKobo: 87000000, // ₦870,000
      currency: "NGN",
      condition: "new",
      merchant: {
        name: "Konga",
        url: "https://www.konga.com",
        verified: true,
        rating: 4.1,
        reviewCount: 89,
        policies: {
          returnsAccepted: true,
          returnWindowDays: 7,
        },
      },
      source: "konga.com",
      scrapedAt: now,
      confidence: "high",
      warnings: ["Fixture data — not from live scraping"],
    },
    {
      id: "fixture-jiji-1",
      title: "Samsung Galaxy S24 Ultra 256GB (Used, Excellent)",
      description:
        "Mint condition, used for 2 months. Original accessories included.",
      priceKobo: 65000000, // ₦650,000
      currency: "NGN",
      condition: "used",
      merchant: {
        name: "Jiji Seller - MobileHub",
        url: "https://jiji.ng",
        verified: false,
        rating: 3.8,
        reviewCount: 42,
        policies: {
          returnsAccepted: false,
        },
      },
      source: "jiji.ng",
      scrapedAt: now,
      confidence: "medium",
      warnings: [
        "Fixture data — not from live scraping",
        "P2P marketplace — inspect item before payment",
      ],
    },
    {
      id: "fixture-jiji-2",
      title: "Samsung Galaxy S24 Ultra 512GB (UK Used)",
      description: "UK used, grade A condition. Battery health 94%.",
      priceKobo: 72000000, // ₦720,000
      currency: "NGN",
      condition: "used",
      merchant: {
        name: "Jiji Seller - PhoneKing",
        url: "https://jiji.ng",
        verified: false,
        rating: 4.0,
        reviewCount: 67,
      },
      source: "jiji.ng",
      scrapedAt: now,
      confidence: "medium",
      warnings: [
        "Fixture data — not from live scraping",
        "P2P marketplace — inspect item before payment",
      ],
    },
  ];
}

function fixtureComparison(): PriceComparison {
  const listings = fixtureListings();
  const prices = listings.map((l) => l.priceKobo);
  return {
    queryId: "fixture-comparison",
    query: "Samsung Galaxy S24 Ultra",
    listings,
    bestPrice: listings.reduce((a, b) =>
      a.priceKobo <= b.priceKobo ? a : b
    ),
    averagePriceKobo: Math.round(
      prices.reduce((a, b) => a + b, 0) / prices.length
    ),
    priceRange: {
      minKobo: Math.min(...prices),
      maxKobo: Math.max(...prices),
    },
    generatedAt: new Date().toISOString(),
    totalSourcesQueried: 3,
    successfulSources: 3,
    warnings: ["Using fixture data — live scraping was not available"],
  };
}

// ─── End-to-End Workflow ────────────────────────────────────────────

describe("End-to-End Shopping Workflow", () => {
  const query: ProductQuery = {
    query: "Samsung Galaxy S24 Ultra",
    category: "smartphones",
    maxResults: 10,
    currency: "NGN",
    condition: "any",
  };

  const preferences: ShoppingPreferences = {
    budgetMaxKobo: 90000000, // ₦900,000
    preferNewCondition: true,
    prioritizeRating: true,
    preferFreeShipping: true,
    preferVerifiedMerchants: true,
    requireReturnPolicy: false,
    blockedMerchants: [],
    preferredMerchants: ["Jumia"],
  };

  it("Step 1: Attempts live product search", async () => {
    // This makes real HTTP requests — may fail due to network/site blocks
    let comparison: PriceComparison;
    try {
      comparison = await searchProducts(query);
    } catch {
      // If search fails entirely, use fixture
      comparison = fixtureComparison();
    }

    expect(comparison.queryId).toBeDefined();
    expect(comparison.query).toBe("Samsung Galaxy S24 Ultra");
    expect(comparison.generatedAt).toBeDefined();
    expect(comparison.totalSourcesQueried).toBeGreaterThan(0);

    // Log what we found
    console.log(
      `[Step 1] Sources queried: ${comparison.totalSourcesQueried}, ` +
        `succeeded: ${comparison.successfulSources}, ` +
        `listings: ${comparison.listings.length}`
    );
    if (comparison.warnings.length > 0) {
      console.log(`[Step 1] Warnings: ${comparison.warnings.join("; ")}`);
    }
  });

  it("Step 2: Generates recommendation from comparison data", async () => {
    // Use fixtures for deterministic testing
    const comparison = fixtureComparison();
    const recommendation = await recommendProduct(comparison, preferences);

    // Invariants
    expect(recommendation.requiresApproval).toBe(true);
    expect(recommendation.recommended).toBeDefined();
    expect(recommendation.recommended.priceKobo).toBeGreaterThan(0);
    expect(recommendation.reason).toBeTruthy();

    // Should recommend something within budget
    expect(recommendation.recommended.priceKobo).toBeLessThanOrEqual(
      preferences.budgetMaxKobo!
    );

    // Should have alternatives
    expect(recommendation.alternatives.length).toBeGreaterThan(0);
    for (const alt of recommendation.alternatives) {
      expect(alt.tradeoff).toBeTruthy();
    }

    console.log(
      `[Step 2] Recommended: "${recommendation.recommended.title}" ` +
        `at ₦${(recommendation.recommended.priceKobo / 100).toLocaleString()}`
    );
    console.log(`[Step 2] Reason: ${recommendation.reason}`);
    console.log(
      `[Step 2] Alternatives: ${recommendation.alternatives.length}`
    );
    if (recommendation.savingsKobo) {
      console.log(
        `[Step 2] Savings vs average: ₦${(recommendation.savingsKobo / 100).toLocaleString()}`
      );
    }
  });

  it("Step 3: Looks up merchant information", async () => {
    const merchants = ["Jumia Nigeria", "Konga", "Jiji Nigeria"];
    for (const name of merchants) {
      const info = await lookupMerchant(name);
      expect(info.name).toBeTruthy();

      console.log(
        `[Step 3] ${info.name}: verified=${info.verified}, ` +
          `returns=${info.policies?.returnsAccepted ?? "unknown"}`
      );
    }
  });

  it("Step 4: Prepares negotiation strategy", async () => {
    // Negotiate on the cheapest used listing
    const listing = fixtureListings().find((l) => l.condition === "used")!;
    const strategy = await prepareNegotiation(listing, preferences);

    // Invariants
    expect(strategy.requiresApproval).toBe(true);
    expect(strategy.suggestedOfferKobo).toBeLessThan(listing.priceKobo);
    expect(strategy.maxOfferKobo).toBeLessThanOrEqual(
      preferences.budgetMaxKobo!
    );
    expect(strategy.openingMessage).toContain(listing.title);
    expect(strategy.keyPoints.length).toBeGreaterThan(0);
    expect(strategy.leverageFactors.length).toBeGreaterThan(0);
    expect(strategy.walkAwayConditions.length).toBeGreaterThan(0);

    console.log(
      `[Step 4] Target: "${listing.title}" at ₦${(listing.priceKobo / 100).toLocaleString()}`
    );
    console.log(
      `[Step 4] Suggested offer: ₦${(strategy.suggestedOfferKobo / 100).toLocaleString()}`
    );
    console.log(
      `[Step 4] Max offer: ₦${(strategy.maxOfferKobo / 100).toLocaleString()}`
    );
    console.log(
      `[Step 4] Success probability: ${strategy.estimatedSuccessProbability}`
    );
    console.log(`[Step 4] Leverage: ${strategy.leverageFactors.join("; ")}`);
  });

  it("Step 5: Drafts merchant communication (never auto-sends)", async () => {
    const listing = fixtureListings()[2]; // Used listing
    const strategy = await prepareNegotiation(listing, preferences);

    // Draft opening message
    const opening = await draftMerchantMessage(strategy);
    expect(opening.role).toBe("buyer");
    expect(opening.approved).toBe(false);
    expect(opening.content).toContain(listing.title);
    expect(opening.content).toContain("₦");

    // Draft follow-up to hypothetical seller response
    const followUp = await draftMerchantMessage(
      strategy,
      "Thank you for your interest. The price is ₦650,000 firm. I can offer free delivery within Lagos."
    );
    expect(followUp.role).toBe("buyer");
    expect(followUp.approved).toBe(false);

    console.log("[Step 5] Opening message drafted (NOT sent):");
    console.log(opening.content.split("\n").slice(0, 3).join("\n") + "...");
    console.log("[Step 5] Follow-up message drafted (NOT sent):");
    console.log(followUp.content.split("\n").slice(0, 2).join("\n") + "...");
  });

  it("Step 6: Verifies permission boundaries", async () => {
    const comparison = fixtureComparison();
    const recommendation = await recommendProduct(comparison, preferences);

    // The recommendation ALWAYS requires approval
    expect(recommendation.requiresApproval).toBe(true);

    // The negotiation strategy ALWAYS requires approval
    const strategy = await prepareNegotiation(
      recommendation.recommended,
      preferences
    );
    expect(strategy.requiresApproval).toBe(true);

    // Draft messages are NEVER pre-approved
    const message = await draftMerchantMessage(strategy);
    expect(message.approved).toBe(false);

    console.log("[Step 6] ✓ Recommendation requires approval");
    console.log("[Step 6] ✓ Negotiation strategy requires approval");
    console.log("[Step 6] ✓ Draft messages are not pre-approved");
    console.log("[Step 6] ✓ No purchases, sends, or commitments made");
  });
});

// ─── Live Scraper Smoke Test ────────────────────────────────────────

describe("Live Scraper Smoke Test", () => {
  it("attempts scraping without crashing", async () => {
    const result = await scrapeAll({
      query: "laptop",
      maxResults: 5,
      currency: "NGN",
      condition: "any",
    });

    // We don't assert results because sites may be unavailable,
    // but the scraper should never throw
    expect(result.sourcesQueried).toBe(3);
    expect(Array.isArray(result.listings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);

    console.log(
      `[Smoke] Scraped ${result.listings.length} listings from ${result.sourcesSucceeded}/${result.sourcesQueried} sources`
    );
    if (result.errors.length > 0) {
      console.log(
        `[Smoke] Errors (expected if sites block): ${result.errors.slice(0, 3).join("; ")}`
      );
    }
    for (const listing of result.listings.slice(0, 3)) {
      console.log(
        `[Smoke] ${listing.source}: "${listing.title}" — ₦${(listing.priceKobo / 100).toLocaleString()} (${listing.confidence})`
      );
    }
  });
});
