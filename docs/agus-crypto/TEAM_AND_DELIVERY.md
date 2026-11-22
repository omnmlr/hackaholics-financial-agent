# Proposed team roles, working agreement and delivery plan

**Status: discussion draft, not approved assignments.** Updated 2026-11-22.

## Proposed ownership to confirm in meeting

| Workstream | Proposed lead | Support / collaboration | Done means |
| --- | --- | --- | --- |
| Product definition, prioritization, AI/backend architecture | Founder | Chisom; Codex / Antigravity as development tools | Requirements and tests reviewed, backend contracts stable |
| Agent tools, Solana data, wallet-control services, security/reconciliation | Founder | Codex / Antigravity | Reproducible backend/mobile integration tests and verified receipts |
| Mobile UI/UX and Android frontend | Chisom | Founder creative direction and QA | Real interactive frontend wired to agreed contracts |
| Landing/product website and interactive walkthrough | Chisom (proposed) | Founder co-direction | Responsive narrative site with truthful download/status CTAs |
| Physical wallet acceptance and full-device demo | Joint | Codex prepares APK/test guide | Public Devnet Phantom → Solflare → Phantom receipts plus UX observation |
| Pitch/demo narrative | Joint; Chisom likely presenting | Founder | Live demonstrable capability, honest limitations |
| Community validation / tester recruitment | Unassigned; Tony potential contributor only | Joint | Real user feedback, not hypothetical endorsements |

Chisom's frontend ownership is a **proposal**, not a command. Confirm his skills/tools, time, design responsibilities and what the founder can realistically take on. Do not assign permanent cofounder equity via this document.

## Engineering collaboration rules
1. Before independent frontend/backend implementation, agree on **typed API and tool contracts**: wallet account object, balances, asset identity/price, connection states, transfer intent, signer/approval flow, receipts, pending/rejected/error states and event timestamps.
2. Write mock fixtures and contract tests early so frontend development is unblocked while backend integrates real signing.
3. Separate branches/PRs for wallet-control acceptance, backend/agent services, mobile UI, website and later cleanups. Avoid broad simultaneous edits to the same files.
4. Merge **small compatible vertical slices frequently** behind feature flags after CI checks. Do not wait until the entire frontend is done for one large merge.
5. Agree which branch is the integration target; inspect CI and device acceptance before advancing release. Never automatically merge spike PR #46 because local tests passed.
6. Keep a living demo build and test matrix: network, devices, wallet app versions, flows and public explorer signatures.
7. Document decisions and evidence in this directory at each checkpoint. Update progress after each demonstrable change; keep speculative ideas in vision/backlog.

## Immediate sequence
- **Gate A:** Accessible verified Android test APK, origin attestation repair, Phantom/Solflare physical Devnet acceptance and failure cases.
- **Gate B:** Founder/Chisom meeting; confirm technical ownership, product scope and interface contracts.
- **Gate C:** Approve concise PRD and architecture based on actual Gate A evidence, with future ideas preserved separately.
- **Gate D:** Build functional vertical slices in parallel; integrate incrementally; then release/pitch readiness.
- **Gate E:** Safe repository cleanup by module inventory and review (isolate legacy banking/Zcash/Pollar; never delete history reflexively).

## Current blockers and decisions needing owners
- APK distribution and assetlinks origin attestation: Codex task + Android tester.
- Physical Phantom → Solflare → Phantom signatures: founder device + Chisom assistance.
- API contract ownership and selected integration branch: agree in team meeting.
- Premium marketing site must not delay the core signed transaction demo.
