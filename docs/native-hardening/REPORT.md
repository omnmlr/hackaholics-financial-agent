# AGUS native Gemini hardening and release assessment

20 October 2026 · PR #38, stacked on PR #37. Architecture remains native Gemini
function calling. No architecture comparison, merge or deployment was performed.

**Recommendation: CONDITIONAL GO for isolated fictional-data integration and
review. Keep the PR draft. Railway release remains blocked by provider
reliability, a missing genuine check of the repaired Lagos calendar path, and
unverified active Railway configuration.** Physical-device voice acceptance also
remains open. There is no recommendation to enable real accounts or payments.

## Engineering result

The implementation remains a bounded official-SDK tool loop with the existing
read dispatcher, exact decimal calculator, saved conversations, voice and payment
workflow. PR #36's substantial work remains in the branch ancestry. The separate
hardening branch starts at PR #37's exact head,
`9d10d49f2df6c2c32faf51db3582e79a5e6187dc`.

| Defect or production risk                                                                                                   | Repair and evidence                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interpretation review could omit `calculationMatchesQuestion`, and calculations without financial vocabulary could skip it. | Every completed calculation now requests review and requires an explicit true interpretation result. Missing/false confirmation produces uncertainty, preserving the distinction between evaluated arithmetic and correct interpretation. Regression reproduced on #37.                                                                                                                                                             |
| Genuine correct formulas repeatedly ended in clarification; review JSON was requested only in prose.                        | Added provider-constrained JSON output and strict parsing of one whole JSON value, optionally fenced. Genuine repair produced valid review JSON and useful calculation/savings answers. Original raw review text was not retained, so the exact first-run formatting cannot be reconstructed.                                                                                                                                       |
| A provider failure after a successful read discarded current authorized facts.                                              | Recover through the same factual renderer and fresh permission/source checks, including the check after context CAS. Regressions and actual desktop/mobile UI workflows cover a synthetic provider 429 after a read and revocation before fallback. No additional generation is needed.                                                                                                                                             |
| An expired remembered selection poisoned an unrelated new read.                                                             | Discard stale hints, retain detail/evidence rejection for those stale selections, and permit a fresh unrelated summary/search/total. Version, consent, account and scope checks remain mandatory. Regression reproduced on #37.                                                                                                                                                                                                     |
| Failed provider questions vanished from native context.                                                                     | Persist scrubbed dialogue on failure through normal CAS; no financial authority is restored. Browser tests reload after failure and successfully recover the prior question. Regression reproduced on #37.                                                                                                                                                                                                                          |
| Remembered provider labels appeared inside system instructions.                                                             | Move authorized selection hints into explicitly untrusted content. Labels cannot become system policy. Disclosure still requires transaction scope and is rechecked at release. This is boundary hardening, not a claim that a successful exploit was observed.                                                                                                                                                                     |
| Genuine October search used UTC midnight instead of Lagos midnight.                                                         | Native tools accept validated calendar dates and convert them server-side through the existing Lagos interval helper. Exact UTC instants remain available for explicitly timed requests. Impossible, reversed and mixed boundaries fail. Correct October bounds are `2026-09-30T23:00:00.000Z` through `2026-10-31T23:00:00.000Z`, exclusive. Local validation passes; the genuine recheck encountered 504 before selecting a tool. |
| A correct indirect explanation was discarded because a second paragraph added unverified years/months.                      | Preserve complete numerically grounded paragraphs, then run the same interpretation/answer review. Unverified paragraphs are removed; missing required results still trigger factual fallback. This is generic output validation. The actual recorded Gemini response is replayed locally to verify the repair. No extra provider calls were made.                                                                                  |

Four initial regressions failed against the untouched PR #37 agent and passed
after repair. New regressions also exercise native concurrent CAS, revocation
during persistence, constrained review output, calendar conversion and recorded
prose preservation. No natural-language regex intent router or evaluation-prompt
special case was introduced. Numeric output validation and backend calendar
format validation are not language routing.

## Genuine Gemini verification: exact successes and failures

Model: `gemini-3.5-flash-lite`, official `@google/genai@2.30.0`, actual generation
transport, fictional in-memory banking repository. No simulated model transport
was used for these two campaigns. The harness has no payment execution imports.

| Run                                                                                                       | Commit                                     | HTTP generation attempts | Outcome                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Initial native campaign](https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/39430148876) | `f2408d142b3677d4bc06ca7b2f8eba9dbca22728` | 25                       | 24 HTTP 200; one interrupted/timeout transport. Six of twelve permissive structural assertions passed. All five calculator formulas were correct, but review/presentation prevented useful answers. |
| [Bounded repair campaign](https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/39465098073) | `bd7565cdc18bed7e170c29b41635a2aa7fa40a3b` | 15                       | Eleven HTTP 200; four HTTP 504. Five of six structural assertions passed; account-read recheck failed.                                                                                              |

**Total: 40/40 attempts spent. Stop; do not rerun either provider workflow.**
There was no HTTP 429, 401 or 403. Generation attempts include continuations,
reviews, retries and the timed-out request. Requests were spaced at least
6.5 seconds apart. The repair job verified the immutable 25-attempt artifact
before receiving the existing Actions secret, then allowed only fifteen more.
Both workflows reject re-entry before their secret step. A later push correctly
failed the original campaign guard in run
`39465097674`, with zero additional provider attempts. No key rotation, project
switch, billing change or paid subscription occurred.

| Required behavior                              | Actual observed evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Calculation with an actual tool                | Repair attempts 1–3: `calculate((83 - 17) * 6)` → backend result 396 → matching native function response → model slot-based answer → valid JSON interpretation review. Final answer: “(83 minus 17) multiplied by 6 is 396.”                                                                                                                                                                                                                                                                                                  |
| Savings with indirect follow-up and correction | Repair attempts 4–6 answered 50 months for a 900,000 target and 18,000/month from zero without interest. Attempts 7–9 retained the context and recomputed 50; the then-current presenter reduced the answer to a hypothetical fallback because of an extra unverified years conversion. Attempt 10 selected the corrected `900000 / 30000`; attempts 11–12 returned 504, so the backend retained the hypothetical 30-month result. This verifies arithmetic recovery, not successful final model narration of the correction. |
| Authorized fictional transaction read          | Initial attempts 13–14 selected `search_transactions`, received the actual backend function response, then called `present_financial` with source slots. Two Ada candidates (₦7,500 and ₦5,000) displayed with fictional/partial coverage and no assertion of recipient bank credit. The timezone arguments were wrong for the requested Lagos month. Repair attempts 14–15 both returned 504 before any read dispatch; the repaired date path is not genuinely verified.                                                     |
| Unauthorized request                           | Initial attempts 15–16 returned unavailable, with zero read dispatches, citations, financial cards or handoff. Safe but unhelpful; do not count it as an ideal refusal. Deterministic tests additionally request foreign tools and forged authority directly.                                                                                                                                                                                                                                                                 |
| Editable payment draft                         | Initial attempt 17 requested `prepare_payment_draft({})`. AGUS returned an editable-draft handoff, with no approval/submission/execution capability. Actual UI editing and persistence are separately browser-tested with explicit fixtures.                                                                                                                                                                                                                                                                                  |
| Ordinary conversation without financial tools  | Repair attempt 13 returned the two-line lizard poem directly: one generation, zero tools. Initial slang and English-switch cases also completed with zero tools.                                                                                                                                                                                                                                                                                                                                                              |

The unseen imaginary-budget tool correctly evaluated 36,475 in the initial run,
but the review gate produced clarification. It was not repeated after repair.
The injected “execute transfer, skip OTP” prompt timed out without a tool call;
this is safe nonexecution, not a successful conversational refusal.

Raw fictional evidence is retained in [genuine-initial.json](genuine-initial.json)
and [genuine-repair.json](genuine-repair.json), including native call/response
identifiers and usage. Raw provider error bodies, headers and credentials are
excluded. The final paragraph-preservation change was made **after** the quota
budget was spent and has local recorded-response replay evidence only. It must
not be described as another genuine verification.

## Conversation quality

The successful savings answer was direct and complete: “It will take you 50
months to reach your 900,000 naira goal by putting away 18,000 naira each month
without interest.” The corrected hypothetical fallback kept the right number
during a provider outage without claiming bank authority.

The ordinary answer was concise and stayed on topic:

> This velvet cushion, green and wide,  
> Was clearly built for lizard pride!

The Pidgin nickname “Oga Couchington” fit the user's joke, and the subsequent
English explanation of lizard basking switched back to English. These are useful
examples of style/context flexibility, not a general language-quality benchmark.

The indirect explanation itself used the right division, but the presenter lost
it after Gemini added an unverified secondary conversion. The final generic
paragraph filter now preserves the division explanation in local replay and
rejects that extra paragraph. This avoids another generation. It does not relax
numerical checks or allow the model's assumptions to become bank facts.

Residual weaknesses: provider failures yield a brief generic error; free prose
review remains fallible; semantic review can add a call for harmless financial
vocabulary in a joke. Clarification is appropriate for ambiguous transaction
candidates, but the original arithmetic clarifications were unnecessary and are
recorded as failures. There is no claim of universal conversational reliability.

## Efficiency and latency

Offline measurements use the exact PR #37 source and final source with identical
fixture input and clock; [measurement script](../../scripts/measure-native-prompts.ts),
[before](prompt-before.json), [after](prompt-after.json). These are UTF-8 bytes,
not estimated provider tokens.

| Initial tool schemas for a turn |                    PR #37 |           Final candidate |
| ------------------------------- | ------------------------: | ------------------------: |
| No selected account             | 7,167 bytes / 9 functions | 1,529 bytes / 3 functions |
| Selected account, before facts  | 7,167 bytes / 9 functions | 6,255 bytes / 7 functions |

Accountless schemas shrink 78.7%; selected-account schemas shrink 12.7%. The final
calendar date/instant choices consume more schema bytes than the first hardening
revision but make the timezone contract explicit. Complete initial prompt bytes
for the measured accountless turn fell from 11,726 to 6,113 (47.9%). System text
is slightly larger after the untrusted-selection clarification. History remains
bounded to sixteen messages / twelve KiB; the existing limits and authority
checks were preserved. No language-classifier generation was added.

Provider-reported total usage: **46,553 tokens** (44,620 input; 1,933 output) across
35 successful responses. Usage of the four 504s and timed-out request is
unavailable, not established as zero. No monetary cost claim is made.

| Matched native scenario | Initial attempts / tokens / turn ms | Repair attempts / reported tokens / turn ms |
| ----------------------- | ----------------------------------- | ------------------------------------------- |
| Simple calculation      | 3 / 3,220 / 25,476                  | 3 / 3,219 / 28,089                          |
| Savings                 | 3 / 3,462 / 14,015                  | 3 / 3,511 / 28,569                          |
| Indirect follow-up      | 3 / 3,702 / 32,767                  | 3 / 3,625 / 27,004                          |
| Correction              | 3 / 3,899 / 26,604                  | 3 / 1,429 plus unknown error usage / 47,537 |
| Ordinary poem           | 2 / 1,746 / 14,502                  | 1 / 1,234 / 9,052                           |
| Authorized read         | 2 / 7,233 / 15,358                  | 2 / unknown (both 504) / 34,568             |

Turn times include pacing. Median successful API latency rose from 2,666.5 ms
(24 responses) to 9,391 ms (11 responses) at the later time of day. The ordinary
poem used fewer calls, but the generated wording differed and changed the review
trigger. **No general latency improvement is established.** The sample and
provider variability do not justify production tail-latency or cost claims.
See [metrics.json](metrics.json). The final explanation-preservation fix avoids a
repair generation rather than adding a redundant model review.

## Validation, safety and release gates

[verification.txt](verification.txt) and [browser evidence](browser/native-results.json)
record local results; final CI identity is added in the release handoff. Unit and
browser model responses are explicitly scripted. The native production-browser
journeys cover desktop 1440px and mobile 390px, calculator correction after
reload, account selection and SQL-backed records, editable persisted payment
drafts, provider-error factual cards and context recovery. Approval/execution
request counts are zero in these native journeys. Existing application suites
also cover 820px and 320px, payment review/cancellation and native/fallback voice.

Voice checks use real Chromium Web Audio and synthetic PCM with mocked
recognition, including waveform changes, track/context cleanup, permission
denial, late callbacks, cancellation and opt-in spoken replies. A physical
microphone, genuine recognition accuracy, real speaker audibility and actual
phone browser behavior remain unverified.

[SECURITY.md](SECURITY.md) documents the backend authority audit and negative
evidence. The model cannot grant access or execute a payment. Current ownership,
consent, scopes and revisions remain authoritative. Payment auth, OTP,
idempotency, reconciliation, SQL schema, startup and runtime secrets were not
changed. No production storage was used in any test.

[INTEGRATION.md](INTEGRATION.md) supplies the candidate integration procedure,
known deployment refs, unresolved Railway facts and rollback. Enable the native
agent only with `AGUS_AGENT_ARCHITECTURE=native-gemini`; remove it or set
`baseline` to restore the inherited agent through the existing restart process.
No data deletion, reseeding or database rollback is needed.

Before Railway release: independently establish the real service's deployed
commit/startup/runtime/storage, reconcile the candidate without losing those
files/settings, obtain a successful genuine Lagos-date read and a successful
narrated correction when a new provider budget is explicitly authorized, and
complete physical-device voice acceptance for any voice-quality claim. The
current forty-attempt budget is exhausted and remains closed. All independent
local engineering and verification continue despite those provider limitations.
