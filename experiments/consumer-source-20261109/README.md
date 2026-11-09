# Consumer source-authority experiments

9 November 2026. **Banking connectivity is not solved.** This checkpoint contains executable probes and actual remote observations, without changing AGUS or building unavailable private-API adapters. Original requirements, including 20 existing personal source banks and normal-bank fee parity, remain intact.

## New operational interface found: Paystack Index

An actual consumer-agent MCP service exists at `https://mcp.paystack.africa`. This is distinct from Paystack's merchant-key MCP wrappers and the previous generic sponsor proposal. We followed public implementation evidence to that service and verified its advertised official site and public OAuth metadata. [Exact server/metadata bytes](zap/server.json), [OAuth metadata](zap/oauth-metadata.json), [source provenance](zap/source-manifest.json).

Built [index_admission.py](zap/index_admission.py), a standalone standard-library client that performs **only six fixed public GETs**. One real run retrieved HTTP 200 for the server, authorization metadata and four official policy/support pages. [Actual sanitized result](zap/actual-index-admission.json). It established:

- The live service identifies itself as `paystack-index-mcp`, version `0.0.1`.
- Actual metadata advertises authorization-code/refresh/client-credentials grants, S256 PKCE, scope `mcp:transact`, and a registration endpoint. No inferred endpoints, test bank or local protocol simulator were substituted.
- Official support explicitly names Claude, ChatGPT and OpenClaw as supported launch agents and says other agents are **not supported at launch**. An advertised registration endpoint is not AGUS approval. No registration or token request was made to Index.
- Official transfer support says funds come **directly from Zap balance**. Privacy describes Zap balance/recent activity, not general balances/history of 20 existing banks. Exact approval is documented via WhatsApp, with expiry/limits; it was not triggered.
- Index terms §4 prohibit general-purpose payments while its current support describes bank transfers. The permitted P2P scope requires provider clarification, not our reinterpretation.

Reproduce the public observation; it requires no keys or accounts:

```sh
python experiments/consumer-source-20261109/zap/index_admission.py --live --output /tmp/index-admission.json
```

Omit `--live` for zero-network mode. The program cannot register a client, authorize a user, exchange a token, call an MCP tool, read an account or execute a transfer. Metadata discovery succeeds; **authenticated MCP integration and banking access were not established**. A zero exit code means the observation program ran, not that AGUS has banking access.

Using Index inside a genuinely supported host could avoid a separate custom-client implementation, subject to that host's/provider's terms and actual user approval. It cannot expand Index's source/data capabilities. Do not impersonate an approved client's identity or expose its customer tokens to AGUS. No supported-host installation, connection or customer-account use was attempted here.

## Costs and source mechanics independently checked

[Zap's current FAQ](https://joinzap.com/faq) says connected Nigerian accounts use **NIBSS Direct Debit**, and describes topping up Zap wallet from linked accounts. Linking a funding account does not establish an external-bank account-history API or prove that Index can select it as the immediate transfer source.

[Official Zap fee article](https://zapsupport.frontkb.com/en/articles/2563266), edited 4 March 2026, lists **N35 per transfer from a linked account** and **N10 from Zap balance** across its three amount bands. Original response SHA-256: `ff53c5675c03bb27b447b41814718f78c90cc612a6ccce3a99fa66afa0ba3290`. This is Zap's published schedule, **not a measured Index quote**. It establishes neither parity with a specific source bank nor free funding/API/infrastructure. Do not invent a fee waiver or use wallet funding to conceal another cost.

Zone's current public site/developer page was also checked as a different network mechanism: it describes institutional integration/UAT, POS/ATM products and labels ZoneFT **Coming Soon**. It supplied no permitted consumer-source/read sandbox for this experiment. No network/node was deployed. The new payment-network lead did not eliminate source-bank authority. [Official developer page](https://zonenetwork.com/developers).

## Real permitted Remita sandbox attempt

[admission_probe.py](remita/admission_probe.py) made **one authentication POST** to the exact documented demo token endpoint, using only an official SDK example explicitly labelled Sample Demo Code and `EnvironmentConfig.TEST`. No guessed/private credential was used. [Actual output](remita/actual-output.json): HTTP 200, 41-byte JSON, `status`/`message` keys, **no token**. Exact message values were not retained, so the provider's precise rejection/non-admission reason remains unknown. No retry or bank API call followed.

The executable defaults to zero network; [permission provenance, guards and reproduction](remita/README.md). The current Remita REST product requires an invitation and issued Secret Key. A merchant engine token would still not establish consumer source consent or history access. This result rules out treating that published sample as working developer admission today; it does not prove every legitimate Remita sandbox is unavailable.

The second narrow hypothesis—PayAttitude consumer delegation through its additional public CIPA integration—remained merchant-scoped and required issued merchant configuration. [Exact issued object and stopping reason](payattitude/README.md). No duplicate merchant prototype was built.

## Requirements and exact next dependency

| AGUS requirement | Result established in this task |
| --- | --- |
| Verified 18+ user | Index publishes an 18+ requirement; no person onboarded/verified. |
| Existing personal bank linking | Zap documents bank linking; no account linked or AGUS source grant obtained. |
| External-bank available balances/general history | No qualifying interface demonstrated. Documented Index reads concern Zap. |
| Arbitrary authorized source-bank transfer | No consumer source/payment grant or authorized AGUS integration obtained; no financial operation attempted. |
| Verifiable financial outcomes | Documented approval/status mechanism only; no transaction outcome generated. |
| 20 common existing source banks | Zero independently qualified by these experiments. No recipient list counted as sources. |
| No extra user charges | No AGUS fee added; actual bank-equivalent total-cost parity and its funding remain unestablished. |

**Do not build a 20-bank adapter against Index's wallet interface.** The new concrete admission owner is Paystack's **Index/Zap product team** (`index@paystack.com`, published on its support page). No contact was sent. The smallest next useful artifact is not generic partnership approval: it is confirmation and a designated no-funds developer fixture for (1) an approved AGUS client or legitimate supported-host integration, (2) a customer-authorized **selected existing bank** grant permitting available balance, general history and intended beneficiary payment, with operation-specific bank coverage, and (3) all-in fees. Index OAuth client admission, a delegated Index user connection and the underlying bank-source mandate are separate objects.

If Paystack confirms the public Zap-balance scope is the only available one, Index is not the required banking backend. Choosing another bank/participant can avoid Paystack-specific client approval, but cannot avoid that source institution's accepted customer delegation. No code we generate can issue a valid bank grant on that bank's behalf. After a real interface/role is supplied, the next engineering action is a source-grant/read conformance test with designated fixtures, followed by approval/reconciliation integration; **not** speculative payment code or real customer testing now.

Stopped at that boundary. No spending, customer data, protected bank calls, production changes, deployment, recovery or browser-automation work. Solana USDC/USD commitments remain unchanged. Initial experiment milestone `a0842c5e4b53d4f91667e4c9de01047ef5d60a36` was pushed and remote SHA verified; Index discovery follows on the same isolated experimental branch.
