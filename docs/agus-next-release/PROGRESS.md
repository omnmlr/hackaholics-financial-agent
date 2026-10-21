# AGUS release progress

Branch: `improve/agus-banking-workspace-20261021`.
Baseline: `ca9994b8c0dedb0ba02e50b9d00308e96a28d277`, PR #42 head on `improve/agus-intelligence-motion-20261021`. This remains the PR base because #42 is still open. The older local `work` branch is preserved.

The owner resumed and expanded the paused assignment on October 21. All earlier foundation work is preserved. No merge, deployment, production mutation, migration, real bank call or real-money operation is authorized or performed.

## Durable checkpoints

| Gate                | Commit               | Implemented and verified                                                                                                       |
| ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Original foundation | `98d867d`, `2b8a23e` | Authorized fictional openings/payment projection; deterministic contextual savings; 211 and 791 overlapping focused tests      |
| 1                   | `2861b92`            | Resumption audit, multi-turn balance/savings browser acceptance; 70 focused tests, 32 browser groups                           |
| 2                   | `fb7d3bc`            | Recipient-local amount grounding; unified text/image/voice drafts; safe decoded ephemeral images; 124 tests, 64 browser groups |
| 3                   | `4d90d7f`            | Current payment outcomes, owner-scoped status tool, simulated downloads, reference wrapping; 158 tests, 112 browser groups     |
| 4                   | `f0c7ee5`            | Conversation rail, optional source-bound context panel, savings visualization; 735 tests, 186 browser groups at six widths     |
| 5                   | `4c14929`            | Clamped visual viewport/keyboard layout, interrupted-image recovery; 42 tests, 147 browser groups at four widths               |
| 6                   | `bdff303`            | Scripted acceptance and Node 22.16/24 CI passed; external acceptance remains below                                             |

Counts overlap; they must not be added as unique tests. All model transports in this assignment are scripted. There have been zero genuine Gemini/bank requests. Each completed gate includes build/lint and browser accessibility checks; artifacts are in validation/ and screenshots/. The full chronological record is CHECKPOINT-HISTORY.md.

## Gate 6 audit

The initial full suite passed 1,274 tests in 54 files. Final audit then added regression coverage for named dates, rejected/ambiguous prior amounts, generic savings cadence and complete daily payment totals beyond the displayed ten-batch limit. Focused quantity/payment regressions passed. Final full suite passed **1,282 tests/54 files**.

Older browser suites found a real startup navigation regression: the active-conversation effect opened navigation while history was still loading. It now waits for loaded, nonempty conversation content. Harnesses now inspect the automatically prepared draft without pressing the obsolete preparation step or closing already-open details. They retain actual field, recovery and no-execution assertions.

Final integrated campaign passed **222 browser check groups across 1440/1920/1280/820/390/320**, six axe scans, zero violations and zero page errors. It covers actual rendered bare ₦500, image preview and multiple drafts, amount correction, verification, separate approval and submission, processing without success, explicit reconciliation to mixed outcomes, simulated download, current conversational status/receipt/credit enquiries, reload and accumulated balance effects. Final code/build/typecheck/lint, HTTP, native (14 groups), chat/payment (54), voice submission (36), voice meter (8), premium (28, 24 axe scans) and motion (20, 16 axe scans) all passed. Reports have zero page errors/axe violations. Fresh captures and motion videos were inspected.

Environment-only failures: running server/restart suites without local networking permission produces EPERM. They are rerun with networking enabled for disposable local servers. No application safety check is removed.

## Exact next task

The existing [PR #43](https://github.com/omnmlr/hackaholics-financial-agent/pull/43) remains the only review PR and targets unchanged PR #42 baseline. Final release candidate `869b5b9b488299007ece130e78d76cf5fc102d45`, including the plus menu, passed all configured gates on Node 22.16/24 ([run 39654260725](https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/39654260725)); both job conclusions and steps were rechecked during the real-model audit.

The owner now authorizes real-model acceptance, not another feature phase. The October 21 preflight is **BLOCKED**: no development Gemini credential is configured and enforced egress excludes `generativelanguage.googleapis.com`. Zero genuine requests, responses or tokens; US$0 model cost. No application change or repeat phase was needed. See [actual result and secure setup](REAL-MODEL-ACCEPTANCE.md) and [machine-readable evidence](validation/real-model-preflight.json).

**Exact next task:** after a separate development credential and Gemini egress are securely configured, verify readiness, adapt the existing bounded runner to this RC's real image/chat/persisted-payment routes with a fresh isolated fixture DB, and execute the eight-case matrix with counters, usage/cost capture and critical-failure stops. Runner adaptation and genuine acceptance remain pending. Do not rerun exhausted older paid CI campaigns. A [separate Railway preview plan](RAILWAY-PREVIEW-PLAN.md) is prepared; resource creation/deployment waits for explicit owner approval. Preserve this branch/PR; do not start features, merge, deploy or touch production.

Outstanding external acceptance: genuine model extraction/reasoning with a new explicitly bounded development budget; physical Android Chrome and affected embedded browser, real keyboard/microphone; WebKit/Firefox. See REAL-DEVICE-CHECKLIST.md. These are not established by Chromium emulation or scripted extraction. No production credential should be copied into this environment to obtain them.

### Final identifier audit after opening PR #43

Review found ten-digit phone/reference evidence could be accepted as an account if the model proposed it. Account grounding now excludes explicitly labelled non-account identifiers, rejects multiple competing account candidates, and does not retain an explicitly superseded account or institution. Bank aliases/codes are independently scoped and ambiguous alternatives stay empty. Correcting one account no longer trips the old overly broad “missing account” negation. The new focus suite passes **82 tests/three files**; full local suite now passes **1,282 tests/54 files**, build/typecheck/lint and the repeated native/chat/voice/multimodal browser checks pass. Node 22.16/24 CI passed at `bdff303` ([run](https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/39623365829)). Existing amounts and execution controls are unchanged. PR: https://github.com/omnmlr/hackaholics-financial-agent/pull/43.

### Composer refinement checkpoint

A focused accessible component replaces the right-side paperclip with **[+] [input] [microphone] [send]**. Desktop exposes Choose image; supported mobile capture APIs also expose Take photo via the native file picker. Keyboard arrows/Home/End, Escape/focus restoration, Tab, outside dismissal, auth/operation locks, actual file choice/empty cancellation, preview removal and zero automatic uploads are tested. No extractor, privacy limit, payment, permission or approval control changes. Menu capability is emulated for the positive camera branch; physical camera remains unverified.

Typecheck, lint and production build pass. Final campaign: **300 grouped browser checks**, six widths (1440/1920/1280/820/390/320), **12 axe scans**, zero violations/page errors. Actual menu/preview/draft/outcome captures inspected. Sources and tests are ready for the final same-PR CI run. Full financial suite remains 1,282 tests/54 files; CI runs it again. Fresh artifacts: validation/final-workflows.json, composer-_.log and screenshots/_-attachment-menu.png. The prior harness approval-read race was fixed by waiting for persisted submission controls; no assertion was weakened.
