# Device authorization and reusable open-source investigation

Research date: 9 November 2026. Scope: legitimate bank-app handoffs, USSD, signed payment intents and reusable direct-banking protocols. **No device/bank was connected, banking credential used, USSD session run or financial transaction initiated.** Browser execution and AGUS recovery were not investigated.

## Finding

The strongest reusable mechanism in this lane is **a bank-owned authorization experience accepting a structured, verifiable payment request**, then returning a reference that AGUS independently reconciles. This preserves the bank's normal transfer route and authentication; it could avoid a second merchant-collection/payout leg. Android/iOS transport and signed-request libraries are reusable today. They cannot make an existing bank app accept that request or expose balance/history.

No evidence found in the inspected code establishes a currently available, universal Nigerian bank-app payment intent supporting 20 source banks. This is an evidence limit, not proof no private bank agreements or implementations exist. The required external deliverable is explicit bank/scheme adoption of the request/consent/status contract, plus authorized account-data access and a tariff agreement. Writing an AGUS deep link alone cannot provide it.

## Credible discoveries and code-level results

| Candidate | Code/specification actually inspected | What changes our options | What remains missing |
| --- | --- | --- | --- |
| **UseHover/Stax** | Real Android application, Apache-2.0; SHA `5b735dc215b63533420fe899c579a42a44f598ea`. `HoverSession.kt`, `TransactionReceiver.kt`, channel repository, app Gradle and version catalogue. | Proves the on-device USSD-as-financial-client pattern is more than an idea. Actions can represent balance checks and sends, with device/SIM selection and parsed outcomes. | External Hover SDK/account/action service; bank authorization/terms; current price; verified Nigerian source coverage and complete history. This is USSD UI automation, not a bank-issued API entitlement. |
| **Checkout Broadcast** | Source-available signed BLE request SDK; SHA `f4add3ef73b2db5b0428052f5db6c050366764c0`. Banking guide, Python protocol, reference FastAPI server and repository tree. | Reusable pattern for signed amount/recipient requests, bank verification, replay control and customer confirmation inside a bank app. | Bank receiver integration and its actual transfer API. Named OPay/Kuda/GTBank URLs are explicitly examples with golden fixtures, not demonstrated integrations. No balance/history service. CC BY-NC 4.0 requires separate commercial permission for a bank/wallet product. |
| **Android verified App Links / intents** | Official Android App Links and common-intent documentation. | Secure domain-to-app association can dispatch a bank-owned authorization URL without collecting banking credentials in AGUS. | The bank must publish/handle the action and validate it. Android does not define an NGN bank-transfer action, account-data scope or trustworthy payment-status API merely by launching an app. |
| **UPI Android intent precedent** | Google's official India in-app payment guide and its generic UPI URI contract. | A scheme-defined URI plus participating bank/PSP apps is a real architecture for multi-source authorization in another jurisdiction. | UPI's payment identifiers, INR route and participant infrastructure cannot be re-labelled NGN. Google's guide requires verification with the PSP even after a `Succeeded` or `Submitted` app result. |
| **FinTS / EBICS clients** | `raphaelm/python-fints` SHA `eda20b4fec2e612dc7942234884be2e8c4fe632f`; README and quickstart. `node-ebics/node-ebics-client` SHA `4a09c8e260a7e61b4bebea9f9df9e52e658dcb6e`; README and initialization contract. | Open-source clients can implement balance/history and authorized transfer protocols without owning the banking rail. The integration pattern is reusable. | A participating bank server and bank-issued access still come first. FinTS example uses bank endpoint, bank code, login/PIN/TAN and registered product ID; EBICS requires bank-issued host/user/partner IDs and bank activation of keys. No 20-bank Nigerian server/adoption evidence was found. Do not collect bank credentials to adapt these clients. |

### Stax: why this was worth investigating, and why it is not an accepted workaround

Stax is publicly buildable according to its README and linked to its Play Store listing. GitHub metadata reports the last repository push as 1 February 2024; public code alone does not establish present SDK/service availability or Nigerian bank reliability.

The inspected `HoverSession` constructs `HoverParameters.Builder`, chooses test/production mode and calls `request(b.action.public_id)`. The production dependency is **`com.hover:android-sdk:2.0.0-beta04`**; implementing the app does not reproduce that SDK or its action service. Hover's published quickstart requires an account, an application API token and configured/downloaded actions. Action definitions contain menu steps, variables and a PIN-prompt step.

`TransactionReceiver.updateBalance` takes a balance from `COLUMN_PARSED_VARIABLES` and updates the local account record. Transaction history is application-observed transaction data; the inspected path does not provide a bank's complete historical ledger. A channel selection filtered by country and available action IDs is not evidence that 20 Nigerian banks support all required operations.

Hover's permission documentation describes phone, accessibility, overlay and optionally SMS permissions. Its accessibility/policy explanations are historical provider documentation, **not independently verified current Play approval or bank authorization**. OS permission from the user cannot establish that the bank permits a third-party service to automate its menus or handle its PIN. Because AGUS excludes unauthorized banking automation and use of banking credentials, no sessions or device automation were attempted.

An explicitly bank-approved SDK/channel could merit a later trial if all of these are evidenced: no AGUS credential collection, bank/operator permission, secure customer authorization, app-store approval where relevant, 20 source-bank actions, full data coverage, independent status reconciliation and fee parity. None was established here. USSD channel/session charges and SDK commercial terms must be counted; a free source-code licence is not a free banking route.

### Checkout Broadcast: substantive intent code, not a hidden bank connector

The banking guide says the SDK calls **the adopting bank's** verification backend, then the bank app runs **its existing** transfer flow. `transferApi.initiateTransfer(...)` appears in integration pseudocode; it is not an implementation against Kuda, OPay or GTBank. The three named-bank fixture URLs must not be queried or counted as supported source banks.

The README claims deployment by CheckoutNow and Cheko/CheckoutPay. These are repository-maintainer claims, not independently verified bank operations or settlement evidence. Neither is a 20-bank source integration proof. The guide says cross-bank terminal use would require a shared registry in the future. The licence explicitly limits free use to noncommercial use and asks commercial banks/wallets/POS vendors to obtain a separate licence.

## Safe structural experiment

An isolated Python `ast.parse` inspection of the downloaded reference `bank_api/server.py` enumerated route decorators without importing or executing repository code. Observed routes:

```text
GET  /health
GET  /ready
POST /terminals/register
GET  /terminals
GET  /terminals/{terminal_id}
POST /verify-broadcast
GET  /usage/public
POST /usage/hit
```

This confirms that the reference server exposes terminal/request verification and usage counting; it does not itself expose account history, balances or a source-bank debit endpoint. The guide separately supplies the missing bank transfer as pseudocode. **This is a local structural check, not a payment PoC or a proof that the entire repository has no other behavior.** No reference server, bank endpoint or device was started.

A separate local JSON parse of [Axxellance's USSD directory](https://github.com/Axxellance/all-nigeria-banks-ussd-code-json-data/tree/8a7db121fbd1aec9fe538b3c2ce674a8fdbd5f05) found 49 bank-labelled directory records across seven categories. Records contain descriptions/websites/codes, not authorized banking adapters. This illustrates why even a directory exceeding 20 names must not be promoted to 20 source-bank integrations. No code was dialled and current accuracy was not validated.

## What a legitimate device-assisted design would require

1. AGUS prepares an exact recipient, source account, integer-kobo amount, expiry, nonce and correlation ID; beneficiary identity is resolved through an authorized source.
2. A **bank/scheme-defined** HTTPS authorization request is opened via a verified app association. The bank fetches/verifies the request and displays it in its own app or hosted flow. AGUS does not embed bank login, read PINs or automate authentication.
3. The bank performs strong customer authentication and executes its normal source-account transfer. AGUS grants cannot substitute for bank consent.
4. A returned app result only resumes the user experience. An authenticated status endpoint, scheme evidence or bank transaction record must establish amount/recipient/reference and finality; timeout remains unknown until reconciled.
5. Balance/history access needs its own consented API. SMS/notifications and AGUS-observed sends cannot silently stand in for a complete bank ledger.

AGUS can build the request/reconciliation interfaces and a local conformance harness. The bank or authorized scheme must implement/authorize the other end. Twenty independent bank integrations can be reduced only if a common scheme/sponsor actually covers those banks as sources; app-store presence, NIP recipient membership and verified links do not prove this.

An ordinary `ACTION_DIAL` handoff can open the user's dialler for manual completion. It is an optional user-assisted tool, not completion of the founder's secure-linking/read/payment/status requirements. No successful transfer status can be inferred from returning to AGUS. It also needs channel-cost comparison against equivalent bank transfers. It is not the selected launch architecture.

## Primary sources / reproducible inspection points

Accessed 9 November 2026; code refs pinned where available.

- [Stax repository](https://github.com/UseHover/Stax/tree/5b735dc215b63533420fe899c579a42a44f598ea); [session construction](https://github.com/UseHover/Stax/blob/5b735dc215b63533420fe899c579a42a44f598ea/app/src/main/java/com/hover/stax/hover/HoverSession.kt); [parsed balance/transaction handling](https://github.com/UseHover/Stax/blob/5b735dc215b63533420fe899c579a42a44f598ea/app/src/main/java/com/hover/stax/hover/TransactionReceiver.kt); [dependency versions](https://github.com/UseHover/Stax/blob/5b735dc215b63533420fe899c579a42a44f598ea/gradle/libs.versions.toml).
- [Hover quickstart](https://docs.usehover.com/), [permissions](https://docs.usehover.com/permissions), [action configuration](https://docs.usehover.com/actions); [pinned documentation source](https://github.com/UseHover/hover-docs/tree/eee32c393706b5a9630778d4670ebab3050f5c94). Main Hover website and Stax website retrievals were blocked with HTTP/tunnel 403; no current price or service acceptance was established.
- [Checkout Broadcast bank integration](https://github.com/amithyone/checkout_broadcast/blob/f4add3ef73b2db5b0428052f5db6c050366764c0/docs/banking-app-integration.md), [reference server](https://github.com/amithyone/checkout_broadcast/blob/f4add3ef73b2db5b0428052f5db6c050366764c0/bank_api/server.py), [README and commercial-licence caveat](https://github.com/amithyone/checkout_broadcast/blob/f4add3ef73b2db5b0428052f5db6c050366764c0/README.md).
- [Android App Links](https://developer.android.com/training/app-links), [common intents / dialler semantics](https://developer.android.com/guide/components/intents-common), [TelephonyManager USSD method](https://developer.android.com/reference/android/telephony/TelephonyManager#sendUssdRequest(java.lang.String,%20android.telephony.TelephonyManager.UssdResponseCallback,%20android.os.Handler)). These define OS behavior, not bank permission.
- [Google Pay India generic UPI intent, INR parameters and PSP verification requirement](https://developers.google.com/pay/india/api/android/in-app-payments).
- [PyFinTS protocol, supported operations and limitations](https://github.com/raphaelm/python-fints/blob/eda20b4fec2e612dc7942234884be2e8c4fe632f/README.md); [bank endpoint/auth/product-registration prerequisites](https://github.com/raphaelm/python-fints/blob/eda20b4fec2e612dc7942234884be2e8c4fe632f/docs/quickstart.rst).
- [EBICS client bank-issued credentials and activation sequence](https://github.com/node-ebics/node-ebics-client/blob/4a09c8e260a7e61b4bebea9f9df9e52e658dcb6e/README.md). This client's README recommends a Node security-revert flag; it is evidence of protocol mechanics, **not a dependency recommendation**.

Bottom-line evidence state for this lane: **useful code and authorization patterns found; zero Nigerian source banks independently linked/read/paid in this investigation; 20-source-bank and fee-parity launch requirements remain unproven.**
