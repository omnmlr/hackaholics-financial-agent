# Paystack Index / Zap: actual public implementation discovery

Observed 9 November 2026. This lane made public HTTP GET requests only. **No client registration, human registration, MCP method, token request, bank call or financial operation was performed.** Root owns any subsequent authorized client-registration experiment.

## What materially changes the options

Index is an operational MCP/OAuth service with an official Paystack product page, not merely a hypothetical interpretation of Zap's agent terms. Public discovery returned actual metadata:

| Request | Actual result |
| --- | --- |
| `GET https://mcp.paystack.africa/` | HTTP 200: `name=paystack-index-mcp`, `version=0.0.1`, `status=ok`, `docs=https://index.paystack.com`. Exact original bytes: [server.json](server.json). |
| `GET https://mcp.paystack.africa/.well-known/oauth-authorization-server` | HTTP 200: issuer `https://mcp.paystack.africa`; authorization endpoint `https://index.paystack.com/oauth/authorize`; token endpoint `https://mcp.paystack.africa/oauth/token`; advertised registration endpoint `https://mcp.paystack.africa/oauth/register`. Exact bytes: [oauth-metadata.json](oauth-metadata.json). |
| `GET https://index.paystack.com` (advertised docs URL) | HTTP 200, official product site: “The AI-native commerce index for Africa”, Nigeria Live, “Works in OpenClaw”, “Send money using Zap”, Chowdeck and airtime. Public Get early access / Sign in links. |
| Standard public resource discovery `GET https://mcp.paystack.africa/.well-known/oauth-protected-resource/mcp` | HTTP 404. Only this path was tested; this does not negate successful authorization-server discovery or prove that no protected-resource metadata exists elsewhere. |

The public authorization metadata advertises `authorization_code`, `refresh_token`, `client_credentials`, response type `code`, PKCE **S256**, authentication methods `client_secret_post`, `client_secret_basic`, `none`, and scope **`mcp:transact`**. It does not publish bank-balance/history scopes or describe the internal source-account grant. An advertised registration endpoint is not permission for an unsupported custom agent. The subsequently inspected [supported-agents policy](https://index.paystack.com/legal/support/supported-agents) limits launch support to Claude, ChatGPT and OpenClaw, and says other agents are not supported at launch. **No AGUS registration was attempted; obtain explicit eligibility rather than testing whether an advertised endpoint will bypass that policy.**

[Source URLs, hashes and retrieval results](source-manifest.json) preserve these observations. The metadata contains no secret or user data. Reproduction of discovery alone requires only the two GET URLs above; no financial method is needed.

## Discovery trail and real code

A genuinely relevant third-party implementation is [bolexyro/paystack-index-chowdeck-ui at `176a9a536bf591d286807130f4abd00798bdd0fc`](https://github.com/bolexyro/paystack-index-chowdeck-ui/tree/176a9a536bf591d286807130f4abd00798bdd0fc). Its README and `.env.example` identify the live MCP/token URLs, require an Index dashboard-issued client pair, and describe client-credentials scope `mcp:transact`. It implements Chowdeck phone/OTP connection, order preview, confirmation and tracking. This supplied the exact public service origin; no private bank endpoint guessing was needed.

This independent repo is evidence of an inspectable Index client pattern, **not independently verified operational transactions or an official security design**. In particular, its suggested unauthenticated public tunnel exposes its adapter; AGUS should not copy that exposure pattern or conflate machine client credentials with a human customer's bank consent.

Two similarly named implementations do **not** establish the desired consumer grant:

- Official [PaystackHQ/paystack-sdk-ios at `28059ae17e95838baeb8868ce3807a5a61c77b3d`](https://github.com/PaystackHQ/paystack-sdk-ios/tree/28059ae17e95838baeb8868ce3807a5a61c77b3d) contains actual `Sources/PaystackSDK/API/Charge/Zap.swift` and Zap view-model code. `initiateZapMandate` uses a supported-bank entry, merchant transaction ID/access-code context and customer email; it returns a Zap deep link/QR and Pusher status channel. This is real code for **merchant checkout authorization**, not a public API for AGUS to read linked accounts or send arbitrary personal transfers. It was inspected, not run.
- [PaystackOSS/paystack-mcp-server](https://github.com/PaystackOSS/paystack-mcp-server) README requires a `sk_test_` merchant API key and describes wrapping Paystack APIs. It is distinct from the consumer-facing Index OAuth service. Running that wrapper cannot establish a Zap customer's source authority.

## Official connection/admission evidence

The Index landing page's linked [login](https://index.paystack.com/login) requires a human email sign-in code. Its linked [signup](https://index.paystack.com/signup) asks name, email, phone and Nigerian residence. These pages were read, but no form or email request was submitted.

[Official support page](https://index.paystack.com/legal/support) explicitly lists “Getting started: Signing up, connecting your agent, and your first requests”, supported agents, and “Transfers and Zap: Sending money, approvals, limits, and fees”. It publishes `index@paystack.com`. This establishes a concrete product/support owner; no contact message was sent. The public page did not expose a step-by-step developer sandbox or a source-enrolment fixture.

Next issued objects remain distinct: OAuth **client admission**, a **human's delegated Index grant**, and any **Zap connection/source-bank mandate** enabling a particular action. Client credentials alone do not establish the latter two. No customer-scope token or test source fixture was obtained in this lane.

## Material legal/product mismatch to resolve

[Official Index terms](https://index.paystack.com/legal/terms), effective 3 June and last updated 24 June 2026, identify Paystack Payments Limited and a beta product. They permit user-authorized agent activities and discuss delegated tokens/MCP permissions, per-tool consent-screen limits, revocation and audit records. They require users to be at least 18.

But §4 calls Index a **restricted-purpose payment facility for participating Paystack merchants**, says it is **not intended for general-purpose payments**, and limits it to the merchant ecosystem. That wording sits alongside the current landing page's “Send money using Zap” claim and Zap's agent-connection terms. Do not hide this mismatch or declare arbitrary personal-bank P2P authorized from metadata. Obtain clarification on whether an approved Zap transfer tool is enabled as a separately governed service, which exact source it uses, its fees and read scopes. Root's broader analysis owns those product/coverage/tariff conclusions.

**Current result:** actual public OAuth discovery works. Official support/privacy additionally establish that the documented transfer source and reads are Zap balance/recent activity, not 20 external-bank sources/history. Custom-agent eligibility and the required bank-source capabilities must be explicitly established before a client-admission experiment is useful. No consumer bank connection, bank history, transfer or 20-bank coverage was demonstrated. No sandbox mode is advertised in the discovered metadata; do not invent a sandbox URL or call value-moving tools to explore it.
