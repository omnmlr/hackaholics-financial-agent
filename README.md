# AGUS

## AGUS Crypto · Dev3pack Global Hackathon

AGUS Crypto is the Android-first Solana wallet workspace in development. It builds on the earlier AGUS financial agent described below. Before the 27 November kickoff, the Crypto branch already contained wallet registration, Devnet portfolio and transfers, alerts, receipt reconciliation and the Android test harness. This branch also records pre-event work on Gemini image understanding, ElevenLabs voice, Firecrawl research and the release infrastructure. Record new work from 27–29 November in the submission's README section with commit and verifiable demo references. [Crypto pull request](https://github.com/omnmlr/hackaholics-financial-agent/pull/52) · [Pre-event implementation evidence](docs/agus-crypto/IMPLEMENTATION.md) · [Submission requirements](docs/agus-crypto/DEV3PACK_SUBMISSION.md)

**Your money, and what's next.**

AGUS is a personal AI financial agent that turns natural-language requests into financial responsibilities, payment requests, and owner-reviewed actions. It understands English and Nigerian Pidgin, keeps useful context across conversations, and brings privacy-focused Zcash receiving and Stellar Testnet USDC workflows into one interface.

**[Launch AGUS](https://agusweb.up.railway.app)** · [Current source code](https://github.com/omnmlr/hackaholics-financial-agent/tree/implementation/agus-counterpart-20261114) · [Zcash transaction evidence](https://github.com/omnmlr/hackaholics-financial-agent/blob/implementation/agus-counterpart-20261114/docs/zcash-native/README.md)

## Try the live application

The hosted evaluation workspace is available to hackathon judges and visitors. **No username, signup, installation, or personal wallet is required to explore it.**

| | |
| --- | --- |
| **Website** | https://agusweb.up.railway.app |
| **Demo password** | `AgusJudge-Z-iz9gIIJIYYjaACjLA1EkXP` |
| **Login field** | `Operator password` |
| **Network** | Testnet; no mainnet payments |

Open the website, enter the demo password in **Operator password**, and select **Sign in securely**.

This is a **shared evaluation workspace**, not a personal account. Other visitors may create test reminders or payment requests, so existing demo data can change. Do not enter private financial information, recovery phrases, or real wallet credentials.

## A two-minute tour

1. **Talk to AGUS.** Select **AGUS** and try: *“Abeg, remind me tomorrow say Ada dey owe me 5 USDC.”* AGUS can interpret Pidgin and prepare a responsibility for review; it does not silently approve it.
2. **Explore Zcash receiving.** Ask: *“Create a private Zcash Testnet invoice for 0.1 ZEC from Demo Payer, titled Judge Live Demo.”* Open the resulting invoice in **Obligations** to see the wallet-generated receiving address and ZIP-321 payment QR. A newly created invoice is **unpaid until actual wallet evidence confirms it**.
3. **See a verified shielded payment.** In **Obligations**, open **Orchard shielded receiving demo**. This existing example records a genuine **0.1 Testnet ZEC** receipt. The receiving wallet decrypted and matched the private payment; AGUS settled the invoice and completed its related responsibility after three blockchain confirmations.
4. **Explore USDC.** Open **Money** to find the Pollar-powered Stellar Testnet wallet integration and owner-reviewed payment preparation. A configured SDK is not proof of a settled USDC transfer.

## Zcash: private payment requests with real verification

AGUS uses a server-side native Zcash Testnet receiving wallet based on **zaw / librustzcash**. The AI can create a receivable invoice from conversation, while the trusted wallet allocates a fresh **Orchard Unified receiving address**. AGUS generates a **ZIP-321** payment request with a QR code.

When the correct amount of ZEC arrives, the receiving wallet—not Gemini and not a public transaction explorer—detects and decrypts the shielded note. At the required confirmations, AGUS updates the invoice and its associated reminder.

**Verified end-to-end Testnet receipt:**

| Evidence | Result |
| --- | --- |
| Amount | **0.1 ZEC** (10,000,000 zatoshis) |
| Transaction | `f6dfa6acf602b2f6b936123c0abc8fa4a8b8c99359e1180f7e675f5dd154d082` |
| Mined height | **4,618,878** |
| Settlement | **3 confirmations** |
| Application result | **Invoice settled; related reminder completed** |

[See the native-wallet acceptance report, receipt evidence, and browser captures](https://github.com/omnmlr/hackaholics-financial-agent/blob/implementation/agus-counterpart-20261114/docs/zcash-native/README.md).

**Current boundary:** shielded **receiving is implemented and tested**; **outgoing ZEC signing and sending are not available** in AGUS. The AI does not hold wallet signing keys. Receiving privacy also depends on the paying wallet actually making a shielded payment.

## Other capabilities

- **Gemini personal agent:** conversation, function calling, Nigerian Pidgin, and persistent reminders and financial context.
- **Owner-reviewed actions:** the agent prepares structured work; consequential payment actions remain subject to explicit user authorization.
- **Pollar / Stellar Testnet:** official Pollar SDK integration, wallet onboarding and USDC payment review. A successful end-to-end owner-signed USDC transfer has **not** been claimed.
- **Financial workspace:** obligations, invoices, activity, account records and financial summaries. **Live Nigerian bank connectivity is not yet available.**

AGUS is a working hackathon application with tested capabilities and clear technical limitations, **not a production-ready bank or a mainnet payment service**.

## Source, architecture and reproducibility

The implementation in **this branch** is the current AGUS application deployed to Railway. Older Hackaholics prototype material remains available in the repository's historical branches.

- [Verified Zcash receiving and settlement](https://github.com/omnmlr/hackaholics-financial-agent/blob/implementation/agus-counterpart-20261114/docs/zcash-native/README.md)
- [Native receiving service and security boundary](https://github.com/omnmlr/hackaholics-financial-agent/blob/implementation/agus-counterpart-20261114/services/zcash-receiving/README.md)
- [Outgoing ZEC signing assessment](https://github.com/omnmlr/hackaholics-financial-agent/blob/implementation/agus-counterpart-20261114/docs/zcash-native/OUTGOING-ASSESSMENT.md)
- [Release checks and browser evidence](https://github.com/omnmlr/hackaholics-financial-agent/blob/implementation/agus-counterpart-20261114/docs/release-pass/README.md)

For local development, use the implementation branch, Node.js and the provided `.env.example`; run `npm ci`, configure your own environment and local operator password, then `npm run dev`. No private wallet credentials or production secrets are included in this repository.

---

**AGUS — Your money, and what's next.**
