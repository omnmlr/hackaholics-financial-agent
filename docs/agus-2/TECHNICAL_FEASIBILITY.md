# AGUS 2.0 — technical feasibility

Investigated 9 November 2026. **No financial integration is established as working end to end.** Public read/quote tests below passed; no bank was linked, credential acquired, wallet funded, order created or transaction submitted. Budget spent: ₦0.

## Capability verdicts

| Capability | Verdict for AGUS now | Decisive evidence / practical alternative |
| --- | --- | --- |
| Read existing Nigerian bank balances/history | **Documented, access-gated; not tested.** Mono Connect is a credible first candidate. No universal free bank connector established. | Mono requires a registered business/compliance and describes account linking, balances and transactions [1]. Exact bank/account/auth-method coverage and pricing remain unverified. Start with explicitly user-supplied statements; do not claim live balances. |
| Debit/pay from an existing personal account | **Conditional, not blanket account control.** | Mono separates one-time DirectPay and mandate-based Direct Debit and requires Payments access [2]. Paystack Direct Debit requires feature enablement and a supported-bank mandate [3]. These collect payments for an approved business; neither documents unrestricted arbitrary-beneficiary personal transfers for AGUS. Use bank/provider-controlled completion until the exact use case is approved. |
| NGN bank payouts using existing code | **Adapter implemented; provider and settlement unverified.** | Paystack Transfers is for registered businesses and requires sufficient Paystack balance plus fees [4]. It spends that provider balance, not arbitrary linked personal accounts. No test/live key or eligible account was provided. Preserve adapter; do not substitute an AGUS-funded pool for personal-account access. |
| Solana native USDC | **Technically viable; public mint reads tested. Transfers/signing untested.** | Circle publishes the native mints [5]; finalized RPC reads confirmed SPL mints with six decimals. SOL fees and token-account funding still exist [6]. Devnet access is not real USD, liquidity or bank access. |
| USD receiving account → stablecoin | **Documented, onboarding-gated; no account issued/tested.** | Bridge describes named USD ACH/wire deposit details and automatic crypto delivery; customers require KYC/KYB [7]. Nigeria is listed High Risk with US ACH/FedWire support and enhanced due diligence [8]. API enums include USDC and Solana, but do not prove that exact combination is enabled for AGUS's customer/purpose [9]. |
| Solana USDC → NGN conversion | **Public quote tested; execution and liquidity unverified.** | Paycrest v2 returned a sell quote for 100 USDC and confirmed the native mint in its token catalogue [10–12]. Its market snapshot showed no Solana entries. Sender KYB/API access and actual settlement remain untested. Keep as a conditional candidate, not a launch promise. |
| NGN settlement into a user's existing bank | **Provider-supported proposition, not demonstrated.** | Paycrest describes local provider payout via PSP/bank [13]. Neither quote success, on-chain finality nor an API “completed” label alone establishes recipient bank credit. Require independent bank evidence in a future authorized trial. Manual completion in the user's provider app is the fallback. |
| Free, unattended USD→USDC→NGN→bank product | **Not established; exclude from current commitment.** | No provider acceptance, commercial terms, gas sponsorship, regulatory allocation or funded settlement trial. No evidence supports a guaranteed ₦0 production service. |

## Repository and historical documentation inspected

Base: [`292d0b1`](https://github.com/omnmlr/hackaholics-financial-agent/tree/292d0b192c8be60589d92fe08dc80a8e25c1d7c5). Inspected `README.md`, `ARCHITECTURE.md`, `LIVE_READINESS.md`, `ENGINEERING_HANDOFF.md`, `docs/integration/provider-compatibility.md`, `src/lib/banking-data.ts` and the Paystack interface/adapter in `src/lib/paystack.ts`.

- Paystack REST adapter and separate fixtures exist. Repository reports explicitly say automated provider responses are mocks and live access/credit were not established. Those tests were not rerun: no application code changed and doing so would not answer external-access questions.
- `BankingDataSource` defines authorized history/revocation only; no implemented Mono/Wema account connection exists in this inspected base. Fictional ledger figures are not account history.
- Current single operator, global workflow aggregate and password controls are not multi-user personal-finance readiness. Preserve digest-bound approval, one-use submission, OTP, unknown outcomes and reconciliation; extend identity/storage only after architecture approval.
- Read historical [Phase 1 founder brief](https://github.com/omnmlr/hackaholics-financial-agent/blob/45f553177f86c2a40de6885304ed9bd47a5af5de/docs/phase1/FOUNDER_BRIEF.md), [proposed contracts](https://github.com/omnmlr/hackaholics-financial-agent/blob/45f553177f86c2a40de6885304ed9bd47a5af5de/docs/phase1/ARCHITECTURE_CONTRACTS.md) and [model-led architecture](https://github.com/omnmlr/hackaholics-financial-agent/blob/869b5b9b488299007ece130e78d76cf5fc102d45/docs/model-led-agent/ARCHITECTURE.md). Did not reconstruct later implementations, inspect browser R&D or change integration branches.

## Practical evidence — public network calls only

Requests made around **05:40–05:41 UTC / 06:40–06:41 WAT**, 9 November 2026, using inherited proxy/CA trust. No authentication or user account data was sent. These were HTTP/RPC probes outside the application, not adapter integration tests.

| Probe | Observed result | What it proves / omits |
| --- | --- | --- |
| `GET https://api.paycrest.io/v2/currencies` | HTTP 200; NGN among four currencies. | Public catalogue responds; not bank or sender eligibility. |
| `GET https://api.paycrest.io/v2/tokens` | HTTP 200; Solana USDC mint `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, decimals 6. | Runtime catalogue agrees with Circle; no funds or order tested. |
| `GET https://api.paycrest.io/v2/rates/solana/USDC/100/NGN?side=sell` | HTTP 200, application `status: success`; sell rate `1369.83`, provider IDs `YyPrHKaI`, `MKgxdEsQ`, `WYjUQLBk`; `orderType: regular`, `refundTimeoutMinutes: 2`. | Public indicative quote for this amount. Not an executable reservation, all-in net amount, rate guarantee or payout SLA. Two minutes is a returned refund parameter, not measured refund behavior. |
| Same quote with `&provider_id=YyPrHKaI` | First Python default User-Agent attempt: HTTP 403, `error code: 1010`. One recheck with `Mozilla/5.0`: HTTP 200, same rate, only `YyPrHKaI`. | Provider-pinned quote works for the second client. Cause of first edge denial not proven; no identity/access bypass or credentials used. |
| `GET https://api.paycrest.io/v2/markets` | HTTP 200; `data.asOf=2026-11-09T05:40:09.66768378Z`. **No Solana entries** in `data.book`; NGN/USDC sell entries on other networks. | Material discrepancy with quote/catalogue. Could be differing API coverage; do not infer funded Solana liquidity or treat provider-reported statistics as independently verified settlements. |
| `POST https://api.mainnet-beta.solana.com`, JSON-RPC `getAccountInfo` | HTTP 200; finalized slot `467203434`; Circle mainnet mint parsed as initialized SPL mint, decimals 6. | Public mainnet read works. No signing, transfer, fee payment or bank settlement. |
| Same method at `https://api.devnet.solana.com` | HTTP 200; finalized slot `520279520`; devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, initialized, decimals 6. | Public test-network read works. No devnet transfer was attempted. |

RPC request: `{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["<mint>",{"encoding":"jsonParsed","commitment":"finalized"}]}`. Both returned owner `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`; both expose freeze authority, so do not describe USDC as censorship-proof.

Reproducibility anchors (SHA-256 of original response bytes):

```text
Paycrest currencies 103d506bb627a08bf744cf37b164e65d001e91c42cb061a1b363126f688520e2
Paycrest tokens     3d1fc3527f3a5585ef0f6daa6ca18d332f20ed2e64d9146d63ad9b0d7e42a3c0
Solana sell quote   c49d5f1281ba546ccd47339281975c8346a95d913be953e8f9613711b9b5c9ba
Paycrest markets    640e1649604f6cb4b470b65a7e6fdb9ce74f20c3583bd12c4ca990c8e693e515
```

These are historical observations, not prices or availability to reuse at execution. Exact responses will change; hashes identify the observations, not future expected output. The selected quote payload is preserved below so the finding does not depend on temporary Cloud files:

```json
{"status":"success","message":"Rate fetched successfully","data":{"sell":{"rate":"1369.83","providerIds":["YyPrHKaI","MKgxdEsQ","WYjUQLBk"],"orderType":"regular","refundTimeoutMinutes":2}}}
```

## Access limits and alternatives

- **Mono:** free sandbox requests are documented, but require an app/key and use sample bank credentials [14]. No app/key or bank consent was available; neither sandbox nor a real bank connection was tested. Production business approval and plan/price confirmation are still needed [1,15]. Do not spend time writing an adapter before these gates resolve. Manual statement ingestion is proposed future work, not an existing tested feature.
- **Paystack:** documented collection mandates differ from payouts. AGUS cannot safely assume that collecting into its merchant account and forwarding funds is an approved personal-payments use case. Existing payout code does not implement direct debit. Obtain explicit product/use-case acceptance later, or keep payment completion with the user's bank/provider.
- **Bridge:** sandbox access requires contacting support for developer onboarding and then generating a key [16]; no such access exists in this task. Its sandbox simulates compliance/bank/blockchain behavior and cannot prove live service. No USD details were issued. Confirm customer residency/type, endorsements, ACH/wire sender restrictions, return handling, minimums, fees and the exact USD→Solana-USDC route before choosing it. Alternative: a user independently obtains an eligible receiving account and uses its own app; AGUS can later ingest statements without claiming API control.
- **Paycrest:** public catalogue/quote access is the strongest accessible conversion evidence, but order creation requires a Sender account, KYB and API key [17]. Its compliance page explicitly says Paycrest is **not a licensed financial institution** and assigns user KYC/KYB, sanctions and applicable regulatory obligations to senders [18]. Protocol escrow is not proof AGUS can avoid these duties. Resolve the Solana market/quote discrepancy and operational/legal allocation before a trial. If blocked, defer in-app conversion; use a separately onboarded provider experience only where its terms permit. Consider another native-USDC network only after actual provider support is established; do not add bridging to rescue an unproven route.
- **Other providers:** Yellow Card documentation retrieval at `https://docs.yellowcard.io/docs` failed with tunnel HTTP 403. Not integrated, tested, selected or repeatedly researched. No reason to build against inaccessible specifications in this task.
- **Regulatory limitation:** no conclusion that AGUS is licensed, exempt or approved. The CBN Open Banking Operational Guidelines PDF request at `https://www.cbn.gov.ng/Out/2023/PSMD/Operational%20Guidelines%20for%20Open%20Banking%20in%20Nigeria.pdf` returned HTTP 500; it was not used as supporting evidence. Provider documentation cannot establish AGUS's legal status. Verify current CBN/SEC requirements and the actual partner's authorization for the chosen activity before a live offering. Without a viable compliance arrangement at ₦0, postpone integrated execution.

## Recommended technical architecture — proposal, no code change

Retain the accepted application stack and add boundaries within a modular backend, not separate financial microservices. Recovery work determines the eventual integration baseline.

`conversation / persistent responsibility → typed intent → scoped capability lookup → read tool OR action proposal → deterministic policy + explicit approval → provider adapter → durable evidence/reconciliation`

Start with import/read capabilities. Later providers must declare environment, supported operations, country/customer eligibility, currencies/networks, funding source, consent requirements and evidence level. Missing capability is unavailable, never a silent fixture fallback. A recurring responsibility is a durable reminder/task with schedule, scope, expiry and audit trail; it is not a financial mandate.

| Boundary | Responsibility | Does not confer |
| --- | --- | --- |
| Existing bank | Owns fiat account, authenticates customer, executes supported bank instructions, supplies history/credit evidence. | Account-number knowledge does not grant debit authority. |
| Bank-data provider | Hosted consent/linking, scoped account-data retrieval/refresh/revocation. | Data permission does not authorize collections or payouts. |
| Wallet / signer | Owns keys or provides user-controlled signing; holds on-chain tokens, handles token accounts and SOL fees. | A wallet does not issue USD banking details, determine FX or credit a bank. AGUS must not hold seeds. |
| Receiving-account provider | Customer onboarding, banking details, accepted deposit rails, conversion/delivery, returns and compliance within its agreed service. | A deposit reference is not an AGUS bank account or guaranteed final stablecoin settlement. |
| Liquidity provider | Commits conversion price, limits and available fiat/token liquidity; fulfils payout obligations under its contract. | A token price/USDC balance is not funded NGN liquidity. AGUS should not become this provider. |
| Off-ramp / routing service | Validates route/recipient, coordinates order, funding/escrow, payout, status and refunds. May bundle an LP/PSP. | A routed order does not independently prove bank credit or outsource every sender obligation. |
| AGUS agent | Understands requests, recalls authorized facts, monitors duties, prepares proposals, explains evidence and failures. | Model output, memory, imported text and tools cannot mint permissions, approve payments or assert unobserved success. |
| Authorization / execution system | Server-derived owner/tenant, consent scopes, exact action approval, expiry/revocation, amount/fee limits, one-use execution and audit. | AGUS approval cannot replace a bank mandate, provider challenge or wallet signature. |

Keep bank accounts, provider balances, receiving-account deposits and wallet token balances distinct. A USD fiat claim and USDC are different assets with different risks. Store asset, network/mint, integer base units (NGN 2 decimals; native Solana USDC 6), source timestamps, evidence and owner. Use exact decimal arithmetic for rates; never floating-point money or a total spanning currencies without an explicit conversion basis.

For a future action, bind approval to source/funding authority, recipient/bank, asset/network/mint, amount, provider/route, quoted fees, minimum NGN received, quote expiry and refund destination. If actual create/funding terms differ, require renewed approval before sending funds. Providers that cannot support this sequence remain unavailable for unattended execution. Preserve provider OTP/mandates and user wallet confirmation.

Maintain separate states: proposed → approved → provider order created → funding observed/finalized → payout pending → provider-confirmed payout → independently observed bank credit; failures, unknowns, refunds and reversals remain explicit. No atomicity across fiat and chain legs. Persist references before side effects; signed webhooks enqueue reconciliation; ambiguous submissions are investigated using the same reference, never blindly resent. Reconcile chain evidence, provider order evidence and bank credit separately. No agent-run treasury, shared customer ledger, exchange order book or cross-chain infrastructure is needed.

## Authoritative sources read

All accessed 9 November 2026. Provider descriptions establish published contracts only unless paired with the observations above.

1. [Mono Connect overview](https://docs.mono.co/docs/financial-data/overview)
2. [Mono Payments overview](https://docs.mono.co/docs/payments/overview)
3. [Paystack Direct Debit](https://paystack.com/docs/payments/direct-debit/)
4. [Paystack Transfers lifecycle and prerequisites](https://paystack.com/docs/transfers/how-transfers-work/)
5. [Circle native USDC contract addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
6. [Solana transaction fees](https://solana.com/docs/core/fees), [token accounts and rent](https://solana.com/docs/tokens/basics/create-token-account)
7. [Bridge virtual accounts](https://apidocs.bridge.xyz/platform/orchestration/virtual_accounts/virtual-account)
8. [Bridge supported countries, risk classification and residence caveat](https://apidocs.bridge.xyz/platform/customers/compliance/supported-countries-list)
9. [Bridge Create Virtual Account contract](https://apidocs.bridge.xyz/api-reference/virtual-accounts/create-a-virtual-account)
10. [Paycrest supported tokens/networks](https://docs.paycrest.io/resources/supported-stablecoins)
11. [Paycrest public rates contract](https://docs.paycrest.io/api-reference/general/get-token-rate)
12. [Paycrest public markets contract](https://docs.paycrest.io/api-reference/general/get-markets)
13. [Paycrest routing, LPs and local payouts](https://docs.paycrest.io/introduction)
14. [Mono sandbox: free sample-data requests](https://docs.mono.co/docs/sandbox)
15. [Mono production checklist](https://docs.mono.co/docs/go-live), [coverage](https://docs.mono.co/docs/coverage) (aggregate coverage is not proof for a particular bank)
16. [Bridge sandbox access and simulation limits](https://apidocs.bridge.xyz/get-started/introduction/quick-start/setting-up-sandbox)
17. [Paycrest Sender prerequisites](https://docs.paycrest.io/quickstart), [integration and funding flow](https://docs.paycrest.io/implementation-guides/sender-api-integration)
18. [Paycrest compliance allocation and fees](https://docs.paycrest.io/concepts/compliance-security)
