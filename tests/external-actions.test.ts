/**
 * AGUS External Actions — Unit Tests
 *
 * Tests the shopping engine's core logic: scoring, recommendation,
 * negotiation preparation, text extraction, and price parsing.
 * These tests run without network access.
 */

import { describe, it, expect } from "vitest";
import {
  scoreListing,
  recommendProduct,
  prepareNegotiation,
  draftMerchantMessage,
  lookupMerchant,
  extractText,
  extractNairaPrice,
  extractUsdPrice,
  productQuerySchema,
  shoppingPreferencesSchema,
  productListingSchema,
  type ProductListing,
  type PriceComparison,
  type ShoppingPreferences,
} from "@/lib/external-actions";

// ─── Test Fixtures ──────────────────────────────────────────────────

function makeListing(overrides: Partial<ProductListing> = {}): ProductListing {
  return {
    id: "test-listing-1",
    title: "Samsung Galaxy S24 Ultra 256GB",
    priceKobo: 85000000, // ₦850,000
    currency: "NGN",
    condition: "new",
    merchant: {
      name: "Jumia Nigeria",
      url: "https://www.jumia.com.ng/samsung-galaxy-s24-ultra",
      verified: true,
      rating: 4.2,
      reviewCount: 150,
      policies: {
        returnsAccepted: true,
        returnWindowDays: 7,
        freeShipping: false,
        shippingEstimateDays: 3,
      },
    },
    source: "jumia.com.ng",
    scrapedAt: new Date().toISOString(),
    confidence: "medium",
    warnings: [],
    ...overrides,
  };
}

function makeComparison(
  listings: ProductListing[],
  query = "Samsung Galaxy S24"
): PriceComparison {
  const prices = listings.map((l) => l.priceKobo);
  return {
    queryId: "test-comparison-1",
    query,
    listings,
    bestPrice: listings.length > 0
      ? listings.reduce((a, b) => (a.priceKobo <= b.priceKobo ? a : b))
      : undefined,
    averagePriceKobo:
      prices.length > 0
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : undefined,
    priceRange:
      prices.length >= 2
        ? { minKobo: Math.min(...prices), maxKobo: Math.max(...prices) }
        : undefined,
    generatedAt: new Date().toISOString(),
    totalSourcesQueried: 3,
    successfulSources: listings.length > 0 ? 2 : 0,
    warnings: [],
  };
}

const defaultPrefs: ShoppingPreferences = {
  budgetMaxKobo: 100000000, // ₦1,000,000
  preferNewCondition: true,
  prioritizeRating: true,
  preferFreeShipping: true,
  preferVerifiedMerchants: true,
  requireReturnPolicy: false,
  blockedMerchants: [],
  preferredMerchants: [],
};

// ─── Schema Validation ──────────────────────────────────────────────

describe("Schema Validation", () => {
  it("validates a minimal product query", () => {
    const result = productQuerySchema.safeParse({ query: "laptop" });
    expect(result.success).toBe(true);
  });

  it("rejects empty product query", () => {
    const result = productQuerySchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  it("applies default values to product query", () => {
    const result = productQuerySchema.parse({ query: "phone" });
    expect(result.currency).toBe("NGN");
    expect(result.condition).toBe("any");
    expect(result.maxResults).toBe(10);
  });

  it("validates shopping preferences with defaults", () => {
    const result = shoppingPreferencesSchema.parse({});
    expect(result.preferNewCondition).toBe(true);
    expect(result.blockedMerchants).toEqual([]);
  });

  it("validates a complete product listing", () => {
    const listing = makeListing();
    const result = productListingSchema.safeParse(listing);
    expect(result.success).toBe(true);
  });
});

// ─── Text Extraction ────────────────────────────────────────────────

describe("Text Extraction", () => {
  it("strips HTML tags", () => {
    expect(extractText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("removes script and style blocks", () => {
    const html =
      '<div>Content</div><script>alert("xss")</script><style>.x{}</style><div>More</div>';
    expect(extractText(html)).toBe("Content More");
  });

  it("decodes HTML entities", () => {
    const result = extractText("&amp; &lt; &gt; &quot; &#39; &nbsp;");
    expect(result).toContain("&");
    expect(result).toContain("<");
    expect(result).toContain(">");
    expect(result).toContain('"');
    expect(result).toContain("'");
  });

  it("collapses whitespace", () => {
    expect(extractText("  Hello   world  \n\t foo  ")).toBe("Hello world foo");
  });
});

// ─── Price Extraction ───────────────────────────────────────────────

describe("Price Extraction", () => {
  describe("Naira prices", () => {
    it("extracts ₦45,000", () => {
      expect(extractNairaPrice("Price: ₦45,000")).toBe(4500000);
    });

    it("extracts NGN 850000", () => {
      expect(extractNairaPrice("NGN 850000")).toBe(85000000);
    });

    it("extracts ₦1,250,000.50", () => {
      expect(extractNairaPrice("₦1,250,000.50")).toBe(125000050);
    });

    it("returns null for no price", () => {
      expect(extractNairaPrice("No price here")).toBeNull();
    });

    it("returns null for zero price", () => {
      expect(extractNairaPrice("₦0")).toBeNull();
    });
  });

  describe("USD prices", () => {
    it("extracts $45.99", () => {
      expect(extractUsdPrice("Price: $45.99")).toBe(4599);
    });

    it("extracts $1,250", () => {
      expect(extractUsdPrice("$1,250")).toBe(125000);
    });

    it("returns null for no price", () => {
      expect(extractUsdPrice("No price")).toBeNull();
    });
  });
});

// ─── Scoring Engine ─────────────────────────────────────────────────

describe("Scoring Engine", () => {
  it("scores a listing within budget higher than over budget", () => {
    const withinBudget = makeListing({ priceKobo: 50000000 });
    const overBudget = makeListing({ priceKobo: 150000000 });

    const prefs: ShoppingPreferences = {
      ...defaultPrefs,
      budgetMaxKobo: 100000000,
    };

    expect(scoreListing(withinBudget, prefs)).toBeGreaterThan(
      scoreListing(overBudget, prefs)
    );
  });

  it("prefers new condition when configured", () => {
    const newItem = makeListing({ condition: "new" });
    const usedItem = makeListing({ condition: "used" });

    const prefs: ShoppingPreferences = {
      ...defaultPrefs,
      preferNewCondition: true,
    };

    expect(scoreListing(newItem, prefs)).toBeGreaterThan(
      scoreListing(usedItem, prefs)
    );
  });

  it("prefers verified merchants", () => {
    const verified = makeListing({
      merchant: { ...makeListing().merchant, verified: true },
    });
    const unverified = makeListing({
      merchant: { ...makeListing().merchant, verified: false },
    });

    const prefs: ShoppingPreferences = {
      ...defaultPrefs,
      preferVerifiedMerchants: true,
    };

    expect(scoreListing(verified, prefs)).toBeGreaterThan(
      scoreListing(unverified, prefs)
    );
  });

  it("penalizes blocked merchants", () => {
    const blocked = makeListing({
      merchant: { name: "Shady Store", verified: false },
    });
    const normal = makeListing({
      merchant: { name: "Good Store", verified: false },
    });

    const prefs: ShoppingPreferences = {
      ...defaultPrefs,
      blockedMerchants: ["Shady"],
    };

    expect(scoreListing(blocked, prefs)).toBeLessThan(
      scoreListing(normal, prefs)
    );
  });

  it("boosts preferred merchants", () => {
    const preferred = makeListing({
      merchant: { name: "Jumia Nigeria", verified: true },
    });
    const other = makeListing({
      merchant: { name: "Random Store", verified: true },
    });

    const prefs: ShoppingPreferences = {
      ...defaultPrefs,
      preferredMerchants: ["Jumia"],
    };

    expect(scoreListing(preferred, prefs)).toBeGreaterThan(
      scoreListing(other, prefs)
    );
  });

  it("penalizes out-of-stock items", () => {
    const inStock = makeListing({ inStock: true });
    const outOfStock = makeListing({ inStock: false });

    expect(scoreListing(inStock, defaultPrefs)).toBeGreaterThan(
      scoreListing(outOfStock, defaultPrefs)
    );
  });

  it("rewards high confidence listings", () => {
    const high = makeListing({ confidence: "high" });
    const low = makeListing({ confidence: "low" });

    expect(scoreListing(high, defaultPrefs)).toBeGreaterThan(
      scoreListing(low, defaultPrefs)
    );
  });

  it("penalizes missing return policy when required", () => {
    const hasReturn = makeListing({
      merchant: {
        name: "Store A",
        verified: true,
        policies: { returnsAccepted: true },
      },
    });
    const noReturn = makeListing({
      merchant: {
        name: "Store B",
        verified: true,
        policies: { returnsAccepted: false },
      },
    });

    const prefs: ShoppingPreferences = {
      ...defaultPrefs,
      requireReturnPolicy: true,
    };

    expect(scoreListing(hasReturn, prefs)).toBeGreaterThan(
      scoreListing(noReturn, prefs)
    );
  });
});

// ─── Recommendation Engine ──────────────────────────────────────────

describe("Recommendation Engine", () => {
  it("recommends the best-scored listing", async () => {
    const listings = [
      makeListing({
        id: "cheap-used",
        title: "Galaxy S24 Used",
        priceKobo: 40000000,
        condition: "used",
        merchant: { name: "Jiji Seller", verified: false },
      }),
      makeListing({
        id: "mid-new",
        title: "Galaxy S24 New",
        priceKobo: 85000000,
        condition: "new",
      }),
      makeListing({
        id: "expensive-new",
        title: "Galaxy S24 Ultra New",
        priceKobo: 120000000,
        condition: "new",
      }),
    ];

    const comparison = makeComparison(listings);
    const result = await recommendProduct(comparison, defaultPrefs);

    expect(result.requiresApproval).toBe(true);
    expect(result.recommended).toBeDefined();
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.reason).toContain("₦");
  });

  it("always requires approval", async () => {
    const comparison = makeComparison([makeListing()]);
    const result = await recommendProduct(comparison, defaultPrefs);
    expect(result.requiresApproval).toBe(true);
  });

  it("throws on empty listings", async () => {
    const comparison = makeComparison([]);
    await expect(
      recommendProduct(comparison, defaultPrefs)
    ).rejects.toThrow("No listings available");
  });

  it("provides savings info when below average", async () => {
    const listings = [
      makeListing({ id: "cheap", priceKobo: 50000000 }),
      makeListing({ id: "mid", priceKobo: 80000000 }),
      makeListing({ id: "expensive", priceKobo: 110000000 }),
    ];

    const comparison = makeComparison(listings);
    const result = await recommendProduct(comparison, defaultPrefs);

    // The cheapest should be recommended and show savings
    if (result.recommended.priceKobo < comparison.averagePriceKobo!) {
      expect(result.savingsKobo).toBeGreaterThan(0);
    }
  });

  it("includes warnings from low-confidence listings", async () => {
    const listings = [
      makeListing({
        confidence: "low",
        warnings: ["Unverified price"],
      }),
    ];

    const comparison = makeComparison(listings);
    const result = await recommendProduct(comparison, defaultPrefs);

    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── Negotiation Preparation ────────────────────────────────────────

describe("Negotiation Preparation", () => {
  it("prepares a strategy with required approval", async () => {
    const listing = makeListing({ priceKobo: 85000000 });
    const strategy = await prepareNegotiation(listing, defaultPrefs);

    expect(strategy.requiresApproval).toBe(true);
    expect(strategy.suggestedOfferKobo).toBeLessThan(listing.priceKobo);
    expect(strategy.maxOfferKobo).toBeLessThanOrEqual(
      defaultPrefs.budgetMaxKobo!
    );
    expect(strategy.openingMessage).toContain(listing.title);
    expect(strategy.keyPoints.length).toBeGreaterThan(0);
    expect(strategy.walkAwayConditions.length).toBeGreaterThan(0);
  });

  it("offers smaller discount for verified merchants", async () => {
    const verified = makeListing({
      merchant: { name: "Jumia", verified: true },
    });
    const unverified = makeListing({
      merchant: { name: "Random", verified: false },
    });

    const strategyV = await prepareNegotiation(verified, defaultPrefs);
    const strategyU = await prepareNegotiation(unverified, defaultPrefs);

    // Verified merchants get smaller discounts (more conservative offer)
    expect(strategyV.suggestedOfferKobo).toBeGreaterThan(
      strategyU.suggestedOfferKobo
    );
  });

  it("caps offer at budget maximum", async () => {
    const listing = makeListing({ priceKobo: 200000000 }); // ₦2M
    const prefs: ShoppingPreferences = {
      ...defaultPrefs,
      budgetMaxKobo: 50000000, // ₦500K
    };

    const strategy = await prepareNegotiation(listing, prefs);
    expect(strategy.maxOfferKobo).toBeLessThanOrEqual(prefs.budgetMaxKobo!);
  });

  it("includes leverage factors for used items", async () => {
    const listing = makeListing({ condition: "used" });
    const strategy = await prepareNegotiation(listing, defaultPrefs);

    expect(strategy.leverageFactors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Used condition"),
      ])
    );
  });

  it("includes budget walk-away condition", async () => {
    const listing = makeListing();
    const prefs: ShoppingPreferences = {
      ...defaultPrefs,
      budgetMaxKobo: 90000000,
    };

    const strategy = await prepareNegotiation(listing, prefs);
    expect(strategy.walkAwayConditions).toEqual(
      expect.arrayContaining([expect.stringContaining("₦")])
    );
  });
});

// ─── Merchant Message Drafting ──────────────────────────────────────

describe("Merchant Message Drafting", () => {
  it("drafts an opening message", async () => {
    const listing = makeListing();
    const strategy = await prepareNegotiation(listing, defaultPrefs);
    const message = await draftMerchantMessage(strategy);

    expect(message.role).toBe("buyer");
    expect(message.approved).toBe(false);
    expect(message.content).toContain(listing.title);
    expect(message.content).toContain("₦");
  });

  it("drafts a follow-up based on context", async () => {
    const listing = makeListing();
    const strategy = await prepareNegotiation(listing, defaultPrefs);
    const message = await draftMerchantMessage(
      strategy,
      "The price is final at ₦850,000"
    );

    expect(message.role).toBe("buyer");
    expect(message.approved).toBe(false);
    expect(message.content).toContain("budget");
  });

  it("never marks messages as approved", async () => {
    const listing = makeListing();
    const strategy = await prepareNegotiation(listing, defaultPrefs);
    const msg1 = await draftMerchantMessage(strategy);
    const msg2 = await draftMerchantMessage(strategy, "reply");

    expect(msg1.approved).toBe(false);
    expect(msg2.approved).toBe(false);
  });
});

// ─── Merchant Lookup ────────────────────────────────────────────────

describe("Merchant Lookup", () => {
  it("returns known merchant info for Jumia", async () => {
    const info = await lookupMerchant("Jumia Nigeria");
    expect(info.name).toBe("Jumia Nigeria");
    expect(info.verified).toBe(true);
    expect(info.policies?.returnsAccepted).toBe(true);
  });

  it("returns known merchant info for Konga", async () => {
    const info = await lookupMerchant("Konga");
    expect(info.verified).toBe(true);
  });

  it("returns unverified for unknown merchants", async () => {
    const info = await lookupMerchant("Unknown Store XYZ");
    expect(info.verified).toBe(false);
    expect(info.name).toBe("Unknown Store XYZ");
  });

  it("marks Jiji as unverified (P2P)", async () => {
    const info = await lookupMerchant("Jiji Nigeria");
    expect(info.verified).toBe(false);
  });
});
