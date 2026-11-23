# Pocket proof of concept

**Three automated tests passed** on each of two real Swig executables in LiteSVM 1.6.2, with local signature and blockhash checks enabled. Each run exercised 30 labeled transactions, plus a runtime duplicate check and simulated transport failure. A clean lockfile install reproduced all six passing executions on Linux x86-64 with Node 24.19.0. All balances and credentials in the transactions were synthetic and held in the local ledger.

## Executed results

| Requirement | Observed result |
| --- | --- |
| Create and own | A disposable Ed25519 root created the Swig configuration. The configuration was program-owned. Swig derived a separate deposit address. The classic token program owned the ATA at the runtime level and its decoded token authority was the Pocket PDA. The funder's ATA had its own wallet authority. |
| Fund independently | In one signed transaction, the independent funder moved 0.4 SOL and 50 synthetic SPL tokens to Pocket. Only the funder and separate fee payer signed. The funder's SPL balance fell from 80 to 30. Pocket moved from 650,240 to 400,650,240 lamports and from zero to 50 tokens. The initial SOL was account reserve created during setup. |
| Spend SOL and SPL | The authorized session and fee payer signed a SOL payout of 0.05 SOL and a separate classic SPL payout of five tokens. Both balances matched recipient deltas. Root and funder signatures were absent. |
| Enforce scope | Remaining SOL and token cap overages were rejected (`0xbd5`, `0xbd7`). Unapproved SOL recipient, unapproved token account, and a benign Memo outside the two explicitly configured programs failed (`0xbbe`). Balance assertions showed no unintended debit. This validates the tested role and instruction set. |
| Verify recurring budget and expiry | The 20-token window accepted a 6-token payment and a 14-token payment, rejected a further one (`0xbd8`), then accepted five in the next slot window. The expired session later failed (`0xbc6`). A 20-token cumulative window does not give a 5-token per-transaction rule. |
| Revoke and exit | The root removed a role before session expiry. A later action failed (`0xc`). The root then returned all 0.35 spendable SOL and 45 remaining tokens to the funder. The vault retained its 650,240-lamport setup reserve. Full vault/ATA closure with rent recovery was outside this test. |
| Recover submission | Saved the signature, signed bytes hash and validity before submit. The receipt lookup recovered the payment after an injected lost acknowledgement and simulated application-state reload. The runtime rejected the identical signed transaction as `AlreadyProcessed`. The recipient balance moved once. A failed insufficient-funds attempt stayed failed. An absent attempt stayed unconfirmed until the local blockhash expired. A retry with a different signed transaction under the same operation was blocked. |

The journal used serialized in-memory records and an authoritative local ledger. Production needs durable persistence, serialized attempt claims, exact transaction/finality verification, reference lookup for lost wallet responses and independence from any one RPC history view. These tests do not establish public network exactly-once behavior.

## Program provenance and public Devnet

| Executable | Evidence |
| --- | --- |
| Official release artifact | Public Swig `devnet-upgrade-9-c64127837995`, source `c64127837995818ef5d1e161bbc367391a1b5765`. File has 436,064 bytes and SHA-256 `3991e3ee04c17238f47baafa73285b4fc65c41ac88aeb396134b950442886a8e`. |
| Public Devnet ProgramData snapshot | On 2026-11-23 the official Devnet RPC returned program `swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB` pointing at ProgramData `Bb6gN8CtkMXf7cfXKnWysmdBg5B8EZfP5kus5TsyH5Es`, slot `522994140`. Full loader payload after its 45-byte header was 443,904 bytes, SHA-256 `0418f037fe1c9f6c0cd9d3ee57d684f69aca2ed9b3388f5d0c45020b01cce1d9`, matching PR #46. Its first 436,064 bytes also differed from the release asset, so the difference is not explained by account padding alone. Both files were tested separately. |
| Live funded run | Verified the RPC genesis hash and read the deployed program. The RPC returned code 410 for a 0.1 test SOL airdrop to a new disposable payer. The official web faucet directs agents to programmatic methods. The recommended proof-of-work client requires a funded fee payer and falls back to the closed RPC faucet for an empty one. No test SOL or authorized alternative payer was available. No signed transaction from this experiment was submitted to Devnet. |

The release artifact and its vendor receipt do not establish the bytes served by the endpoint at a later time. Record cluster, observed slot and byte digest explicitly for any device or deployment acceptance. Privy, Turnkey and hosted Swig IdP/paymaster flows require configured vendor projects/credentials. No hosted signer or passkey bridge was exercised in this environment. [Release and attached evidence](https://github.com/anagrambuild/swig-wallet/releases/tag/devnet-upgrade-9-c64127837995) · [Official Devnet faucet](https://faucet.solana.com/) · [Solana faucet guide](https://solana.com/developers/cookbook/development/airdrops-and-faucets) · [Proof-of-work client](https://github.com/jarry-xiao/proof-of-work-faucet/blob/HEAD/cli/src/main.rs) · [PR #46](https://github.com/omnmlr/hackaholics-financial-agent/pull/46)

## Example from one local release run

| Role or address | Exact local value |
| --- | --- |
| Root | `2x8WDYjQj5zqzezax6W6i8EpgEdLJhoEfq1iAma7jzdw` |
| Independent funding wallet | `vLd7q5Qff8RapngUZoVpMdF38Q6sPAoJhhy6Dn2U22y` |
| Pocket | `mByBDNH4dXZ4hkhEvvaXTLxxFnwhNqXEYfjdZV1Lzkw` |
| Pocket token account | `T2mZFwzuZacBnhRL3HBY4QdgiEmDR1zA5JPbMf71i17` |
| Scoped session | `BE4dPpGXFuPb2mSqnosuykUvEuZQNpGuq1m9uQqSjcCv` |
| Fee payer | `7WY7KvpA6zyri6enwVuiXnbkm7i4FMk94qwP1PKzKhh7` |
| Combined funding signature | `Kf97Z2HcC1pW5S7ZWJtvVEZfwvDgi2SJcBmdYaLdKviY9SdGUTaNx5NKdo71T5mxMvrsXRPMVSuNMBDoHRJfo3b` |
| Five-token session payment signature | `2CGi8AvYFeKCawncL87qVnhiXDUy5N71zeRY5xThFee1V1sUzeSdZcRGe4tXFdjdonvcTmYh4js12h971rSdF3o2` |

Transactions are local evidence and have no public explorer entry. Fresh run output records the corresponding public addresses, signer sets, byte hashes where applicable, signatures, computed units and rejection codes. [Harness and reproduction](../../../experiments/agus-pocket/README.md)
