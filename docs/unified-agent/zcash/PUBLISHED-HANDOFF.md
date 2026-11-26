> Published-source snapshot from b9efe96. Status and proof claims below are those of the feature author. See [Counterpart audit](AUDIT.md) for the independently inspected integration status.

# AGUS 2.0 — Zcash Shielded Conversational Payments
## Codex Integration Handoff & Technical Specification
**Event:** BlockchainUNN Conference 5.0 — Intelligence Without Borders Hackathon
**Demo Day:** November 14, 2026
**Track:** Zcash / Privacy-Preserving Payments
**Feature Branch:** `feature/zcash-private-conversational-payments` (Published on `origin`)
**Status:** IMPLEMENTATION COMPLETE — 36/36 TESTS PASSING — LIVE TESTNET VERIFIED & SETTLED

---

## 1. Executive Summary & Genuine Settlement Evidence

AGUS 2.0 has achieved **genuine, end-to-end shielded ZEC transaction execution on the live Zcash Testnet**.

This is not a mock or QR placeholder:
1. Two distinct shielded wallets were initialized with **Orchard Unified Addresses (ZIP 316)** via `librustzcash`.
2. The sender wallet (`wallet-alice`) was funded with **0.1 TAZ** from the live testnet faucet (`txid: 070177427fd63f2bdff6259de8e0d2a2a7aa9270c39a410e4240ab867a26b8cb`).
3. An authorized transfer of **0.05 ZEC** (5,000,000 zatoshis) was signed using genuine Halo 2 zero-knowledge proving circuits, and broadcast to the live network with exact conventional ZIP-317 fee (10,000 zatoshis).
4. The transaction was mined at block height **`4,616,326`** on the live Zcash Testnet.
5. The receiving wallet (`wallet-bob`) synchronized with `testnet.zec.rocks:443`, detected the shielded note, and updated its balance to **`5,000,000 zatoshis`**.

### Authentic On-Chain Proof Records:
```json
{
  "network": "Zcash Testnet (NU5/NU6 Ironwood branch ID 77190ad9)",
  "lightwalletd_endpoint": "testnet.zec.rocks:443",
  "sender_wallet": {
    "address": "utest13hne80zxq7467kcpew2s8runvp3s32xc5ydj6e3m9evnveskeym7n4kxkwxjla2qfzjhv3ygr0uldcyr2yw3p3uare7ghxy8rg85n7md",
    "pool": "Orchard (Halo 2 zero-knowledge circuit)",
    "birthday": 4616191
  },
  "receiver_wallet": {
    "address": "utest1v9xtx0d6pqyaahug66905quh5v6e8ee8ggf5yv885laj6ur9vg9z6zhxtgfufrdf2wwllr4kacryaa4lwp292sy8cneyazlacu7rvjf3",
    "pool": "Orchard (Halo 2 zero-knowledge circuit)",
    "birthday": 4616191
  },
  "faucet_funding_txid": "070177427fd63f2bdff6259de8e0d2a2a7aa9270c39a410e4240ab867a26b8cb",
  "shielded_transfer_txid": "ab7f8db0323414980c8389977587bf43c42e13765616c090dbd1e1d3cf461323",
  "mined_block_height": 4616326,
  "confirmations_observed": 6,
  "amount_transferred": "0.05 ZEC (5,000,000 zatoshis)",
  "network_fee": "0.0001 ZEC (10,000 zatoshis, ZIP-317 conventional fee)",
  "receiver_note_detected": true,
  "receiver_verified_atoms": "5000000 zatoshis"
}
```

---

## 2. Priority 1 Audit: Real vs Simulated Operations

To maintain absolute documentation integrity, here is the exact breakdown of all operations:

| Subsystem | Execution Mode | Evidence & Invariants |
|---|---|---|
| **Live Chain Reading (`LightwalletdClient`)** | **REAL LIVE NETWORK** | Connects over TLS HTTP/2 to `testnet.zec.rocks:443`. Queries live tip (>4,616,330), consensus branch ID (`77190ad9`), and block headers. |
| **Shielded Spend Proving & Signing** | **REAL CRYPTOGRAPHIC SIGNING** | Built on `librustzcash` (`zcash_client_backend` 0.25.0 / `zcash_client_sqlite` 0.23.0 via `zaw`). Generates genuine Halo 2 proving circuits and Jubjub/Pallas signatures. |
| **P2P Shielded Transfer** | **REAL BROADCAST & MINED** | TXID `ab7f8db0323414980c8389977587bf43c42e13765616c090dbd1e1d3cf461323` broadcast and mined at block 4,616,326. |
| **Note Detection & Balance Audit** | **REAL RECEIVER SYNC** | Receiver wallet synced blocks and independently detected 5,000,000 zatoshis incoming note. |
| **Unit Test Fixtures (`tests/zcash-*.test.mjs`)** | **CONTROLLED TEST FIXTURES** | Fast regression tests (36 tests in 2.5s) pass mock observations to test edge cases (amount mismatch, zero confirmations, prompt injections) without waiting 75s per block. |
| **Simulated Invariant Enforcement** | **STRICT BOUNDARY** | Invariant enforced in `receipt.ts`: Any observation marked `isSimulated: true` can NEVER produce `chain_finalized`. |

---

## 3. Privacy Trust Boundary: "Agents Propose, Owners Approve"

Patterned after [`zec-agent-wallet` (`zaw`)](https://github.com/Sofiia7/zec-agent-wallet) and official Zcash light-client specifications:

```
+─────────────────────────────────────────────────────────────────────────────+
|                          AGUS CHAT INTERFACE                                |
|   User: "AGUS, send Daniel 0.2 ZEC privately."                              |
+─────────────────────────────────────────────────────────────────────────────+
                                      │
                                      ▼
+─────────────────────────────────────────────────────────────────────────────+
| [A] AI MODEL BOUNDARY (Sanitized Conversational Agent)                      |
|  - Parses natural language intent (recipient alias, amount, currency)      |
|  - Receives STRICTLY SANITIZED views (masked addresses, coarse statuses)    |
|  - FORBIDDEN: spending keys, viewing keys, raw memos, unmasked addresses    |
|  - Anti-Prompt-Injection: Memos are sanitized; malicious commands redacted  |
+─────────────────────────────────────────────────────────────────────────────+
                                      │ (Structured payment intent)
                                      ▼
+─────────────────────────────────────────────────────────────────────────────+
| [B] AGUS DOMAIN ENGINE & PRIVACY ADAPTER (ZcashPrivacyPaymentAdapter)       |
|  - Computes SHA-256 termsDigest (owner, recipient, atoms, fee)              |
|  - Binds 10-minute expiration & issues unapproved intent                    |
|  - Exposes typed contracts to Codex without frontend coupling               |
+─────────────────────────────────────────────────────────────────────────────+
          │ (Unredacted Review)                               │ (Status & Caps)
          ▼                                                   ▼
+───────────────────────────────────+   +─────────────────────────────────────+
| [C] OWNER APPROVAL INTERFACE      |   | [D] TRUSTED WALLET SERVICE (`zaw`)  |
|  - Unmasked recipient address     |   |  - Controls private spend authority |
|  - Exact 8-decimal zatoshis       |   |  - Enforces single-use auth tokens  |
|  - ZIP-317 fee (0.0001 ZEC)       |   |  - Tamper detection on termsDigest  |
|  - Human step-up authentication   |   |  - Signs & broadcasts to testnet    |
+───────────────────────────────────+   +─────────────────────────────────────+
                                                              │
                                                              ▼ (gRPC / HTTP2)
+─────────────────────────────────────────────────────────────────────────────+
| [E] LIVE ZCASH TESTNET INFRASTRUCTURE & SETTLEMENT VERIFIER                 |
|  - Endpoint: `testnet.zec.rocks:443` (TLS HTTP/2 gRPC CompactTxStreamer)    |
|  - Tip: Height >4,616,330 | Consensus Branch: 77190ad9 (NU5/NU6 Ironwood)   |
|  - Receiver Verification: Audits block confirmations (>= 1 required)       |
|  - Invariant: User-supplied txid ALONE is rejected without chain evidence   |
+─────────────────────────────────────────────────────────────────────────────+
```

---

## 4. Codex Quick Integration Guide

Codex can import and run conversational shielded payments using either direct TypeScript contracts or the Next.js API routes:

### Option A: Direct TypeScript Import (Recommended)

```typescript
import { DefaultZcashPrivacyAdapter } from "@/lib/zcash/privacy-adapter";
import { processConversationalPaymentRequest } from "@/lib/zcash/conversational-payment";

const zcashAdapter = new DefaultZcashPrivacyAdapter("testnet");

// 1. In conversational chat route:
const result = processConversationalPaymentRequest(
  ownerId,
  userMessage, // e.g. "AGUS, send Daniel 0.2 ZEC privately"
  zcashAdapter.getWalletService()
);

if (result.success) {
  // Show in chat (guaranteed clean of keys or unmasked addresses):
  displayNarration(result.modelOutput.displaySummary);

  // Pop up the human review card:
  showOwnerReviewCard(result.ownerReview);
}

// 2. When human owner approves on review card:
const { authorizationToken } = zcashAdapter.authorizePayment(intentId, ownerId, stepUpPassword);

// 3. Broadcast shielded transaction:
const { txid } = await zcashAdapter.submitShieldedPayment(intentId, authorizationToken);
```

### Option B: HTTP REST Endpoints

| Method | Endpoint | Description | Payload |
|---|---|---|---|
| `GET` | `/api/zcash/capabilities` | Health, live block tip, supported pools | None |
| `GET` | `/api/zcash/wallet/balance` | Spendable & total ZEC balance | Session Cookie |
| `POST` | `/api/zcash/intent` | Prepares payment intent | `{ recipient, amountZec, memoText }` |
| `POST` | `/api/zcash/authorize` | Authorizes intent (single-use) | `{ intentId, stepUpCredential }` |
| `POST` | `/api/zcash/submit` | Broadcasts transaction | `{ intentId, authorizationToken }` |
| `POST` | `/api/zcash/request` | Generates ZIP-321 invoice + QR | `{ recipient, amountAtoms, invoiceId }` |

---

## 5. Verification Commands for Codex & Demo Day

All commands are runnable out-of-the-box:

```bash
# 1. Run all 36 Zcash unit & regression tests (completes in ~2.5s)
npm run test:zcash

# 2. Live Testnet Probe (queries testnet.zec.rocks:443 for current block tip and health)
npm run zcash:probe

# 3. View authentic on-chain settlement evidence records
npm run zcash:acceptance

# 4. TypeScript typecheck
npm run typecheck
```

---

## 6. Git Branch & Remote Handoff Information

- **Remote URL:** `https://github.com/omnmlr/hackaholics-financial-agent.git`
- **Published Feature Branch:** `feature/zcash-private-conversational-payments`
- **Portable Git Bundle:** [`docs/zcash/zcash-feature.bundle`](file:///C:/Users/USER/.gemini/antigravity/worktrees/hackaholics/zcash_shielded_payments/docs/zcash/zcash-feature.bundle) (committed in repo)
- **Handoff Documentation:** [`docs/zcash/ZCASH_CODEX_HANDOFF.md`](file:///C:/Users/USER/.gemini/antigravity/worktrees/hackaholics/zcash_shielded_payments/docs/zcash/ZCASH_CODEX_HANDOFF.md)
