# Pollar Web SDK Integration Decision — AGUS 2.0

**Target Event:** BlockchainUNN Conference 5.0 (Intelligence Without Borders)  
**Demo Date:** November 14, 2026  
**Focus:** Next.js / React 19 Web-First Conversational Payment Experience  
**Preferred Network:** Stellar Testnet (Native Pollar Support) with USDC & XLM  

---

## 1. SDK Truth & Verification Findings

Based on inspection of `@pollar/core` (0.12.0) and `@pollar/react` (0.12.0):

1. **Web Compatibility**:
   - Full native support for Next.js 16 (App Router) and React 19.
   - Browser client uses `@pollar/core` (`PollarClient`) with WebCrypto ECDSA P-256 and RFC 9449 DPoP proofs.
   - UI layer uses `@pollar/react` (`PollarProvider`, `usePollar`, `<WalletButton>`, etc.).

2. **Network & Asset Selection**:
   - **Stellar Testnet** is Pollar's foundational, first-class rail. Zero third-party RPC shims required.
   - Native XLM and Circle Testnet USDC (`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) are fully supported.
   - Solana Devnet is also supported at the API level via `/tx/build` and `/tx/submit` (or `/tx/build-sign-submit`).

3. **Custody & Signing Architecture**:
   - **Embedded/Custodial**: Provisioned via email/social login, with background ledger provisioning status (`CREATING`, `READY`, `FAILED`).
   - **External**: Supports browser wallets (Freighter, Albedo, Lobstr, xBull via Stellar Wallets Kit; Phantom/Solflare on Solana).
   - **Co-Signed**: Turnkey 2-of-2 co-signing option where the device proposes/verifies and votes.

4. **Payment Flow**:
   - `buildTx('payment', params)` builds an unsigned Stellar XDR (or Solana tx).
   - AGUS inspects the draft, generates a cryptographic authorization digest, requires user password approval.
   - On approval, `submitTx(signedXdr)` or `buildAndSignAndSubmitTx` dispatches payment.
   - Settlement is verified via `/tx/status` and Stellar Horizon testnet RPC (`https://horizon-testnet.stellar.org/transactions/<hash>`).

---

## 2. Implementation Architecture

We will implement:

1. **`src/lib/pollar/contracts.ts`**:
   - Types for Pollar configuration, wallet sessions, Stellar/Solana testnet drafts, review digests, submission outcomes, settlement verification.
   - Constants for Stellar Testnet Horizon (`https://horizon-testnet.stellar.org`), testnet USDC issuer, explorer links.

2. **`src/lib/pollar/service.ts`**:
   - Server-side Pollar service handling API communication (`https://sdk.api.pollar.xyz/v3`), draft preparation, status checks, idempotency, and verification.
   - Graceful fallback: when `POLLAR_API_KEY` is not configured, provides a deterministic contract-compliant sandbox mode with informative blockers and verifiable simulation.

3. **`src/lib/pollar/adapter.ts`**:
   - The unified `PollarPaymentAdapter` for Codex:
     - Provider identity (`pollar-stellar`)
     - Wallet session management
     - Balance check (XLM / USDC)
     - Draft preparation and review payload calculation
     - Owner password re-authentication enforcement
     - Payment submission with idempotency protection
     - Settlement verification on public ledger
     - Receipt generation

4. **`src/components/pollar/pollar-payment-card.tsx`**:
   - Clean, lightweight Next.js / React 19 UI component demonstrating:
     - Wallet connection state
     - Conversational draft review ("AGUS, send Daniel 10 USDC")
     - Approval button with re-authentication
     - Real-time settlement status & explorer link

5. **Automated Vitest Test Suite (`tests/pollar-web-adapter.test.ts`)**:
   - Contract validation, missing credentials, invalid recipients/amounts, idempotency, settlement, simulation mode.
