# Isolated AGUS staging — verified 2026-10-23

The isolated release is deployed and its functional acceptance checks passed.
Production approval and user acceptance are still pending; PR #44 remains draft.

- Public URL: https://staging--agus-ai-isolated-staging-20261023.netlify.app
- Netlify site: `b9f8d2af-8aba-494b-a012-4d0424df33c8`
- Final deployment: `6adadb8cfea84740643b6c42`, `deploy-preview`, alias `staging`
- Application source: `6fbbcf6`; model `gemini-3.5-flash-lite`; Node 22
- Build runtime: Node 22.23.4; hosted diagnostic observed Node 22.23.2
- Next.js adapter: 5.16.3; packaged function runtime: `nodejs22.x`
- Private operator login is in the protected workspace file, not this branch.

## Verified 401 mechanism and essential repair

With the same tested key, model, site and runtime, direct Gemini REST generation
returned HTTP 200. The unpinned official SDK instead requested:

`https://staging--agus-ai-isolated-staging-20261023.netlify.app/.netlify/ai/v1beta/models/gemini-3.5-flash-lite:generateContent`

The SDK sent the configured Google key in `x-goog-api-key`; the Netlify gateway
returned 401. It honored the platform-injected `GOOGLE_GEMINI_BASE_URL` instead
of using Google's endpoint. Pinning `httpOptions.baseUrl` to
`https://generativelanguage.googleapis.com` fixed genuine application calls.
The installed-SDK regression now proves an ambient gateway cannot redirect this
configured credential. No financial validator or payment authority was relaxed.

[REST control](staging-rest-auth-probe.json), [SDK request metadata](staging-sdk-gateway-probe.json),
[before repair](staging-before-repair.json), [after repair](staging-acceptance-20261023.json).
The temporary, authenticated probe returned only request metadata and allowlisted
status/reason codes. It was removed from the final deployed application.

This is a hosted reproduction of the production failure mechanism. Production
still runs the same unpinned client at commit `869b5b9`; its runtime destination
was not instrumented because production deployment is prohibited. Its old key
is different and concealed; its validity against Google remains unverified.
Do not claim the old key is revoked, expired or quota-limited. The new key's
nonstandard prefix also did not establish invalidity: direct generation succeeded.

## Genuine public acceptance

| Check | Result |
| --- | --- |
| Operator sign-in and unauthenticated API boundary | Passed in actual Chromium UI |
| Two ordinary conversational turns | HTTP 200, genuine model replies |
| No selected records account | Asked for explicit account selection |
| Authorized October spending | Correct authoritative ₦19,751.51; safe factual fallback |
| Authorized Ada search | Genuine AI narration, two cited fictional candidates |
| Screenshot payment preparation | Two independent real image readings; editable Ada/Wema ₦500 and Chidi/Access ₦600 fields |
| Duplicate payment draft reopening | Same stored draft ID and proposals; no repeated extraction |
| Saved chats and browser reload | Six successful turns retained; fresh session also passed |
| Replacement deployment | Same six turns and image draft retained; zero further model calls |
| Payment execution | Zero batches; no beneficiary verification, approval or submission |

[Acceptance JSON](staging-acceptance-20261023.json), [redeployment persistence](staging-persistence-20261023.json),
[real payment-preparation screenshot](staging-screenshots/payment-preparation.png).

The campaign made **14 generation attempts**: two initial gateway 401 failures,
one successful direct REST diagnostic, and eleven calls across the repaired
application scenarios. One generating request was in flight at a time; there
were at least 15 seconds between application turns. Calls within a native tool
round and the two image readings were sequential. The initial ceiling of 16 was
raised to 18 for conservative per-turn reservations; observed use remained 14.
No successful inference was repeated when resuming the unfinished checks.
Persistence verification made zero model calls. Exact active Google quotas are
unknown, and this trial establishes neither maximum capacity nor concurrency.
The owner explicitly waived exact quota confirmation for this conservative trial.

### Remaining quality issue and preserved failures

The spending answer used authoritative factual cards after model narration failed
`NARRATION_REFERENCE` / `missing_required_limit`. Its amount and source scope were
correct; the validator retained its safety boundary. This is functional financial
retrieval, not a pass for AI-authored spending prose. Ada search did pass genuine
AI narration. All earlier FAIL artifacts are retained, including the stricter
spending-narration check. The runner resumed completed spending from its saved
turn rather than calling the model again.

Initial deployment preflight also exposed the CLI's raw `.next` publish directory;
the corrected manual deploy uses `.netlify/static`. The initial UI preflight had
zero model calls. Later fresh-browser retries exposed an automation hydration
race: the runner now waits for the application's initial history response and
idle composer before clicking sign-in. These fixes affect staging packaging and
the evidence runner, not application authority or test fixtures. The first failed
401 run's aggregate counter omitted its failed call; campaign totals above count
that attempt from the retained reply evidence.

## Database and payment isolation

Staging uses the independently created project `empty-bonus-20525410`, branch
`br-plain-hat-baqksqhi` (`staging`), database `agus_staging`, role
`agus_staging_owner`, pooled host
`ep-square-sky-bazwbdb9-pooler.c-8.eu-central-1.aws.neon.tech`.
It was not branched or copied from production or the previous preview. Before
initialization it had zero user tables and zero foreign servers. Its role is
absent from the production branch. No production credential is bound to this site.

After acceptance, read-only verification found three fictional accounts, zero
non-fixture accounts or transactions, three saved chats, seven turns (including
the preserved initial failure), zero payment batches and zero foreign servers.
The built-in fixture schema also constrains financial provenance to `fixture`.
Only two accounts are visible to the authenticated fictional account owner.

`PAYMENT_MODE=fixture`; all five live/Paystack enablement flags are false;
`PAYMENTS_EMERGENCY_DISABLED=true`; Paystack credentials are empty. No transfers
were submitted. Existing production and preview databases were not reset, deleted
or retargeted. The unused old-preview role is left unchanged as requested.
Railway was not accessed or modified.

## Credential handling and rotation

The owner explicitly approved standard Netlify environment variables after the
account rejected narrower secret scopes. Every variable value is restricted to
this new site and `deploy-preview`; none is `NEXT_PUBLIC_*`. The new site has no
Git connection, and the account had no shared variables. Netlify's preview SSO
was disabled on this site only so the public URL reaches AGUS's own operator login.

[Configuration and exposure checks](staging-config-verification-20261023.json)
cover local client files, public HTML and scripts, tracked application/evidence
source and available hosted log records without printing their contents. A full
build scan also found zero credential matches in 2,310 files. Raw hosted log
output was blocked by automatic review; protected status-only diagnostics and
non-printing credential-match scans provided the safer alternative.

Both credentials remain independently replaceable. To rotate after testing:

1. Reset only `agus_staging_owner` in the new Neon project, then replace the
   existing staging `DATABASE_URL` value for `deploy-preview` with its new pooled
   URI. Preserve the host, database and role checks.
2. Replace only the staging `AI_API_KEY` value for that same context with the
   replacement Google key. Do not revoke a key used elsewhere without approval.
3. Redeploy only this site and alias using the validated package. Recheck login,
   a genuine reply and saved history. Keep `OPERATOR_ID` stable to retain ownership.

No automatic rotation or production credential change was performed.

## Minimal production proposal and rollback — approval required

The subsequently prepared release, exact production-context changes, protected
configuration backup, independent package verification, rehearsed runtime rollback
and required approval for normal test records are documented in
[PRODUCTION_RELEASE_APPROVAL.md](PRODUCTION_RELEASE_APPROVAL.md). Production has
not been changed. That document supersedes the preliminary rollback assumptions
below: the retained deploy restores its captured runtime environment, while the
site-level key binding is a separate setting.

The essential 401 fix is the explicit Google SDK `baseUrl` in
`src/lib/model-led-agent/model.ts`. The final PR contains five application and
diagnostic-test files, retaining the earlier narration instructions and bounded
provider diagnostics. Investigation documents and runners remain on this separate
branch and will not enter the application tree through PR #44.

For the exact combination accepted here, deploy application commit `6fbbcf6` and
change only the existing production `AI_API_KEY` and `AI_MODEL` values to the
tested new key and `gemini-3.5-flash-lite`. Preserve their existing secret flags
and scopes; do not assume the staging downgrade approval applies to production.
Retain the production database URL, Node 22, native architecture, payment flags
and Railway. No database migration or branch switch is required.

Before that separately approved release, securely retain the previous model/key
bindings and production deploy `6ada1aa358e288da5818c039` (commit
`869b5b9b488299007ece130e78d76cf5fc102d45`). Netlify conceals the old key, so an
owner-held secure copy is required if its binding must be restored. On a material
regression, restore the prior bindings and republish that saved deployment, then
verify login, an ordinary response and saved history. Restoring the old unpinned
client can restore its original 401; prefer retaining the endpoint fix if the
regression is isolated to a model/key change. Do not rely on deploy rollback alone
to restore edited environment values without confirming the platform behavior.
No rollback step alters databases, Railway or payment authority.

Production is still on the saved deploy. Nothing has been merged or deployed to
production, and all prior work and commits are preserved.
