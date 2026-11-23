# AGUS Crypto pre-PRD architecture decision

## Decision

Build the Solana financial operator around **verified incoming stablecoin payments and multi-wallet investigation**. Adopt **Swig direct protocol as the preferred optional Pocket** after Android signing and recovery gates pass. Keep external-owner signing through MWA as the first Android transport. Support a separate opt-in, payee-bound Subscriptions path for recurring token pulls from existing accounts after exact deployment and operational validation. The primary payment and invoice workflow works with any independently owned supported wallet and does not require Pocket.

Use one shared typed intent, payment attempt and receipt pipeline around both signers. Conversational output proposes a draft or explains verified records. The user and deterministic authorizers decide and sign. There is no model-accessible arbitrary sign tool. [Local Swig proof](POCKET_PROOF_OF_CONCEPT.md) · [Existing-wallet proof](../research/existing-wallet-delegation-poc.md)

## Starting evidence and branch history

| PR | Head and actual base | Evidence carried into this decision |
| --- | --- | --- |
| [#46, wallet-control spike](https://github.com/omnmlr/hackaholics-financial-agent/pull/46) | `4c132b7` on implementation `a26880a` | Expo harness has Android per-wallet association, reviewed SOL/classic SPL transfers, package targeting and exact replay/reconciliation logic. Automated transport was stubbed. Program and transfer tests were local. Signed APK and watch-only reads are separate evidence. |
| [#47, product journal](https://github.com/omnmlr/hackaholics-financial-agent/pull/47) | `87be10e` on implementation `a26880a` | On physical Android, both wallets connected and balances were visible. Phantom showed an unverified identity warning and force-closed at signing, and Solflare reported Low Power Mode blocked signing. No finalized public Devnet transfer for that sequence is recorded. |
| [#48, architecture research](https://github.com/omnmlr/hackaholics-financial-agent/pull/48) | `3399614` on implementation `a26880a` | Source-backed external wallet, token delegation and optional smart-account comparisons. Proposed hypotheses distinguished from physical and program evidence. |
| [#49, existing-wallet proof](https://github.com/omnmlr/hackaholics-financial-agent/pull/49) | `ebf4d0a` on research `3399614` | Six reproducible local tests prove canonical ATA pulls with two separate owners, limits, allowlisted merchant plan, insufficient balance, revocation and native SOL boundary. This supplies no Android or live deployment acceptance. |
| This package | Separate branch based on `ebf4d0a` | Tests three Pocket cases on a pinned Swig release and public Devnet executable snapshot. Public faucet restriction blocked the funded Devnet run. No app code or existing branch merge is included. |

The default implementation includes existing financial workspace and invoice conventions, and a verified Zcash Testnet receiving example. The Solana read history endpoint lists wallet-address signatures and explicitly warns that incoming token-account history can be incomplete. Use existing intent, persistence and receipt patterns, and prove the Solana invoice and ATA history adapters on their own merits. [Implementation README](https://github.com/omnmlr/hackaholics-financial-agent/blob/a26880a97faac0cde495e0f7f667ce86f3f8978a/README.md) · [Current Solana history source](https://github.com/omnmlr/hackaholics-financial-agent/blob/a26880a97faac0cde495e0f7f667ce86f3f8978a/src/server/solana-history.ts)

## Boundaries to carry forward

1. **Accounts and evidence.** Separate read-only addresses from signing routes and Pocket addresses. Persist network/owner/token account and source slots. Deduplicate per chain and owner while retaining routes. Show source coverage and stale estimates. Keep the portfolio resolver, invoice ledger and signer catalog distinct.
2. **Incoming payments and evidence.** Start with one network and one verified classic USDC mint. Create Solana Pay-compatible request links/QRs with an opaque unique reference and intended recipient. Keep invoice IDs and personal data private. Ingest signature candidates and independently verify reference, cluster, mint, exact destination and received amount, receipt success and finality. Uniquely consume a verified transfer event per invoice, carry an exception state for partial/ambiguous/wrong payment and retain auditable receipt evidence. Chain data can be indexed and backfilled independently of the app lifecycle. [Solana Pay protocol](https://github.com/solana-foundation/pay/blob/main/typescript/packages/solana-pay/spec/SPEC.md) · [Transaction RPC](https://solana.com/docs/rpc/http/gettransaction)
3. **Outgoing requests.** Agent proposes structured fields. A deterministic composer selects exact source, validates instruction and amount, simulates and produces user review. Approval binds the exact transaction and policy. Reject unexpected programs/accounts or a different transaction. Persist a unique attempt before opening the external wallet or submitting the Pocket signature. Reconcile uncertain outcomes before issuing alternative transactions.
4. **Pocket roles.** The pilot uses a user-held external root, separate fee payer and a bounded device signer when available. Provider-backed credentials may be evaluated for the device role. Root, backup and server automation roles are separate. The worker is isolated and receives no root or external wallet secret. Approved payee, mint, program scope, cap and expiry are enforced by Swig. User presence, duplicate scheduler claims and calendar timing belong to application controls unless the selected verified program enforces them. Do not promise the unproven hard 5-per-payment rule.
5. **Release control.** Feature flag Pocket and automation by cluster and signer acceptance. Respect token-account program IDs and use known mints. Record deployed program data hash, audited scope and upgrade authority before value is held. Provide recovery without an AGUS backend if a user-held backup can sign directly. Never label process-local tests or SDK samples as a proven physical-device signing route.

## Alternatives and open decisions

| Alternative | Decision and reason |
| --- | --- |
| Single embedded wallet for all users | Reject for core. Creates a migration pressure and loses existing-wallet receipts/context. |
| Privy-only or Turnkey-only Pocket | Keep as a human-signing fallback candidate. Good SDK ergonomics. Hosted credentials, recovery and provider-side enforcement require a separate risk and cost decision. |
| Squads or LazorKit as default | Squads is credible for teams that need threshold and proposal workflows. LazorKit is attractive for passkeys but its current repository warns that the program is pre-audit. Swig has closer tested consumer spending semantics. |
| Plain SPL allowance or unbound Subscriptions as default | Reject for ordinary recurring merchant payments. A raw delegate can spend or burn its allowance without recipient or expiry constraints. Fixed and recurring Subscriptions grant recipient discretion. Use nonempty merchant allowlists when payee constraint is part of consent. |
| Escrow or token for normal payments | Use direct transfers. Conditional escrow only when a product genuinely requires a release condition. SOL and stablecoins already cover fees and settlement. |
| Ship Pocket and automation on the hackathon date regardless | Use the November 26 device cutoff. The invoice, receipt and investigation loop is a strong standalone submission. Label a local-only Pocket demo as such. |

Open before real funds: reliable MWA identity and switching, exact mobile signing/recovery, deployed program and audit scope, unsupported token extensions, full account/rent closure and failed settlement conditions. Open commercially: retention from invoice reconciliation, willingness to pay, exception handling cost and geography-dependent compliance.

[Infrastructure comparison](SMART_WALLET_COMPARISON.md) · [Mobile Pocket flows](AGUS_POCKET_FEASIBILITY.md) · [Product differentiation](PRODUCT_DIFFERENTIATION.md) · [Revenue options](BUSINESS_MODEL.md) · [Readiness and founder checklist](HACKATHON_READINESS.md)
