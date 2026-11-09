# Nigerian open-banking protocols and reusable implementation research

Research lane A; 9 November 2026. Status: **public code and primary documents inspected; one isolated authorization-code experiment; no bank linked or payment attempted**. Founder requirements remain 20+ existing personal **source** banks, private balances/history, authorized beneficiary transfers and zero AGUS-added charges.

## Finding that changes the engineering options

An open implementation exists on the **bank/provider side**, not just an abstract API standard: Open Banking Nigeria's `obn-gateway` is a Kong/NestJS gateway with API import/mapping, consumer management, OAuth token introspection, scope enforcement and consumer binding. A bank or authorized participant can deploy this to expose its underlying systems through common contracts. AGUS could contribute a narrow bank-sponsored reference integration instead of paying an aggregator or implementing 20 proprietary APIs independently.

This is a credible **institutional engineering path**, not a discovered free connection to 20 banks. Installing a gateway supplies no accounts, settlement participant rights, upstream bank adapters or authority. The strongest architecture hypothesis is an approved bank/participant-hosted service where AGUS supplies the conversational client and scoped orchestration; the institution retains authorized API-consumer execution, customer authentication, transfer rails and liability under explicit agreements. The precise outsourced role, permitted private-data processing and commercial treatment must be accepted by that institution and relevant regulator. Simply calling AGUS a technology provider does not establish permission.

The smallest initial external dependency is **one institution willing and authorized to accept that role and enable a real personal-account read + payment-consent flow**. That establishes a pilot, not launch completion. Expansion still requires independently evidenced source-bank coverage and commercial terms for 20 banks.

## Primary regulatory documents successfully retrieved

The previous report's unsuccessful CBN URL was not evidence that the guideline was inaccessible generally. Following the official OBN homepage revealed the correct `CCD` path. Both primary CBN PDFs returned HTTP 200 on this investigation:

1. [CBN Regulatory Framework for Open Banking, 2021](https://www.cbn.gov.ng/Out/2021/PSMD/Circular%20on%20the%20Regulatory%20Framework%20on%20Open%20Banking%20in%20Nigeria.pdf). SHA-256 `b045c5579e3100695f02b148e2a9f9e7326e63e582b15646f760b829abb99d73`.
2. [CBN Operational Guidelines for Open Banking, 2023](https://www.cbn.gov.ng/Out/2023/CCD/Operational%20Guidelines%20for%20Open%20Banking%20in%20Nigeria.pdf). SHA-256 `ca58851ef32ba6c25a8ba27c85148fd63b541632f5f40b97552575124e868734`.

Decisive text, using printed document pages:

| Source | Exact relevant text / rule | Implication for AGUS |
| --- | --- | --- |
| 2021 framework §4.1, pp.4–5 | MIT “shall not be associated to any individual customer or account”; PIFT includes customer “balances, bills payments, loans, repayments, recurring transactions”. | Public bank catalogues/statistics are not AGUS's required private account access. |
| 2021 framework §5.1 table, p.6 | Unlicensed Tier 0: PIST/MIT. Regulatory-sandbox Tier 1: PIST/MIT/PIFT. Licensed PSP/OFI Tier 2 and banks Tier 3: PIST/MIT/PIFT/PAST. | Registration of an unlicensed application alone does not establish private account privileges. Exact payment privileges also need provider/regulatory confirmation; PIFT naming is not proof every transfer API is enabled. |
| 2021 framework §5.2.1, pp.6–7 | Tier 0 onboarding is determined by sponsoring Tier 2/3; sponsor registers it and supplies a CRO-signed risk assessment. | Sponsorship is an available participation route, but that paragraph does not automatically elevate Tier 0 to all higher-tier services. |
| 2023 guidelines §§6/6.1, pp.8–9 | Registry identifies participants by CAC number; accreditation refers to framework §5.0. | A standards-compatible client and customer consent are not substitutes for institutional onboarding. |
| 2023 guidelines §8.1.2, p.11 | “A Service Level Agreement (SLA) shall be executed between API providers and API consumers”; §8.1.2.2: “All participants shall state the fees in the SLA and publicly disclose on their websites and applications.” | A signed service/commercial relationship matters. No universal free-access conclusion follows from open standards. |
| 2023 guidelines Appendix III (Authentication/Authorisation), p.50 | “Participants shall adopt authentication protocols at the minimum, OAuth 2.0 in conjunction with OpenID Connect.” | The same page requires mTLS or approved machine-authentication standard and FAPI security profiles. Reusable plumbing still depends on participating authorization servers and registered clients. |
| 2023 guidelines Appendix III (Supplier Management), pp.48–49 | Requires clearly documented contracts for outsourced processing, infrastructure and application development; suppliers interacting with PIFT/PAST need evidence of ISO 27001 requirements or approved ISMS accreditation. | A participant-hosted/outsourced route is contemplated, but has substantive supplier-assurance gates; not a free regulatory bypass. |
| 2023 guidelines Appendix IV §4.2, p.59 | Explicit consent, customer copy, annual/180-day-unused revalidation, termination on expiry and customer revocation control. | AGUS needs durable consent lifecycle and bank-enforced revocation, not a stored blanket approval. |

These are authoritative documents **read**, not a legal opinion on today's exhaustive access rules. No newer CBN instrument changing these classifications was verified in this lane. The intended sponsor/CBN must confirm the currently applicable role and operational enrollment route before reliance.

## Current rollout evidence and its limits

The [OBN implementation page](https://openbanking.ng/implementation-guidelines/) links June-2026 guides for [fintechs](https://openbanking.ng/wp-content/uploads/2026/06/Open-Banking-Implementation-Guidelines-For-FinTechs.pdf) and [banks](https://openbanking.ng/wp-content/uploads/2026/06/Open-Banking-Implementation-Guidelines-For-Banks.pdf). Both downloaded successfully. These are OBN industry guides, **not new CBN regulations**.

- Fintech guide introduction says the CBN “is set to declare Open Banking operational”; §11.1 recommends controlled pilots with one, at most two anchor banks before broad integrations. Its examples are proposed pilots, not evidence that Sterling/Stanbic or 20 banks offer AGUS usable access.
- §4.2 labels possible certification/registry/data fees as “educated assumptions ... in no shape or form constitute a formal guidance on CBN fee structures.” Do not quote its suggested initially free APIs as established free service.
- The current public [OBN API standard page](https://apis.openbanking.ng/) explicitly says “All data presented here are dummy values” and “you would need to connect with real banks to be able to do real-life transactions.” HTTP 200 here is documentation access only.
- No authoritative current list of 20 certified/live personal-account **read and payment** endpoints was obtained. An attempted possible registry hostname could not be retrieved (tunnel HTTP 403); that hostname was not established as the current official registry location. This neither proves registry unavailability nor establishes bank coverage. Request the actual current directory/participant interfaces through OBN/CBN or the sponsor; verify per-bank capabilities rather than counting membership logos.

Guide SHA-256: fintech `7c31da8098523af8d05a2141200e35f6e06cfe260b927b896aed14806e3954e5`; banks `074b7b0464816b3caf90a6059a4a9f0b467c750abdf98580d2c831e0f3c5f624`.

## Open-source code inspected

| Repository, pinned version | Actual mechanism inspected | Reuse / limitation |
| --- | --- | --- |
| [`openbankingnigeria/obn-gateway` @ `5c85a0a`](https://github.com/openbankingnigeria/obn-gateway/tree/5c85a0a6386841584c460a6ccd652e0873347f9a) | `apps/kong/plugins/obn-authorization/handler.lua`: bearer extraction, authorization-server introspection, `active` and scope checks, registered consumer/client-ID equality; `apps/server/src/apis/apis.service.ts`: imported upstream/downstream mapping and Kong routes. | Real reusable bank-side publishing/control-plane code; not a multi-bank account connector. README requires Kong, MySQL, Elasticsearch, Logstash and app services. GPL-3.0; review distribution/derivative obligations before reuse. Not independently security audited here; do not deploy unchanged on the basis of these seven tests. |
| [`openbankingnigeria/api` @ `33c5b1e`](https://github.com/openbankingnigeria/api/tree/33c5b1e23d2c22d4390b562f339d218d2db60938) | `BankAccountService` and `BankTransactionService` define account/history and `singleTransferOtherBank`; controllers expose contract-shaped routes. `demo-web-service/.../OB_HOME/data/` supplies account/statement JSON. | Apache-2.0 contracts and Java integration skeleton; demo data is not a bank adapter. This can shape a conformance test, not prove 20 banks. |
| [`openbankingnigeria/docs` @ `7b05815`](https://github.com/openbankingnigeria/docs/tree/7b05815453eed84f5f191b571f4ee2801516f83f) | `developer-center/api-architecture.md`, `customer-experience/overview.md`, `security-framework/data-management-and-exchange.md`, integration certification pages. | Explicit TPP/AP registration, consent, scoped OAuth and mutual certificate model; older documents include unfinished certification notices. Useful historical design detail; current CBN documents and partner profiles govern. No explicit repository license found; do not assume code/document reuse rights. |
| [`openbankingnigeria/aperta-docs` @ `7b59764`](https://github.com/openbankingnigeria/aperta-docs/tree/7b59764d9d9ae151d095adb5710c46d62294aeb8) | Only README/SUMMARY with no substantive implementation instructions in inspected tree. | Not a hidden complete connector or proof of supported banks. |

### Isolated practical experiment

[Reproducible harness](experiments/test_obn_authorization.py) and [actual sanitized output](experiments/obn_authorization_results.txt) are preserved with this report. It executes the **unmodified pinned gateway Lua handler**, via the installed `liblua5.4` shared library, against local Kong/request/introspection test doubles. Upstream source SHA-256 is enforced: `492bf26cf9f7ebbc9d44e7984a3d12e11be942b635042bfc063d3a2c5ca4bdc5`.

Result: **7/7 local unit cases passed**: missing bearer denied (401), inactive token denied (401), read-only token cannot invoke write scope (403), wrong client denied (403), empty client denied (403), authorization-server rejection denied (401), active correctly bound write grant accepted. The harness sets introspection cache TTL to zero; caching/revocation propagation is not tested.

This resolves a narrow engineering question: OBN's real middleware can enforce differentiated read/write grants and bind them to a registered client; AGUS need not invent that mechanism. It does **not** establish customer authentication, valid bank-issued tokens, interoperability, banking permissions, 20-bank support, throughput, transfer execution or production security. There is no HTTP bank call or simulated payment demo. No AGUS production code was changed.

Reproduce with Python 3 and `liblua5.4.so.0`: `python3 docs/agus-2/research/experiments/test_obn_authorization.py`. Default mode retrieves and hash-checks the pinned public handler; `--source PATH` uses an existing exact copy. It uses no keys or bank credentials.

## Closely related systems outside Nigeria

- [OpenBankingUK read/write specifications @ `484a179`](https://github.com/OpenBankingUK/read-write-api-specs/tree/484a1795680d9852600247878b9fd2bfe584c0aa): inspected `dist/openapi/account-info-openapi.yaml` and `payment-initiation-openapi.yaml`, version 4.0.1. Separate `/account-access-consents`, balances/history and `/domestic-payment-consents` → `/domestic-payments`; payment routes require OAuth `payments`, idempotency and message-signature headers. This is a concrete reusable **consent-then-payment** pattern, not a UK API that can debit Nigeria.
- [Open Finance Brasil conformance @ `eeb6267`](https://github.com/OpenBanking-Brasil/conformance/tree/eeb6267f239694d9003329bbac00e7de4f20755e): README describes directory/certification and OpenID Foundation-derived conformance tooling; inspected repository tree includes named institutional payment/consent certification submissions. It is stronger operational-interoperability evidence than a bank list, but this research did not validate those submissions against live banks. Transferable idea: a signed participant directory plus conformance evidence for each account/payment capability; copying the directory software cannot enroll Nigerian banks or grant Pix access.

## Concrete path and stop conditions

1. Ask one licensed bank/PSP to assess a **bank/participant-hosted AGUS pilot**, not an AGUS-owned omnibus wallet. Obtain the exact permitted consumer/outsourcing role, private-data access, consent/SCA and fee treatment in writing. Sandbox admission is another possible route, not a live production entitlement.
2. Use actual provider contracts plus standard account/consent/payment semantics; keep financial intent and recipient review in AGUS, tokens/consent authority and bank transfer execution in the authorized institution's boundary. Do not assert that a bank's own existing NIP access authorizes it to read/debit 19 other banks.
3. Prove one source bank's balance/history and exact beneficiary payment flow under separate future transaction authorization. Add a capability-specific conformance and acceptance record for every additional source bank. Reuse standards where truly supported; otherwise institutional adapters remain necessary.
4. Contract for AGUS-zero-markup pricing with all extra API/operations costs expressly funded by institution/product revenue or waived—not hidden transaction subsidies. No free plan or recurring-cost funding was established here.
5. A launch with 20 source banks remains blocked until those 20 records and commercials exist. Neither a successful gateway unit experiment, OBN membership, directory registration, recipient-bank reach nor the 2026 rollout guide satisfies it.
