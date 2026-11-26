> **Archived upstream claims, not integration acceptance.** See [the source audit](INTEGRATION.md) for exclusions, actual verification and remaining blockers.

# Codex Handoff: AGUS 2.0 Pollar Web SDK Integration

**Target Event:** BlockchainUNN Conference 5.0 (Intelligence Without Borders)  
**Demo Date:** November 14, 2026  
**Status:** Verification Complete & Ready for Main Interface Integration  
**Branch:** `feature/pollar-web-hackathon`  
**Commit SHA:** `605dda1`  

---

## 1. Executive Summary

We have delivered an official, verified Web-First **Pollar SDK (`@pollar/core` and `@pollar/react` v0.12.0)** payment integration for AGUS on Next.js 16 (App Router) and React 19.

This integration empowers AGUS's conversational financial AI to prepare, review, authorize, and submit gasless payments on **Stellar Testnet (with Circle Testnet USDC and XLM)** and multi-rail web infrastructure:
- **Pollar** provides the wallet provisioning, multichain transaction compilation, fee sponsorship, and transaction broadcast.
- **AGUS** provides the intelligence, obligation tracking, exact-digest owner approval, and conversational user experience.

---

## 2. Changes & File Architecture

```
├── package.json                                   # Installed @pollar/core@^0.12.0, @pollar/react@^0.12.0
├── package-lock.json
├── docs/agus-2/
│   ├── POLLAR_WEB_IMPLEMENTATION_DECISION.md      # Ground-truth findings & architectural decision
│   └── CODEX_POLLAR_HANDOFF.md                    # This handoff guide
├── src/lib/pollar/
│   ├── contracts.ts                               # Typed contracts, Stellar constants, digest math, atoms
│   ├── store.ts                                   # In-memory/persisted draft store with idempotency
│   ├── service.ts                                 # Core Pollar service (real SDK client + sandbox fallback)
│   ├── adapter.ts                                 # Unified typed PollarPaymentAdapter for Codex
│   └── index.ts                                   # Clean module export
├── src/app/api/pollar/payment/
│   └── route.ts                                   # Next.js API endpoints (/api/pollar/payment)
├── src/components/pollar/
│   └── pollar-payment-card.tsx                    # Drop-in React 19 conversational review & execution card
└── tests/
    └── pollar-web-adapter.test.ts                 # Comprehensive 16-test Vitest verification suite
```

---

## 3. Environment Variables

Add to `.env.local`:

```ini
# Pollar Web SDK Configuration
POLLAR_API_KEY=pk_testnet_your_pollar_api_key                # Server-only (privileged API calls)
NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY=pub_testnet_your_pub_key # Browser bundle (client components)
POLLAR_BASE_URL=https://sdk.api.pollar.xyz                   # Origin URL (SDK appends /v3)
POLLAR_STELLAR_NETWORK=testnet                               # testnet (default) or mainnet
```

> **Sandbox Mode:** If keys are unset, `PollarService` and `PollarPaymentAdapter` seamlessly operate in deterministic testnet sandbox mode with transparent blocker reporting (`category: "MISSING_CREDENTIALS"`).

---

## 4. How Codex Integrates the Adapter

### 4.1 Server / Conversational Flow

Codex can import `defaultPollarAdapter` from `@/lib/pollar`:

```ts
import { defaultPollarAdapter } from "@/lib/pollar";

// 1. Get user's wallet session
const session = await defaultPollarAdapter.getWalletSession(user.id);
console.log("Stellar address:", session.address);

// 2. Prepare payment when user says: "AGUS, send Daniel 10 USDC"
// NOTE: Use a controlled recipient wallet (GAE2WA6Q5V5SDOHCF3CGEK7AQEERFZ6BS7NI4AAXON2D2KZTPATB2VAU),
// NOT Circle's USDC issuer (GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5).
const { draft, review } = await defaultPollarAdapter.prepareConversationalPayment(user.id, {
  recipient: "GAE2WA6Q5V5SDOHCF3CGEK7AQEERFZ6BS7NI4AAXON2D2KZTPATB2VAU",
  amount: "10.00",
  asset: "USDC", // Stellar Testnet USDC
  memo: "Payment for design task",
});

// 3. User reviews in chat and authorizes with password re-auth:
// SECURITY REQUIREMENT: Pass the actual user password, NOT an arbitrary boolean.
const result = await defaultPollarAdapter.authorizeAndExecute(
  user.id,
  draft.id,
  {
    digest: review.digest,
    password: operatorPassword, // Genuine server-side reauthentication
  }
);

// 4. Result contains live transaction hash, receipt, explorer link, and executionMode:
console.log("Result:", result.transactionHash, result.explorerUrl, result.executionMode);
```

### 4.2 Drop-In UI Card in Chat

Codex can mount `<PollarPaymentCard />` directly in the message stream:

```tsx
import { PollarPaymentCard } from "@/components/pollar/pollar-payment-card";

export function MessagePaymentBlock({ review, senderAddress }) {
  return (
    <PollarPaymentCard
      review={review}
      senderAddress={senderAddress}
      onExecute={async (draftId, digest, password) => {
        const res = await fetch("/api/pollar/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "approve_and_submit",
            draftId,
            digest,
            password,
          }),
        });
        const data = await res.json();
        return data.execution;
      }}
    />
  );
}
```

---

## 5. Verification Evidence & On-Chain Proof

- **Automated Tests**: 18/18 passed in `tests/pollar-web-adapter.test.ts`.
  - Issue 1: Issuer address `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` blocked with `INVALID_RECIPIENT_ISSUER`.
  - Issue 2: Arbitrary boolean bypass blocked with `BOOLEAN_AUTHORIZATION_DISALLOWED` and `PASSWORD_REAUTHENTICATION_REQUIRED`.
  - Issue 3: Genuine Pollar SDK vs Sandbox fallback clearly categorized on all execution results.
- **Existing Tests**: 31/31 passed in `tests/solana-core.test.ts` (zero regressions).
- **TypeScript**: `npm run typecheck` passes with exit code 0 across the entire repository.
- **Live Public Stellar Testnet Controlled Recipient**:
  - Account: `GAE2WA6Q5V5SDOHCF3CGEK7AQEERFZ6BS7NI4AAXON2D2KZTPATB2VAU`
  - Balance: `10000.0000000 XLM`
  - Creation Tx Hash: `9a06fa5ed4e8a4ac1e7e2d71240a884488d7bcd1f07f7d29034933a7b68f21c5`
  - Ledger Sequence: `5711803`
  - Horizon API Probe: `https://horizon-testnet.stellar.org/accounts/GAE2WA6Q5V5SDOHCF3CGEK7AQEERFZ6BS7NI4AAXON2D2KZTPATB2VAU`
  - Explorer Link: `https://stellar.expert/explorer/testnet/account/GAE2WA6Q5V5SDOHCF3CGEK7AQEERFZ6BS7NI4AAXON2D2KZTPATB2VAU`

---

## 6. Exact Cherry-Pick / Merge Instructions

To integrate into Codex's branch:

```bash
# In your local working branch:
git merge feature/pollar-web-hackathon
```

Or cherry-pick the verified feature commits:

```bash
git cherry-pick 605dda1 70794f1 HEAD
```

---

## 7. 60-Second Hackathon Explanation of Pollar's Contribution

> *"For BlockchainUNN, AGUS wanted to prove that AI financial agents don't require users to manage raw private keys, manually fund gas reserves, or leave the conversation. By integrating the official Pollar Web SDK on Stellar Testnet, AGUS provisions secure, embedded wallets directly in the browser and facilitates sponsored Circle USDC transfers. When a user tells AGUS 'Send Daniel 10 USDC', AGUS calculates the obligation, binds the exact review digest for owner approval, and dispatches the gasless transaction via Pollar. Pollar handles the blockchain complexity; AGUS provides the financial intelligence."*
