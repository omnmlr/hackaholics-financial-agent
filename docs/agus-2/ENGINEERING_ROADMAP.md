# AGUS 2.0 — engineering roadmap

Date: 9 November 2026. **Proposed milestones only. No implementation starts in this task.** GitHub is the project record; no merge/deployment is authorized.

## Priority and dependency order

`Founder decisions + accepted recovery baseline → identity/authority contracts → useful financial read experience → conditional provider trials → separately authorized live execution`

Persistent responsibilities use the same capability/permission boundaries. Broader calls, shopping and negotiation features remain part of the product; their implementation is outside this financial-feasibility assignment. Browser R&D remains separate and provisional.

| Milestone | Substantial deliverable | Dependencies and acceptance gate |
| --- | --- | --- |
| M0 — architecture acceptance | Record founder answers to [decisions 1–6](PRODUCT_AND_DECISIONS.md#decisions-required-before-implementation); designate the independently accepted recovered baseline; freeze scope and evidence vocabulary. | Required before AGUS 2.0 coding. Do not replay recovery or merge this planning branch automatically. No provider selected solely from documentation. |
| M1 — authority and financial domain | Explicit identity/ownership, consent lifecycle, read/action capability registry, typed money/evidence records; durable responsibility/action states. Preserve current payment approval and reconciliation guarantees. | M0. Choose storage changes from actual recovered code, not this older `main` snapshot. Prove cross-owner denial, revoked/expired consent rejection, exact-approval binding and inability of model/tool text to gain authority. No real data in a global demo ledger. |
| M2 — useful financial understanding at ₦0 | User-supplied statement ingestion, normalization, transaction search and deterministic cashflow; remembered responsibilities can monitor known facts and prepare reminders/proposals. | M1 + approved data policy. Verify against hand-calculated samples, duplicate imports, reversals, missing dates, currency precision and incomplete coverage. Show source/freshness; imported statements cannot answer “current bank balance” without qualifying their date. Fixtures stay labelled and separate. |
| M3 — one consented bank-data provider | Mono first candidate; adapter only after legitimate no-cost access is established. Hosted connection, initial import, pagination, refresh, expired/revoked consent, deletion and owner isolation. | M1; can follow M2 without blocking it. First establish eligible entity, exact target bank/account support, access terms and price. Sandbox contract success is a separate gate from one genuinely consented live account read. If unavailable, stop the adapter lane and keep M2 useful. No mandate/debit implied. |
| M4 — one financial-action route evaluation | Resolve one concrete use case: own-account payment, approved collection, or payout from an eligible provider balance. Select provider only after funding, authorization and legal responsibilities are explicit. | M0/M1 + founder use case + provider acceptance. Paystack adapter is reusable for its approved business-payout use case; it does not solve personal debit. Prove hosted authorization and exact-action review in an available legitimate sandbox; document sandbox omissions. No pooling collected user funds as a workaround. |
| M5 — optional stablecoin/USD lane | A single native-USDC network and signer model; conditional Bridge receiving-account trial and conditional Paycrest off-ramp trial, independently gated. | M1 + founder D4–D6 decisions + legitimate access. USD receipt is not a prerequisite for a wallet; off-ramp is not a prerequisite for financial read intelligence. Resolve Paycrest quote/market discrepancy, sender obligations, fees, net payout, refund semantics and customer eligibility before adapter work. Do not build bridges or an LP service. |
| M6 — production authorization and controlled validation | Operational reconciliation, incident/support ownership, backup/recovery, observability, security/privacy review and a separately authorized end-to-end live trial. | Only after the relevant provider gates, funding and compliance arrangement exist. Current ₦0 budget and no-transactions scope do not authorize this milestone. Measure each evidence state separately; recipient bank credit is the final settlement check. Release/merge/deployment needs separate approval. |

M3–M5 are access-gated options, not critical-path promises. Do not estimate dates for them until access and dependencies are evidenced. If a provider requires money, an unsupported entity type or an unacceptable compliance role, mark the lane blocked and continue the approved read/preparation product.

## Evidence required to unblock provider engineering

Keep the following compact record in GitHub, with secrets and personal data excluded:

| Lane | Evidence to obtain next | Stop / fallback |
| --- | --- | --- |
| Bank read | Mono approves entity/use case; exact target-bank/auth-method coverage; sandbox and live access distinction; written no-cost terms or approved budget. | No access: statement import. Do not repeatedly probe private endpoints without a legitimate key. |
| Existing-account action | Provider confirms the intended beneficiary/funding flow is allowed; supported mandate/authorization and revocation; settlement and liability terms. | Generic merchant collection is not enough: use bank/provider completion. |
| USD receipt | Bridge developer onboarding; Nigerian customer approval requirements; accepted payer/purpose; exact USD→USDC/network route; returns, minimums and fee schedule. | No developer/customer access: user-managed eligible account, manual operation and statement evidence. |
| Off-ramp | Paycrest explains Solana catalogue/quote versus missing market entries; accepts AGUS's sender role; identifies sender KYC duties and local payout arrangement; confirms quote/funding/expiry/refund behavior. | No suitable compliance/access arrangement: defer API integration. Hosted user-provider flow only if supported by its terms. |
| Chain/signer | User signing and recovery model; native mint allowlist; fee/rent payer; bounded transaction construction and simulation policy. | Public RPC read is already evidenced. Do not spend on wallets/RPC plans or move tokens to demonstrate it. A future devnet transfer needs separate scope authorization. |

The founder should obtain commercial/use-case answers through the normal provider relationship. This task neither contacts providers on their behalf nor requests credentials in chat. A free sandbox does not establish free production service. A future paid plan, gas payment or real-money trial requires new funding and authorization.

## Division of work after authorization

- **Codex:** own contracts, identity/consent enforcement, deterministic financial calculations, provider adapters, execution/reconciliation state machines and meaningful failure tests. Begin with one lead and one selected baseline; later delegation requires explicit work packages and shared-contract ownership.
- **Antigravity:** keep its existing browser R&D separate. After independent acceptance, its executor may consume the same typed proposal/authorization interfaces. For this financial plan, it can later help produce labelled statement samples and repeatable UI QA; browser success cannot certify banking access or authorize payments.
- **Other development/UI tools:** implement approved screens against frozen contracts and prepare documentation or test cases. They must show unavailable, stale, sandbox and unknown states accurately; no tool owns bank credentials, signing authority or financial truth.
- **Founder/ChatGPT:** approve product boundaries and priorities, designate the recovered baseline, resolve provider/entity/commercial/compliance decisions and authorize implementation/release separately. Provider gates cannot be completed by generating more code.

Use isolated branches and small reviewable PRs per milestone. Freeze contracts before shared-file work; integration belongs to one named maintainer. Do not parallelize overlapping payment/authentication changes or schedule duplicate recovery/browser work.

## Validation and exit criteria

For future implementation, test the failure that matters: cross-owner access, consent revocation, stale quote, altered recipient/network, duplicate execution, timeout after submission, restart, webhook replay, partial payout and refund/reversal. Contract fixtures test code only; genuine sandbox results test that sandbox only. Record provider authentication, live read, value movement, provider settlement and bank credit as distinct evidence levels.

For this planning task, the completed deliverable is the three Markdown documents. Verification is limited to documentation consistency, source/evidence review, a docs-only Git diff, commit/push and matching local/remote SHA. Existing app tests cannot establish the missing external banking capabilities.

Start no implementation until the founder accepts the decisions. See [feasibility findings and exact public tests](TECHNICAL_FEASIBILITY.md).
