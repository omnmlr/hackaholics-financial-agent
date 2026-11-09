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

## Founder-confirmed launch requirements — 9 November 2026

These are **explicit founder product decisions** and supersede any contradictory provisional recommendations elsewhere in this document or the roadmap. They are requirements, **not claims of current technical feasibility**. Do not relax them to make a release appear complete; report any unresolved dependency plainly.

1. **Existing-account connectivity:** initial intended financial release must allow consenting users to connect their **existing personal Nigerian bank accounts**. Do not require creating a replacement AGUS bank account.
2. **Coverage:** target **at least 20 common Nigerian banks as funding/source accounts at initial launch**, not merely 20 recipient/destination banks. Coverage is only accepted when the supported bank, account type, consent method and real authorized transfer path are established for each. Recipient-bank availability alone does not satisfy this requirement.
3. **Conversation-driven execution:** user can request a transfer by ordinary language (e.g., “send ₦15,000 to David”), identify or confirm the intended recipient, review the exact instruction, complete bank/provider-required strong authentication and receive an evidence-based status. A mock, instruction draft or unverified handoff is not a completed transfer.
4. **Fee model:** **AGUS adds no fee or markup** to the amount and fees the user would ordinarily pay through their bank for an equivalent transfer. This does not mean banks, networks, gas or providers are costless. Any unavoidable provider-side costs and how they are funded must be resolved before launch; do not silently pass new charges to users.
5. **Onboarding:** first public release is **18+ only**, with account registration, verified identity/customer due diligence appropriate to the permitted product, bank-specific consent and revocation, data-protection measures and secure payment approval. Collect only data actually necessary for an authorized purpose; AGUS onboarding does not by itself grant bank API access or a financial-services licence.
6. **Solana's role:** native Solana USDC and the planned USD receiving/conversion route are **core committed product direction**, not optional product ideas. Provider-specific USD bank details, USDC issuance/delivery, FX and Nigerian-bank settlement remain individually access-gated and cannot be presented as completed until verified. Staging of implementation is possible; cancellation of the product direction requires founder approval.
7. **AGUS's broader scope:** AGUS remains a personal agent with memory, responsibilities, calls, shopping, proactive execution and financial intelligence; it is not being reduced to statement uploads or a payment demo.
8. **Evidence and release gate:** if an authorized route for 20 source banks under the fee constraints is not yet available, mark the banking launch requirement **blocked/pending partner or protocol access**, not silently lowered to statement-only functionality. Interim development may proceed without claiming the finished launch goal.

The engineering investigation should compare legitimate bank-sponsored/open-banking access, participant-authorized multi-bank connections, and independently authorized bank-app handoffs against these requirements. It must separate what code can implement from what a bank, licensed participant or regulator must authorize. No use of user banking credentials, bypasses, pooled pass-through customer funds or unauthorized banking-app automation is authorized.
