# AGUS autonomous architecture investigation — 20 October 2026

## Decision and release status

Implemented a working, opt-in Gemini native-function-calling candidate on
`experiment/agus-model-led-20261020`, based on PR #36 commit
`dac1f769bff31a3c5ef5820e222e9545025163cd`. Retain PR #36 as the default.
**Keep this PR draft. There is insufficient genuine-provider evidence to select
the new architecture for deployment.** No merge or deployment occurred.

The new candidate uses pinned `@google/genai@2.30.0` and `decimal.js@10.6.0`.
Gemini chooses a direct answer, a mathematical expression, a read tool, a
clarification or an editable payment-draft handoff. The backend validates every
request and retains financial authority. A server-only flag,
`AGUS_AGENT_ARCHITECTURE=native-gemini`, selects the candidate; requests cannot
change the flag, model, principal or tool allowlist.

The genuine A/B/C campaign **stopped at HTTP 429 on generation attempt 17**.
The remaining tests did not run. No retry, alternate key, alternate model or paid
resource was used to continue past the limit. Eight scenario/candidate turns
were recorded, including the interrupted baseline turn. This is the exact
blocker to completing the requested comparative acceptance, not a passing result.

## Architecture investigation

[ARCHITECTURE.md](ARCHITECTURE.md) contains the sourced comparison of native
Gemini function calling, Vercel AI SDK `ToolLoopAgent`, LangChain/LangGraph and the
existing orchestration, plus registry/package compatibility checks and
ReAct/τ-bench research implications. The selected prototype is a small loop over
the official SDK, rather than another graph/persistence framework. AGUS already
owns durable chat and payment state machines; duplicating them before the finals
would add integration risk without supplying financial authorization guarantees.

This is an implementation choice to test, not evidence that frameworks are less
capable or that the prototype is superior. The current SDK's default five HTTP
attempts are explicitly reduced to one. The application permits one bounded retry
for 500/502/503/504, never quota/authentication retries. Every outbound generation
attempt is counted independently by the comparison harness.

## What PR #36 already does, and what changes

The existing conversational agent classifies first, then routes to general,
education, reasoning, product, records or payment handoff. General responses use
generation plus independent review after classification. Calculations commonly
use classification, a source-bound calculation plan, composition with exact
value slots, then semantic review. A separate read loop validates tool arguments,
ownership, consent, scope, source revisions and provenance, and can render factual
cards when narration fails. This substantial work remains available unchanged.

The prototype replaces language routing with native function selection. It keeps:

- authenticated HTTP/origin checks, operator identity and owner-scoped storage;
- the existing read dispatcher, result schemas, provenance validators and factual
  presentations;
- consent, account membership, scopes, revision checks, bounded selection memory,
  fresh detail-before-evidence and ambiguous-record selection requirements;
- PR #36's UI, measured voice input, opt-in speech, saved chats and payment flow.

The secure read adapter exposes the existing five named read tools. Before and
after every read, and immediately before releasing results, current permissions
and source versions are checked. A saved selection is included in a model prompt
only when current selection, access version and expiry still match. Expired or
changed selections cannot disclose old labels/amounts to the model merely because
they exist in memory. Search and detail sequencing remain bounded and serialized.

Financial narration uses the existing source-linked slots and deterministic
acceptance rules. Unrecognized financial prose falls back to authoritative cards;
it does not gain authority through fluency. Free conversational financial prose
retains a separate bounded semantic review. Ordinary nonfinancial conversation
can finish in one generation. The lexical output backstop and selective-review
trigger do not classify user intent or decide which tools to call.

### The reported failures

The original artifact was downloaded and retained verbatim as
[pr36-prior-gemini-evaluation.json](pr36-prior-gemini-evaluation.json), from
[run 39411663095](https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/39411663095).
It records 15/17 structural passes and 49 genuine calls to
`gemini-3.5-flash-lite`.

The indirect follow-up received a clarification that explicitly repeated the
₦10,000/month and ₦1,000,000 context. This demonstrates that relevant context was
available; the model chose to clarify instead of explaining. Three calls were
spent classifying, answering and approving that unhelpful answer. A safety review
does not establish task fulfillment. The prototype supplies the dialogue directly
to the same model that chooses tools/final communication and instructs it to
resolve corrections and explain prior answers without requiring command forms.
No exact-sentence routing patch was added.

For the budget arithmetic, the three-call `CALCULATION_PROSE` result is consistent
with classification, calculation planning and composition followed by rejection
in `composeCalculation`: missing/unknown slots or literal numbers/currency in
prose cause the whole answer to be discarded. The legacy recipe path has another
prose guard, but would reject before that third composition call. The artifact
does not retain intermediate provider outputs, so the exact offending token
cannot be recovered. The prototype independently evaluates
`150000-80000-25000` as `45000` and can retain an explicitly hypothetical factual
answer after a prose/provider failure. This is covered by deterministic and
production-browser tests; it has **not** yet been verified with genuine Gemini.

Duplicate assumptions arose because model composition included assumptions that
the backend also appended. The new path does not blindly append model-authored
assumptions. Its factual fallback excludes unvalidated assumption prose. If
semantic review rejects the formula/interpretation, it distinguishes that from a
prose-only problem: it reports the evaluated expression with explicit uncertainty
instead of presenting a knowingly rejected interpretation as the answer.

## Mathematics and bounded execution

The calculator accepts a bounded arithmetic grammar: decimal constants, arithmetic,
percentages, integer powers, parentheses and `ceil/floor/round/sqrt/abs`.
It never executes JavaScript or model-written code. Gemini interprets the problem
and chooses the expression; no savings/budget language grammar is required.
Decimal precision is 120 digits within a magnitude limit of 10^100; monetary
outputs round half-up to kobo, other fractional outputs to twelve decimal places,
with an explicit approximation marker. Bounded integers retain their digits.

Arithmetic evaluation does not prove the model selected the right figures,
formula or units. Financial semantic review and scenario evaluation address that
separate, fallible interpretation step. The backend inserts computed numeric
slots into explanations and falls back if explanation numbers do not match.

The native turn permits at most four model generations, five executed native
functions, 60 seconds overall and 20 seconds per generation. Rejected function
requests can also appear in the diagnostic request counter. Reads have a separate
five-dispatch ceiling (including automatic prerequisite reads), ten-second waits
and a 48 KiB aggregate result budget; strict per-result validation also applies.
Read transports do not accept cancellation signals in the legacy interface: a
timed-out read may finish in the background, but cannot authorize a mutation or
release a late answer. Model requests are cancelled on deadline.

The comparison separately records native function requests and actual backend
dispatch attempts. They are different metrics: `present_financial` and
`request_account` are functions but do not dispatch a banking read; prerequisite
detail reads can add dispatches. Do not compare their counters as equivalent.

## Genuine provider comparison: incomplete

Evidence: [run 39422739466](https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/39422739466),
evaluated commit `c5b4132a2527d621e8d6c77af002b412c250d7c3`,
[verbatim report](comparative-gemini-evaluation.json).
The requested model was discovered through the provider model-list API before
generation. Sixteen requests returned 200; request 17 returned 429 during B's
review of the millionaire calculation. The harness stopped all candidates.
The response body was not retained, so this evidence does not distinguish a
per-minute limit from another quota condition or establish its reset time.

The intended corpus has 29 scenarios per candidate: the original 17, unseen
creative/math/language cases, correction/expiry, permission and malicious-tool
cases, injected read failure and repeated critical questions. Candidates are
interleaved to reduce time/load confounds. A has no private tools and is not
credited with account-read capability. B is the unchanged PR #36 implementation.
A/C use temperature 0.2 and 2,048 output tokens; B retains its provider defaults.
Thus these are practical-system comparisons, not controlled decoding ablations.

Only two prompts completed for all three candidates:

| Completed matched turn | A direct | B PR #36 | C native prototype |
| --- | --- | --- | --- |
| Casual tired-day conversation | 1 call; 1,056 ms | 3 calls; 7,085 ms | 2 calls; 3,490 ms |
| Why learning feels difficult | 1 call; 4,773 ms | 3 calls; 6,161 ms | 2 calls; 4,079 ms |
| Total reported tokens for these two turns | 615 | 3,078 | 8,465 |

All six matched turns passed the harness's permissive structural checks. Manual
review found that C still carried Pidgin into the English follow-up and added an
unrequested religious explanation. Its tired-day answer was also longer and more
financially themed than necessary. Both C turns consequently triggered financial
prose review and used two generations, rather than demonstrating a genuine
one-call ordinary reply. General tone instructions were tightened afterward;
that revision is covered locally but **not** live-model validated.

C used fewer calls and lower observed turn latency than B on these two turns,
but substantially more input tokens because native function schemas and policy
are present up front. It is not demonstrated to be cheaper or more reliable.
No currency-cost claim is made without verified pricing. The dataset is too small
for useful tail-latency conclusions. Raw p50/p95 fields remain in the artifact as
descriptive order statistics, not population estimates.

A additionally answered the millionaire question correctly as 100 months,
8 years and 4 months. B's turn was interrupted by HTTP 429; it must not be counted
as an arithmetic reasoning failure. C did not reach this scenario. No genuine
native calculation/read/function-response round trip, correction, authorization,
or recovery scenario completed. Those remain provider acceptance blockers.

The historical baseline's 17-turn median was 15,097 ms and nearest-rank p95 was
34,057 ms, with 49 calls and five-second request pacing. Do not compare those
timings directly with this campaign's 1.5-second pacing. Future harness pacing is
now five seconds; the automatic rerun guard remains closed after the quota stop.

## Local verification and safety evidence

[verification.txt](verification.txt) records final commands/results. The new
tests use scripted models or mocked HTTP, never genuine-provider claims.

The final implementation commit `b5ef640e1a672925adac5b207154ffbbc1d83271`
also passed [isolated CI run 39424438282](https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/39424438282):
**1,142 tests in 47 files**, typecheck, lint, production build, HTTP smoke,
existing browser/voice suites and native browser journeys. Its additional test
requires transaction-read scope for remembered-selection disclosure and rechecks
that disclosure before release even when Gemini uses no new read tool.
Subsequent commits update evidence/documentation only. See
[ci-quality.json](ci-quality.json) for exact run, commit and artifact identity.

- Native protocol tests preserve complete provider content, thought signatures,
  function IDs and response ordering, and verify the SDK has no implicit retries.
- Calculator tests cover generic formulas, percentages/compound growth, operator
  precedence, exact decimal subtraction, large integers, rounding and hostile or
  unsupported expressions.
- Read tests cover unauthorized scope, revocation/version changes, mismatched
  source envelopes, evidence sequencing, ambiguous selection, duplicate/parallel
  calls, budgets and factual-narration fallback.
- Loop tests cover direct conversation, dialogue restoration, changed figures,
  malformed arguments, undeclared tools, provider 503/429, bounded loops,
  rejected financial claims and redaction in both generation/review prompts.
- Production-browser native journeys at 1440 and 390 pixels cover a generic
  calculation (540), a correction after reload (1,080), budget remainder (45,000),
  account selection and fictional spending (19,751.51), and an editable persisted
  payment draft. Approval/execution request counts remain zero in these journeys.
- Existing HTTP payment smoke and browser suites cover the preserved payment,
  persistence and voice behavior. Voice tests use Chromium/synthetic PCM and
  mocked recognition; physical microphones, live recognition accuracy and audible
  playback on real devices are not validated here.

See [native browser report](native-browser-results.json),
[existing browser report](existing-browser-results.json),
[voice evidence](voice-results.json), and
[mobile screenshot](native-mobile.png).

No changes were made to payment authorization/execution, OTP, Paystack,
reconciliation, database schemas, startup scripts, production credentials,
`main`, the deployment branch or Railway. The native tool allowlist contains no
payment approval/execution function. Draft creation confers no transfer authority.
Independent review also found and reproduced stale-selection disclosure,
unvalidated fallback assumptions and long-integer truncation during development;
all were repaired with regression tests before this handoff.

## Acceptance status and next action

Working implementation, architecture research, backend safety regressions,
typecheck/lint/build, HTTP/browser verification, reviewable draft PR and deployment
instructions are supplied. Broad language understanding, continuity, correctness
and recovery are exercised locally, but genuine A/B/C acceptance is incomplete.
In particular, **17/17 genuine scenarios, material reliability improvement,
repeated-run consistency, and a defensible latency tail are not demonstrated**.
Prompt injection robustness and the same-model semantic reviewer remain fallible;
backend permission/execution boundaries do not depend on model obedience.

The user/provider account must have usable Gemini quota again before another
genuine campaign. The observed limit/reset type is unknown; check it through the
existing provider account without exposing the key. No new subscription or
privileged integration is needed for the prepared code. Do not retry automatically
or route around the exhausted limit. Once usable quota is confirmed, explicitly
review the ledger (17 generation attempts spent), allocate a remaining campaign
budget at most 233, and prepare a separately gated isolated run. The harness caps
an individual run at 220, so `AGUS_EVAL_ALREADY_SPENT=17` and
`AGUS_EVAL_MAX_CALLS=220` would keep the campaign at most 237. It must still stop
on 401/403/429 and use the current five-second pacing. Tighten or reduce that
allocation if other authorized work consumed quota/campaign calls. Preserve this
partial artifact and report the new commit separately.

After provider validation and review, use [HANDOFF.md](HANDOFF.md) to prepare an
integration branch without changing Railway's startup, environment, persistent
data or payment controls. It includes the judge-ready architecture explanation.
Deployment still requires the user's explicit approval.
