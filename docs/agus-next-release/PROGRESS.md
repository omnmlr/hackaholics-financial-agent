# AGUS release progress

Branch: `improve/agus-banking-workspace-20261021`.
Baseline: `ca9994b8c0dedb0ba02e50b9d00308e96a28d277`, PR #42 head on `improve/agus-intelligence-motion-20261021`. This remains the PR base because #42 is still open. The older local `work` branch is preserved.

The owner resumed and expanded the paused assignment on October 21. All earlier foundation work is preserved. No merge, deployment, production mutation, migration, real bank call or real-money operation is authorized or performed.

## Durable checkpoints

| Gate                | Commit                | Implemented and verified                                                                                                       |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Original foundation | `98d867d`, `2b8a23e`  | Authorized fictional openings/payment projection; deterministic contextual savings; 211 and 791 overlapping focused tests      |
| 1                   | `2861b92`             | Resumption audit, multi-turn balance/savings browser acceptance; 70 focused tests, 32 browser groups                           |
| 2                   | `fb7d3bc`             | Recipient-local amount grounding; unified text/image/voice drafts; safe decoded ephemeral images; 124 tests, 64 browser groups |
| 3                   | `4d90d7f`             | Current payment outcomes, owner-scoped status tool, simulated downloads, reference wrapping; 158 tests, 112 browser groups     |
| 4                   | `f0c7ee5`             | Conversation rail, optional source-bound context panel, savings visualization; 735 tests, 186 browser groups at six widths     |
| 5                   | `4c14929`             | Clamped visual viewport/keyboard layout, interrupted-image recovery; 42 tests, 147 browser groups at four widths               |
| 6                   | In final verification | Full unit/HTTP/native/voice/browser/motion regressions, CI and integrated review PR                                            |

Counts overlap; they must not be added as unique tests. All model transports in this assignment are scripted. There have been zero genuine Gemini/bank requests. Each completed gate includes build/lint and browser accessibility checks; artifacts are in validation/ and screenshots/. The full chronological record is CHECKPOINT-HISTORY.md.

## Gate 6 audit

The initial full suite passed 1,274 tests in 54 files. Final audit then added regression coverage for named dates, rejected/ambiguous prior amounts, generic savings cadence and complete daily payment totals beyond the displayed ten-batch limit. Focused quantity/payment regressions passed. Final full-suite rerun is pending completion.

Older browser suites found a real startup navigation regression: the active-conversation effect opened navigation while history was still loading. It now waits for loaded, nonempty conversation content. Harnesses now inspect the automatically prepared draft without pressing the obsolete preparation step or closing already-open details. They retain actual field, recovery and no-execution assertions.

Final integrated campaign passed **222 browser check groups across 1440/1920/1280/820/390/320**, six axe scans, zero violations and zero page errors. It covers actual rendered bare ₦500, image preview and multiple drafts, amount correction, verification, separate approval and submission, processing without success, explicit reconciliation to mixed outcomes, simulated download, current conversational status/receipt/credit enquiries, reload and accumulated balance effects. Final code/build verification and older suites are still completing.

Environment-only failures: running server/restart suites without local networking permission produces EPERM. They are rerun with networking enabled for disposable local servers. No application safety check is removed.

## Exact next task

Finish Gate 6 on the final code: full suite, typecheck/lint/build; HTTP, native, chat-payment, voice, premium and motion browser suites. Save logs and inspect fresh captures. Commit the audited code and evidence, push this branch, create one PR against the exact baseline branch, attach it and inspect Node 22.16/24 CI. Update RELEASE-REPORT.md with actual results and release SHA. Do not merge or deploy.

Outstanding external acceptance: genuine model extraction/reasoning with a new explicitly bounded development budget; physical Android Chrome and affected embedded browser, real keyboard/microphone; WebKit/Firefox. See REAL-DEVICE-CHECKLIST.md. These are not established by Chromium emulation or scripted extraction. No production credential should be copied into this environment to obtain them.
