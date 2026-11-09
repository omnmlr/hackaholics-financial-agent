/**
 * AGUS External Actions — Shopping & Negotiation Engine
 *
 * Implements the ExternalActionTools interface for product research,
 * price comparison, recommendation, and negotiation preparation.
 *
 * Invariants:
 * - Never purchases products or sends external messages without user authorization
 * - All prices are in kobo (₦) or cents ($) as integers
 * - Confidence levels and warnings are always propagated
 * - Scraped data is attributed to its source and sanitized
 */

import { randomUUID } from "node:crypto";
import type {
  ExternalActionTools,
  ProductQuery,
  ProductQueryInput,
  PriceComparison,
  MerchantInfo,
  ShoppingPreferences,
  ShoppingRecommendation,
  NegotiationStrategy,
  NegotiationMessage,
  ProductListing,
} from "./types";
import { productQuerySchema, shoppingPreferencesSchema } from "./types";
import { scrapeAll, Scraper } from "./scrapers";
import { detectPriceAnomalies } from "./anomaly-detector";

// ─── Product Search ─────────────────────────────────────────────────

export async function searchProducts(
  query: ProductQueryInput,
  customScrapers?: Scraper[]
): Promise<PriceComparison> {
  const validated = productQuerySchema.parse(query);
  const { listings, errors, sourcesQueried, sourcesSucceeded } =
    await scrapeAll(validated, customScrapers);

  // Run anomaly and hallucination detection on scraped listings
  const { processedListings, medianPriceKobo, anomalyWarnings } =
    detectPriceAnomalies(listings);

  const prices = processedListings
    .map((l) => l.priceKobo)
    .filter((p) => p > 0);

  const averagePrice =
    prices.length > 0
      ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
      : undefined;

  const bestPrice =
    processedListings.length > 0
      ? processedListings.reduce((a, b) =>
          a.priceKobo <= b.priceKobo ? a : b
        )
      : undefined;

  const warnings = [...errors, ...anomalyWarnings];
  if (sourcesSucceeded === 0) {
    warnings.push(
      "No sources returned live results. Product data may be unavailable."
    );
  }
  if (processedListings.length === 0) {
    warnings.push(
      `No listings found for "${validated.query}". Try different keywords or broader filters.`
    );
  }

  return {
    queryId: randomUUID(),
    query: validated.query,
    listings: processedListings,
    bestPrice,
    averagePriceKobo: averagePrice,
    medianPriceKobo,
    priceRange:
      prices.length >= 2
        ? {
            minKobo: Math.min(...prices),
            maxKobo: Math.max(...prices),
          }
        : undefined,
    generatedAt: new Date().toISOString(),
    totalSourcesQueried: sourcesQueried,
    successfulSources: sourcesSucceeded,
    warnings,
  };
}

// ─── Merchant Lookup ────────────────────────────────────────────────

export async function lookupMerchant(
  merchantName: string,
  url?: string
): Promise<MerchantInfo> {
  const knownMerchants: Record<string, Partial<MerchantInfo>> = {
    jumia: {
      name: "Jumia Nigeria",
      url: "https://www.jumia.com.ng",
      verified: true,
      policies: {
        returnsAccepted: true,
        returnWindowDays: 7,
        freeShipping: false,
      },
    },
    konga: {
      name: "Konga",
      url: "https://www.konga.com",
      verified: true,
      policies: {
        returnsAccepted: true,
        returnWindowDays: 7,
      },
    },
    jiji: {
      name: "Jiji Nigeria",
      url: "https://jiji.ng",
      verified: false,
      policies: {
        returnsAccepted: false,
      },
    },
  };

  const normalized = merchantName.toLowerCase().trim();
  for (const [key, info] of Object.entries(knownMerchants)) {
    if (normalized.includes(key)) {
      return {
        name: info.name ?? merchantName,
        url: url ?? info.url,
        verified: info.verified ?? false,
        policies: info.policies,
      };
    }
  }

  return {
    name: merchantName,
    url,
    verified: false,
  };
}

// ─── Product Recommendation ─────────────────────────────────────────

export function scoreListing(
  listing: ProductListing,
  prefs: ShoppingPreferences
): number {
  let score = 100;

  // Price score (lower is better relative to budget)
  if (prefs.budgetMaxKobo) {
    if (listing.priceKobo > prefs.budgetMaxKobo) {
      score -= 50; // Over budget penalty
    } else {
      score += Math.round((1 - listing.priceKobo / prefs.budgetMaxKobo) * 20);
    }
  }

  // Condition preference
  if (prefs.preferNewCondition && listing.condition === "new") {
    score += 15;
  } else if (prefs.preferNewCondition && listing.condition === "used") {
    score -= 10;
  }

  // Merchant rating
  if (prefs.prioritizeRating && listing.merchant.rating) {
    score += Math.round(listing.merchant.rating * 5);
  }

  // Verified merchant bonus
  if (prefs.preferVerifiedMerchants && listing.merchant.verified) {
    score += 12;
  }

  // Free shipping bonus
  if (prefs.preferFreeShipping && listing.merchant.policies?.freeShipping) {
    score += 8;
  }

  // Return policy bonus / penalty
  if (
    prefs.requireReturnPolicy &&
    !listing.merchant.policies?.returnsAccepted
  ) {
    score -= 25;
  }

  // Shipping speed
  if (
    prefs.maxShippingDays &&
    listing.merchant.policies?.shippingEstimateDays &&
    listing.merchant.policies.shippingEstimateDays > prefs.maxShippingDays
  ) {
    score -= 15;
  }

  // Blocked merchants
  if (
    prefs.blockedMerchants.some((b) =>
      listing.merchant.name.toLowerCase().includes(b.toLowerCase())
    )
  ) {
    score -= 150;
  }

  // Preferred merchants
  if (
    prefs.preferredMerchants.some((p) =>
      listing.merchant.name.toLowerCase().includes(p.toLowerCase())
    )
  ) {
    score += 15;
  }

  // Confidence & anomaly penalties
  if (listing.confidence === "high") score += 10;
  else if (listing.confidence === "low") score -= 25;

  if (listing.warnings.some((w) => w.startsWith("price_anomaly:"))) {
    score -= 40;
  }
  if (listing.warnings.some((w) => w.includes("injection"))) {
    score -= 50;
  }

  // In-stock bonus/penalty
  if (listing.inStock === true) score += 5;
  else if (listing.inStock === false) score -= 30;

  return score;
}

export async function recommendProduct(
  comparison: PriceComparison,
  preferences: ShoppingPreferences
): Promise<ShoppingRecommendation> {
  const prefs = shoppingPreferencesSchema.parse(preferences);
  const { listings } = comparison;

  if (listings.length === 0) {
    throw new Error(
      "No listings available for recommendation. Run a product search first."
    );
  }

  // Score all listings
  const scored = listings
    .map((listing) => ({
      listing,
      score: scoreListing(listing, prefs),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const alternatives = scored.slice(1, 4).map((s) => {
    const tradeoffs: string[] = [];
    if (s.listing.priceKobo < best.listing.priceKobo) {
      tradeoffs.push(
        `₦${((best.listing.priceKobo - s.listing.priceKobo) / 100).toLocaleString()} cheaper`
      );
    } else if (s.listing.priceKobo > best.listing.priceKobo) {
      tradeoffs.push(
        `₦${((s.listing.priceKobo - best.listing.priceKobo) / 100).toLocaleString()} more expensive`
      );
    }
    if (s.listing.merchant.verified && !best.listing.merchant.verified) {
      tradeoffs.push("verified merchant");
    }
    if (s.listing.condition === "new" && best.listing.condition !== "new") {
      tradeoffs.push("new condition");
    }
    if (
      s.listing.merchant.policies?.returnsAccepted &&
      !best.listing.merchant.policies?.returnsAccepted
    ) {
      tradeoffs.push("has return policy");
    }
    return {
      listing: s.listing,
      tradeoff: tradeoffs.join("; ") || "Similar overall value",
    };
  });

  const reason = buildRecommendationReason(best.listing, prefs, comparison);

  const savingsKobo =
    comparison.averagePriceKobo &&
    best.listing.priceKobo < comparison.averagePriceKobo
      ? comparison.averagePriceKobo - best.listing.priceKobo
      : undefined;

  const warnings: string[] = [];
  if (best.listing.confidence === "low") {
    warnings.push(
      "Low confidence listing — verify price and availability before proceeding"
    );
  }
  if (best.listing.inStock === false) {
    warnings.push("This item may be out of stock");
  }
  if (best.listing.warnings.length > 0) {
    warnings.push(...best.listing.warnings);
  }

  return {
    recommended: best.listing,
    reason,
    alternatives,
    savingsKobo,
    warnings,
    requiresApproval: true,
  };
}

function buildRecommendationReason(
  listing: ProductListing,
  prefs: ShoppingPreferences,
  comparison: PriceComparison
): string {
  const parts: string[] = [];

  parts.push(
    `Best match for "${comparison.query}" at ₦${(listing.priceKobo / 100).toLocaleString()}`
  );

  if (prefs.budgetMaxKobo && listing.priceKobo <= prefs.budgetMaxKobo) {
    parts.push("within budget");
  }

  if (listing.merchant.verified) {
    parts.push(`from verified merchant ${listing.merchant.name}`);
  }

  if (listing.condition === "new") {
    parts.push("new condition");
  }

  if (listing.merchant.policies?.returnsAccepted) {
    parts.push(
      `${listing.merchant.policies.returnWindowDays ?? "?"}-day return policy`
    );
  }

  if (
    comparison.averagePriceKobo &&
    listing.priceKobo < comparison.averagePriceKobo
  ) {
    const savings = (
      (comparison.averagePriceKobo - listing.priceKobo) /
      100
    ).toLocaleString();
    parts.push(`₦${savings} below average price`);
  }

  return parts.join(". ") + ".";
}

// ─── Negotiation Preparation ────────────────────────────────────────

export async function prepareNegotiation(
  listing: ProductListing,
  preferences: ShoppingPreferences
): Promise<NegotiationStrategy> {
  const prefs = shoppingPreferencesSchema.parse(preferences);

  // Pricing strategy: 5-15% target discount depending on verification
  const targetDiscount = listing.merchant.verified ? 0.05 : 0.15;
  const maxDiscount = listing.merchant.verified ? 0.1 : 0.25;

  const suggestedOffer = Math.round(listing.priceKobo * (1 - targetDiscount));
  const maxOffer = Math.round(listing.priceKobo * (1 - maxDiscount * 0.3));

  const budgetCapped = prefs.budgetMaxKobo
    ? Math.min(maxOffer, prefs.budgetMaxKobo)
    : maxOffer;

  const leverage: string[] = [];
  if (listing.condition === "used") {
    leverage.push("Used condition justifies negotiation on price");
  }
  if (listing.inStock === false) {
    leverage.push("Item availability is uncertain");
  }
  if (!listing.merchant.verified) {
    leverage.push("Unverified merchant — request additional trust signals");
  }
  if (listing.merchant.policies?.returnsAccepted === false) {
    leverage.push("No return policy — negotiate for inspection period");
  }

  const walkAway: string[] = [
    "Seller refuses to provide additional photos or details",
    "Price exceeds your maximum budget",
    "Seller pressure to complete transaction immediately",
    "Seller asks for payment through unofficial channels",
  ];
  if (prefs.budgetMaxKobo) {
    walkAway.push(
      `Final price exceeds ₦${(prefs.budgetMaxKobo / 100).toLocaleString()}`
    );
  }

  const keyPoints: string[] = [
    `Listed price: ₦${(listing.priceKobo / 100).toLocaleString()}`,
    `Target: ₦${(suggestedOffer / 100).toLocaleString()} (${Math.round(targetDiscount * 100)}% off)`,
    "Request current photos and condition details",
    "Clarify shipping costs and timeline",
    "Confirm return/warranty terms before committing",
  ];

  const openingMessage = buildOpeningMessage(listing, suggestedOffer);

  return {
    targetListing: listing,
    suggestedOfferKobo: suggestedOffer,
    maxOfferKobo: budgetCapped,
    openingMessage,
    keyPoints,
    leverageFactors: leverage,
    walkAwayConditions: walkAway,
    estimatedSuccessProbability: listing.merchant.verified ? "low" : "medium",
    requiresApproval: true,
  };
}

function buildOpeningMessage(
  listing: ProductListing,
  offerKobo: number
): string {
  const offerNaira = (offerKobo / 100).toLocaleString();
  const lines = [
    `Hello, I'm interested in "${listing.title}".`,
    "",
    "Before proceeding, I'd appreciate if you could confirm:",
    "1. Current availability and condition",
    "2. Whether the listed price includes shipping",
    "3. Your return or inspection policy",
    "",
    `I'd like to offer ₦${offerNaira} for this item.`,
    "",
    "Looking forward to your response.",
  ];
  return lines.join("\n");
}

// ─── Draft Merchant Message ─────────────────────────────────────────

export async function draftMerchantMessage(
  strategy: NegotiationStrategy,
  context?: string
): Promise<NegotiationMessage> {
  let content: string;

  if (context) {
    content = buildFollowUpMessage(strategy, context);
  } else {
    content = strategy.openingMessage;
  }

  return {
    id: randomUUID(),
    role: "buyer",
    content,
    at: new Date().toISOString(),
    approved: false, // Always requires explicit approval before transmission
  };
}

function buildFollowUpMessage(
  strategy: NegotiationStrategy,
  sellerResponse: string
): string {
  const maxNaira = (strategy.maxOfferKobo / 100).toLocaleString();
  const lines = [
    `Thank you for your response regarding "${strategy.targetListing.title}".`,
    "",
  ];

  if (
    sellerResponse.toLowerCase().includes("price") ||
    sellerResponse.toLowerCase().includes("₦") ||
    sellerResponse.toLowerCase().includes("naira")
  ) {
    lines.push(
      `My budget allows up to ₦${maxNaira}. Would you consider meeting at that price?`
    );
  } else {
    lines.push(
      "I appreciate the details. Could you also confirm the final price including all costs?"
    );
  }

  lines.push("");
  lines.push(
    "I'm ready to proceed once we agree on terms that work for both of us."
  );

  return lines.join("\n");
}

// ─── Exported Engine ────────────────────────────────────────────────

export const shoppingEngine: ExternalActionTools = {
  searchProducts,
  lookupMerchant,
  recommendProduct,
  prepareNegotiation,
  draftMerchantMessage,
};
