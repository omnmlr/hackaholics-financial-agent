# AG-03 Financial Security & Reliability Threat Model

**Target**: AGUS Crypto Backend Engine, Execution Pipeline, Financial Ledger, Portfolio Aggregator, Alert Subsystem, Session Identity, and PostgreSQL DAL  
**Target Repository**: `omnmlr/hackaholics-financial-agent`  
**Base Commit**: `c66bf769f0febb947284018efc181df37104c350`  
**Coordination Branch**: `ops/agus-crypto-agent-coordination-20261124`  
**Audit Branch**: `ag/crypto-security-audit-20261124`  
**Date**: November 24, 2026  
**Auditor**: Independent Teamwork Security Implementer (`teamwork_worker` AG-03)  

---

## 1. System Overview and Assets

The AGUS Crypto subsystem provides multi-wallet custody delegation, transaction preparation, quote review, Mobile Wallet Adapter (MWA) intent handoff, on-chain execution reconciliation, and financial event attribution on Solana (devnet and mainnet-beta). The system coordinates between client applications (Next.js web and Expo React Native mobile), external non-custodial wallet apps (e.g., Phantom, Solflare), the AGUS core backend, and Solana RPC clusters.

### 1.1. Core Assets Under Protection
1. **User Funds / Lamports / SPL Tokens**: Cryptographic balances stored on Solana accounts owned by end users.
2. **Review Intents (`agus_crypto_reviews`)**: Cryptographically bound financial proposals specifying immutable transfer amounts, source/destination tokens, recipient addresses, and validity block heights.
3. **Execution Attempts (`agus_crypto_attempts`)**: State machine entities tracking client signing handoff, mobile callback outcomes, and on-chain reconciliation status.
4. **Financial Receipts (`agus_crypto_receipts`)**: Immutable settlement records linking verified transaction signatures to execution attempts and user accounts.
5. **Ownership Proofs (`agus_crypto_challenges`)**: Cryptographic session-bound proof-of-ownership challenges validating that an authenticated user controls the private key corresponding to a registered public key.
6. **Chain Event Ledger (`agus_crypto_chain_events`, `agus_crypto_wallet_events`)**: Attributed transaction history recording incoming/outgoing transfers for accounting and balance computation.
7. **Audit Trail (`agus_audit`)**: System-wide compliance and security audit logs tracking high-value administrative and user actions.
8. **Session Identity / Tenant Context**: Better Auth session tokens establishing user identity (`principal.id`) and role authorization.

---

## 2. Trust Boundaries and Attacker Capabilities

```
+-----------------------------------------------------------------------------------+
| UNTRUSTED EXTERNAL WORLD                                                          |
|  - Malicious HTTP clients / public network attackers                               |
|  - Compromised mobile apps / hostile Android IPC callers                           |
|  - Untrusted / compromised external wallet applications                            |
+-----------------------------------------------------------------------------------+
                                    |
                            [HTTPS / WAF / Caddy]
                                    |
+-----------------------------------------------------------------------------------+
| TRUST BOUNDARY 1: Web / API Ingress Boundary                                      |
|  - Next.js Edge / Node API Routes (/api/v1/crypto/*)                              |
|  - Better Auth Session Validation (Cookie / Header HMAC)                          |
+-----------------------------------------------------------------------------------+
                                    |
                            [principal(request)]
                                    |
+-----------------------------------------------------------------------------------+
| TRUST BOUNDARY 2: Core Application & Execution Domain                             |
|  - Registry Service (Wallet association, challenge verification)                  |
|  - Execution Service (Review preparation, handoff grant, reconciliation)          |
|  - Portfolio & Activity Services (Balance aggregation, ledger attribution)        |
+-----------------------------------------------------------------------------------+
                  /                                           \
    [RPC Connection / Pinning]                         [Parameterized SQL / Pool]
                /                                               \
+-----------------------------------------+   +-------------------------------------+
| TRUST BOUNDARY 3: Solana Cluster & RPC  |   | TRUST BOUNDARY 4: Persistence / DAL |
|  - Primary Solana RPC Node              |   |  - PostgreSQL Database (Neon/AWS)   |
|  - Secondary Verification RPC Node      |   |  - Role Privileges (agus_runtime)   |
|  - Solana Validator Network (Devnet)    |   |  - Schema Constraints / Indices     |
+-----------------------------------------+   +-------------------------------------+
```

### 2.1. Attacker Personas and Capabilities
- **A1 — Unauthenticated External Adversary**: Lacks valid session credentials. Can send arbitrary HTTP requests to public endpoints (`/api/v1/crypto/share/:reference`), intercept or replay network traffic, and probe for injection or DoS vulnerabilities.
- **A2 — Authenticated Rogue Tenant**: Possesses valid credentials for Tenant B. Attempts to read, mutate, or transfer assets belonging to Tenant A via parameter tampering, IDOR, forged pagination cursors, or race conditions.
- **A3 — Malicious Mobile Host / Intercepted MWA**: Controls the local device environment or intercepts Android Intent IPC during MWA transaction signing. Can alter transaction parameters (recipient address, lamports, memo) or discard callbacks.
- **A4 — Byzantine / Compromised RPC Node**: Returns manipulated blockhashes, forge genesis hashes, or report premature transaction confirmations (processed vs finalized).
- **A5 — Compromised Application Worker / DAL Infiltrator**: Gains code execution or SQL injection capability within the `agus_runtime` role context, attempting to tamper with past financial records, receipts, or audit logs.

---

## 3. Attack Surface Mapping (11 Financial Surfaces)

| Surface ID | Attack Surface Domain | Primary Components | Attack Vectors |
|---|---|---|---|
| **AS-01** | Cross-Tenant Access | Route handlers, registry, activity queries | IDOR, cross-tenant wallet lookup, unauthorized transfer preparation, cursor forgery |
| **AS-02** | Cluster & Signer Mismatch | RPC client, route selection, signer validator | Network spoofing, mainnet-to-devnet replay, unauthorized sender substitution |
| **AS-03** | Digest & Message Tampering | Instruction hasher, beginCrypto, reconciliation | Client tampering with review digest, mutation of compiled Solana message bytes |
| **AS-04** | Expired Proofs & Replay | Challenges, review TTLs, receipt deduplication | Replaying consumed challenges, cross-session proof reuse, replaying past transaction signatures |
| **AS-05** | Amount / Recipient Tampering | Review binding, on-chain leg verification | Changing recipient or lamport amount in client before wallet signing |
| **AS-06** | Repeat Handoffs & Idempotency | `cryptoMutation`, `handoffCrypto`, state machine | Launching multiple signing prompts from one review, concurrent double-spend race |
| **AS-07** | Missing Callbacks & Webhook Drops | `reportWalletOutcome`, background reconciliation | Mobile OS killing app during sign, dropped deep link causing false failed state |
| **AS-08** | False Finality vs Confirmation | RPC commitment, reconciliation status check | Reorg risk from accepting "processed" or "confirmed" commitment before root finality |
| **AS-09** | Replayed Alerts & Race Conditions | `evaluateAlertRule`, observation index | Triggering duplicate alerts for the same on-chain signature under concurrent scans |
| **AS-10** | Stale / Partial Portfolio Data | Token account scanner, multi-wallet filter | Ambiguous token account ownership causing inaccurate balance calculations |
| **AS-11** | SQL Privileges & DAL Boundaries | Database roles, schema privileges, RLS | Runtime role executing `UPDATE` or `DELETE` on immutable financial receipts/events |

---

## 4. Enumerated Threat Scenarios (12 Scenarios)

### Scenario TM-01: Cross-Tenant Wallet Route Tampering and IDOR
- **Attack Surface**: AS-01 (Cross-Tenant Access)
- **Threat Category**: Tampering / Information Disclosure (STRIDE)
- **Attacker Capability**: Authenticated Tenant B (A2)
- **Scenario Description**: Tenant B discovers or guesses the UUID of Tenant A's wallet (`walletA`). Tenant B issues:
  1. `GET /api/v1/crypto/wallets?cluster=devnet&walletIds=${walletA.id}`
  2. `PATCH /api/v1/crypto/wallets/${walletA.id}` with `{ label: "Compromised" }`
  3. `DELETE /api/v1/crypto/wallets/${walletA.id}/routes/${routeId}`
  4. `POST /api/v1/crypto/reviews` specifying `sourceWalletId: walletA.id`
- **Mitigation in Code**:
  - `src/server/crypto/registry.ts:93-109, 157-169`: `listWallets` (`wallets`) filters `WHERE w.owner=$1 AND ($2::text IS NULL OR w.cluster=$2) AND ($3::uuid[] IS NULL OR w.id=ANY($3))`. If unauthorized IDs are passed, `rows.length !== new Set(ids).size` triggers `invariant(..., "NOT_FOUND", 404)`.
  - `src/server/crypto/registry.ts:358-372`: `relabel` filters `WHERE owner=$1 AND id=$2` and calls `walletById(sql, p.id, id)`, which throws 404 `NOT_FOUND` when `walletA.id` does not belong to `p.id`.
  - `src/server/crypto/registry.ts:374-398`: `unlink` executes `UPDATE agus_crypto_routes SET revoked_at=COALESCE(revoked_at,now()) WHERE owner=$1 AND wallet_id=$2 AND id=$3 RETURNING id` and throws `NOT_FOUND` (404) if `updated.rows.length === 0`.
  - `src/server/crypto/execution.ts:116-153`: `routeFor` joins `agus_crypto_wallets w` and `agus_crypto_routes r` filtering `WHERE w.owner=$1 AND w.id=$2 AND w.cluster=$4`. If not owned by caller, throws 404 `NOT_FOUND`.
- **Residual Risk**: Low. Application queries consistently bind `owner = $1`.

---

### Scenario TM-02: Pagination Cursor Forgery and Context Substitution
- **Attack Surface**: AS-01 (Cross-Tenant Access)
- **Threat Category**: Elevation of Privilege / Information Disclosure (STRIDE)
- **Attacker Capability**: Authenticated Tenant B (A2)
- **Scenario Description**: Tenant B attempts to forge or manipulate the `cursor` parameter in `GET /api/v1/crypto/activity?cursor=...` to inspect transaction events belonging to Tenant A or other clusters.
- **Mitigation in Code**:
  - `src/server/crypto/activity.ts:45-82, 324-330`: Cursors encode base64url JSON and are integrity-protected (signed, not encrypted) using HMAC-SHA256 with `BETTER_AUTH_SECRET`. The signed context is `JSON.stringify([owner, cluster, [...new Set(walletIds ?? [])].sort(), from ?? null, to ?? null])`.
  - On receipt, `decodeCursor` computes the expected HMAC and validates via `timingSafeEqual`. Any alteration or cross-tenant substitution immediately throws `DomainError("INVALID_CURSOR", 400)`.
- **Residual Risk**: Low. HMAC verification is cryptographically sound and constant-time (note: cursor payload contains only `observed`, `from`, `to`, `slot`, and `signature`, and is returned solely to the authenticated owner).

---

### Scenario TM-03: RPC Genesis Hash, Cluster Identity, and Signer Mismatch Spoofing
- **Attack Surface**: AS-02 (Cluster & Signer Mismatch)
- **Threat Category**: Spoofing / Tampering (STRIDE)
- **Attacker Capability**: Network Attacker / Rogue RPC Provider / Compromised Signer (A3/A4)
- **Scenario Description**: An adversary points the application's RPC URL to a private testnet or simulated node with a mismatched genesis hash, or submits an on-chain transaction signed by an unauthorized signer (`staticAccountKeys[0] !== review.expectedSigner` or `numRequiredSignatures !== 1`), in order to trick reconciliation into crediting a counterfeit settlement.
- **Mitigation in Code**:
  - `src/server/crypto/rpc.ts:75-87` and `src/lib/solana/contracts.ts:4-5`: Every RPC connection verification performs `connection.getGenesisHash()` and validates against hardcoded `DEVNET_GENESIS` (`"EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"`).
  - Any mismatch throws `DomainError("CHAIN_IDENTITY_MISMATCH", 503)`.
  - On `mainnet-beta`, `approvedCryptoProviders()` returns empty array (`src/server/crypto/registry.ts:29-46`), preventing execution on unapproved networks.
  - `src/server/crypto/execution.ts:633-634`: During reconciliation, `reconcileCrypto` verifies `message.staticAccountKeys[0]?.toBase58() === review.expectedSigner` and `message.header.numRequiredSignatures === 1`, skipping any transaction with a substituted or multi-party signer.
- **Residual Risk**: Low. Genesis pinning and strict single-signer verification prevent cluster and signer substitution attacks.

---

### Scenario TM-04: Review Digest Tampering and Step-Up Approval Bypass
- **Attack Surface**: AS-03 (Digest & Message Tampering)
- **Threat Category**: Tampering / Elevation of Privilege (STRIDE)
- **Attacker Capability**: Authenticated Malicious Tenant (A2)
- **Scenario Description**: A user obtains a review for a transfer of 0.1 SOL, modifies the client state to submit a transfer of 10 SOL, and attempts to invoke `POST /api/v1/crypto/reviews/:id/begin` with forged parameters or an altered digest.
- **Mitigation in Code**:
  - `src/server/crypto/execution.ts:245-252`: `prepareCrypto` creates a canonical review digest via `instructionHash({ owner: p.id, genesis: draft.genesisHash, review: bound })`.
  - `src/server/crypto/execution.ts:293-297` & `src/server/errors.ts:15-21`: In `beginCrypto`, the backend retrieves the review `FOR UPDATE` and asserts (defaulting to HTTP `409`):
    ```ts
    invariant(
      review.reviewDigest === input.reviewDigest && review.revision === input.revision,
      "REVISION_CHANGED",
    );
    ```
  - Execution parameters (amount, recipient, tokens) are loaded exclusively from database storage, not accepted from client POST bodies.
- **Residual Risk**: Low. Review parameters cannot be altered post-creation.

---

### Scenario TM-05: Client-Side Transaction Byte Mutation (Recipient / Lamport Alteration)
- **Attack Surface**: AS-03 & AS-05 (Amount/Recipient Tampering)
- **Threat Category**: Tampering / Financial Loss (STRIDE)
- **Attacker Capability**: Compromised Mobile Device / Intercepted MWA (A3)
- **Scenario Description**: The client receives `unsignedTransactionBase64`. A compromised mobile app or proxy alters the compiled Solana transaction instructions to transfer funds to an attacker's address or increase the transfer amount, signs it with the user's private key, and submits it to the Solana network.
- **Mitigation in Code**:
  - `src/server/crypto/execution.ts:630-636`: During on-chain reconciliation, the backend retrieves the transaction message from Solana RPC and computes:
    ```ts
    createHash("sha256").update(message.serialize()).digest("hex") === review.messageDigest
    ```
    If any byte of the compiled message was modified, `messageDigest` mismatches and the transaction is discarded.
  - `src/server/crypto/execution.ts:687-702`: Furthermore, settlement legs are explicitly verified against `review.recipient`, `review.expectedSigner`, and `review.amount.atoms`. If mismatched, attempt transitions to `unknown` with reason `SETTLEMENT_EFFECTS_UNVERIFIED`. No receipt is minted.
- **Residual Risk**: Low. Cryptographic message digest and atom-level leg matching provide dual-layer defense.

---

### Scenario TM-06: Ownership Challenge Proof Replay and Cross-Session Fixation
- **Attack Surface**: AS-04 (Expired Proofs & Replay)
- **Threat Category**: Spoofing / Replay (STRIDE)
- **Attacker Capability**: Eavesdropper / Rogue Tenant (A1/A2)
- **Scenario Description**: An attacker intercepts a signed wallet challenge message from Tenant A and attempts to use it to associate Tenant A's wallet address to Tenant B's account, or replay an old challenge after session expiry.
- **Mitigation in Code**:
  - `src/server/crypto/registry.ts:251-274`: Challenges have a 5-minute TTL (`expires_at timestamptz`).
  - Challenge message format binds user ID and session ID: `Session binding: ${binding}` where `binding = instructionHash({ user: p.id, session: p.sessionId, id })`.
  - In `associate()` (`registry.ts:296-301`):
    - Asserts `row.fresh` (`expires_at > now()`, else throws `CHALLENGE_EXPIRED`, 410).
    - Asserts `!row.consumed_at` (else throws `OWNERSHIP_PROOF_REQUIRED`, 403).
    - Challenge is atomically marked `consumed_at = now()` in the same transaction.
- **Residual Risk**: Low. Challenges are single-use, time-bounded, and cryptographically bound to the authenticated session.

---

### Scenario TM-07: Concurrent Double Handoff and Intent Dispatch Race Condition
- **Attack Surface**: AS-06 (Repeat Handoffs & Idempotency)
- **Threat Category**: Race Condition / Denial of Service (STRIDE)
- **Attacker Capability**: Authenticated Client / Scripted Loop (A2)
- **Scenario Description**: A client fires multiple concurrent `POST /attempts/:id/handoff` requests with identical or distinct idempotency keys to trigger multiple MWA launches or double-execute a single transfer attempt.
- **Mitigation in Code**:
  - `src/server/crypto/registry.ts:60-91`: `cryptoMutation` acquires a row-level lock on idempotency operations. Conflicting keys with identical digest replay the cached response.
  - `src/server/crypto/execution.ts:355-392`: In `handoffCrypto`, state transition check:
    ```ts
    if (row.state !== "ready") return { id, granted: false };
    await sql.query("UPDATE agus_crypto_attempts SET state='handoff' WHERE owner=$1 AND id=$2");
    return { id, granted: true };
    ```
  - Replay transformer: `(replay) => ({ ...replay, granted: false })`.
  - The first request receives `launchGranted: true`; any subsequent or replayed call receives `launchGranted: false`. State locks in `handoff`.
- **Residual Risk**: Low. Exactly-once launch grant guaranteed by transactional lock.

---

### Scenario TM-08: Dropped Mobile Wallet Callback and False Failure Reconciliation
- **Attack Surface**: AS-07 (Missing Callbacks & Webhook Drops)
- **Threat Category**: Reliability / Financial State Inconsistency
- **Attacker Capability**: Network Disruption / OS App Death (A3)
- **Scenario Description**: A user approves and signs the transaction in Phantom, but before Phantom can deep-link back to AGUS, Android kills the AGUS mobile app due to memory pressure. The client never reports the signature, leaving the attempt unresolved.
- **Mitigation in Code**:
  - `src/server/crypto/execution.ts:437-465`: Reporting `unavailable` or `unknown` marks attempt state as `unknown`, **never** `failed`.
  - `src/server/crypto/execution.ts:201`: Every transfer transaction includes a unique 32-byte Ed25519 public key as a read-only `reference` account.
  - `src/server/crypto/execution.ts:574-582`: The background worker executes `chain.getSignaturesForAddress(new PublicKey(review.reference))`. Even if the client dropped all callbacks, the engine discovers the on-chain signature, verifies legs, and finalizes settlement.
  - A 30-second grace period (`execution.ts:550-553`) avoids premature reconciliation while mobile handoff is actively executing.
- **Residual Risk**: Low. Reference-based indexing guarantees transaction discovery independent of mobile app lifecycle.

---

### Scenario TM-09: Premature Finality Acceptance Under Transient Fork Reorganization
- **Attack Surface**: AS-08 (False Finality vs Confirmation)
- **Threat Category**: Tampering / Double Spend (STRIDE)
- **Attacker Capability**: Solana Fork / RPC State Inconsistency (A4)
- **Scenario Description**: An RPC node reports a transaction at `"processed"` or `"confirmed"` commitment. If an exchange or merchant treats this as finalized, a transient micro-fork reorganization could roll back the slot, causing financial loss.
- **Mitigation in Code**:
  - `src/server/crypto/execution.ts:642-650`: `reconcileCrypto` explicitly queries signature status with `searchTransactionHistory: true` and checks:
    ```ts
    if (status?.confirmationStatus !== "finalized") continue;
    ```
  - Transactions at `"processed"` or `"confirmed"` are strictly skipped. The attempt remains in `"pending"` or `"unknown"` until 31+ confirmations (root finality) are achieved.
- **Residual Risk**: Low. Finalized commitment is required for receipt generation.

---

### Scenario TM-10: Database Runtime Role Privilege Escalation and Audit Trail Deletion
- **Attack Surface**: AS-11 (SQL Privileges & DAL Boundaries)
- **Threat Category**: Elevation of Privilege / Tampering / Repudiation (STRIDE)
- **Attacker Capability**: Infiltrated Application Process / SQL Injection (A5)
- **Scenario Description**: An attacker who compromises the application server or exploits a SQL injection flaw in a future route uses the existing `agus_runtime` database connection to `DELETE` or `UPDATE` records in `agus_crypto_receipts`, `agus_crypto_chain_events`, `agus_crypto_wallet_events`, `agus_crypto_reviews`, or `agus_audit`, destroying auditability.
- **Mitigation in Code (Existing & Required)**:
  - Existing: 100% parameterized queries in `src/server/crypto/*.ts`.
  - **Identified Gap**: `scripts/sql/runtime-role.sql:6` issues:
    `GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO agus_runtime;`
    (`tests/helpers/shared-platform.ts:14,30` applies the same broad grant pattern to an ephemeral `agus_market_role_<uuid>`.)
    No table-level `REVOKE UPDATE, DELETE` was previously executed for financial ledger, attribution, review, or audit tables!
  - **Required Remediation (AG-03 Remediation Script)**:
    Execute `scripts/sql/runtime-role-least-privilege.sql` to explicitly revoke mutation privileges:
    ```sql
    REVOKE UPDATE, DELETE ON
      agus_crypto_chain_events,
      agus_crypto_wallet_events,
      agus_crypto_receipts,
      agus_crypto_reviews,
      agus_audit
    FROM agus_runtime;
    ```
  - **PostgreSQL Row Level Security (RLS) Gap**: Currently, RLS is not enabled on tables (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`). Tenant isolation depends entirely on `WHERE owner=$1` in application code. RLS policies (matching `owner` as `text`, since `agus_users.id` and `owner` are `text` per `migrations/0004_identity_platform.sql:2` and `0022`–`0027`, using `NULLIF(current_setting('app.current_user_id', true), '')`) must be introduced in future migrations to enforce defense-in-depth at the storage layer.
- **Residual Risk**: **Medium** until `runtime-role-least-privilege.sql` is applied in production and RLS is implemented.

---

### Scenario TM-11: Replayed On-Chain Alert Notifications and Evaluation Races
- **Attack Surface**: AS-09 (Replayed Alerts & Race Conditions)
- **Threat Category**: Tampering / Repudiation / Denial of Service (STRIDE)
- **Attacker Capability**: Concurrent Monitoring Workers / Repeated Activity Sync Scans (A2/A4)
- **Scenario Description**: Concurrent invocations of `runCryptoMonitoring()` or repeated `evaluateAlertRule()` executions process the same incoming finalized transfer signature for a monitored wallet, attempting to generate duplicate `agus_crypto_alerts` notifications or trigger false external-inflow alerts on internal self-transfers or historical pre-activation events.
- **Mitigation in Code**:
  - `src/server/crypto/alerts.ts:196-202`: `evaluateAlertRule` runs inside a PostgreSQL transaction and locks the target rule with `SELECT * FROM agus_crypto_alert_rules WHERE owner=$1 AND id=$2 AND enabled FOR UPDATE`.
  - `src/server/crypto/alerts.ts:204-212`: Candidate events are filtered by `e.block_time >= target.activated_at` and `NOT EXISTS(SELECT 1 FROM agus_crypto_alert_observations o WHERE o.owner=$1 AND o.rule_id=$5 AND o.signature=w.signature)`.
  - `src/server/crypto/alerts.ts:216-236`: Only `finalized` + `success` legs where `leg.fromWalletId === null && leg.toWalletId === target.wallet_id` (external inflows matching asset/decimals) accumulate toward `incoming`.
  - `src/server/crypto/alerts.ts:238-247` & `migrations/0025_crypto_alerts.sql:13-32`: `agus_crypto_alerts` enforces `UNIQUE (owner,rule_id,cluster,signature)` with `ON CONFLICT(owner,rule_id,cluster,signature) DO NOTHING`, and `agus_crypto_alert_observations` enforces `PRIMARY KEY (owner,rule_id,signature)` with `ON CONFLICT DO NOTHING`.
- **Residual Risk**: Low. Transactional `FOR UPDATE` locking plus composite uniqueness constraints prevent alert replay and duplicate emission.

---

### Scenario TM-12: Stale, Partial, or Ambiguous Token Account Portfolio Data
- **Attack Surface**: AS-10 (Stale / Partial Portfolio Data)
- **Threat Category**: Information Disclosure / Tampering (Misleading Financial State) (STRIDE)
- **Attacker Capability**: Lagging/Failing RPC Provider or Malformed SPL Token Account Payload (A4)
- **Scenario Description**: An RPC node fails on either the `sol` or `token` balance query, returns malformed/non-owned SPL token account metadata, lags behind recent blocks (>120s TTL), or reports conflicting ownership of the same SPL token account across two user wallets at the same slot—potentially causing overstated balances or stale snapshots overwriting fresher complete data.
- **Mitigation in Code**:
  - `src/server/crypto/portfolio.ts:101-143`: `pull()` validates SPL token account owner (`info.owner === wallet.address`), program (`TOKEN_PROGRAM_ID`), valid mint address, integer decimals (`0..255`), `u64` atom bounds, and account state (`initialized`/`frozen`). Invalid accounts are skipped and mark `partial: true`.
  - `src/server/crypto/portfolio.ts:198-204`: Cache upsert into `agus_crypto_balances` enforces monotonic slot/timestamp progression (`agus_crypto_balances.slot <= excluded.slot`) and refuses to overwrite a non-partial snapshot with a partial one (`AND (NOT (excluded.value->>'partial')::boolean OR (agus_crypto_balances.value->>'partial')::boolean)`).
  - `src/server/crypto/portfolio.ts:226-261`: `coverage()` computes explicit degradation states for `"balances"`: `"unavailable"` (no cached values), `"stale"` (`Date.now() - Date.parse(observedAt) >= 120_000`, reason `"provider_failure"`), or `"partial"` (missing `sol` or `token` snapshot or `partial === true`).
  - `src/server/crypto/portfolio.ts:307-341`: Cross-wallet `byAccount` deduplication flags any token account observed across multiple wallets at the same slot (`ambiguous = true`), excludes ambiguous holdings from `holdings`, and downgrades affected wallets' `"balances"` coverage from `"ready"` to `"partial"` with `reason: "rpc_lag"`.
- **Residual Risk**: Low. Degraded, stale, and disputed holdings fail closed into explicit coverage warnings rather than corrupting balance totals.

---

## 5. Summary Threat Matrix

| Threat Scenario | Asset | Attack Vector | STRIDE | Inherent Risk | Mitigations | Residual Risk |
|---|---|---|---|---|---|---|
| **TM-01** | Wallets / Routes | IDOR via `/wallets` & `/reviews` | Tampering | High | Tenant ownership assertions (`WHERE owner=$1`) | Low |
| **TM-02** | Activity Stream | Forged cursor context | Info Disclosure | Medium | HMAC-SHA256 signature over `JSON.stringify([owner, cluster, walletIds, from, to])` | Low |
| **TM-03** | Chain / Signer | Rogue RPC or signer mismatch | Spoofing | High | `DEVNET_GENESIS` pinning (`qa1wca`) + `staticAccountKeys[0] === expectedSigner` | Low |
| **TM-04** | Review Proposal | Modified reviewDigest on begin | Tampering | High | Server-side digest match (`REVISION_CHANGED`, HTTP 409) | Low |
| **TM-05** | Transaction Bytes | Client mutates recipient/amount | Financial Loss | Critical | On-chain `messageDigest` match + leg atom verification | Low |
| **TM-06** | Wallet Ownership | Replay challenge / session hijack | Spoofing | High | 5-min TTL, `consumed_at` lock, session hash binding | Low |
| **TM-07** | Handoff Dispatch | Concurrent handoff spam | Race Condition | Medium | Idempotent single launch grant (`launchGranted: false`) | Low |
| **TM-08** | Unsigned/Pending Tx | Dropped MWA callback | Inconsistency | High | Reference account scanning; non-destructive `unknown` state | Low |
| **TM-09** | Receipt Settlement | Fork rollback on processed tx | Double Spend | High | Mandatory `"finalized"` commitment requirement | Low |
| **TM-10** | Receipts / Audit | Privileged role updates receipts | Repudiation | Critical | Least-privilege SQL remediation (`REVOKE UPDATE,DELETE`) | **Medium** (Pending RLS) |
| **TM-11** | Alert Feed | Replayed inflow alert evaluation | Tampering / DoS | Medium | `FOR UPDATE` rule lock + `UNIQUE(owner,rule_id,cluster,signature)` & observations PK | Low |
| **TM-12** | Portfolio Balances | Stale/partial/disputed RPC data | Tampering / Info | Medium | Non-partial upsert guard, 120s TTL `stale` state, `byAccount` ambiguity `rpc_lag` | Low |

---

## 6. Explicitly Inconclusive Checks

In compliance with the AG-03 integrity mandate, the following areas could not be conclusively validated through local headless automated tests alone and are explicitly declared inconclusive:

1. **Physical Android MWA Inter-App IPC (Handset Acceptance)**:
   - *Status*: **INCONCLUSIVE (Device-Only)**
   - *Reason*: Headless test environments cannot simulate the Android Activity Manager lifecycle, vendor-specific battery optimization killers, inter-application Binder IPC latency, or third-party wallet app UI behavior (e.g. Phantom/Solflare back-button aborts).
   - *Next Step*: Dedicated physical device acceptance per AG-02 / REL-01 on approved Android hardware.

2. **Live Mainnet-Beta Provider Execution**:
   - *Status*: **INCONCLUSIVE (Intentionally Disabled)**
   - *Reason*: `approvedCryptoProviders("mainnet-beta")` returns `[]`. Mainnet financial transactions are strictly disabled to prevent accidental fund expenditure during the hackathon.
   - *Next Step*: Requires explicit founder sign-off and production wallet keypair provisioning prior to mainnet deployment.

3. **Public Route Distributed Denial of Service (DDoS)**:
   - *Status*: **INCONCLUSIVE (Capacity-Dependent)**
   - *Reason*: `GET /api/v1/crypto/share/:reference` is unauthenticated and performs a database lookup. While protected by PostgreSQL indexes, resilience against distributed high-volume connection pool exhaustion (e.g., >10,000 req/sec) requires cloud-scale load-testing tooling and edge WAF rate-limiting.
   - *Next Step*: Implement Caddy/Cloudflare edge rate-limiting rules in production deployment tooling (AG-01).
