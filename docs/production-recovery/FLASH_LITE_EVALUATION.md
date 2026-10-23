# Separate-key investigation and Flash-Lite evaluation — 23 October 2026

The owner confirmed that the injected Gemini credential is a newly created key,
**different from the key in Netlify production**. All successful isolated tests
use that new key. They do not authenticate or validate the old production key.
No production key, model, deployment, database, Railway resource or payment
setting was changed. PR #44 remains draft.

## What the credential difference establishes

Read-only Netlify checks still show deployment `6ada1aa358e288da5818c039`, commit
`869b5b9`, production context and `AI_MODEL=gemini-3.6-flash`. The production
`AI_API_KEY` is still secret, has functions scope and was last updated in Netlify
at 14:15:37 UTC on 22 October. That timestamp is when Netlify's binding changed;
it does not establish the Google key's creation time or validity.

The native adapter rejects an empty/missing key before HTTP with
`MODEL_NOT_CONFIGURED`. Production instead recorded `MODEL_HTTP_401` before any
financial tool, so its failure is at provider authentication, not account
selection, financial search, payment preparation or narration validation. A
nonempty credential was configured; this does not prove its value or runtime
request was correct. The same SDK/adapter path successfully authenticates using
the new key in the isolated environment. The production RPC reason and the old
key's validity remain unobserved; a credential/configuration difference is now
confirmed, but an exact expired/invalid/restricted-key diagnosis is not.

Google's current [key documentation](https://ai.google.dev/gemini-api/docs/api-key)
adds a relevant possibility: new AI Studio keys default to authorization keys
bound to a service account. Unrestricted standard keys can be rejected, and
dormant unrestricted keys can be blocked. The old key's type/restrictions have
not been inspected, so this policy must not be reported as the proven cause.
Read-only metadata from its owning Google project, or an isolated REST → SDK →
AGUS run with that exact old key securely bound, would distinguish a bad old key
from a Netlify runtime problem without changing production. Netlify's API cannot
provide that secret. Merely switching models is not an established 401 repair.

## Independent capacity sample

`scripts/verify-flash-lite-capacity.ts` uses the real native AGUS adapter and
installed SDK, with no database or payment imports. It makes at most 24 genuine
generations, one in flight, spaces starts by at least 6.5 seconds, disables
redirects, has no retries and stops on provider/network failure. Each attempt is
saved before sending; pacing happens outside the application's unchanged
20-second request deadline. Inputs and recorded answers are synthetic. It tests
eight conversational answers, eight strict structured draft extractions, and
four native function-call/response round trips. Tool arguments are checked and
the complete returned content, including thought signatures, is preserved in the
next request; a local integer multiplication is the only backend operation.

Result: **24/24 HTTP 200 and 20/20 quality cases passed**. Starts spanned
149.543 seconds, with at most 10 in any observed rolling minute. Provider-call
latency, including response-body reading, was **953 ms p50, 2,415 ms p95 and
4,473 ms maximum**. Reported usage was 1,381 input tokens and 1,992 total tokens.
See [the complete capacity artifact](flash-lite-capacity-20261023.json).

This establishes a lower bound of 24 accepted calls in this test window, not a
published RPM/RPD entitlement, maximum sustainable throughput or concurrency
benchmark. The short prompts do not represent the full AGUS prompt/token load.
Google's [rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits)
says quotas apply per project, not per key, vary by model/tier, and daily quotas
reset at midnight Pacific time. Creating a second key in the same project does
not create another quota pool. Active project quotas are visible in AI Studio;
this environment has no Google administrative identity to read them. Neither
the old and new keys' project relationship nor their exact current quotas is
known.

The prior 3.6 campaign observed a 20-request/day free-tier 429 with a long retry
delay. A **fresh single 3.6 control returned HTTP 200** on 23 October. Therefore,
that historic limit must not be treated as a currently reproduced failure or as
proof that Flash-Lite has a larger current entitlement than 3.6. No attempt was
made to exhaust either model's allowance. See [the control](gemini-36-control-20261023.json).

## Actual AGUS acceptance

A fresh production-build run on Flash-Lite with the new key made **10 provider
requests, all HTTP 200**, and passed ordinary conversation, education, account
selection, genuine narrated spending (₦19,751.51), authorized Ada search,
payment preparation, extracted editable fields, idempotent reopen, and payment
draft persistence after process restart. No approval or execution occurred.
All financial records and credentials were local/disposable fixtures.

The campaign then exposed another browser-runner assertion issue: ordinary
answers render as separate paragraph elements, while its exact-text locator
expected one combined element. Saved API history was correct. The runner now
asserts each paragraph and deliberately requests a two-paragraph joke. A focused
fresh genuine persistence run passed process restart and Chromium reload, using
one HTTP 200 generation. The initial FAIL artifact is retained separately from
the focused PASS: [application run](flash-lite-application-20261023.json),
[corrected persistence run](flash-lite-persistence-20261023.json).

To check the production runtime family independently, the existing direct REST
→ SDK → AGUS diagnostic was also run under **Node 22.23.4** using a temporary
Node installation. All three calls returned HTTP 200 (1,150 / 1,484 / 848 ms),
with valid SDK text and adapter completion. Netlify's exact Node patch version
was not exposed; the local runtime matches its Node 22 major family. See
[Node 22 evidence](flash-lite-node22-20261023.json). No application timeout,
SDK dependency or model setting was changed to obtain these results.

## Candidate decision

Flash-Lite with the new key is a credible **candidate for an approved production
trial**: it works with AGUS's native tools, structured extraction, source
validation and persistence, and the bounded sample had no 401, 429 or timeout.
Google lists this stable model as designed for high-volume workloads, with
function calling and structured outputs supported in its
[model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).
Its 1,048,576 input and 65,536 output token limits were also confirmed by the
authenticated model metadata endpoint; these are context limits, not quotas.

The proposed later configuration would pair the **tested new key**, installed
through a secure production binding, with `AI_PROVIDER=gemini` and
`AI_MODEL=gemini-3.5-flash-lite`. This is a proposal only. Changing the model while
retaining an unvalidated production key may preserve the 401. Before a production
capacity commitment, inspect the intended project's active RPM/TPM/RPD quotas
and account for multiple model generations per AGUS turn. The evidence supports
a bounded trial, not a guaranteed capacity increase or an exact historic 401 fix.
