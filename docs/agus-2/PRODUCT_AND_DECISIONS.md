# AGUS 2.0 — product and decisions

Date: 9 November 2026. Status: **planning for founder review; no implementation authorized**.

## Established founder requirements

Source: this assignment. These are requirements, not evidence of working integrations.

- AGUS is a personal AI agent: financial intelligence, real-world execution, persistent responsibilities, calls, shopping, negotiations, memory and proactive assistance. Original tagline: **“Your money, and what's next.”** Finance is a capability of the agent, not its entire product.
- Investigate existing Nigerian accounts, legitimate authorized operations, Solana/USDC, USD receiving accounts, conversion and Nigerian bank settlement. None of these candidate rails is an approved architecture decision merely because it was requested for investigation.
- Development budget is **₦0**. No paid services, purchased credentials, infrastructure, financial transactions, deployment, speculative implementation or architectural rewrite in this task.
- GitHub is canonical. Work on an isolated planning branch; commit and push these findings. Founder and ChatGPT finalize architecture before implementation.
- Browser execution is a separate, provisionally completed Antigravity R&D workstream. Its reported 6/6 benchmarks and 30/30 security tests are founder-supplied reports, not independently accepted evidence here. Do not recreate or investigate it.
- Previous AGUS 2.0 recovery is separate. Do not reconstruct it or choose a replacement integration baseline in this task.

## Evidence baseline

The inspected `main` snapshot is `292d0b192c8be60589d92fe08dc80a8e25c1d7c5`. It contains a Next.js/PostgreSQL, single-operator Paystack payout prototype, a separate fixture adapter and a future `BankingDataSource` interface. It does not establish personal-bank access, a crypto wallet, USD accounts or an off-ramp. See [technical evidence](TECHNICAL_FEASIBILITY.md).

Historical Phase 1 contracts and the model-led-agent architecture were also read from GitHub, without importing their code. Their authority boundary is useful: models plan; server code enforces permissions; payment approval and submission are separate. Their proposals and historical test reports do not establish founder approval of this AGUS 2.0 plan or current provider access.

## Proposed decisions — require founder acceptance

| ID | Recommendation | Reason / consequence |
| --- | --- | --- |
| D1 | Keep AGUS an agent and orchestration product. Do not hold pooled customer money, run an exchange, make markets or operate a lending treasury. | Avoid building a financial institution to deliver personal assistance. Partner use still has contractual and regulatory obligations. |
| D2 | Ship financial understanding before integrated money movement: user-supplied statements first; consented bank API only when access is evidenced. | Useful at ₦0 without pretending a sandbox is a connected bank. Imported records must show source, age and incomplete coverage. |
| D3 | Make account reading, collections, payouts, receiving accounts and wallets separate capabilities with separate grants. | Data consent cannot authorize a debit; a Paystack payout balance cannot represent a user's bank balance. |
| D4 | Keep Solana/USDC optional. Prefer native USDC on one verified network if a stablecoin route becomes viable. | RPC reads and quotes passed; no end-to-end settlement was tested. No cross-chain bridge, swap engine or AGUS token is needed for the initial plan. |
| D5 | Prefer user-controlled signing or a provider-hosted financial experience; AGUS stores neither seed phrases nor pooled balances. | Signing authority must be explicit. Noncustodial design does not automatically remove compliance duties. |
| D6 | Treat Bridge as a conditional USD-account candidate and Paycrest as a conditional conversion candidate, not selected production dependencies. | Both have onboarding gates; Paycrest explicitly assigns KYC and applicable compliance to integrating senders. No proof of free production access exists. |
| D7 | Initially require approval of each exact value-moving instruction. Persistent responsibilities may monitor, prepare and request approval. | Proactivity remains possible without unattended spending. Standing financial mandates require a later, separately approved scope and risk model. |
| D8 | Extend the accepted recovered application through modular server-side boundaries; preserve existing payment controls. | This planning branch does not select a recovery branch or mandate a framework/database migration. |

## Decisions required before implementation

1. **First financial release:** accept statement-based intelligence plus preparation/manual handoff, with live bank APIs and conversion conditional? If live connectivity is essential, accept that release is blocked on legitimate access rather than promise it at ₦0.
2. **Money and authority:** accept D1/D5/D7? Who may sign, approve, revoke access and resolve a lost-device/account-recovery case? Is unattended financial execution deferred?
3. **Provider obligations and cost:** is the founder able to supply an eligible business relationship and accept provider-required KYC/AML/support obligations later? If not, keep financial execution in the user's separately onboarded provider app. Any future fees, gas and test funds need separate authorization and funding.
4. **USD purpose:** salary/freelance payments, business collections or own-account transfers? Resident individuals or businesses? First-party or third-party senders? These determine receiving-account eligibility; “USD account” alone is insufficient.
5. **Rail priority:** is Solana essential or optional? Accept delaying it rather than adding bridges if an approved provider supports another native-USDC network more reliably?
6. **Data policy and baseline:** approve retention/deletion, model exposure of financial data and identity requirements; designate the accepted recovered codebase before engineering resumes.

No recommendation in this document is marked approved. The engineering gates in [the roadmap](ENGINEERING_ROADMAP.md) are proposed acceptance criteria, not permission to implement, transact, merge or deploy.
