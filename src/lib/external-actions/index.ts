/**
 * AGUS External Actions — Module Index
 *
 * Public API surface for the external-actions module.
 * Codex's central reasoning engine should import from here.
 *
 * Integration example:
 *
 *   import { shoppingEngine, type ExternalActionTools } from '@/lib/external-actions';
 *
 *   // Search for products
 *   const comparison = await shoppingEngine.searchProducts({
 *     query: 'Samsung Galaxy S24',
 *     maxResults: 10,
 *   });
 *
 *   // Get recommendation
 *   const recommendation = await shoppingEngine.recommendProduct(comparison, {
 *     budgetMaxKobo: 50000000, // ₦500,000
 *     preferNewCondition: true,
 *   });
 *
 *   // recommendation.requiresApproval === true — always
 */

export { shoppingEngine } from "./shopping-engine.js";
export {
  searchProducts,
  lookupMerchant,
  recommendProduct,
  prepareNegotiation,
  draftMerchantMessage,
  scoreListing,
} from "./shopping-engine.js";

export type {
  ExternalActionTools,
  ProductQuery,
  ProductListing,
  PriceComparison,
  MerchantInfo,
  ShoppingPreferences,
  ShoppingRecommendation,
  NegotiationStrategy,
  NegotiationMessage,
  ExternalActionResult,
  ActionStatus,
} from "./types.js";

export {
  productQuerySchema,
  merchantInfoSchema,
  productListingSchema,
  priceComparisonSchema,
  shoppingPreferencesSchema,
  shoppingRecommendationSchema,
  negotiationStrategySchema,
  negotiationMessageSchema,
  externalActionResultSchema,
} from "./types.js";

export { scrapeAll, scraperRegistry, extractText, extractNairaPrice, extractUsdPrice } from "./scrapers.js";
export type { Scraper } from "./scrapers.js";
