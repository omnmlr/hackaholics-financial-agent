# AGUS — AI usage, account abuse and unit-economics guardrails
**Status:** Pre-PRD product requirements / founder emphasis, recorded 2026-11-23. Numeric quotas and prices below are **hypotheses**, not approved commercial terms or working features.

## Product principle
AGUS's main value is unified management of financial activity across existing wallets. Linking multiple independently owned wallets is *normal product usage*, not suspicious multiple-account creation. Differentiate **one AGUS user identity** from **many linked or watched blockchain addresses** and from **an optional AGUS Pocket**. Never silently combine or authorize wallets merely because their public addresses have been entered.

Founder explicitly requires sustainable AI costs and controls against (a) creating numerous AGUS identities to claim free trial/AI quotas, (b) automated prompting or AI spam, and (c) unbounded model inference or chain-indexing costs.

## Recommended commercial stance
- **Do not require an upfront signup fee to try AGUS.** It creates heavy acquisition friction and does little to prevent low-cost or stolen-identity abuse. Do not require subscriptions for basic wallet aggregation or essential transaction verification.
- **Freemium + metered AI/automation is the default hypothesis:** basic balance/history access and essential deterministic transaction workflows free within reasonable provider rate limits; limited free AI investigations; paid AI usage packs and/or a subscription for more frequent/high-compute users; separate transparent fees for valuable optional business/automation operations where justifiable.
- Do not claim all paid features are unlimited; every tier needs explicit fair-use and backstop budgets. No AI API provider key in the mobile app and no private signing authority on the LLM path.
- Avoid charging repeatedly for mandatory security checks, permission revocations, receipt verification or recovery. Users must be able to exit Pocket safely if a subscription expires.
- Preserve access to user funds and underlying account data if AI quota is exhausted; simply gate new paid AI generations and optional high-cost insights.

## Proposed trial quota, not yet selected
Consider a **small free daily/weekly pool of AI-assisted analyses** (initial test candidate: 10 grounded AI questions per day plus a separate modest monthly heavy-analysis quota). Ordinary portfolio reads, deterministic history lookups, invoice status and payment finality checks should **not** silently consume an LLM prompt allowance if they can be served with non-LLM methods.

Offer clearly labeled usage remaining, next reset time, and upgrades/top-ups rather than surprising mid-task throttles. Charge based on cost-weighted work (short ledger explanation vs long historical investigation), not just raw message counts. Bound lookback, number of token accounts and RPC/indexing compute per request; provide stable pagination and background caching.

Before freezing allowances, measure **unit costs per actual feature**, including prompt/input/output tokens, tool calls, retries, indexing/RPC, storage, support, fraud costs and model-provider quotas. Protect gross margin under worst-case heavy use. Model provider pricing and paid tier prices must be measured at build time, not invented here.

## Identity / account anti-abuse
- One primary AGUS profile per person is a **policy goal, not a technically enforceable absolute**. Users may legitimately have multiple devices and multiple wallets.
- Sign up with an authenticated identity (verified email, passkey or other suitable mechanism). Apply risk-aware controls for new free accounts. Verify wallet ownership by signed challenge **before enabling signing-related control**; watch-only addresses remain read-only and distinctly labeled.
- Use identity-level quotas and abuse detection across device/session/IP/network signals where lawful, proportionate and privacy-preserving. Do not use IP address, wallet address, device fingerprint, email alias or SIM alone as conclusive unique-person proof. Avoid blanket bans of campuses, mobile carrier NAT, VPNs and shared families.
- Limit free-tier creation/redeeming patterns and repeated trial claims with risk signals, short cool-downs, email verification, and human-review appeal paths. A paid upgrade can increase limits without being a requirement for account existence.
- Allow secure unlink, wallet change, account recovery and privacy deletion paths. Multiple connected wallets must never automatically multiply user AI quotas.
- Differentiate signed-in user tokens, agent tasks, wallet identities and AGUS Pocket signer identities in authorization/audit logs.

## API and infrastructure safeguards
- **Server-side quota metering:** atomic per-identity counters plus per-IP/device risk gates and global budget ceilings. Enforce on *all* AI entry points, worker jobs, conversational APIs and retries. Per-identity daily/period budget; per-request input/output token limits; tool-call count; history lookback, concurrency, frequency and spending limits.
- **Cost-aware orchestration:** use deterministic queries for balances, histories, portfolio arithmetic, receipts and state checks; invoke LLM only for language interpretation/explanations that need one. Prefer smaller model for simple tasks and escalate selectively, with strict structured outputs and verified on-chain sources. Cache only non-sensitive shared chain metadata/prices and safely scoped user results; never cache private messages across identities. Summarize/truncate conversation histories and throttle long contexts.
- **Anti-loop limits:** cap agent steps, tool calls, retry depth and scheduled operations. Never let agents recursively trigger billable LLM calls or costly third-party APIs without task budgets. Cancel work at quota boundaries and show partial work honestly.
- **Rate limiting:** short-window request burst limits, concurrent request limits, abuse/risk signals and circuit breakers for unexpected provider spend. Respect provider-specific latency/429s without uncontrolled retries. For reads, paginate/cache and avoid repeated full-address rescans.
- **Payment safety isolation:** LLM cost/usage gates and payment authorization are different. No payments inferred from free-text or app state without explicit wallet owner/policy authorizer; no payment duplicate because of retry. AI quota expiration must never interfere with emergency revocation, root withdrawal, pending settlement recovery or access to existing financial records.
- **Observability:** dashboard for active users, AI questions per user, tokens and billed USD per workflow, RPC/indexer requests, cache hit ratio, failed retries, gross revenue per paying cohort, abnormal usage and global daily/monthly stop-loss.

## PRD acceptance requirements
1. One signed-in person can link several independently owned wallets, with quotas counted **once** per AGUS identity, without forcing Pocket.
2. Floods and concurrent prompt retries cannot exceed configured server-side quota/budget due to race conditions.
3. A free user may still inspect balances, initiate safely wallet-authorized core operations and recover account access when LLM quota is exhausted (within reasonable infrastructure read safeguards).
4. AI calls that exceed quotas return a clear, recoverable message and never execute a pending financial command.
5. Device/IP anomalies trigger proportionate safeguards, not arbitrary irreversible lockouts.
6. Every expensive workflow has an observable per-operation cost and a configured failure/circuit-breaker behavior.
7. Pricing and actual free quota are finalized only after test measurements of API and data-provider costs and willingness to pay, with a realistic abuse stress test.
8. Pocket withdrawals, policy revocations and verification of in-flight settlements remain available regardless of payment/subscription status.

This file adds a **commercial and operational constraint** to the corrected AGUS multi-wallet vision. It does not reframe AGUS as an invoicing service and does not implement rate limiting or paid plans by itself.
