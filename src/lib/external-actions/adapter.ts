/**
 * AGUS External Actions — Agent Architecture & Workspace Adapter
 *
 * Bridges the external actions shopping engine into AGUS's:
 * 1. Typed ToolRegistry & DAG PlanExecutor (src/lib/agent-architecture/)
 * 2. Gemini FunctionDeclaration format for native conversational tool calling
 *
 * Enforces explicit human authorization for consequential external actions.
 */

import { z } from "zod";
import type { FunctionDeclaration } from "@google/genai";
import { ToolRegistry } from "../agent-architecture/tool-registry";
import type { ToolContract } from "../agent-architecture/types";
import {
  productQuerySchema,
  shoppingPreferencesSchema,
  productListingSchema,
  priceComparisonSchema,
  negotiationStrategySchema,
  merchantInfoSchema,
  shoppingRecommendationSchema,
  negotiationMessageSchema,
  ProductQuery,
  PriceComparison,
  MerchantInfo,
  ShoppingPreferences,
  ProductListing,
  ShoppingRecommendation,
  NegotiationStrategy,
  NegotiationMessage,
} from "./types";
import {
  searchProducts,
  lookupMerchant,
  recommendProduct,
  prepareNegotiation,
  draftMerchantMessage,
} from "./shopping-engine";

// ─── Consequential Action Input Schema ──────────────────────────────

export const sendMerchantMessageSchema = z.object({
  recipient: z.string().min(1).max(200),
  content: z.string().min(1).max(2000),
  messageId: z.string().min(1).max(100),
});

export type SendMerchantMessageInput = z.infer<
  typeof sendMerchantMessageSchema
>;

export const sendMerchantMessageOutputSchema = z.object({
  dispatched: z.boolean(),
  messageId: z.string(),
  recipient: z.string(),
  sentAt: z.string(),
  authorizedBy: z.string(),
});

export type SendMerchantMessageOutput = z.infer<
  typeof sendMerchantMessageOutputSchema
>;

// ─── Tool Contracts for ToolRegistry ────────────────────────────────

export const searchProductsContract: ToolContract<
  ProductQuery,
  PriceComparison
> = {
  name: "search_products",
  category: "read_only",
  description:
    "Search for products across Nigerian merchants (Jumia, Konga, Jiji) with structured price comparisons, confidence ratings, and anomaly warnings. Zero cost, read-only.",
  inputSchema: productQuerySchema,
  outputSchema: priceComparisonSchema,
  isIdempotent: true,
  timeoutMs: 15_000,
  execute: async (params) => {
    return await searchProducts(params);
  },
};

const lookupMerchantInputSchema = z.object({
  merchantName: z.string().min(1).max(100),
  url: z.string().url().optional(),
});

export const lookupMerchantContract: ToolContract<
  z.infer<typeof lookupMerchantInputSchema>,
  MerchantInfo
> = {
  name: "lookup_merchant",
  category: "read_only",
  description:
    "Retrieve verified merchant details, return window, shipping policies, and credibility signals.",
  inputSchema: lookupMerchantInputSchema,
  outputSchema: merchantInfoSchema,
  isIdempotent: true,
  timeoutMs: 5_000,
  execute: async ({ merchantName, url }) => {
    return await lookupMerchant(merchantName, url);
  },
};

const recommendProductInputSchema = z.object({
  comparison: priceComparisonSchema,
  preferences: shoppingPreferencesSchema,
});

export const recommendProductContract: ToolContract<
  z.infer<typeof recommendProductInputSchema>,
  ShoppingRecommendation
> = {
  name: "recommend_product",
  category: "preparation",
  description:
    "Score and rank product listings according to user preferences, budget, condition, and merchant reliability. Requires user review.",
  inputSchema: recommendProductInputSchema,
  outputSchema: shoppingRecommendationSchema,
  isIdempotent: true,
  timeoutMs: 5_000,
  execute: async ({ comparison, preferences }) => {
    return await recommendProduct(comparison, preferences);
  },
};

const prepareNegotiationInputSchema = z.object({
  listing: productListingSchema,
  preferences: shoppingPreferencesSchema,
});

export const prepareNegotiationContract: ToolContract<
  z.infer<typeof prepareNegotiationInputSchema>,
  NegotiationStrategy
> = {
  name: "prepare_negotiation",
  category: "preparation",
  description:
    "Generate a budget-aware negotiation strategy, leverage factors, walk-away thresholds, and an initial inquiry draft for a target listing.",
  inputSchema: prepareNegotiationInputSchema,
  outputSchema: negotiationStrategySchema,
  isIdempotent: true,
  timeoutMs: 5_000,
  execute: async ({ listing, preferences }) => {
    return await prepareNegotiation(listing, preferences);
  },
};

const draftMerchantMessageInputSchema = z.object({
  strategy: negotiationStrategySchema,
  context: z.string().max(2000).optional(),
});

export const draftMerchantMessageContract: ToolContract<
  z.infer<typeof draftMerchantMessageInputSchema>,
  NegotiationMessage
> = {
  name: "draft_merchant_message",
  category: "preparation",
  description:
    "Draft a contextual negotiation or inquiry message for merchant communication. Unapproved draft only.",
  inputSchema: draftMerchantMessageInputSchema,
  outputSchema: negotiationMessageSchema,
  isIdempotent: true,
  timeoutMs: 5_000,
  execute: async ({ strategy, context }) => {
    return await draftMerchantMessage(strategy, context);
  },
};

export const sendMerchantMessageContract: ToolContract<
  SendMerchantMessageInput,
  SendMerchantMessageOutput
> = {
  name: "send_merchant_message",
  category: "consequential_external",
  description:
    "Send an authorized inquiry or negotiation message to an external merchant. Requires explicit human authorization token.",
  inputSchema: sendMerchantMessageSchema,
  outputSchema: sendMerchantMessageOutputSchema,
  isIdempotent: false,
  timeoutMs: 10_000,
  execute: async (params, context) => {
    if (!context?.authorizationToken) {
      throw new Error(
        "Consequential external action 'send_merchant_message' requires an explicit user authorization token."
      );
    }
    return {
      dispatched: true,
      messageId: params.messageId,
      recipient: params.recipient,
      sentAt: new Date().toISOString(),
      authorizedBy: context.authorizationToken,
    };
  },
};

// ─── Registration Helpers ───────────────────────────────────────────

/**
 * Registers all external action tools into an AGUS ToolRegistry.
 */
export function registerExternalActionTools(registry: ToolRegistry): void {
  registry.register(searchProductsContract);
  registry.register(lookupMerchantContract);
  registry.register(recommendProductContract);
  registry.register(prepareNegotiationContract);
  registry.register(draftMerchantMessageContract);
  registry.register(sendMerchantMessageContract);
}

/**
 * Returns Gemini FunctionDeclarations for all external action tools,
 * suitable for inclusion in Gemini GenerativeModel tools config.
 */
export function getExternalActionDeclarations(): FunctionDeclaration[] {
  const tempRegistry = new ToolRegistry();
  registerExternalActionTools(tempRegistry);
  return tempRegistry.toFunctionDeclarations();
}
