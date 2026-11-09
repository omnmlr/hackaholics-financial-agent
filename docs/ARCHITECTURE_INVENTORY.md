# AGUS 2.0 — Architecture Inventory & Capability Matrix

**Inspection Baseline**: Commit `4e378f4` (`dev/agus2-solana-core-20261109`)  
**Tagline**: "Your money, and what's next."

---

## 1. Implemented Capabilities

### A. Core Payments & Financial Safety (`src/lib/payments.ts`, `src/lib/domain.ts`, `src/lib/paystack.ts`)
- **Integer Arithmetic**: Strict integer-kobo units; zero floating-point math in financial balances.
- **Approval CAS**: Atomic Compare-And-Swap (CAS) digest verification with one-use approval nonce. Double spending or concurrent execution is mathematically blocked.
- **Provider Status Evidence**: Initiation cannot transition directly to `successful`; requires verified webhook HMAC-SHA512 or polling reconciliation. Reversals are terminal and cannot be superseded by stale success events.
- **Beneficiary Resolution**: Enforces 10-digit NUBAN numbers, verified names via provider, and stored recipient codes.

### B. Solana Devnet Financial Layer (`src/lib/solana/`)
- **Devnet Classic SPL & SOL**: Real RPC calls to `https://api.devnet.solana.com`. Validates full devnet genesis hash.
- **Simulation-First Invariant**: Every prepared unsigned transaction must successfully simulate on-chain before it can be presented to the user for approval.
- **Zero Server Keys**: Server never receives, generates, or stores private keys or seed phrases. All signatures are collected from the client wallet (Phantom/Solflare).
- **Follow-up Responsibilities**: Unresolved submissions persist as asynchronous follow-up jobs with bounded retries (32 attempts, 24h backoff).

### C. Agent Workspace & Responsibilities (`src/lib/agent-workspace/`, `src/lib/responsibilities/`)
- **Durable Responsibilities**: Task and reminder lifecycle: `pending` → `active` → `completed` | `paused` | `cancelled`.
- **Memory Boundaries**: Distinction between unconfirmed memory proposals and confirmed facts. Memory cannot grant financial or execution authority.
- **Local In-Process Runner**: Background runner handles approved reminders and read-only chain queries during server runtime without distributed message queues.

### D. Conversational Interface (`src/components/financial-conversation.tsx`, `src/lib/intelligence.ts`)
- **Native Gemini Function Calling**: Model dynamically selects tools based on typed schemas.
- **Voice Capabilities**: Web Speech API speech-to-text dictation and text-to-speech feedback with pause/mute controls.
- **Multimodal Preparation**: Uploaded invoice/receipt images extracted into unverified draft payment proposals.

---

## 2. Unfinished Integrations & Architectural Gaps

| Area | Current Status in `4e378f4` | Architectural Gap | Sprint Action |
|---|---|---|---|
| **External Actions (Shopping / Web)** | Exists only in isolated branch `feature/agus-external-actions-opus` | Missing from AGUS 2.0 core; lacks prompt injection defense and workspace compatibility adapters | Port, harden, and provide workspace-ready adapter (Milestone 4) |
| **Tool Execution Resilience** | Single-pass tool calling in `intelligence.ts` | No durable execution planner for multi-step tasks; failure in step 2 causes complete task drop | Build typed composable execution engine with durable intermediate states (Milestone 3) |
| **Mobile Experience** | Desktop-centric layout with basic responsive breakpoints | Touch target padding, virtual keyboard height shifts, multiline composer scrolling, and card overflow at 320px–430px need hardening | Browser-based audit & fixes across 5 viewports (Milestone 2) |
| **Evaluation Framework** | Rigid scripted fixtures | Lacks open-ended evaluation of user intention shifts, commitment revision, partial failures, and injection attacks | Build reproducible evaluation harness (Milestone 5) |
| **Multi-bank Nigerian Rails** | Fixture Paystack payout only | True personal account balance & statement access across 20+ commercial banks is unmapped | Document regulatory truth, CBN Open Banking standards, and viable paths (Milestone 6) |
| **Dependency Security** | 10 vulnerabilities reported in `npm audit` | Several dev-dependencies require isolation or remediation | Audit runtime reachability and safely patch (Milestone 7) |

---

## 3. Clear Integration Contract Boundaries for Codex

To ensure Codex can cleanly incorporate these improvements without regressions:
1. **Zero Core File Breakages**: Do not mutate `src/lib/domain.ts`, `src/lib/payments.ts`, or `src/lib/solana/` in a way that breaks existing contracts.
2. **Modular Architecture**: Place new execution and external-action engines under isolated namespaces (`src/lib/agent-architecture/`, `src/lib/external-actions/`).
3. **Additive UI Refinements**: Retain exact CSS classes and component contracts in `src/components/financial-conversation.tsx` and `src/components/financial-workspace.tsx`.
4. **Standard Typescript & Zod**: Export typed interfaces and Zod schemas with complete validation at runtime boundaries.
