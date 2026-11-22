# Decision log and open questions

Updated 2026-11-22. Use **Approved**, **Provisional**, **Blocked**, **Backlog** explicitly. Proposed role allocations and design references are not implementation approvals.

| ID | Status | Decision / issue | Evidence or follow-up |
| --- | --- | --- | --- |
| D-01 | **Approved direction** | Focus hackathon product on AGUS **Crypto**, separate from future AGUS **Bank** | Founder decision |
| D-02 | **Approved direction** | Wallet-agnostic *agentic control* of multiple blockchain wallets, not a generic chat-to-swap wallet | Founder decision |
| D-03 | **Approved direction** | Android-first and Solana-first; architecture should admit other chains later | Founder decision |
| D-04 | **Approved direction** | No mandatory private-key import / centralized custody of existing wallets | Founder decision; PR #46 constraints |
| D-05 | **Provisional / gated** | MWA package-targeted external wallet approval with saved per-wallet grants | PR #46 local tests pass; physical Phantom/Solflare acceptance pending |
| D-06 | **Provisional** | Swig optional bounded automation over separately funded smart accounts | Local permission tests passed; public Devnet and exact scopes pending |
| D-07 | **Approved vision** | Real voice, images, documents, contextual memory, proactive intelligence are first-class product experiences | Founder direction; release sequencing TBD |
| D-08 | **Backlog** | Evaluate natural open-source voice and possible intelligence fine-tuning after shipping foundation | Model selection/licensing/evals not done |
| D-09 | **Approved process** | Finish physical wallet acceptance before finalizing PRD, then agree roles and implement | Founder decision |
| D-10 | **Provisional** | Founder backend/AI + architecture + Codex/Antigravity orchestration; Chisom frontend + potential site + pitching | To agree at cofounder meeting; no fixed assignment |
| D-11 | **Approved direction** | Premium responsive marketing/product website with walkthrough and app download destination | Reference HeyElsa and Atlas Computers; creative direction pending |
| D-12 | **Provisional** | Start with a single multi-route website; only add a separate web application if required by actual flows | Avoid premature two-site architecture |
| D-13 | **Approved process** | Document product ideas and progress in the repo for continuity; do incremental integration, not a late big merge | This journal |
| D-14 | **Blocked / gate** | Real Phantom → Solflare → Phantom Devnet authorizations, finalized signatures and UX prompt counts | No physical test evidence yet |
| D-15 | **Backlog** | Repository cleanup/segregation of legacy banking, Zcash, Pollar and experiments | Inventory and review before archive/delete/merge |

## Still to decide at team meeting
- Confirm engineering owners, time commitments, review rights, API contracts, and whether Tony takes any trial/non-engineering contribution.
- Core hackathon demo narrative, minimum reliable release slice, and which multimodal capabilities are release-gating.
- Hosting/domain, release artifact distribution, privacy policy, website sections, landing-page visual references and actual CTA destinations.
- Approved founder review of PRD and technical architecture **after** device evidence.

## Claims requiring verification
- Exact hackathon submission/build window and organizer rules.
- Wallet app and Devnet network compatibility, digital asset links, return behavior, renewal and prompt count.
- Which advanced notifications or cross-wallet background actions are feasible without new authorities.
- Costs and licenses of alternative voice models and whether mobile-friendly inference is viable.
