# AGUS Crypto — Project Journal

**Status:** Active concept + Android technical validation. **Updated:** 2026-11-22.

This directory is the durable product memory for AGUS Crypto: what we decided, what was actually demonstrated, what remains open, and what should be built next. Read it before drafting a PRD, starting a new Codex task, changing product direction, or designing the app.

## Navigation
- [Progress and validation gates](PROGRESS.md): dated outcomes, proof quality and immediate next actions
- [Vision, scope and idea backlog](PRODUCT_VISION.md): user-facing product intent and retained longer-term ideas
- [Decisions and open questions](DECISIONS.md): confirmed choices versus proposals awaiting testing
- [Web and mobile experience](EXPERIENCE.md): reference direction and the website's role
- [Team and delivery workflow](TEAM_AND_DELIVERY.md): provisional work ownership, branches and integration checkpoints

## Source of truth / precedence
1. Real, reproducible test evidence and actual wallet behavior override earlier assumptions.
2. Explicit founder-approved decisions override proposals and brainstorming.
3. A future approved PRD will specify release scope; until then, these are **working notes**, not a finished specification.
4. Do not rewrite historical claims as successful device tests or silently drop ideas that are postponed.

## Immediate gate
See [draft PR #46](https://github.com/omnmlr/hackaholics-financial-agent/pull/46) and its feasibility/compatibility reports. **Real Phantom → Solflare → Phantom signing on one Android device with public finalized Devnet signatures remains unverified as of this note.** Do not treat local runtime or mock transport tests as equivalent.

## Project boundaries
- **AGUS Crypto**: wallet-agnostic blockchain financial agent, Solana-first, multichain-capable design.
- **AGUS Bank**: separate future product for conventional bank-account connections. Do not mix banking scope into Crypto.
- Existing legacy experiments are historical material; cleanup must preserve recoverable history and avoid destroying active code.
