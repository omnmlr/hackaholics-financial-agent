/**
 * AGUS External Actions — Core Types & Schemas
 *
 * Self-contained type definitions for external-action capabilities.
 * These types define the integration contract that Codex's central
 * reasoning engine can use to invoke shopping/negotiation tools.
 *
 * Tagline: "Your money, and what's next."
 */

import { z } from "zod";

// ─── Product Research ───────────────────────────────────────────────

export const productQuerySchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    category: z.string().max(100).optional(),
    maxPriceKobo: z.number().int().positive().optional(),
    minPriceKobo: z.number().int().nonnegative().optional(),
    currency: z.enum(["NGN", "USD"]).default("NGN"),
    preferredMerchants: z.array(z.string().max(100)).max(10).optional(),
    condition: z.enum(["new", "used", "refurbished", "any"]).default("any"),
    maxResults: z.number().int().min(1).max(50).default(10),
  })
  .strict();

export type ProductQuery = z.infer<typeof productQuerySchema>;
export type ProductQueryInput = z.input<typeof productQuerySchema>;

export const merchantPolicySchema = z.object({
  returnsAccepted: z.boolean().optional(),
  returnWindowDays: z.number().int().nonnegative().optional(),
  warrantyMonths: z.number().int().nonnegative().optional(),
  freeShipping: z.boolean().optional(),
  shippingEstimateDays: z.number().int().nonnegative().optional(),
});

export type MerchantPolicy = z.infer<typeof merchantPolicySchema>;

export const merchantInfoSchema = z.object({
  name: z.string(),
  url: z.string().url().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  location: z.string().optional(),
  verified: z.boolean().default(false),
  responseTimeHours: z.number().nonnegative().optional(),
  policies: merchantPolicySchema.optional(),
  staleAfter: z.string().datetime().optional(),
});

export type MerchantInfo = z.infer<typeof merchantInfoSchema>;

export const productListingSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  priceKobo: z.number().int().nonnegative(),
  currency: z.enum(["NGN", "USD"]),
  originalPriceKobo: z.number().int().nonnegative().optional(),
  condition: z.enum(["new", "used", "refurbished", "unknown"]),
  merchant: merchantInfoSchema,
  url: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  inStock: z.boolean().optional(),
  specifications: z.record(z.string(), z.string()).optional(),
  source: z.string(),
  scrapedAt: z.string().datetime(),
  confidence: z.enum(["high", "medium", "low"]),
  warnings: z.array(z.string()).default([]),
  sanitized: z.boolean().default(true),
});

export type ProductListing = z.infer<typeof productListingSchema>;

// ─── Price Comparison ───────────────────────────────────────────────

export const priceComparisonSchema = z.object({
  queryId: z.string(),
  query: z.string(),
  listings: z.array(productListingSchema),
  bestPrice: productListingSchema.optional(),
  averagePriceKobo: z.number().int().nonnegative().optional(),
  medianPriceKobo: z.number().int().nonnegative().optional(),
  priceRange: z
    .object({
      minKobo: z.number().int().nonnegative(),
      maxKobo: z.number().int().nonnegative(),
    })
    .optional(),
  generatedAt: z.string().datetime(),
  totalSourcesQueried: z.number().int().nonnegative(),
  successfulSources: z.number().int().nonnegative(),
  warnings: z.array(z.string()).default([]),
});

export type PriceComparison = z.infer<typeof priceComparisonSchema>;

// ─── Shopping Preferences ───────────────────────────────────────────

export const shoppingPreferencesSchema = z.object({
  budgetMaxKobo: z.number().int().positive().optional(),
  preferNewCondition: z.boolean().default(true),
  prioritizeRating: z.boolean().default(true),
  preferFreeShipping: z.boolean().default(true),
  preferVerifiedMerchants: z.boolean().default(true),
  maxShippingDays: z.number().int().positive().optional(),
  requireReturnPolicy: z.boolean().default(false),
  blockedMerchants: z.array(z.string()).default([]),
  preferredMerchants: z.array(z.string()).default([]),
});

export type ShoppingPreferences = z.infer<typeof shoppingPreferencesSchema>;

// ─── Shopping Decision & Recommendation ─────────────────────────────

export const shoppingRecommendationSchema = z.object({
  recommended: productListingSchema,
  reason: z.string(),
  alternatives: z.array(
    z.object({
      listing: productListingSchema,
      tradeoff: z.string(),
    })
  ),
  savingsKobo: z.number().int().nonnegative().optional(),
  warnings: z.array(z.string()).default([]),
  requiresApproval: z.literal(true),
});

export type ShoppingRecommendation = z.infer<
  typeof shoppingRecommendationSchema
>;

// ─── Negotiation ────────────────────────────────────────────────────

export const negotiationStrategySchema = z.object({
  targetListing: productListingSchema,
  suggestedOfferKobo: z.number().int().positive(),
  maxOfferKobo: z.number().int().positive(),
  openingMessage: z.string(),
  keyPoints: z.array(z.string()),
  leverageFactors: z.array(z.string()),
  walkAwayConditions: z.array(z.string()),
  estimatedSuccessProbability: z.enum(["high", "medium", "low"]),
  requiresApproval: z.literal(true),
});

export type NegotiationStrategy = z.infer<typeof negotiationStrategySchema>;

export const negotiationMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["buyer", "seller", "system"]),
  content: z.string(),
  at: z.string().datetime(),
  approved: z.boolean().default(false),
});

export type NegotiationMessage = z.infer<typeof negotiationMessageSchema>;

// ─── External Action Execution & Integration ────────────────────────

export interface ExternalActionTools {
  searchProducts(query: ProductQueryInput): Promise<PriceComparison>;
  lookupMerchant(merchantName: string, url?: string): Promise<MerchantInfo>;
  recommendProduct(
    comparison: PriceComparison,
    preferences: ShoppingPreferences
  ): Promise<ShoppingRecommendation>;
  prepareNegotiation(
    listing: ProductListing,
    preferences: ShoppingPreferences
  ): Promise<NegotiationStrategy>;
  draftMerchantMessage(
    strategy: NegotiationStrategy,
    context?: string
  ): Promise<NegotiationMessage>;
}
