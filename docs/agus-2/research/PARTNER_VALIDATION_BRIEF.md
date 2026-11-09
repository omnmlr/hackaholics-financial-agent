# Consumer-source pilot — prepared institutional validation brief

Status: draft for founder review, **not sent**. 9 November 2026. Priority target: **Remita's consumer-channel/product partnership team**, given its current first-party personal account-profiling product. Alternative: an authorized bank/participant's consumer/open-banking team. This asks for technical and operational evidence, not permission to use a merchant account as a shortcut.

## Proposed service

AGUS is a conversational personal agent for verified adults. A customer links an existing Nigerian personal bank account, reads available balance/history, reviews an exact beneficiary transfer and completes required institution/bank authorization. The institution retains the approved financial service and source execution; AGUS supplies a contracted, bounded technical interface. No AGUS customer-money pool, replacement bank account or account-credential collection.

Initial intended launch needs **20 distinct personal source banks**; a one-bank controlled pilot is a mechanism test only. AGUS adds no fee/markup and the route must cost the customer no more than their equivalent ordinary bank transfer. Development resources currently have N0 available for paid providers/infrastructure or test funds. No live trial or credential exchange is requested yet.

## First decision requested

Can your institution support this precise **third-party consumer-delegated existing-account read and beneficiary-payment model**, under a currently authorized operational role, rather than only corporate accounts or merchant collections? Please identify the responsible entity/product, approved role of AGUS and scope of source-bank authority. If unsupported, an explicit no avoids wasted integration work.

If potentially supported, provide these reviewable artefacts without sending secrets or customer records:

1. **Operating arrangement:** current eligibility/onboarding requirements, regulator/participant classification, allowed outsourcing/data access, supplier security/ISMS requirements and who owns CDD/AML/sanctions, financial execution, complaints and losses. Is 18+ eligibility available as a minimized verified assertion? Which obligations remain AGUS's?
2. **Actual consumer flow:** current source-account enrolment and ownership checks; institution/bank-hosted consent and SCA; account-grant/token/reference contract; read versus payment permissions; revocation/revalidation and lost-device/recovery. For RITS, is there a supported consumer replacement for historical AddAccount/ValidateAccountOTP? May third-party personal profiles be operated without making those accounts part of AGUS's merchant identity?
3. **Source-bank schedule:** named banks and exact existing personal account types; balances, general transaction history, source payment, bank authentication and limitations for each. Distinguish recipients, network participants, corporate-only banks and demonstration examples. Can the institution genuinely cover 20 sources through one interface, or which bank agreements/adapters remain?
4. **Payment contract:** arbitrary intended personal beneficiaries versus approved merchants; source and destination binding; fee quote; expiry/idempotency/reference; payer SCA; precise debit/credit path; status, reversals and dispute evidence. Can the customer stay on the bank's ordinary transfer route with no AGUS/intermediary collection pool?
5. **Economics:** setup, sandbox, production, per-API, per-account, transfer, tax/channel and infrastructure costs. Who contractually funds incremental costs? Provide same-source ordinary-bank-fee comparisons including free-transfer allowances. A statement that AGUS can set `fee=0` is insufficient.
6. **Validation access:** supported public contract/version and legitimate zero-cost sandbox process if available. Which behaviors are simulated? Identify a future controlled test plan, but do not supply keys or initiate any financial operations before separate authorization and funding.

## Acceptance and stop conditions

Proceed to an integration proposal only when a named institution accepts the role and supplies an actual consumer-source interface. A high-level partnership response, bank logo page, NIP recipient list, wallet creation endpoint or merchant collection key is insufficient.

Confirm the pilot source first; expand only on capability-specific evidence. Keep 20-bank coverage and fee parity as separate required gates. If a required cost has no committed payer, record the dependency rather than proposing an unfunded subsidy. No message has been sent to any external party by this research task.
