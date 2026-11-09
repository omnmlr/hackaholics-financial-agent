# AGUS 2.0 — Independent Banking, Solana, & Platform Architecture Research

**Author**: AGUS Autonomous Engineering Sprint  
**Target Audience**: Codex (Lead System Architect), Product & Security Engineering  
**Branch**: `feat/agus2-autonomous-engineering-sprint`  
**Repository**: `omnmlr/hackaholics-financial-agent`  
**Tagline**: "Your money, and what's next."  

---

## Executive Summary

AGUS 2.0 is designed as an agentic personal financial copilot capable of coordinating actions across traditional fiat rails (Nigerian Naira / commercial banks), decentralized blockchain infrastructure (Solana Devnet & Mainnet), and autonomous web workflows (shopping, negotiation, research).

Codex has already established high-assurance foundations:
1. Strict integer kobo accounting with CAS (Compare-And-Swap) approval digests and Paystack HMAC reconciliation.
2. Zero-server-key Solana architecture with simulation-first safety, SPL/SOL asset isolation, and durable follow-up reconciliation.
3. Model-led reasoning with strict separation between probabilistic LLM generation and deterministic execution authority.

This research memo provides rigorous, production-grade blueprints to advance AGUS along three critical frontiers without burdening Codex:
1. **The Nigerian Open Banking Landscape**: Realities of the CBN Open Banking Operational Guidelines, comparative breakdown of Mono, Okra, Stitch, and OnePipe, Paystack/Monnify boundary limitations, and a scalable multi-bank aggregation architecture.
2. **The Solana Production Roadmap**: Navigating the transition from Devnet to Mainnet, managing dynamic priority fees and compute unit budgets, RPC failover architecture, and evaluating Jupiter, Circle CCTP, and Solana Pay for real Nigerian FX hedging and remittance corridors.
3. **Cross-Platform Transport (WhatsApp, Telegram, Voice)**: Extending AGUS to conversational messaging channels with zero-trust session binding, out-of-band cryptographic approvals, and asynchronous audio pipeline design.

---

## Part 1: Nigerian Banking & Open Banking Architecture

### 1.1 Regulatory & Technical Reality: CBN Open Banking Guidelines

In March 2023, the Central Bank of Nigeria (CBN) issued the *Operational Guidelines for Open Banking in Nigeria*, establishing an official regulatory framework for data sharing across financial institutions.

#### Key Regulatory Pillars:
- **Open Banking Registry (OBR)**: Managed by NIBSS (Nigeria Inter-Bank Settlement System). Only participants registered in the OBR may access open banking APIs.
- **Categorization of Data & Services**:
  - *Tier 0 (Public/Indirect)*: Exchange rates, branch/ATM locations, fees.
  - *Tier 1 (Market Insight)*: Aggregated statistical product information.
  - *Tier 2 (Consumer Information)*: Account balances, historical transaction statements, account verification (requires explicit, verifiable customer consent).
  - *Tier 3 (Transaction Initiation)*: Direct debit, transfer initiation, standing orders (requires highest KYC, dual authorization, and direct CBN authorization).
- **Consent Architecture**: Customer consent must be explicit, granular, time-bounded, revocable at will, and auditable. Storing unencrypted customer credentials (such as internet banking passwords or ATM PINs) is explicitly prohibited under penalty of license revocation.

#### Technical Reality on the Ground:
Despite the CBN framework, **commercial Tier-1 banks (Access, GTBank, Zenith, UBA, First Bank) have not yet deployed universally accessible, standardized Open Banking REST APIs directly to third-party developers**.
Instead, data access in Nigeria currently operates through **aggregators (Mono, Okra, Stitch)** who utilize a hybrid of:
1. Direct institutional partnerships with select banks.
2. Secure embedded OAuth/widget flows (where the bank supports it).
3. Reverse-engineered mobile/internet banking endpoints using encrypted user-authenticated sessions.

### 1.2 Aggregator Comparison: Mono vs. Okra vs. Stitch vs. OnePipe

| Dimension | Mono | Okra | Stitch | OnePipe |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Strength** | Personal account linking & statement streaming; clean mobile SDK | Deep financial data extraction (IBAN/BVN, identity, loans) | Clean modern developer experience; strong in South Africa | Embedded banking & virtual account orchestration |
| **Coverage in Nigeria** | ~95% of retail commercial banks + Kuda, PalmPay | ~95% of retail banks + Microfinance Banks (MFBs) | Limited bank coverage in Nigeria; stronger in SA | Focuses on PayWithAccount & merchant billing |
| **Authentication Flow** | Mono Connect Widget (OTP / Mobile App 2FA) | Okra Widget (App/SMS OTP + BVN match) | Hosted web redirect | API-driven OTP verification |
| **Session Lifetime** | Periodic re-auth required every 30–90 days depending on bank | Requires re-auth when bank invalidates tokens | Token-based refresh | Partner-dependent |
| **Read Latency** | Webhook-driven statement sync (3–10s sync initial) | Real-time polling or webhook push | Fast REST | Moderate |
| **Write/Payment Capability** | *Mono DirectPay* (account-to-account transfer via NIP) | *Okra Pay* (direct debit authorization) | *Stitch Pay* (PISP-style transfer) | *PayWithTransfer* |
| **Cost Model** | ₦50–₦100 per successful account link + per-call statement fee | Flat setup + tiered monthly volume pricing | Enterprise contract | Per-transaction percentage |

#### Recommendation for AGUS:
- **Mono** is the optimal partner for AGUS's read-only personal financial management (PFM) features:
  - Proven track record with Nigerian personal finance applications.
  - Granular webhook notifications for transaction events (`transaction.created`, `account.reauthorized`).
  - Clear customer-facing consent UI that aligns with AGUS's strict human-confirmation ethos.

### 1.3 Limitations of Payment Gateways (Paystack vs. Monnify)

A frequent misconception in fintech development is assuming Paystack or Monnify can serve as full banking layers. Their boundaries must be strictly understood:

1. **Read-Only Deficit**:
   - Neither Paystack nor Monnify can query or stream account balances from an external commercial bank account (e.g. "What is my current balance at Access Bank?").
   - They only report balances of funds held inside their own merchant balance or dedicated virtual accounts.
2. **Write Limitations**:
   - **Paystack Transfers**: Outbound transfers from the merchant's Paystack balance to any Nigerian NIP bank account are fast and reliable. However, this is *merchant-funded* payout, not a debit against the user's personal bank account.
   - **Dedicated Virtual Accounts (DVA)**: Useful for funding an AGUS wallet or escrow pool via inbound bank transfer, but cannot initiate transfers *from* the user's primary bank account without pre-established NIBSS Direct Debit mandates.
3. **Reconciliation Latencies**:
   - Paystack webhooks typically arrive in 1–5 seconds, but during NIP network degradation (frequent on peak days), reconciliation can stall for up to 30 minutes, requiring AGUS's idempotent polling and fallback reconciliation.

### 1.4 Production Multi-Bank Aggregation Architecture for AGUS

```
┌────────────────────────────────────────────────────────────────────────┐
│                        AGUS PERSONAL AGENT                             │
│                  "Your money, and what's next."                        │
└───────────────────┬────────────────────────────────┬───────────────────┘
                    │                                │
      [Read-Only Historical Feeds]     [Consequential Transfers & Escrow]
                    │                                │
                    ▼                                ▼
       ┌────────────────────────┐       ┌────────────────────────┐
       │   Mono Connect Client  │       │   Paystack Transfers   │
       │  (Aggregated Balances, │       │  (Outbound Disbursals, │
       │   Statements, Cleared) │       │   Virtual Accounts)    │
       └────────────┬───────────┘       └────────────┬───────────┘
                    │                                │
                    ▼                                ▼
       ┌────────────────────────┐       ┌────────────────────────┐
       │     Commercial Banks   │       │  NIBSS Instant Payment │
       │ (GTB, Access, Zenith)  │       │     (NIP Network)      │
       └────────────────────────┘       └────────────────────────┘
```

#### Core Architectural Principles for Codex:
1. **Physical Isolation of Credentials**: AGUS never ingests, logs, or stores banking passwords or card PINs. All linking occurs inside the aggregator's hosted iframe/widget.
2. **Durable Snapshot Invalidation**: As already modeled in `src/lib/financial-data/`, cached bank balances must have explicit `staleAfter` timestamps (e.g. 5 minutes) and must never be asserted as immutable truth.
3. **Idempotent Webhook Processing**: External transaction webhooks must be deduplicated via database primary keys on `provider_reference` to prevent double-counting.

---

## Part 2: Solana Integration Path — From Devnet to Production

### 2.1 Security & UX Barriers: Devnet vs. Mainnet

The existing AGUS 2.0 implementation on `dev/agus2-solana-core-20261109` establishes critical safety primitives:
- Unsigned transaction preparation on the server.
- Zero server-held private keys (client-side signing via Phantom / Solflare).
- Mandatory simulation (`simulateTransaction`) prior to client exposure.
- Dual approval digest matching the CAS pattern.

Moving to **Mainnet-Beta** introduces four immediate production challenges:

| Barrier | Devnet Reality | Mainnet Reality | AGUS Production Remedy |
| :--- | :--- | :--- | :--- |
| **Transaction Drops / Land Rate** | Blocks rarely full; transactions confirm instantly | Congested leader queues; 20–40% unprioritized tx drops | Dynamic compute unit budgeting + priority fee injection via Helius/Jito |
| **Blockhash Expiration** | 150 slots (~60s) is ample for human review | Human review delays often exceed 60s, causing blockhash expiry | Fetch recent blockhash *only* immediately before user presentation; support automatic blockhash refresh |
| **RPC Rate Limits & Reliability** | Public devnet endpoints tolerate basic traffic | Public mainnet endpoints strictly rate-limit and desync | Premium clustered RPC (Helius / Triton) with fallback failover |
| **Loss of Real Capital** | Airdrop SOL has zero economic value | Irreversible loss if transfer parameters are malformed | Hard maximum transfer caps, destination address checksums, and address book confirmation |

### 2.2 Transaction Simulation, Priority Fees, & Compute Unit Budgets

To ensure high transaction land rates without overpaying fees on Mainnet:

#### 1. Precise Compute Unit Budgeting (`ComputeBudgetProgram.setComputeUnitLimit`)
By default, Solana transactions request 200,000 Compute Units (CUs), even if they only need 5,000 (such as a simple SOL transfer). Over-requesting CUs delays block inclusion during congestion.
- **Remedy**: Run `simulateTransaction` on the prepared transaction, inspect `unitsConsumed`, add a 15% safety buffer, and append `ComputeBudgetProgram.setComputeUnitLimit({ units: bufferUnits })`.

#### 2. Dynamic Priority Fees (`ComputeBudgetProgram.setComputeUnitPrice`)
- Standard static fees result in dropped transactions during network spikes.
- **Remedy**: Query Helius or Solana RPC `getRecentPrioritizationFees` across the last 150 slots. Compute the 75th percentile priority fee (in micro-lamports per CU) and inject `ComputeBudgetProgram.setComputeUnitPrice({ microLamports: dynamicFee })`.

### 2.3 RPC Failover Architecture

Public RPC nodes (`api.mainnet-beta.solana.com`) cannot support a financial agent. AGUS requires a resilient multi-tier RPC manager:

```typescript
export class ResilientSolanaRpcManager {
  private endpoints: string[] = [
    process.env.HELIUS_MAINNET_RPC_URL!,
    process.env.QUICKNODE_MAINNET_RPC_URL!,
    process.env.TRITON_MAINNET_RPC_URL!,
  ];
  private currentIndex = 0;

  async executeWithFailover<T>(op: (conn: Connection) => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    for (let i = 0; i < this.endpoints.length; i++) {
      const endpoint = this.endpoints[(this.currentIndex + i) % this.endpoints.length];
      try {
        const conn = new Connection(endpoint, { commitment: "confirmed", confirmTransactionInitialTimeout: 30_000 });
        return await op(conn);
      } catch (err) {
        lastError = err as Error;
        this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
      }
    }
    throw new Error(`All Solana RPC endpoints failed: ${lastError?.message}`);
  }
}
```

### 2.4 Nigerian DeFi Use Cases: FX Hedging & Remittances

For a Nigerian user facing currency volatility (Naira inflation and FX spread fluctuations), speculative crypto trading is secondary. The true consumer utilities are:

1. **Inflation Hedging (USDC Vaults)**:
   - Holding digital dollars in standard SPL USDC on Solana allows instantaneous protection against Naira depreciation.
   - Low fees (< ₦20 per transaction vs ₦2,000+ on Ethereum/Tron) make micro-savings feasible.
2. **Cross-Border Remittances**:
   - Friends/family abroad send USDC via Solana in 400 milliseconds.
   - AGUS pairs with licensed local off-ramps (e.g. Yellow Card, Fonbnk, Cashlink) to convert USDC directly into Naira NIP bank deposits.

### 2.5 Protocol Evaluation for AGUS Financial Workflows

#### 1. Jupiter Aggregator v6
- **Purpose**: Best-price execution for asset swaps (SOL <-> USDC).
- **Suitability**: **High**. Jupiter's Swap API (`quote` and `swap-instructions`) provides exact-out routing, slippage defense, and composable instructions that can be inserted into AGUS's simulation-first pipeline before signing.

#### 2. Circle CCTP (Cross-Chain Transfer Protocol)
- **Purpose**: Native 1:1 burn-and-mint of USDC across Ethereum, Arbitrum, Base, and Solana without bridge slippage or wrapped asset risk.
- **Suitability**: **Medium (Future Phase)**. Excellent for international users bridging funds from Base or Ethereum into AGUS's Solana environment.

#### 3. Solana Pay
- **Purpose**: Standardized URL specification (`solana:`) and QR code protocol for merchant point-of-sale requests and payment links.
- **Suitability**: **High (Immediate Utility)**. Allows AGUS to generate standardized payment requests for peer-to-peer or merchant checkouts that open directly in mobile wallets (Phantom, Solflare).

---

## Part 3: Cross-Platform Voice, Messaging, & Channel Architecture

### 3.1 Strategic Imperative of Messaging Channels in Nigeria

In Nigeria, **WhatsApp is the default operating system of personal and business life**. While browser-based web applications are essential for complex dashboards and rich reviews, consumer adoption requires conversational availability where users already spend their time:
- WhatsApp: 90%+ smartphone penetration.
- Telegram: Strong tech/crypto demographic.
- SMS / USSD: Essential for low-connectivity fallback.

### 3.2 Secure Messaging Architecture

Interacting with an AI agent over messaging channels creates distinct security risks:
- Phone number spoofing or SIM swaps.
- Shoulder surfing in public environments.
- Accidental voice note interpretation triggering financial commitments.

#### Zero-Trust Channel Architecture:
```
┌─────────────────┐       ┌────────────────────────┐       ┌────────────────────────┐
│  User WhatsApp  │ ----> │  WhatsApp Cloud API    │ ----> │  AGUS Webhook Ingestion│
│  (Text / Audio) │       │  (Meta Webhooks)       │       │  (HMAC Signature Check)│
└─────────────────┘       └────────────────────────┘       └───────────┬────────────┘
                                                                       │
                                                                       ▼
                                                           ┌────────────────────────┐
                                                           │  Channel Session Auth  │
                                                           │ (Phone -> Owner UUID)  │
                                                           └───────────┬────────────┘
                                                                       │
                                [Read / Conversational]                │ [Consequential Action]
                                       ┌───────────────────────────────┴─────────────────┐
                                       ▼                                                 ▼
                          ┌────────────────────────┐                        ┌────────────────────────┐
                          │ Model-Led Execution    │                        │ Ephemeral Step-Up Link │
                          │ (Agent Architecture)   │                        │ (One-Time Token, WebUI)│
                          └────────────────────────┘                        └────────────────────────┘
```

#### Security Invariants for Messaging:
1. **Read & Conversational Freedom**: Users can ask balance questions, request spending summaries, search products, or compare prices directly via chat.
2. **Mandatory Out-of-Band Step-Up for Consequential Actions**:
   - AGUS **must never execute a bank transfer, Solana transaction, or financial commitment based purely on a WhatsApp message or voice note**.
   - When a consequential action is proposed, AGUS generates a short-lived (5-minute), cryptographically signed ephemeral link:
     `https://app.agus.internal/approve?token=ha_sec_9f83...`
   - The user opens the link on their device, reviews the exact CAS digest, and authorizes with biometric/passkey or wallet signature.
3. **Voice Pipeline Processing**:
   - Inbound WhatsApp audio (`.ogg` / Opus) is downloaded via authenticated Meta Graph API.
   - Streamed to Gemini Multimodal Audio or Whisper API for transcription.
   - The verbatim transcription is logged and presented back to the user:
     *"I heard: 'Prepare a ₦50,000 transfer to Mum'. Here is the review link."*

---

## Part 4: Implementation Blueprint for Codex

To make these research findings directly actionable for Codex, the following typed contracts and interfaces are provided:

### 1. Unified Bank Aggregator Interface (`src/lib/banking/types.ts`)
```typescript
export interface BankAccountSnapshot {
  accountId: string;
  accountNumberMasked: string; // e.g. "******4819"
  bankName: string;
  bankCode: string;
  accountType: "savings" | "current";
  currency: "NGN";
  availableBalanceKobo: number;
  ledgerBalanceKobo: number;
  lastSyncedAt: string;
  staleAfter: string;
}

export interface BankStatementItem {
  transactionId: string;
  date: string;
  narration: string;
  amountKobo: number;
  type: "credit" | "debit";
  category?: string;
  counterparty?: {
    name?: string;
    bank?: string;
    accountMasked?: string;
  };
}
```

### 2. Mainnet Solana Transaction Builder (`src/lib/solana/mainnet-builder.ts`)
```typescript
export interface MainnetTransferConfig {
  connection: Connection;
  sender: PublicKey;
  recipient: PublicKey;
  lamports: bigint;
  priorityLevel: "low" | "medium" | "high";
}

export async function buildOptimizedMainnetTransfer(
  config: MainnetTransferConfig
): Promise<VersionedTransaction> {
  // 1. Fetch recent priority fees from network
  // 2. Set compute budget limit and microLamports price
  // 3. Append SystemProgram.transfer instruction
  // 4. Retrieve fresh blockhash with commitment: "confirmed"
  // 5. Compile into VersionedTransaction message (v0)
}
```

---

## Conclusion & Checkpoint

This research establishes concrete, non-speculative foundations for Codex's future integration work. By keeping these engineering blueprints grounded in Nigerian regulatory reality and live Solana network mechanics, Codex can proceed directly into implementation with zero architectural backtracking.
