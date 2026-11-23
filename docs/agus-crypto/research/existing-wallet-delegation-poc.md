# Existing-wallet delegation proof of concept

## Verdict

**Use Solana Foundation Subscriptions for explicit, opt-in token payments from existing wallet accounts. Start with a finite merchant plan with an on-chain recipient allowlist for any payee-bound use case.** Each owner can sign one setup transaction per grant or plan. A later authorized pull requires the puller and fee payer, while the funds stay in the original owner-controlled ATA until the pull succeeds. The wallet owner can still spend the tokens directly.

**Fixed and recurring delegations are bounded spending envelopes.** A fixed grant caps lifetime spend and can expire. A recurring grant limits each period and can expire, with no accumulation of unused periods. Both let the authorized delegate choose the receiving token account for that mint. A fixed or recurring grant is suitable only when the user knowingly grants that discretion. A scheduled payment to a specific recipient needs a merchant plan with a nonempty destination list, or a new wallet-approved payment at each occurrence.

The result supports an AGUS pilot for token payments after deployment and operational validation. Before production, verify deployed bytecode, upgrade authority and audit coverage for the exact revision, isolate puller and fee-payer keys, disclose max ATA approval and any delegate replacement, and reconcile each pull against the chain. The local tests establish program behavior. A production wallet integration and deployed program were outside this run.

[Executable harness and reproduction](../../../experiments/existing-wallet-delegation/README.md) · [Updated capability matrix](capability-matrix.md) · [Architecture research PR #48](https://github.com/omnmlr/hackaholics-financial-agent/pull/48)

## What ran

The harness compiled the official Subscriptions release at `364a41976c33347d092902443bbec2def9227e75` and loaded its SBF ELF into LiteSVM 1.6.2 with signature and blockhash checks enabled. A fresh source checkout, Cargo build and `npm ci` in another directory reproduced the binary hash and passed all **6 tests**. The tests checked **58 transactions or signing attempts** after fixture setup, with **34 accepted and 24 expected rejections**. The SDK rejected one of the 24 before execution because an owner signature was missing. The other 23 were rejected by the local runtime. The harness signs with disposable in-memory keys and records only public addresses, signatures, and account or program state. [Subscriptions program release](https://github.com/solana-foundation/subscriptions/releases/tag/program-v0.5.0) · [LiteSVM](https://github.com/LiteSVM/litesvm)

| Build input or result | Value |
| --- | --- |
| Reproduced | 2026-11-23, Linux x86-64, Node 24.19.0, npm 11.9.0 |
| Subscriptions program ID | `De1egAFMkMWZSN5rYXRj9CAdheBamobVNubTsi9avR44` |
| Client | `@solana/subscriptions@0.5.0` |
| Compiler | Anza platform-tools v1.58, Rust `1.95.0-dev (1e20dd0d5 2026-10-05)` |
| Stripped local ELF | 107,680 bytes, SHA-256 `346f866673363ea85a0f85bd91f1c2b8c5995ca33c6a8413554e866dc826a1ed` |
| Tests | 6 passed, 0 failed, 0 skipped |

## Exact ownership and signature evidence

These addresses and signatures are from one local run of the independent-grants test. The fixture used classic SPL Token `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` and synthetic mint `2JnRFtEKwfugnTVmPfqwkJnHSpNBpnbKhuqbXiyeidEH` with six decimals. Both owners started with 100 tokens (100,000,000 base units), no delegate, and zero allowance.

| Decoded field | Alice's fixed grant | Bob's recurring grant |
| --- | --- | --- |
| Wallet authority recorded as ATA `owner` | `9qmmUcD1uCDSACBCKK6ddyxVdB29cykDLwTrWqG95FZv` | `4yUp1ZqkR5eeWz5LZf3ofEcRnqYzpTwUmbG8Bfb3sCgx` |
| Source ATA | `GEqxp6A5i4imSE7C4RBk6KsBU76e4fUHgxnkZUASZ1dp` | `7eteyS4Y22AEBYN1ac8AE9dwEp7SWN2JqWUsFQW6YtT2` |
| ATA `delegate` after approval | `VeJyCtuUq2U7HgR48cJxqQzX2zNLLPLLrjcD1RmWnfF` | `D2yE5faYY4uqSc5ByFvnasnUPw5EMBbSc93DXcHLnK3W` |
| Subscriptions-owned grant PDA | `5zMJqU1SADEx8ZeK1NzxCKV1y66MYgmmgm3h6kfP63dR` | `BF3o39zfVMi3ATj6Rzy4o5sc1FDzcaZjk7Fh2XHXA9Y2` |
| Balance before setup → after setup → after pulls | 100 → 100 → 75 | 100 → 100 → 72 |
| SPL allowance after setup → after pulls, in base units | 18446744073709551615 → 18446744073684551615 | 18446744073709551615 → 18446744073681551615 |

The ATA's runtime program owner was the Token Program throughout. The decoded token-account `owner` remained Alice or Bob and both ATA addresses stayed the same. Each separate Subscription Authority PDA was owned by Subscriptions and recorded the respective wallet, mint, sponsor and initialization slot. Each grant linked its authority PDA and recorded the same external delegatee, `F9sA9vQ3px8JxA4mtGR2YWSYdaTpbz2CWGu644srncYc`. The fee payer and recorded rent sponsor was `4ZBSNfLMK55peYxWQ3rAcMX5EY4RgcABtWNokSBPmMTh`.

Alice and the sponsor signed Alice's initialization and fixed grant together. Bob and the sponsor signed Bob's initialization and recurring grant together. Both example pulls below had exactly the delegatee and fee payer as transaction signers. During each pull Subscriptions enforced the grant, then signed the Token Program's `TransferChecked` CPI with the PDA. The wallet owner and the PDA were absent from the transaction signatures. The token program enforced the actual token-account delegate, mint and available funds.

| Successful local transaction | Signature | Compute units |
| --- | --- | --- |
| Alice fixed pull of 10 | `61UdQBvfMEq3m9RRmyTWzkdjjw7PaXwiytc5wKAVuLVSgNKmu1wcoEGsYVgvEZcfPLjaERTXxvJzF77n1nw5tQW5` | 5,337 |
| Bob recurring pull of 8 | `32vXtVfs99Ryz6LJ9d6uNWpykKYXoLiQburFrZwoeLY2juSvQqUvGrbjJk4WmCQSHPBpaHccX5bH8R2uDLUd1sr4` | 8,447 |

Local rent balances were 1,188,720 lamports per authority, 1,600,200 for the fixed grant and 1,722,120 for the recurring grant. These reflect LiteSVM's rent configuration. Estimate rent and transaction fees on the intended network before quoting users.

[Authority initialization](https://github.com/solana-foundation/subscriptions/blob/364a41976c33347d092902443bbec2def9227e75/program/src/instructions/initialize_subscription_authority.rs) · [PDA-signed transfer helper](https://github.com/solana-foundation/subscriptions/blob/364a41976c33347d092902443bbec2def9227e75/program/src/instructions/helpers/transfer_utils.rs)

## Enforcement and failure results

| Case | Observed behavior |
| --- | --- |
| Ordinary SPL delegate | Alice signed a 15-token approval. The delegate sent 5 to one recipient, 4 to another 30 simulated days later, and burned 2. A further pull of 5 with 4 remaining failed with SPL error 1. Owner revoke cleared the slot. The next delegate pull failed with SPL error 4. |
| Fixed grant | Alice's 25-token cap paid 10 and 15 to two recipients. A further 1 failed with Subscriptions error 300. Another fixed grant expired with 5 tokens of budget left and returned error 128. An unrelated signer and an attempt to pair Alice's grant with Bob's ATA each returned error 130. |
| Recurring grant | Bob's 20-token, 60-second cap allowed 8 and rejected 13 in the same period with error 400. An unused period elapsed without a payment. The next period still capped spend at 20 and paid that amount to a different recipient. After expiry, another pull returned error 128. |
| Insufficient balance and conflicting delegate | Alice independently spent 94, leaving 6 in her ATA. A 10-token pull failed in SPL with error 1 and rolled back the grant debit. A pull of 3 later succeeded. Installing the Subscriptions PDA displaced Alice's previous ordinary delegate. Installing a new ordinary delegate later blocked Subscriptions pulls with SPL error 4 while the Subscriptions grant record remained. Reinstating the same authority with a fresh owner signature let the surviving grant collect again. |
| Subscriptions revocation | Alice removed one fixed grant. Its PDA closed, a later pull failed the program-account ownership check, and the ATA's delegate stayed set. Alice later revoked the whole authority in one owner-signed transaction. The ATA cleared its delegate, the authority PDA closed, and another surviving grant could no longer pull (Subscriptions error 103). |
| Allowlisted merchant plan | The merchant published a 12-token hourly plan with one allowed receiving owner and one AGUS puller. Alice subscribed. The puller paid the merchant 5, but an unlisted caller and a different destination owner failed with errors 130 and 506. The merchant could change the optional puller without Alice, while the puller could not update the plan. Alice's cancellation left the rest of the current period collectible. The replacement puller collected the remaining 7 and a pull at the cancellation boundary failed with error 508. |
| Basic Token-2022 | The same in-place setup and a 3-token pull under a 4-token grant worked on a basic synthetic mint. Owner-signed token revoke blocked a remaining 1-token pull. Transfer fees, hooks, and other mint extensions were outside this test. |
| Native SOL | The delegate paid fees for a proposed transfer from Alice's ordinary System Program account. LiteSVM's API rejected the message missing her signature. A transaction with Alice marked as a nonsigning source reached the System Program and failed with `MissingRequiredSignature`. Both native balances held steady. The owner-signed control then moved 10,000 lamports. |

An ordinary SPL delegate signs later SPL operations itself. A Subscriptions grant delegates the token account to the program PDA, so the grant's named delegatee cannot use it directly with SPL. Only the published transfer path can exercise its Subscriptions role. For merchant plans, the program checks the receiving token account's **owner** against the plan's destination list. The list is fixed through the tested release's plan update instruction. The merchant can replace optional pullers and remains an eligible caller. A plan with an empty destination list permits any destination. Use a nonempty list for a payee-bound flow.

[Fixed transfer](https://github.com/solana-foundation/subscriptions/blob/364a41976c33347d092902443bbec2def9227e75/program/src/instructions/transfer_fixed_delegation.rs) · [Recurring validation](https://github.com/solana-foundation/subscriptions/blob/364a41976c33347d092902443bbec2def9227e75/program/src/instructions/helpers/transfer_validation.rs) · [Plan policy](https://github.com/solana-foundation/subscriptions/blob/364a41976c33347d092902443bbec2def9227e75/program/src/state/plan.rs) · [Plan updates](https://github.com/solana-foundation/subscriptions/blob/364a41976c33347d092902443bbec2def9227e75/program/src/instructions/update_plan.rs) · [SPL approve and revoke](https://solana.com/docs/tokens/basics/approve-delegate)

## What a compromised signer can access

| Signer | Exposure while the approval remains active |
| --- | --- |
| Ordinary SPL delegate | The lower of the remaining allowance and the token balance in each approved source account. The delegate can direct funds to a compatible destination or burn them. Later deposits remain collectible while allowance survives. |
| Subscriptions fixed or recurring delegatee | Each grant's collectible amount subject to expiry, the ATA balance and the remaining fixed cap or current recurring budget. With approvals on multiple accounts, exposure spans those separately granted accounts. The delegate can direct payments to another owner. Recurring exposure can renew in future periods. The program PDA's SPL approval is max-sized. The lower effective limits depend on the Subscriptions program and its deployed code. |
| Merchant plan puller | The remaining per-period budget can be collected to a plan-listed receiving owner. A nonempty allowlist constrains diversion, while the caller can still collect the available amount early within a valid period. The merchant can also pull and administer its plan. An empty list widens exposure to any compatible receiving owner. |
| Dedicated fee payer | Fee-payer status alone grants no access to the token owner or its payments. If its key is compromised, its own SOL is exposed. Keep it separate from the delegate role and wallet owner. |

Removing a grant and removing the ATA delegate are distinct operations. For an immediate account-level stop, the owner signs a token revoke or the program's combined authority teardown. A token revoke or replacement can leave grant records in place. Before reinstating an authority, check any surviving grants. A plan's normal subscriber cancellation stops collection at the period boundary, while the documented immediate plan cancellation requires the merchant and subscriber. [Program revocation and cancellation source](https://github.com/solana-foundation/subscriptions/tree/364a41976c33347d092902443bbec2def9227e75/program/src/instructions) · [Release semantics](https://github.com/solana-foundation/subscriptions/releases/tag/program-v0.5.0)

## Operations after the initial approval

- **Existing tokens with a standing grant.** AGUS can submit fixed-budget or per-period pulls for a specific mint and canonical ATA when its signer is named in the grant. It can collect a merchant subscription if it is an eligible puller, only to the plan's allowed owner when configured. A separate signer pays transaction fees. The clock alone makes no payment, and sufficient balance is required at execution.
- **Fresh owner signature.** The owner authorizes a new grant or plan, signs owner-controlled cancellation or revocation, and must sign a direct transaction that asks for authority outside the grant. A standing allowance does not authorize arbitrary transfers from other mints or accounts, owner-level swaps or DeFi position instructions, or a transfer of native SOL from an ordinary wallet. An exact native transfer can be signed ahead of submission, but it still needs that transaction's owner signature. WSOL is a token-account model that first requires wrapping funds.
- **Separately funded execution.** Unattended native SOL or program-scoped DeFi needs a different authority model or a protocol-specific funded account where that model is supported. Those options are separate from this token-pull proof. [Solana System Program](https://solana.com/docs/core/programs/builtin-programs) · [Wrapped SOL](https://solana.com/docs/tokens/basics/sync-native)

## Phantom Auto-Confirm on Android

Phantom documents Auto-Confirm on mobile and extension for supported apps, including third-party products such as Jupiter, Magic Eden and Tensor. It is user-enabled, time- and rate-limited to two hours and ten transactions per minute, and subject to wallet security checks. Phantom's published Android linking and MWA resources do not establish a general way for a new third-party app to opt in or show AGUS eligibility. Phantom Portal also currently pauses new Connect SDK sign-ups and app-directory submissions. That onboarding notice supplies no evidence about a specific Auto-Confirm approval path. AGUS should treat eligibility as unverified. [Phantom Auto-Confirm](https://help.phantom.com/articles/let-an-app-confirm-transactions-on-your-behalf-19385761078547) · [Phantom mobile links](https://docs.phantom.com/phantom-deeplinks/deeplinks-ios-and-android) · [Phantom Portal](https://docs.phantom.com/phantom-portal/getting-started) · [MWA specification](https://github.com/solana-mobile/mobile-wallet-adapter/blob/main/spec/spec.md)
