# AGUS 2.0 — Solana Technical Validation & Harness

**Directory:** `experiments/solana-rnd/` (also preserved in `C:\Users\USER\AGUS_SOLANA_RND`)  
**Target Cluster:** Solana Devnet (`https://api.devnet.solana.com`)  
**Scope:** Independent technical environment verification for Codex's AGUS Solana implementation.  
**Mode:** Zero-broadcast, read-only RPC queries, local protocol tests, zero financial spending.

---

## 1. Quick Start & Reproducible Harness

Run the Node.js validation harness:
```bash
npm install
node solana_harness.js
```

Or run the zero-dependency Python RPC validator:
```bash
python solana_rpc_validator.py
```

### Manifest & Artifact Inventory
* `package.json` & `package-lock.json` — Pinned `@solana/web3.js` (^1.99.0) and `@solana/spl-token` (^0.4.15).
* `solana_harness.js` — Node.js validation harness exercising Devnet RPC, ATA derivation, transaction construction, and preflight simulation.
* `solana_rpc_validator.py` — Standalone Python 3 validator using standard library only (zero external dependencies).
* `solana_harness_output.json` — Live Node.js harness execution trace.
* `solana_validation_report.json` — Live Python JSON-RPC validation trace.

---

## 2. Test Verification Matrix: Real RPC vs. Local Simulation vs. Untested

| Component / Operation | Method Tested | Execution Type | Status | Actual Observation / Evidence |
|---|---|---|---|---|
| **RPC Cluster Health** | `getVersion`, `getHealth` | **Real Devnet RPC** | **PASSED** | Core `4.4.0`, health: `ok`, latency ~850ms. |
| **Slot & Blockhash Tracking** | `getSlot`, `getLatestBlockhash` | **Real Devnet RPC** | **PASSED** | Confirmed slot > `520,385,000`, returned active blockhash & `lastValidBlockHeight`. |
| **Circle Devnet USDC Mint** | `getParsedAccountInfo` | **Real Devnet RPC** | **PASSED** | Mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, 6 decimals, SPL Token owner. |
| **Account & Balance Reads** | `getBalance`, `getTokenAccountsByOwner` | **Real Devnet RPC** | **PASSED** | Read native SOL and discovered devnet USDC token accounts for authority address. |
| **Preflight RPC Simulation** | `simulateTransaction` (sigVerify: false) | **Real Devnet RPC** | **PASSED** | Node executed instruction dry-run without broadcast; returned `AccountNotFound` for mock pubkey. |
| **ATA Derivation** | `getAssociatedTokenAddressSync` | **Local Protocol Logic** | **PASSED** | Deterministic PDA derived offline for sender and recipient. |
| **Tx Compilation & Wire Sizing** | `tx.compileMessage().serialize()` | **Local Protocol Logic** | **PASSED** | 4 instructions compiled to 405 bytes (well within 1232-byte IPv6 MTU limit). |
| **Idempotency Staging** | Non-signer Reference Public Key | **Local Protocol Logic** | **PASSED** | Unique reference key appended to instruction keys for O(1) indexed confirmation. |
| **User Wallet Signing** | Private Key / Hardware Signing | **UNTESTED** | *Intentionally Omitted* | No private key extraction or simulated key theft permitted. Delegated to client wallet adapter. |
| **Live Network Broadcast** | `sendRawTransaction` | **UNTESTED** | *Intentionally Omitted* | Zero-broadcast safety mandate. No financial spending or testnet spam permitted. |
| **On-Chain Balance Mutation** | Live Debit / Credit Reconciliation | **UNTESTED** | *Intentionally Omitted* | Requires live broadcast and funded signer. Verified at preflight simulation layer. |
| **Mainnet USDC Operations** | Real-value Transfer (`EPjFW...`) | **UNTESTED** | *Intentionally Omitted* | Mainnet requires production release candidate and real user funds. |

---

## 3. Technical Findings & Architecture Decisions for Codex

### A. RPC Connectivity & Endpoints
* **Primary Devnet RPC:** `https://api.devnet.solana.com` (Verified operational, Solana Core `4.4.0`, average latency ~850ms).
* **Backup Endpoints:** Commercial free-tier endpoints (Ankr, Helius, Alchemy, QuickNode) require project API keys. For local dev/test, `api.devnet.solana.com` is sufficient for read-only queries, but rate-limits heavily on burst airdrops.

### B. SDK Recommendations
* **Production Recommended SDK:** `@solana/web3.js` (v1.95+ / v1.99.0) + `@solana/spl-token` (v0.4.15+).
* **Why not Web3.js v2 yet?** While `@solana/web3.js` v2 (`@solana/kit`) offers modular tree-shaking, major ecosystem wallet adapters (`@solana/wallet-adapter-base`, Solana Mobile Wallet Adapter, and Solana Pay) still depend on v1 `PublicKey`, `Transaction`, and `Connection` classes. Using v1 prevents conversion bridge overhead.

### C. Devnet USDC vs. Genuine Mainnet USDC
* **Circle Official Devnet USDC Mint:** `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
  * Decimals: `6` (matches Mainnet USDC standard).
  * Program Owner: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` (Standard SPL Token).
  * Faucet: Obtain test USDC via Circle's official web faucet at `https://faucet.circle.com/` (select Solana Devnet).
* **Mainnet USDC Mint:** `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
* **Critical Rule:** Devnet USDC is a faucet asset with arbitrary supply authority. Codex must enforce strict mint validation and network environment checks to ensure devnet tokens are never treated as real fiat value.

### D. Token Account Discovery (ATAs)
* Derivation must use `getAssociatedTokenAddressSync(mint, owner)`.
* **Safe Transfer Pattern:** Always prepend `createAssociatedTokenAccountIdempotentInstruction(payer, recipientATA, recipientOwner, mint)` before the transfer instruction. This ensures the recipient ATA exists without throwing an error if it was already created.

### E. Idempotency & Duplicate Prevention
1. **Recent Blockhash Expiry:** Blockhashes expire after 150 slots (~60–90 seconds). Within this window, the Solana validator signature cache automatically deduplicates transactions sharing the same signature.
2. **On-Chain Idempotency Key (Solana Pay Pattern):**
   * Generate a unique random public key: `const reference = Keypair.generate().publicKey`.
   * Include it in `transferInstruction.keys.push({ pubkey: reference, isSigner: false, isWritable: false })`.
   * Reconcile/query using `connection.getSignaturesForAddress(reference)`. This gives O(1) indexed lookup for payment confirmation without storing tx hashes in local state.

### F. Preflight Simulation & Error Handling
* Call `connection.simulateTransaction(tx, undefined, false)` before prompting the user for approval.
* This verifies:
  1. Fee payer lamport sufficiency (`InsufficientFundsForFee`).
  2. SPL Token balance sufficiency (`InstructionError: Custom(1)`).
  3. Exact compute unit requirements (to accurately set `ComputeBudgetProgram.setComputeUnitLimit`).

### G. Confirmation & Reconciliation Strategy
* **`processed`:** Transaction reached leader (display "Submitting..." in UI).
* **`confirmed`:** 2/3+ stake supermajority voted (display "Payment Sent" in UI).
* **`finalized`:** 31+ blocks built on top (mark irreversible settlement in persistent database).
* **Timeout:** If `currentBlockHeight > lastValidBlockHeight` and signature is not found, the transaction definitely failed and can safely be retried with a new blockhash.
