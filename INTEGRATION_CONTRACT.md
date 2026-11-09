# AGUS External Actions — Integration Contract

> **For Codex**: this document describes the interface contract for integrating the external-actions shopping module into AGUS's central reasoning engine.

## Module Location

```
src/lib/external-actions/
├── index.ts           # Public API — import from here
├── types.ts           # All types and Zod schemas
├── shopping-engine.ts # Implementation
└── scrapers.ts        # Web scrapers for Nigerian e-commerce
```

## Quick Start

```typescript
import { shoppingEngine } from '@/lib/external-actions';

// 1. Search for products
const comparison = await shoppingEngine.searchProducts({
  query: 'Samsung Galaxy S24 Ultra',
  maxResults: 10,
  currency: 'NGN',
  condition: 'any',
});

// 2. Get a recommendation
const recommendation = await shoppingEngine.recommendProduct(comparison, {
  budgetMaxKobo: 90000000,    // ₦900,000
  preferNewCondition: true,
  preferVerifiedMerchants: true,
});
// recommendation.requiresApproval === true  — ALWAYS

// 3. Prepare negotiation
const strategy = await shoppingEngine.prepareNegotiation(
  recommendation.recommended,
  { budgetMaxKobo: 90000000 }
);
// strategy.requiresApproval === true  — ALWAYS

// 4. Draft merchant message (does NOT send)
const message = await shoppingEngine.draftMerchantMessage(strategy);
// message.approved === false  — ALWAYS
```

## Permission Boundaries

| Action | Auto-execute? | Requires approval? |
|--------|:---:|:---:|
| Product search | ✅ | No |
| Merchant lookup | ✅ | No |
| Price comparison | ✅ | No |
| Recommendation | ✅ | **Yes** (always set) |
| Negotiation prep | ✅ | **Yes** (always set) |
| Draft messages | ✅ | **Yes** (never pre-approved) |
| **Send messages** | ❌ | Not implemented |
| **Place orders** | ❌ | Not implemented |
| **Make payments** | ❌ | Not implemented |

## Tool Interface

```typescript
interface ExternalActionTools {
  searchProducts(query: ProductQuery): Promise<PriceComparison>;
  lookupMerchant(name: string, url?: string): Promise<MerchantInfo>;
  recommendProduct(comparison: PriceComparison, prefs: ShoppingPreferences): Promise<ShoppingRecommendation>;
  prepareNegotiation(listing: ProductListing, prefs: ShoppingPreferences): Promise<NegotiationStrategy>;
  draftMerchantMessage(strategy: NegotiationStrategy, context?: string): Promise<NegotiationMessage>;
}
```

## Data Formats

- All prices are integers in **kobo** (₦) or **cents** ($)
- Timestamps are ISO 8601 strings
- All schemas are Zod-validated at boundaries
- IDs are UUIDv4 strings

## Scraper Sources

| Source | Type | Products | Confidence |
|--------|------|----------|:---:|
| Jumia.com.ng | Marketplace (verified) | New | Medium–High |
| Konga.com | Marketplace (verified) | New | Medium–High |
| Jiji.ng | P2P classifieds | Used/New | Low–Medium |

Scrapers are isolated and failure-tolerant: each runs independently, and individual failures don't block others.

## Dependencies

- **Zero** new runtime dependencies
- Uses only: `zod` (already in project), `node:crypto` (stdlib)
- `fetch` is Node.js built-in (no polyfill needed for Node 18+)

## Tests

```bash
npx vitest run tests/external-actions.test.ts    # Unit tests (offline)
npx vitest run tests/shopping-workflow.test.ts    # E2E workflow (may hit network)
```

## What Works

- ✅ Product search across 3 Nigerian e-commerce sources
- ✅ Structured price comparison with ranges and averages
- ✅ Preference-based scoring and recommendation engine
- ✅ Negotiation strategy preparation with budget awareness
- ✅ Draft merchant messages (never auto-sent)
- ✅ Merchant information lookup
- ✅ HTML text extraction and Nigerian price parsing
- ✅ Rate limiting and error isolation per scraper
- ✅ Complete Zod schema validation at all boundaries

## What Remains Incomplete

- ⬜ AliExpress/international scraper sources
- ⬜ Product image comparison
- ⬜ Price history tracking
- ⬜ Actual message delivery (blocked by design until authorization system integration)
- ⬜ Product availability monitoring / price alerts
- ⬜ Integration with AGUS memory system (Codex's domain)
- ⬜ Integration with financial approval flow (Codex's domain)
