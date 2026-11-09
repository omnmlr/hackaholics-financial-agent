# Paystack Index — official consumer-agent evidence

Read-only public-page investigation, 9 November 2026. **No account registration, authorization, MCP tool call, financial API call or transaction was performed in this lane.** Public descriptions below are documented behavior, not tested payment operation.

## Identity and actual supported consumer mechanism

[Zap Terms §15.1](https://joinzap.com/terms#connections) explicitly contemplate Paystack-approved AI agents accessing information and initiating transactions within user-granted permissions. Its definition of **Index** is the **“Paystack Index MCP server and accompanying web app”**, not an unrelated third-party company. Permission for a product category does not mean AGUS is approved.

`https://paystack.com/index` redirects to the live public homepage at [index.paystack.com](https://index.paystack.com/). It advertises Nigerian airtime, food and **“Send money using Zap”**, including “Send ₦5,000 to a friend.” These are stronger official clues than a generic merchant API; the support pages explain the actual consumer path:

| Question | Official answer / effect on AGUS |
| --- | --- |
| How does a consumer enroll? | [Getting started](https://index.paystack.com/legal/support/getting-started): email signup, **account approval**, then agent connection; a **linked Zap account** is required for purchases. Example: “Send ₦10,000 to [account] at GTBank.” |
| Is any custom agent approved? | [Supported agents](https://index.paystack.com/legal/support/supported-agents): launch support is **Claude, ChatGPT and OpenClaw**. “What about other agents?” → **“Not supported at launch.”** Expansion requests are invited. Public client-registration metadata cannot by itself establish AGUS's approved integration status. |
| What authorizes tools? | [Index Terms §14](https://index.paystack.com/legal/terms): **Connect/Connection is the OAuth authorization flow giving an agent permission to call Index tools.** §2 describes delegated tokens, MCP permissions and account controls; user authority can be revoked prospectively. |
| What source funds a bank transfer? | [Transfers and Zap](https://index.paystack.com/legal/support/transfers-and-zap): **“Transfers go directly from your Zap balance.”** The consumer must link Zap. This page does not describe selecting/debiting an arbitrary existing external bank account for each Index transfer. |
| What is user approval? | Same page: by default a **WhatsApp message displays recipient, bank and amount**, with Yes/Decline. Request expires after **10 minutes**, with no Zap balance debit if it expires. These are provider descriptions; no approval was triggered or tested. |
| Limits / fees? | Same page: **₦50,000 per transfer**; published tier daily limits apply. **Zap may charge a transfer fee**; amount plus fee is displayed before approval. This is not proof of fee parity with a user's equivalent external-bank transfer. |
| What reads are documented? | [Privacy Notice §4](https://index.paystack.com/legal/privacy): read the **Zap balance on Index**, initiate permitted transactions, read **recent activity**. These are not a 20-bank external-account balance/history contract. |

## Important restrictions and documentation conflict

[Index Terms](https://index.paystack.com/legal/terms) mark the product **beta**, effective 3 June 2026, updated 24 June 2026, and 18+. The terms say the user configures limits and approval requirements, accepts agent actions within granted permissions, and must not share PIN/authentication credentials with an agent. Index may rely on authenticated agent instructions without separately checking the user's intent on every transaction. AGUS therefore still needs its own deterministic execution controls even if the provider delegates capability.

There is a material scope mismatch to resolve: **Terms §4 describes a restricted-purpose merchant ecosystem and says “No general-purpose payments.”** The homepage, privacy notice and transfer support page explicitly describe sending money/bank transfers via Zap. This could reflect differing product versions or a specific permitted Zap integration, but the inspected documents do not resolve it. Do not infer legal permission for arbitrary P2P use solely from marketing or reinterpret the restriction without provider clarification.

The Privacy Notice says actual money moves from **Zap balance**, transaction/top-up history is recorded, and banking/card credentials go directly to a hosted Paystack page rather than Index. The public login page uses email OTP; it was viewed but no email was supplied. There is no documented free money-moving sandbox in these pages.

## What this changes, and what it does not establish

This is concrete official evidence that consumer AI-to-payment delegation, OAuth, exact-transfer approval and subsequent bank payout exist as a published Paystack product proposition. It is **not** the old business Paystack Transfers API, nor merely a speculative agent diagram.

It does **not yet** meet AGUS's full requirement: the documented source is Zap balance; source-bank account reads are not documented here; AGUS custom-client eligibility is not established; twenty existing personal source banks and normal-bank fee parity are unverified. Another research lane handles the actual public MCP metadata/SDK and any explicitly permitted protocol experiment. This page investigation does not claim authenticated API or bank access.

The next evidence needed is precise: Paystack confirms AGUS/custom-client admission and intended transfer use; identifies whether Index can use a **selected linked external source account** rather than only Zap balance; supplies supported source-bank/account/read capabilities and fee terms; resolves §4 against transfer support; and provides an authorized no-funds test route or explicit live validation scope.

## Preservation anchors

SHA-256 of original public response bytes retrieved by this lane (dynamic markup may vary):

```text
joinzap.com/terms                         d78705a86970ec0772c7a22a361e3019343ee99685b910be3f9382921cca5853
index.paystack.com/                       72bb4a36e04d1af1ff9faa2e2b1477133494c17d64413e0523a05e44f266766c
index.paystack.com/legal/terms            8cdb9d6ab01328f5238af4267523b28ef95470d8680b5bedcb25e9b3fb539758
index.paystack.com/legal/privacy          d2c2cb86ec782634149039ee66b3faf75dee5c36bfdd51c9fdbc524320589670
```

No private client bundle/API investigation, registration, customer contact or credential use occurred. Public GitHub searches did not locate an official Index source repository; that search result is not evidence that none exists privately.
