# AGUS Crypto wallet architecture research

Reviewed 2026-11-23 against the repository default branch `a26880a`, the heads of draft PRs #46 and #47, and the upstream sources linked below.

Use external wallets for core signing and aggregate their holdings independently through public chain data. Android Mobile Wallet Adapter (MWA) is the first transport to validate. A saved wallet authorization can streamline reconnection. For the core path, the user reviews an exact transaction in AGUS and the selected wallet controls signing. Assets stay in the existing wallet until the user authorizes the requested operation.

For unattended work, investigate **Solana Foundation Subscriptions** for bounded pulls from an existing token account and **Swig** for program-scoped spending from a separately funded, optional account. Keep reminder-only schedules available through the core path. Evaluate Privy if AGUS later needs an embedded wallet and is willing to depend on hosted signing and policy enforcement.

| Document | Contents |
| --- | --- |
| [Competitor architectures](competitor-architectures.md) | Agentic, HeyElsa and the implementation evidence in AGUS |
| [Existing-wallet authorization](existing-wallet-authorization.md) | Wallet sessions, SPL and Token-2022, Subscriptions, Swig and Privy |
| [Capability and limitation matrix](capability-matrix.md) | In-place authority, approval, assets, Android, security, cost and scale |
| [Recommended technical architecture](recommended-architecture.md) | Integration boundaries, intent review, exact transaction verification and optional automation |
| [Proposed local test plan](local-test-plan.md) | Prioritized experiments, evidence requirements and outstanding device gate |

**Evidence terms.** **Documented** means a protocol specification, official product documentation or a vendor claim. **Implemented** means an inspectable code path or a published artifact, with any test evidence identified separately. **Observed** describes a reported test or device outcome and names its environment. **Candidate** describes a technical possibility or AGUS proposal that still needs verification. Public product claims and release artifacts carry no implied transaction or device coverage.

This review used source and documentation reads. No wallet was connected, no transaction was executed, and no private key or user funds were accessed. Local experiments and device acceptance are proposed work.

[AGUS implementation base](https://github.com/omnmlr/hackaholics-financial-agent/tree/a26880a97faac0cde495e0f7f667ce86f3f8978a) · [Wallet spike #46](https://github.com/omnmlr/hackaholics-financial-agent/pull/46) · [Project journal #47](https://github.com/omnmlr/hackaholics-financial-agent/pull/47)
