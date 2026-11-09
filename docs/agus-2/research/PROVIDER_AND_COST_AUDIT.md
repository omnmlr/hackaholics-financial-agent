# Additional provider and cost investigation

Date: 9 November 2026. Public documentation and code inspection only. No provider account, key, bank session or financial operation was used. This lane tested whether alternative unified APIs materially change the source-bank and price constraints, rather than repeating the earlier Mono/Paystack feature summary.

## Stitch: source coverage differs from a shared bank enum

The current published GraphQL surface contains substantive financial-data and user-authorized-payment contracts. But inspecting the **payer-specific** type changes how its Nigerian bank names should be interpreted:

- [`BankId`](https://docs.stitch.money/api/enums/bank-id) includes `access_bank`, `first_bank_of_nigeria`, `gtbank`, `gtbank_mobile`, `providus_bank`, `sterling_bank`, `united_bank_for_africa`, `vfd_microfinance_bank`, `wema_bank`, `zenith_bank`. These are ten IDs for nine distinct Nigerian institutions; GTBank mobile is not a second bank. This broad shared enum is not a live source-bank coverage table.
- [`PayerBankId`](https://docs.stitch.money/api/enums/payer-bank-id), explicitly described as **“The banks which a user can link or pay from”**, lists `absa`, `african_bank`, `capitec`, `discovery_bank`, `investec`, `fnb`, `nedbank`, `standard_bank`, `tymebank`. No Nigerian ID appears in that inspected type. This is a concrete reason not to count the broader enum as Nigerian source support. It is not proof that no private/other Stitch product supports Nigeria.
- [`userPaymentInitiationRequestCreate`](https://docs.stitch.money/api/mutations/user-payment-initiation-request-create) is deprecated in favour of `userInitiatePayment`. Its old input contains a beneficiary, but [`UserInitiatePaymentInput`](https://docs.stitch.money/api/inputs/user-initiate-payment-input) has amount, references, merchant and payer information, without a freely selected beneficiary. That can reflect previously authorized payment context; it cannot be treated as arbitrary consumer-P2P permission without the current consent contract.
- The current [Pay By Bank guide](https://docs.stitch.money/payment-products/payins/paybybank/introduction) describes a hosted redirect handling bank selection/authentication and merchant payment completion, with Capitec Pay, Absa Pay and PayShap examples. Good reusable flow; no evidence here of 20 Nigerian personal debit sources, general P2P permission or normal-bank-fee parity.

**Disposition:** serious provider mechanism, but the published source-specific evidence does not establish the AGUS launch requirement. No private API probes were warranted. Reconsider only with a current Nigerian source/consent/use-case schedule and commercial terms, not a bank-code list.

Source-byte SHA-256 anchors: `BankId` `e0ea3271670a15219a3a39c28784fec5d526ab9c098e8cc48c5356bf2c32b171`; `PayerBankId` `2685fb58e891e09023616055da005ca6323b4de9899a0f043897e978d3e796c2`; `UserInitiatePaymentInput` `fa3e4a7616fb6595deb97782a07035c3dde23e0dadfda5570dcf33cf8adddc63`. HTTP 200 establishes public schema retrieval only.

## OnePipe: actual collection code, not an undiscovered direct-P2P connector

The [current OnePipe institutional site](https://us.onepipe.com/) describes deployments with Fidelity (A2A payments), Polaris (banking APIs) and UBA (virtual accounts). This supports a bank-partner middleware approach as an institutional precedent; it is the vendor's description, not independently verified AGUS access or a 20-source-bank service.

The same site explicitly defines **Collect** as payments out of a customer's account **into yours**, and **Disburse** as payments out of **your account** into a customer's. It separately lists balance/statement functions. Examples use `Demoprovider` and mixed `mock_mode` values; they do not establish real coverage or authority, even when a sample says `live`. No example credentials were used.

Inspected real payment code in the WordPress.org mirror [`common-repository/onepipe-payment-gateway-for-woocommerce`](https://github.com/common-repository/onepipe-payment-gateway-for-woocommerce/blob/7db3960e81f31ead346b2291356eba36825b5d5a/woo-onepipe.php), SHA `7db3960e81f31ead346b2291356eba36825b5d5a`. `process_payment` constructs `request_type: collect`, order amount, customer and checkout options; it does not nominate an arbitrary personal beneficiary. The callback verifies the merchant order. The mirror is evidence of implementation shape, not an official/current personal-banking SDK or a dependency recommendation.

**Disposition:** credible bank-side infrastructure/sponsorship lead, not evidence that combining merchant collection with disbursement satisfies direct personal-account funding, liability or fee parity. An existing partner bank's API monetization agreement must not be generalized to 20 banks. Public signup/free-source claims do not establish free production use. The old docs hostname redirected to a WordPress signup page; current private contracts were not available.

## New concrete pricing evidence

[Mono's current pricing page](https://mono.co/pricing), retrieved HTTP 200, publishes a **one-time 30-day trial capped at five unique accounts monthly**, a Basic financial-data plan at **NGN 50,000 monthly** capped at 100 accounts, and real-time sync at **N100 per call**. These are observed published plan descriptions, not a quotation or evidence that AGUS is eligible for the trial. Response SHA-256: `d0241986b67171b86a96fb8ac92c6d16cf454c982ee4a813eb65f03542900f51`.

This resolves the narrower question whether the published self-service data plan supplies an ongoing, free 20-bank consumer service: the inspected page does not offer that. A negotiated bank-sponsored arrangement could differ; none exists in this investigation. The page was not used to infer DirectPay/DirectDebit transaction pricing.

Other concrete institutional prices are preserved in [the network report](NETWORK_SPONSORSHIP.md): NIBSS Pay advertises N15 per record; NDD advertises N30 per successful debit. Those figures are product-page statements, not complete tariffs, and cannot be mechanically added to every route. They demonstrate why “no AGUS markup” is not sufficient evidence of equivalent user cost.

## Economic acceptance rule

For the same source account, amount, destination and ordinary transfer channel/entitlement:

`AGUS user total charges <= that bank's equivalent ordinary transfer charges`

Compare quoted bank charges, taxes, intermediary/collection/payout fees, and any channel charge separately. Count a user's ordinary free-transfer allowance: a route costing N15 is not parity when the equivalent bank transfer is free. Do not insert a paid USSD session, card-acquiring fee or conversion leg and call it normal bank fees by changing the comparison channel. No AGUS fee/markup is added.

Provider-side API, compliance and infrastructure costs must have an actual identified payer. A sponsor retaining its normal bank transfer economics and contractually funding its AGUS channel is a plausible **negotiation model**, not an identified committed funding source. Without that commitment or a documented waiver, the budget/price gate remains blocked. No assumption of advertising, float, later fundraising or endless transaction subsidies closes it.

## Other mechanism families screened

- Card-acquiring/3DS followed by a payout can authorize a card charge, but does not itself supply bank balance/history or source-account P2P authority. Extra acquiring/payout economics and permitted money-transfer use need explicit acceptance. Not a shortcut to the current requirements.
- Pay-with-transfer/virtual-account checkout asks the user to send to a merchant or intermediary. It does not make AGUS an initiator on an existing source account or provide account reads. No merchant account was opened.
- SMS/email/notification extraction can supply observed events, not authoritative current available balances, complete history or debit permission. It is not accepted as bank linking.
- A bank's WhatsApp/chat channel may serve its own customers, but no common authorized delegation/read/status contract for AGUS across 20 banks was found. Replacing a bank interface with an AGUS-controlled credential session is outside scope.
- Blockchain cannot originate a fiat bank debit without an authorized fiat-side participant. No repeat Solana experiment was useful for this specific uncertainty. Committed Solana/USD capabilities are retained as separate future rails.

These screens establish why the mechanisms alone are insufficient; they do not claim exhaustive knowledge of every private commercial product.
