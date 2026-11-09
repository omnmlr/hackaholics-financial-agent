# PayAttitude consumer-source hypothesis — stopped before a prototype

Checked 9 November 2026. Hypothesis: an external AGUS integrator can request a consumer-approved transfer **from a selected existing linked personal bank account to an arbitrary personal beneficiary**, without merchant collection, and can read balance/history.

**Result: no publicly documented consumer-delegation authority or permitted sandbox for that hypothesis was found. No payment API request, onboarding submission, bank request, credential use or transaction was made.** This does not establish that PayAttitude has no private partner product. It establishes that the available published integration cannot authorize the proposed experiment.

## New discriminator checked

The public `up-eplatform` organization contains three repositories: `PayAttitude-Integration`, `Merchant-Payment-Gateway`, and `cipa-schemes-consolidation`. In addition to the previously studied PayAttitude merchant guide, this investigation inspected the **CIPA consolidation** guide at SHA [`fd918f25c94c933112ebfe888190463905d96651`](https://github.com/up-eplatform/cipa-schemes-consolidation/blob/fd918f25c94c933112ebfe888190463905d96651/README.md). It expressly applies to merchants receiving scheme payments on the payment gateway. Its PayAttitude branch accepts a payer's mobile number and asks the customer to authenticate, but the order remains a merchant order.

The distinction matters: customer approval through the PayAttitude scheme is real **documented authentication machinery**; it does not turn a merchant order into delegated P2P access. No documented source-account selector, arbitrary bank beneficiary, consent-scoped balance/history read, consumer permission grant, client registration for P2P, or consumer-transfer sandbox was located in that guide. Consumer account linking inside a scheme app, even if available, would not itself grant AGUS any of those roles.

## Exact issued object / enrolment owner actually documented

- **Issued object:** Merchant ID plus Cryptographic Key, identifying a Webshop to UP MPI; the examples refer to a merchant secret key and create an aggregator order. It is not a reusable customer bank-consent token.
- **Issuer / owner:** Unified Payments **E-Commerce Ops** sets up the merchant. The prospective-merchant application is followed by emailed test configuration, system integration testing/UAT with Unified Payments and separately issued production parameters.
- **Documented transaction role:** collect a customer-approved payment for that configured merchant. The issuer authorizes the scheme transaction after customer authentication. No public authority object for an AGUS-controlled arbitrary-beneficiary consumer transfer was identified.
- **Source coverage:** no operation-specific 20-source-bank matrix, account-type eligibility or selected-account semantics published in the inspected integration. No bank counted as verified.
- **Cost:** `fee: 0` in a merchant request is not a scheme/issuer/acquirer tariff or proof that the route costs no more than the user's normal bank transfer. No qualifying fee-parity terms found.

The previously studied [`PayAttitude-Integration` guide, SHA `232eaa4cac9d5df1efd5b03503ba8894d459c539`](https://github.com/up-eplatform/PayAttitude-Integration/blob/232eaa4cac9d5df1efd5b03503ba8894d459c539/README.md) remains merchant-scoped. A recurring-payment `SessionId` or merchant authorization must not be repurposed as a personal P2P mandate.

## Access limitation

Consumer-site retrievals from `payattitude.com` and `payattitudeglobal.com` were blocked by the environment's HTTP tunnel with 403, so their current consumer features/terms could not be independently inspected. Public GitHub code search for PayAttitude plus transfer did not expose a qualifying consumer API; absence from that search is not proof of absence. No guessed mobile package or unofficial consumer-app source was used to infer private endpoints. The published merchant test URL was **not called**: its documentation requires issued merchant test configuration, and that role would not satisfy this experiment anyway.

## Smallest next external artifact needed

PayAttitude/Unified Payments must identify an authorized **consumer/P2P integrator role**, issue its actual client/participant registration and customer-consent authority in a permitted sandbox, and supply a contract that binds a selected existing source account, arbitrary personal recipient, amount, authentication and status evidence. It must separately authorize account-data reads and document at least 20 qualifying source banks and all-in transfer costs. These are requested artifacts, not names of objects known to exist.

Until that artifact exists, implementing an encrypt/order/merchant-status demo repeats an exhausted mechanism and cannot test the new hypothesis. **No new code or duplicate mock was built.**
