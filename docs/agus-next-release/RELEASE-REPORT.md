# AGUS integrated financial workflows — review candidate

Baseline: PR #42, `ca9994b8c0dedb0ba02e50b9d00308e96a28d277`. Branch: `improve/agus-banking-workspace-20261021`. PR base: `improve/agus-intelligence-motion-20261021`, preserving the exact deployed-source lineage while #42 remains open. One integrated PR; no merge or deployment.

Audited implementation revision: `9954989a0225d718b74eb5367c0af6c7dcb0e273`. Documentation/evidence commits may follow. PROGRESS.md records the exact checkpoint.

## Resumption and financial intelligence

The paused checkpoint had already implemented fictional balance projection and contextual savings, with focused unit verification. This assignment retained those commits, closed their browser gate, and added multimodal drafts, outcome continuity, simulated confirmations, desktop composition and mobile recovery/layout work. Existing native Gemini orchestration, Neon-compatible PostgreSQL/CAS workflow persistence and explicit payment controls remain the architecture.

Original historical fixture rows are intentionally partial and do not reconcile to their old snapshot. An immutable fictional opening is captured once, without reseeding or changing those records. Only newly linked authorized fictional payments project changes: unresolved records reserve principal and fee allowance; success debits principal and confirmed fees; failure/reversal releases the net effect. Legacy unlinked payments stay separate. Reads share the workflow SQL snapshot, enforce principal/tenant/consent boundaries and distinguish a current fictional projection from historical or stale bank data. Original timestamps are retained. No SQL migration.

Savings tool arguments are checked against actual user quantities, roles and cadence before deterministic arithmetic and an independent integer-rational check. Context stores plan assumptions, not balance authority; account values are read again on follow-up. Unknown is never zero. Separate narration/financial review remains. Unreviewed generic calculations cannot leak a numerical fallback.

Scripted actual-app examples from a fresh isolated workspace:

| Instruction                    | Verified result                                                         |
| ------------------------------ | ----------------------------------------------------------------------- |
| Fictional available balance    | ₦123,456.78; current ₦124,456.78; original snapshot provenance retained |
| Save 10k weekly to 1m          | 100 weekly deposits from zero                                           |
| Use existing available balance | 88 weekly deposits                                                      |
| Make it 20k weekly             | 44 weekly deposits, same goal/start assumptions                         |
| Calculate from zero            | 50 weekly deposits                                                      |
| Save 5h daily to 1m            | ₦500/day; 2,000 deposits                                                |

Calendar durations are approximate; no interest, withdrawals or fees are assumed in these plans. Repeated browser sessions use accumulated payment debits/holds rather than resetting the opening. Arbitrary Pidgin, misspellings and noisy speech are not proven by scripted model transport; ambiguous interpretations still clarify.

## Payment parsing and unified input

The missing ₦500 arose after extraction: `groundProposal()` required conventional currency/amount formatting and discarded the valid bare amount before institution/account. Recipient-local numeric evidence now distinguishes monetary quantities from account/phone digits, references, identifiers, dates and durations. Reordered fields, punctuation, h/k/m and explicit corrections are grounded independently. Multiple competing amounts remain missing for review; previous amounts cannot silently override a rejected/ambiguous correction. Multiple-recipient values cannot borrow an unrelated segment's amount. The synthetic `9812345670` regression value is not a real user's account.

Text → existing native handoff → populated editable proposal. Voice → existing transcription → reviewed composer text → the same path. Image → existing authenticated `/api/extract` and extractor → owned conversation handoff → the same proposal/editor, beneficiary verification, batch approval, explicit submission and reconciliation. No modality can approve or execute. Partial fields are retained; provider-verified names remain distinct from user labels. Arbitrary OPay details remain editable and unverified; the fixture provider resolves only supported fictional recipients.

Composer supports file selection, local preview, image paste, desktop drop, mobile selection, cancel and explicit recovery. Lost responses are checked against the saved conversation before retry. Owned upload IDs are claimed once; reopening returns the original draft, preventing repeated extraction/operations. Raw screenshots are not stored in history or audit records. A selected local object URL is revoked on removal/completion.

Image validation checks size/signature/MIME plus actual sharp decoding: 5 MB input, 16 megapixels, single frame, decode timeout, resize to at most 2400 pixels per side and metadata-stripping re-encoding. PNG/JPEG/WebP only. Two independent readings of the original normalized image must agree on fields; contradictions remain empty. Image instructions are untrusted and never alter auth, verification or approval. Agreement is fallible extraction, not proof that image content is true. New direct dependency: pinned `sharp@0.35.5`, already used transitively by Next.

## Outcomes, status and simulated evidence

Before: a completed fictional payment could be discovered only in collapsed technical details, and chat had no authoritative payment-state tool. Now: a prominent persisted outcome region shows each recipient's actual current state, amount, confirmed fee or unavailable fee, timestamp/reference disclosure and a safe explicit provider-check operation. Pending/unknown never becomes success because HTTP submission succeeded. Displayed/spoken handoff text follows the current linked batch, including reversal. Reload does not append duplicate success messages.

The native read-only `get_payment_status` tool filters by authenticated owner and conversation/latest/today scope, supports an explicit recipient index and receipt enquiry, and writes backend-grounded wording. Daily totals cover every matching owned batch; bounded detail is disclosed. Status enquiries never resubmit a payment. Source-side provider status never claims recipient-bank credit. There is no automatic background reconciliation scheduler added; use explicit checks, or the existing separately operated reconciliation tooling.

Browser acceptance uses two image recipients, edits ₦500→₦700, saves, verifies, separately approves with the AGUS operator credential, then explicitly submits. Initial pending offers no successful confirmation. Explicit reconciliation yields Ada successful/Chidi processing; conversational enquiries and reload agree. Failures, reversals, unknown outcomes, expiry/material edits, interrupted submission, duplicates and reconciliation are also tested at unit/HTTP integration level; not every failure variant has a separate browser recording.

A successful approved fictional payment can download a plain AGUS text **SIMULATED PAYMENT CONFIRMATION**. It includes user label, verified fictional name, institution, amount, recorded timestamp/reference/status and confirmed fee where available. DEMO/no-real-funds/no-recipient-credit labels persist in the file. No bank branding, signature or imitation receipt. Auth/ownership/current success are checked again on download; pending/failed/reversed/live records are denied. Previously downloaded files cannot be recalled after a later reversal; their timestamp identifies the recorded state at issue time.

## Desktop and mobile

The welcome identity remains black/graphite, agus., Let's talk money., compact composer and restrained blue. The active workspace adds a compact navigation rail, readable conversation measure and optional In focus reference panel. Savings timelines, account facts and current payments use validated sources; partial coverage remains explicit. Closing the panel retains inline information; Escape restores focus. No invented dashboard figures or decorative progress. Native transitions and existing motion respect reduced motion.

Mobile fixes replace flow-margin visual viewport offsets with a clamped fixed-shell geometry, coalesced resize/scroll/orientation updates and zoom-stable layout. Dialogs use visible-height bounds. The narrow payment-reference defect came from a detail row inheriting the 24px recipient-number column; explicit grid placement/one-column mobile flow repairs it. Interrupted first-image upload now exposes recovery outside an empty thread.

Actual Chromium captures cover 320–1920px, real browser viewport shrink/restore, injected visual-only pan and zoom measurements, navigation/account/upload/editor/approval/outcomes/reload and voice mocks. They do not establish hardware keyboard/microphone, physical Android or the affected embedded browser. No WebKit/Firefox executable or physical device was available. REAL-DEVICE-CHECKLIST.md gives reproducible outstanding acceptance. GALLERY.md links before/after, preview/draft, status, mobile, loading/error and motion evidence.

## Verification and limitations

Local final checks: **1,276 tests in 54 files passed**, typecheck/lint/production build passed, HTTP safety smoke passed, native browser **14 groups at two widths** passed. The final integrated workflow campaign covers **222 groups at six widths**, with six axe scans and zero violations/page errors. Chat/payment **54 groups/four widths**, voice submission **36 groups/two capture paths/four widths**, voice meter **8 groups**, premium **28 groups/four widths/24 axe scans**, and motion/intelligence **20 groups/four widths/16 axe scans** also passed. All reported scans have zero violations and all browser reports have zero page errors. Counts overlap and are not unique tests. See validation/ for exact logs and machine-readable results. CI is configured for Node 22.16.0 and 24 and will be inspected on the integrated PR. All new model requests are **scripted transports**, with real local deterministic calculations, authorization, PGlite/PostgreSQL persistence and fixture payment state. **Zero genuine Gemini requests and zero real banking/provider requests** were made. No development model credential was configured; the previous branch's 48-request paid campaign is not reused. Semantic image reading and broad conversational performance require a separately budgeted genuine-model campaign before calling them fully accepted.

Commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:http`, `npm run test:browser`, `npm run test:browser:native`, `npm run test:browser:premium`, `CAPTURE_MOTION_VIDEO=1 npm run test:browser:motion`, and `WORKFLOW_PHASE=outcomes MOBILE_VIEWPORT_CHECKS=1 WORKFLOW_WIDTHS=1440,1920,1280,820,390,320 npm run test:browser:workflows`. Browser outputs use isolated output directories and Chromium; scripts deny external fetch and override financial/model settings with fixture values. Local Node version: 24.19.0.

The initial attempts exposed real startup-navigation and 320px-placeholder regressions, repaired above. Older assertions assumed manual preparation, closed cards and immutable spending totals across persisted payments; those harness expectations now reflect the intended workflow while retaining amount/security assertions. A savings narration check was updated for deterministic parentheses, preserving exact quantities and duration. The final full suite passes the added eleven-batch daily-total regression. No unresolved local test failure is hidden behind these counts. Fontconfig emits cache-path warnings while generating the synthetic image in this restricted environment; rendered browser reports remain error-free.

## Security and rollback

No real payments, production data/variables, Railway configuration, production migrations, unauthorized customer reads, bank passwords or production secrets were used or changed. Live transfers remain disabled. Session auth, tenant isolation, consent, strict fixture beneficiaries, time-limited digest-bound approval, edit invalidation, independent submission, idempotency, reference matching, durable cancellation/recovery and uncertain-outcome handling are preserved and regression tested.

This is a code-review candidate, not a production release authorization. A later authorized deployment must preserve the existing database, seed, native-agent settings and disabled live-transfer flags. Do not run a reset/reseed/migration to install it. Optional fields live in existing workflow JSON. Use supported Node 22.16+ or 24, `npm ci`, build and normal application startup. The new CI uses no deployment credentials.

For an authorized rollback, keep database/audit history and restore `ca9994b8c0dedb0ba02e50b9d00308e96a28d277` or the prior approved image. Pause new simulated submissions while old code is running: it does not enforce this release's linked fictional source funds. Optional state fields must not be deleted. Existing short-lived savings contexts may need their normal 15-minute TTL to expire under an older strict schema; do not reset production persistence to resolve them. Keep receipts clearly fictional and use current records to resolve any later reversal/uncertainty. Back up the existing workflow/database before any separately authorized release action.
