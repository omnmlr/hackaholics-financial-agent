# Product vision, boundaries and retained ideas

**Status:** Founder direction as discussed 2026-11-22. This is not yet a release PRD.

## Core proposition
**AGUS Crypto is an AI financial operating layer across existing blockchain wallets.** People should not have to repeatedly open wallet apps, reconcile balances manually, or assemble transactions in each wallet. From a single Android-first application they should see their combined assets and activity, converse naturally, have financial work prepared and executed with proper authorization, and receive meaningful proactive information.

The distinguishing engineering problem is **permission-aware control of multiple independent signing wallets**, not merely read-only multi-wallet tracking. One interface is a strong promise; universal invisible signing is **not** a promise.

## Near-term product foundations
- Solana first: manage SOL and supported Solana SPL assets, including canonical Solana USDC and USDT, using verified mint identities. USD totals must be price-source-aware, deduplicated and honest about unknown assets.
- Link Phantom, Solflare and other supported signers independently; add watch-only addresses for vaults/cold storage. A linked watch-only address is not spendable.
- Execute supported payments with the correct wallet's actual approval and independently verify chain results. No seed phrase collection or central storage of existing private keys.
- Combine balances, track income/outflows and distinguish transfers between a user's own wallets where sufficient evidence exists.
- Text, natural voice interaction, images, PDF/documents and contextual memory are part of the desired **core user experience**. Files supply information, not authority to transfer funds.
- Proactive monitoring and alerts, including security signals and important money movement, without requiring users to type 'is this risky?'.
- Speak normal conversational language, including short commands ('Pay Chisom', 'How much do I have?', 'Anything new?'). Do not force elaborate prompt templates.
- AGUS should be an agent with tools, plans, validation and verified outcomes; not an ordinary chat-to-swap clone.

## Future expansion — preserve, do not silently discard
- More wallets and chains: Ethereum/Base, Bitcoin, Tron and others via chain-specific read/sign/execute adapters, not presumed universal access.
- Swig-compatible programmable smart accounts for user-initiated opt-in bounded delegation: caps, expiry, revocation, allowlists where genuinely enforceable. Existing EOA wallets remain under their own signing keys; transferred vault funds are a separate account.
- DeFi positions, cross-wallet orchestration, swaps, spending/rent hygiene and richer transaction protection; only claim coverage after tests.
- Invoice/document reconciliation, freelancer/cashflow workflows and financial reports as possible verticals, **not a locked main persona**.
- Advanced conversational voice: investigate high-quality commercially usable open-source speech synthesis and recognition, especially natural expression and Nigerian/African pronunciation. Generic device TTS should not be the final voice identity.
- Advanced AGUS intelligence: evaluate strong models, reliable tools, grounding and benchmarks first; consider future specialist fine-tuning/weight updates only if evidence shows a benefit. Do not block v1 on custom model training.
- Cross-device memory and account labels; optional background monitoring; permission-scoped automation with auditability.
- Companion iOS app after a separate signing-adapter investigation.

## Explicit separation
AGUS Bank remains a **different** product for normal bank-account connectivity. Banking integration is not part of the Solana hackathon's AGUS Crypto scope. Existing code may share infrastructure later, with clear separation and authorization boundaries.

## What AGUS does not claim
It cannot silently control an arbitrary connected Phantom/Solflare account without a wallet approval or supported delegation. It cannot intercept every transaction initiated inside unrelated apps. An app biometric check is not an external wallet signature. It is not automatically an all-chain wallet merely because Phantom supports several chains.
