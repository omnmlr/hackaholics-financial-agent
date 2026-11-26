# Marketplace, escrow and receiving checkpoint — 11 November 2026

Work continues on `integration/agus2-foundation-20261110`, descended from approved
baseline `3f767d17e35efb8e84a9fe4da05f231c8e6956b4`. Sprint 0/1 tools and acceptance
data are preserved. The user's subsequent instructions authorize independent
escrow work while genuine wallet acceptance remains pending; the original
approved plan is preserved unchanged. This branch has not been pushed, merged,
or deployed. No paid service was invoked.

## Implemented and locally verified

| Area                  | Delivered behavior                                                                                                                                                                                 | Acceptance boundary                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P2P marketplace       | Eligible fixture traders, executable offer/order pagination, revisioned offer edits/closure, deterministic quote pricing, atomic reservations, participant isolation and capacity restoration once | Functional simulation, not a live marketplace or bank integration                      |
| P2P settlement        | Durable fictional token ledger/vault; seller funding, buyer fiat claim, independent verifier, seller release, bilateral cancellation, disputes and fixed two-of-three arbitration                  | Every receipt says simulated; no bank credit or chain finality claimed                 |
| Anchor escrow         | Exact test-USDC funding; immutable parties/terms/authorities; cooperative release, bilateral cancellation, dispute and arbitration; replay and account-substitution protections                    | Compiled and executed in local banks only; no deployment or genuine wallet transaction |
| Backend escrow        | Rust-compatible instruction builders, verified party-wallet bindings, immutable term snapshots and strict read-only finalized funding inspector                                                    | Instruction templates, not an approved full transaction or enabled wallet flow         |
| Solana requests       | Owned lifecycle, QR/Solana Pay URI, strict parsing, references, exact finalized receipt inspection, bounded external-wallet discovery, cursor pagination and append-only settlement observations   | Synthetic signed transaction/RPC acceptance; genuine paid requests remain unaccepted   |
| USD receiving         | Typed eligibility, account issuance, incoming funds, conversion, blockchain delivery, NGN settlement and return partner interfaces                                                                 | Real partner adapters deliberately unavailable; contracts/ports only                   |
| USD fixtures          | Encrypted explicitly fictional receiving details, distinct incoming allocation, immutable quotes, idempotent conversion, staged delivery/payout and unallocated-source returns                     | Implemented durable simulation, not USD custody, USDC delivery or NGN bank payment     |
| Shared backend/mobile | Migrations 0014–0017, generated OpenAPI/client, action-bound step-up for P2P, worker reconciliation, safe request/P2P notification links                                                           | Android bundle verified; physical device, wallet return and push acceptance pending    |

### Settlement and uncertainty

P2P snapshots four independent operations identities per funded order. Neither
an “I paid” claim nor a screenshot authorizes release. Duplicate disputes do not
reset votes; two agreeing fixed arbitrators suffice even if the third dissents.
One authority cannot count twice or change its committed decision. Funded
orders cannot expire into refunds, and cancelled/expired capacity restores once.
The fixture authority setup command affects future snapshots only.

On-chain terms bind seller, buyer, amount, mint, order digest, destination,
refund account, verifier and arbitrators. Settlement validates only the selected
destination, preventing the unused account's closure/owner change from blocking
the other outcome. Terminal PDAs remain to prevent reinitialization. No personal
bank details are put on-chain. The verifier remains explicitly simulated.

The declared program address is a **local placeholder with no retained private
key**, not an owner-controlled accepted deployment address. Genuine deployment
requires choosing that address, updating both clients and program, rebuilding,
retesting, and human wallet interaction. Templates report those gates as false.
Funding observations are separate from the fixture financial ledger. See
[escrow reproduction and invariants](../../escrow/README.md).

Request discovery makes bounded read-only calls through the pinned Devnet RPC,
after ownership checks and persistent rate limiting. The HTTP interface accepts
a signature or opaque cursor, never a caller-provided RPC URL or settlement
evidence. Exact signed legacy SOL/classic TransferChecked instructions, readonly
reference, recipient/mint/scale/amount, balance deltas and finalized status/slot
must agree. Versioned, routed, multisig, pending or pruned observations remain
unresolved. Discovery never proves complete history or nonpayment.

The first valid receipt remains primary. A different subsequent matching payment
is recorded as an additional payment requiring manual review; no automatic
refund is authorized. Chain time distinguishes late/cancelled payments; missing
time remains timing-unverified. Notifications refer only to resources their
recipient owns. Genuine settled requests are **not** claimed by fixture tests.

USD source allocation and provider-effect claims prevent duplicate conversion;
delivery and payout require distinct fresh step-up approvals. Ambiguous writes
stay unknown and reconciliation reads existing effects without resending.
Receiving funds does not prove blockchain delivery or bank credit. Returns in
this fixture cover unallocated incoming funds; post-delivery return handling
remains a partner gate. Fixed 1:1 USD/USDC and 1500 NGN/USD rates and zero fees are
explicit test constants, not commercial policy. All real partner capability
flags remain false. Source-bank coverage remains **zero accepted institutions**;
all seven live operation flags for all 23 candidates remain disabled.

## Verification evidence

Machine-readable results and exact command counts are recorded in
[roadmap-validation-20261111.json](evidence/roadmap-validation-20261111.json).
The final regression, production build, least-privilege PostgreSQL HTTP flow,
TypeScript/lint, generated-contract drift, Android bundle and preserved legacy
checks are recorded there. No hosted CI result is claimed for this local branch.

The native escrow suite passed six tests (two library plus four local-bank
journeys); the compiled SBF artifact passed all four bank journeys. The stripped
ELF SHA-256 is
`bba86a2d0f396849e96c24cd708fed364c95bec6e0bfe989add83778707d8a21`.
Rust/TypeScript golden serialization checks cover all funding, release, refund,
arbitration and dispute instructions. These are **local runtime tests**, not
genuine public Devnet execution or an independent security audit.

### Visual expectations

Before changing stale assertions, the baseline was checked: sign-in/account
controls, responsive typography, colored semantic surfaces and payment drafts
inside chat are intended existing behavior. The maintained workspace script now
tests those journeys; it no longer asserts removed Spend/sign-in-hint controls,
monochrome styling or the former payment redirect. Explicit edit/verify/approve/
execute coverage remains in the chat-payments suite (desktop and phone passed).
Its October spending assertion now counts only transfers actually in October;
the November execution timestamp was correctly excluded by the application.

A real 740×390 defect was fixed with a small CSS rule: history in a short drawer
could shrink until its links were unclickable. All six workspace viewports
(1440×1000, 1024×768, 820×1000, 390×844, 320×740, 740×390) passed, including existing
accessibility checks. Results and selected screenshots are in
[visual-20261111](evidence/visual-20261111/). Historical approved-P0 screenshots
were preserved; future default screenshots go to a temporary directory. No UI
redesign or intelligence development was performed.

### APK storage investigation

The previous debug APK attempt exhausted disk during Gradle/Kotlin work; no
signing failure or installable APK is established. The environment restart also
removed the temporary SDK. The read-only `mobile:build:storage` command reports
free space, configured SDK and a conservative 8 GiB per build-volume budget.
`mobile:build:preflight` exits 2 when that budget or the SDK is missing. Its
threshold is a planning budget, not an exact prediction. Current evidence is
[android-storage-20261111.json](evidence/android-storage-20261111.json).

Cleanup was restricted to task-owned compiler/build caches and the incomplete
public SDK download; important source, databases, JDK, signing material and
Sprint 1 acceptance data were preserved. The legacy SDK's unwanted second
toolchain installation was bypassed by a direct pinned SBF compiler script.
No paid EAS build, physical install or push acceptance was attempted.

## Remaining external acceptance

Genuine SOL/test-USDC wallet execution, an owner-controlled escrow program
address/deployment and real escrow signatures remain pending. Android needs
sufficient build storage and a complete SDK, then physical device/MWA and push
acceptance. Genuine USD and bank operations require issued partner contracts,
eligibility/access and independent delivery/credit/return evidence. Production
identity recovery/email and key governance remain operational gates. Optional
Jupiter swaps and iOS wallet parity are not implemented in this checkpoint.

This checkpoint completes independently testable local scope, not those external
acceptance gates. Use the prior [platform checkpoint](PLATFORM_CHECKPOINT.md) for
identity, normalization, banking fixtures and worker operating instructions.
