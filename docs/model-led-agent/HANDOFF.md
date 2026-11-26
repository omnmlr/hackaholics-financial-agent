# Review and deployment handoff

This is a handoff for an operator after code review and explicit deployment
approval. No Railway service, deployed branch, credential, database, or real bank
was changed by this experiment. The candidate remains opt-in and must remain a
draft until the final evaluation report and unresolved limitations are reviewed.

## Integrate without changing the running service's foundations

The actual Railway project's connected branch, build/start commands, service
variables and storage configuration were not independently observable during this
work. Establish those values in the existing Railway service before integration;
do not infer them from a branch name or an old README. Record the deployed commit,
the exact startup file/command, Node version, persistent volume mount if any, and
non-secret configuration names. Use the existing secret manager; do not export
credential values into a terminal transcript or PR.

The separately inspected `deploy/agus-render-fixture-20261020` branch contains
`scripts/render-preview-start.mjs`, explicitly a Render-only fixture entrypoint.
It derives the operator password hash, enforces fixture payment flags, runs the
existing migration command and starts Next on the supplied port. It is not
evidence of Railway's startup configuration. Preserve whichever script Railway
actually uses; do not replace it with `npm start`, a new bootstrap script, or that
Render entrypoint as part of this agent change.

1. Create a fresh integration branch from the commit/branch the existing Railway
   service actually uses. Bring the reviewed experimental changes into that
   branch, resolving conflicts in favor of preserving deployment-specific startup
   files and settings. Keep the deployment branch and automatic release trigger
   untouched during preparation. Review the resulting diff before pushing any
   branch connected to automatic deployment.
2. Include both `package.json` and `package-lock.json`; install with `npm ci`.
   Runtime dependencies add pinned `@google/genai` and `decimal.js`. The SDK needs
   Node 20 or newer; the existing Next.js 16.4.1 package requires **Node 20.9 or
   newer**, so that is the effective minimum. Verify the service's installed
   runtime meets it. An existing compatible Node 22/24 runtime needs no change.
3. Keep existing `DATABASE_URL`, database TLS settings, persistent volumes,
   operator identity/password configuration, cookie/session secrets,
   `APP_ORIGIN`, port binding and reconciliation/webhook configuration exactly as
   configured. Keep the existing fixture/demo payment mode and every payment
   authorization gate. Do not regenerate the operator hash, rotate credentials,
   clear tables, reset data, reseed records, or enable live flags for this change.
4. This candidate introduces **no new SQL migration and no database reset**.
   Existing payment state, saved chats, beneficiaries, audit records and sessions
   remain in their existing stores. Existing startup initialization may still run
   as it did before; do not remove or duplicate it. The new agent uses the same
   context schema/version and compare-and-swap persistence. Expired financial
   authority requires fresh reads; stored dialogue alone grants no access.
5. Run the verification commands below on the integrated source with an isolated
   fixture database. Review the PR's actual genuine-provider evidence separately.
   Automated HTTP fixtures and scripted-model tests are not additional Gemini
   verification. Only after review and explicit approval should the existing
   service's ordinary release process deploy the approved commit.

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npm run test:http
npm run test:browser:integration
npm run test:browser
```

Use the existing test harnesses, which establish isolated fixture environments.
For manual checks use a disposable database and the existing private development
credentials; never point test commands at the Railway database. Confirm the
deployed startup file has no candidate-induced diff, for example with
`git diff <deployed-commit> -- <actual-startup-file>`. Neither placeholder is a
literal repository path: substitute the verified deployed commit and file.

## Enable and roll back the candidate

The selector is server-side:

| Setting | Meaning |
| --- | --- |
| `AGUS_AGENT_ARCHITECTURE=native-gemini` | Opt in to the new native Gemini function-calling conversation agent. |
| Architecture variable absent or any other value | Keep the repaired PR #36 conversation agent. |

The candidate reuses the existing private `AI_API_KEY`, `AI_PROVIDER=gemini` and
`AI_MODEL` settings. It does not read the GitHub Actions secret directly at
runtime. The Actions workflow maps `AGUS_GEMINI_API_KEY` to `AI_API_KEY` only for
its isolated job. Do not copy or print that secret. Use the already configured
runtime credential and a model ID whose availability has been verified for that
credential. The campaign model is `gemini-3.5-flash-lite`; availability is provider
and project dependent. Do not rely on the code's fallback model name as proof.

After the approved code reaches an isolated fixture preview, add only the
architecture selector through the existing deployment configuration mechanism.
Check that the actual startup script preserves it in the child process. If the
runtime is configured for another provider, keep the baseline active until the
intended provider change is separately reviewed. Never change existing provider
credentials or payment mode just to make the candidate start.

Run a short approved smoke test against fictional accounts: one ordinary chat,
the savings calculation and an indirect follow-up, a changed amount, an authorized
fixture read, a denied foreign-account read, and a payment draft. Verify that the
draft remains editable, recipient verification is separate, and chat does not
approve or submit it. Reopen a saved chat and inspect a previously saved payment
card to confirm continuity. Check model/tool counts and fixed diagnostic codes;
do not log raw provider errors or private inputs.

Rollback is the inverse selector change: remove `AGUS_AGENT_ARCHITECTURE` (or set
it to `baseline`) and use the existing service restart/release mechanism. This
returns conversation routing to PR #36 without a database rollback or record
deletion. If code rollback is required, redeploy the previous known-good commit
through the existing process, preserving the same database, volume, environment
and startup configuration. Do not approve, resubmit or replay a saved payment to
test rollback.

## Explain AGUS to technical judges

AGUS lets Gemini do two jobs: understand what the person means and communicate a
useful answer. The model sees a bounded conversation, so it can follow a changed
amount, an indirect question or Nigerian Pidgin without requiring a fixed command
grammar. It can answer a casual question directly. When it needs a calculation
or a financial record, Gemini requests one of the functions the server has made
available and supplies structured arguments.

The server decides whether that request is allowed. A model cannot choose its own
identity, grant itself an account, or turn remembered dialogue into current bank
evidence. Read tools check ownership, consent, scope and current source revisions.
Their results carry provenance. A bounded decimal calculator evaluates a safe
mathematical grammar; it never runs model-written code. The model still has to
choose the correct formula, and evaluation checks that distinction.

Gemini receives the tool's result and can decide what to do next, including
correcting malformed arguments. The loop has fixed call, time and result-size
limits. For actual financial records, the backend inserts authoritative values
into validated factual presentations. For conversational financial explanations,
an additional bounded model review checks for unsupported claims. That reviewer
is another call to the same configured model, not a proof of truth or a second
provider. If explanation authoring fails, verified backend facts or an explicitly
hypothetical calculation can remain available.

Payment preparation opens an editable draft in the existing payment workflow.
There is no model tool for approval or transfer execution. The person must review
the details, verify beneficiaries, authenticate, approve and submit through the
established controls. OTPs, idempotency, reconciliation and emergency switches
stay in the backend. Voice supplies editable input and optional spoken output;
it grants no payment authority.

The demo uses fictional financial records. State the observed evaluation results
with their sample sizes and latency measurements, and show residual failures.
Do not describe a passing test run as universal reliability, a mocked browser
response as a live Gemini result, or this research branch as a deployed service.
