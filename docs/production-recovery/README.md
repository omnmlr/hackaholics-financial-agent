# Production recovery investigation — 22 October 2026

PR #44 remains a draft. Existing diagnostics and all earlier work are retained.
The changes below have not been merged or deployed. Production's HTTP 401 root
cause is still unconfirmed; this is not a claim that production is repaired.

## Authenticated evidence

The republished environment exposes `AI_API_KEY` and `NETLIFY_AUTH_TOKEN`.
Authenticated Google model-list and Netlify user requests both returned HTTP 200.
The managed runtime's readiness fields remain `unknown`; actual API responses,
not those fields or mere variable presence, establish the tested authorization.
Shell probes initially needed the command runner's additional network permission.
No secret value, header, cookie or raw provider exception was printed.

The existing `scripts/diagnose-gemini.ts` passed direct Gemini REST, installed
`@google/genai` 2.30.0, and AGUS native adapter checks on both `gemini-3.6-flash`
(published setting) and `gemini-3.5-flash-lite` (existing application default).
All six requests returned HTTP 200; SDK text and adapter completion were valid.
The harness observed the explicit key header and Gemini Developer endpoint at
each layer, with no ambient Google override variables in this environment.
This establishes the injected credential's working path, not its equality to
Netlify's production secret or the historic failure reason.

## Published Netlify configuration and database attribution

Read-only Netlify API calls confirm site `askagus`, ID
`fee8fc4a-b59d-4c8c-894b-599cf6d5a1e6`, published deployment
`6ada1aa358e288da5818c039`, commit
`869b5b9b488299007ece130e78d76cf5fc102d45`, published at
14:17:01.038 UTC on 22 October. Its branch is
`deploy/agus-netlify-emergency-20261022`, but its deploy context is **production**.
The branch-named URL does not make this a branch-deploy context.

Current resolved production settings are `AI_PROVIDER=gemini`,
`AI_MODEL=gemini-3.6-flash`, `AGUS_AGENT_ARCHITECTURE=native-gemini`,
`PAYMENT_MODE=fixture`, `FINANCIAL_DEMO_ENABLED=true`, and Node 22.
Both transfer-enable flags are false. The function is the Next.js server handler,
running `nodejs22.x`; build command is `npm run build`, publish directory `.next`.
The site reports no managed Netlify database, no service instances, and the
deployment has no `database_branch_id`. Its database is selected through the
production `DATABASE_URL` binding, not a Netlify-managed branch association.

`AI_API_KEY` and `DATABASE_URL` have function scope and production-context values,
but are marked `is_secret=true`. Netlify's documented API contract withholds
non-development secret values outside Netlify's systems. Masked values must not
be compared to injected keys or parsed as database URLs. Their plaintext values
and the resolved endpoint could not be independently retrieved.

The storage attribution can nevertheless be established by correlation:
the published function's historical log contains a native `provider_http` 401
event at **14:18:25.413 UTC**, one model call, zero tools. A read-only query of
Neon's **production** branch finds the 401 turn with that exact `completed_at`;
its SQL insertion is at 14:18:25.461 UTC. The preview branch contains no matching
error turns that day. The same production branch has six 401, seven 503 and five
TIMEOUT turns. Both queries explicitly used READ ONLY transactions and a
five-second local statement timeout; only allowlisted codes and timestamps were
returned. See [database-evidence.json](database-evidence.json).

This ties the observed Netlify failure to production storage, without reading
financial records, credentials or identities. No database retargeting, migration,
reset, schema change, seed or write was performed.

## Genuine functional defect and smallest repair

Genuine `gemini-3.6-flash` conversations and education worked. Spending tools
returned correct fictional data, but the model embellished the explanation with
total/requested-period wording. The deterministic grammar rejected it, and the
independent reviewer rejected the broader prose (`scope_or_coverage` or
`unsupported_claim`), leaving factual fallback. Those are application validation
failures after successful provider HTTP 200, separate from production's 401.

The repair changes only two native authoring instructions: prefer an existing
source-proven example, preserve slot roles, and leave coverage/date details to
the authoritative cards and server caveats. No validator, permission, payment
authority, retry policy or source-data behavior was weakened. A fresh targeted
3.6 spending turn then returned genuine `narration=ai`, correct expenses
₦19,751.51, two model calls and two tool calls instead of fallback.

Further calls to 3.6 hit HTTP 429. A bounded follow-up error inspection established
`RESOURCE_EXHAUSTED`, a **20-request/day free-tier limit**, and a retry delay of
38,829 seconds for the injected credential's project/model. Calls to that model
were stopped. This is not evidence that the historic 401 was a quota error, nor
that the injected key and production key belong to the same project. The existing
3.5 default was then verified separately; production configuration was unchanged.

## Reproducible genuine acceptance

`scripts/verify-production-recovery.mjs` starts the actual production build with
genuine Gemini, random local operator credentials, fictional authorized data and
a disposable persistent PGlite database. It uses an environment allowlist, excludes
production database/payment credentials, disables transfer flags, guards inference
destinations, disables redirects, caps requests and stops on 401/403/429. Thirteen
seconds between application turns spaces the campaign without consuming the
application's provider deadlines; continuations retain normal application timing.
No mocked inference module is loaded. Successful synthetic model content is
retained for review; failed provider bodies and process errors are withheld.

After building, run with securely injected `AI_API_KEY`:

```sh
AI_MODEL=gemini-3.5-flash-lite NODE_USE_ENV_PROXY=1 \
  node scripts/verify-production-recovery.mjs /tmp/agus-recovery.json
```

`RECOVERY_SCENARIOS` optionally selects comma-separated cases. Persistence also
selects an ordinary turn. Unknown scenarios are rejected. The harness checks
ordinary conversation, education, account selection, genuine narrated spending,
authorized search, extracted editable payment fields, duplicate reopen, absence
of approvals/execution, process-restart persistence and browser reload. It never
calls a production application endpoint or submits a payment.

The first genuine search/payment run passed AI search and extracted draft checks,
then failed in the browser runner's sidebar selector. That runner was corrected
to reopen the saved conversation's actual URL. A fresh genuine ordinary response
then survived process restart, saved-history reads and actual Chromium reload.
This was a harness issue, not a change to application persistence.

The broader 3.5 run then passed ordinary conversation, education and account
selection before a spending timeout. Its initial guard paced inside the SDK's
20-second request deadline, making that timing result unsuitable for judging
production latency. Pacing was moved before application turns, without changing
application timeouts. A fresh spending-only run passed genuine AI narration,
two HTTP 200 generations and exact expenses in 19.369 seconds. All requested
acceptance categories have now passed across the focused runs; there is no
claim of an uninterrupted all-scenarios campaign or a production PostgreSQL
write/restart test. See [genuine-evidence.json](genuine-evidence.json).

## Verification and remaining boundary

The initial full suite passed 1,293 tests across 55 files. After the prompt repair,
all 68 native agent/read-boundary tests passed. Typecheck, lint, production build,
HTTP payment-safety smoke and 14 native browser groups at 1440/390px passed.
The conventional HTTP/browser suites use fixture inference and are not counted
as genuine-provider evidence. Genuine results and failures are retained separately.

The production 401 occurs before tools. Existing production logs omit the Google
RPC reason and the published commit predates PR #44's diagnostic reader. Its
exact cause cannot be reconstructed from HTTP status alone. Netlify conceals the
production key, and the working injected key has not been proven identical.
Credential identity must be confirmed privately, or the reviewed diagnostic patch
must receive deployment approval to capture a bounded provider reason at source.
No model change or key rotation should be presented as an established 401 repair
without that evidence. No deployment, merge, Railway change or real-money setting
change was made.
