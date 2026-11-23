# Product differentiation

**Focus on Solana-first freelancers and small creator teams paid in stablecoins several times a month.** Focus on people who already use more than one wallet, deal with repeat clients, and need to identify which request a payment settles. Their recurring problem is knowing who paid, which wallet received it, and what can be spent. Willingness to pay is a hypothesis.

| Segment | What they do now | Pain worth solving | Retention and willingness to pay |
| --- | --- | --- | --- |
| Ordinary multi-wallet Solana users | Open Phantom/Solflare/Backpack, use explorers and dashboard or tax tools. | Duplicate or missing balances, obscure transactions, no clear explanation for transfers between their own wallets. | Strong acquisition from a free wallet view. Some repeat use for alerts and investigation. Low likely willingness to pay for balances and basic chat in isolation. |
| **Freelancers and creators receiving stablecoins** | Send an address or QR, chase payment over messages, check explorer, log receipts in a spreadsheet or use Request Finance/MoonPay Commerce. | Wrong wallet/mint/amount, unclear payment-to-invoice match, little evidence for a client dispute, fragmented monthly records. | Natural repeat loop tied to invoices and client follow-ups. Test payment for accurate reconciliation, receipts and exports. Basic invoice creation has free competitors. |
| Businesses and power users | Request Finance, Squads, accounting tools, dedicated data pipelines or agent wallets. | Multiple signers, spend policies, bookkeeping and recurring settlement. Accountants need evidence of approval, failed and pending operations. | Higher potential contract and usage value. Reliability, approval controls, integrations, support and legal requirements raise the sales and implementation cost. Treat as an expansion segment. |

[Request Finance plans](https://www.requestfinance.com/pricing) · [MoonPay Commerce](https://dev.commerce.moonpay.com/docs/for-creators) · [Squads](https://github.com/Squads-Protocol/v4)

## The repeat workflow

**Ask what is outstanding → request USDC into an existing wallet → verify the payment → issue a receipt → explain the change → spend or set aside a small amount in Pocket.**

A payment request and receipt are valuable because they share the same verified record. A user can ask “Did James pay?” and open the invoice and matching transaction. “Why did this wallet balance increase?” should show the ledger entries, validated transfer amounts and the reason an internal transfer did not change overall holdings. Provide a partial-coverage label when the ledger, token accounts, protocol positions or valuation snapshots are incomplete. Keep off-chain invoice details private and avoid putting personal names in a public memo.

| Capability | Role in the first useful experience |
| --- | --- |
| Multi-wallet balances and activity | Foundation. Include SOL, a verified classic USDC mint for the intended network and incoming token-account signatures. Deduplicate derived accounts and representations of the same owner. Coverage and freshness matter more than asset count. |
| Conversational investigation | Differentiator when backed by transaction and invoice references. Start with what changed, who paid, which wallet, and a simple period summary. An ungrounded crypto chat competes with free chat and gives false confidence. |
| Invoices, QR codes, collection | Anchor. Make a standard link and QR for one supported mint and receiver. The payer can use their own compatible wallet, without an AGUS account. Verify the transfer before crediting a receipt. |
| Reconciliation, receipts and reports | Core retention and revenue surface. Match exact chain, mint, recipient, reference, amount and execution. Surface underpayment, duplicate events and manual exceptions. Begin with one receipt and a simple export. |
| Financial monitoring | Useful when tied to outstanding payments or meaningful changes. Use triggered follow-ups, with configurable frequency. Avoid broad notifications that add noise. |
| Pocket spending | Optional extension after a verified receipt and after Android acceptance. Keep an explicit “External” and “Pocket” balance. Pocket gives a reason to return for controlled spending. It adds limited value if its only feature is another transfer screen. |
| Restricted automation | Follow the fiduciary workflow. Start with reminders and owner-approved drafts. Pilot allowlisted merchant pulls or a bounded Pocket payout after policy, audit and recovery gates. |
| Cross-chain swaps, yield, perps, voice-first, broad positions | Defer for the submission. They expand signer and data paths and do little to prove the invoice loop. Price-only snapshots and generic chat are commodities. |

[Solana Pay specification and SDK](https://github.com/solana-foundation/pay) · [Solana token account RPC](https://solana.com/docs/rpc/http/gettokenaccountsbyowner)

## What competitors already cover

- **HeyElsa** covers conversational trading, portfolio workflows and linked/embedded wallet choice. AGUS should compete on verifiable payment records and multi-wallet reconciliation. Public portfolio and trading claims do not establish equivalent invoice matching. [HeyElsa guide](https://docs.heyelsa.ai/a-field-guide-to-heyelsa)
- **Bankr** offers a provider wallet and paid agent APIs, execution and token-launch rails. Its controls and pay-per-use model set expectations for transparency. AGUS users bring their wallet and give each operation or grant an auditable policy. [Bankr overview](https://docs.bankr.bot/docs/getting-started/overview.md) · [Bankr API](https://docs.bankr.bot/docs/wallet-api/overview.md)
- **Agentic** already demonstrates existing-wallet routing and an approval inbox. Multi-wallet wallet routing alone is a technical capability. AGUS differentiation depends on attributing a payment to the right invoice and explaining it in context. [Agentic source and available tools](https://github.com/mstevens843/solana-agent-wallet-adapter/blob/f00f17f8283c1fca259cefc5d402ef07b463b899/packages/mcp-server/README.md)
- **Wallets and billing platforms** already excel at sending, signing or generating invoices. AGUS should keep existing-wallet custody, make incoming events understandable across wallets and give customers a reason to return when the next payment is due. [Request Finance](https://www.requestfinance.com/pricing) · [Phantom app connections](https://docs.phantom.com/solana/establishing-a-connection)

Test demand with 10–15 freelancers who receive repeat Solana USDC. Ask them to bring de-identified examples of hard-to-match payments, run two billing cycles, and offer one clearly priced reconciled receipt/export product. Measure activation to verified invoice, manual exception frequency, time saved, second-cycle return and how many actually pay. Reserve an onboarding cohort with Pocket disabled to determine whether it drives retention or adds drop-off. Usage and pricing validation are still open. [Business scenarios](BUSINESS_MODEL.md)
