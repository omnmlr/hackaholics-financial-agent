# Isolated staging release — 2026-10-23

## Current status

**Prepared, not deployed or accepted.** The application compiled and the Netlify
Next.js adapter packaged successfully under Node 22.23.4. The function manifest
targets `nodejs22.x`; adapter version is 5.16.3. Source is application commit
`97c0dcf`, whose final diff contains five application/diagnostic-test files.

Google model-list access returned HTTP 200 and listed `gemini-3.5-flash-lite`.
Netlify authenticated access returned HTTP 200 for both sites. No secrets were
printed. Exact Google administrative quotas remain unknown. The owner explicitly
waived that prerequisite for a small, sequential staging trial; previous 24/24
genuine responses establish neither maximum capacity nor a guaranteed quota.

Automatic approval review rejected transfer of the new database connection string
through terminal stdin, because the tool record would contain a credential.
That transfer did not execute. The configuration script now requires a secure
`STAGING_DATABASE_URL` cloud binding; it does not accept secret terminal input.
Deployment and genuine public acceptance remain pending that binding. No hosted
acceptance success is claimed, and the undeployed site currently returns 404.

## Resources and isolation

| Resource | Staging value |
| --- | --- |
| Netlify site | `agus-ai-isolated-staging-20261023` |
| Site ID | `b9f8d2af-8aba-494b-a012-4d0424df33c8` |
| Planned draft alias | `https://staging--agus-ai-isolated-staging-20261023.netlify.app` |
| Neon project | `empty-bonus-20525410` |
| Branch | `staging`, `br-plain-hat-baqksqhi` |
| Database | `agus_staging` |
| Role | `agus_staging_owner` |
| Pooled hostname | `ep-square-sky-bazwbdb9-pooler.c-8.eu-central-1.aws.neon.tech` |

The Neon project was created independently, not branched from production or the
old preview. Before initialization it had zero user tables and zero foreign
servers. Its database list contained only `agus_staging` and `postgres`. A
read-only production metadata check found no `agus_staging_owner` role. The
Netlify account has no shared environment variables; the new site has no Git
repository connection. The configuration script asserts the exact staging site,
database, role and endpoint before writing environment settings.

The application will initialize only its built-in fictional fixtures. Settings
use fixture payments, no Paystack credential, all live flags false, and an
environment-level emergency switch disabling every transfer submission. The
operator password is random and independent of production. The private local
acceptance configuration is mode 0600 and is never committed.

The previously created, unused `agus_staging_20261023` role on the **old preview**
is left unchanged, as explicitly requested by the owner. It will not be used.
No existing database was deleted, reset or retargeted.

## Acceptance prepared

`scripts/verify-isolated-staging.mjs` operates against the exact public draft alias,
uses Chromium with TLS verification and real Gemini responses, and records only
synthetic content. It is prepared but **not yet run**. No mocks or production
financial credentials are injected. It checks:

- Actual UI sign-in and unauthenticated API rejection.
- Two sequential ordinary conversations and the account-selection permission gate.
- Authorized narrated spending of ₦19,751.51 and cited Ada searches over fixtures.
- A genuine PNG screenshot containing two synthetic payment instructions; editable
  amounts and account fields; idempotent draft reopening; no payment execution.
- Saved chats and turns through API reads, browser reload, and a fresh session.
- A separate `--persistence-only` mode after a second deployment of the same
  artifact, without further generation, to verify records survive replacement.

It allows one generating application request at a time, waits at least 15 seconds
after each turn before the next, reserves the application's six-call native
limit before each text turn, and has a 16-provider-call budget with two reserved
for image extraction. Any failed status or quality assertion stops the campaign;
there is no whole-suite retry. Calls inside a native tool round remain sequential
and may be closer together than the interval between application turns. This
is a conservative functional trial, not a concurrency or maximum-capacity test.

## Next authorized actions once bound

1. Run `scripts/configure-isolated-staging.py` with the secure cloud binding. It
   copies the tested injected Gemini key to **only** the new site's function
   environment, selects Flash-Lite and applies the isolation settings above.
2. Verify remote setting metadata and non-secret flags, then deploy the prepared
   Node 22 package with explicit staging site ID and `--alias staging`; never
   target `askagus`. The Netlify config in this directory is staging-only.
3. Run acceptance once, inspect the new project's saved rows read-only, replace
   the staging deployment with the identical artifact, then run persistence-only.
4. Recheck production's published deployment and record actual results here.

## Conditional production change and rollback plan

Production remains outside current authorization. After staging acceptance and
explicit approval, the proposed minimal change is the five-file repair from PR
#44 plus Netlify production function bindings `AI_API_KEY` = the tested new key
and `AI_MODEL` = `gemini-3.5-flash-lite`. Retain the existing Node 22, native Gemini
architecture, production database binding and payment settings. No migration,
database retarget, Railway operation or real-money setting change is required.
The historical 401 cause is still unproven: successful calls with the new key do
not authenticate the withheld old key.

Before an approved production change, securely preserve prior model/key bindings
and the published deploy `6ada1aa358e288da5818c039` (commit
`869b5b9b488299007ece130e78d76cf5fc102d45`). The old key cannot be recovered from
Netlify's concealed API value, so credential rollback requires an owner-held
secure copy. On failure, restore the prior bindings and republish the saved
deployment, then verify sign-in, an ordinary genuine response and saved history.
Restoring the previously failing key can restore the old 401 behavior; keep the
tested key if the failure is isolated to application code or the new model.
No rollback step changes databases, Railway or payment authority. Confirm the
platform's environment snapshot behavior before relying on deploy rollback alone.

PR #44 remains draft. Investigation scripts, this runbook and test artifacts live
only on `investigation/agus-ai-recovery-evidence-20261023`; all original commits
and work are preserved. See the existing Flash-Lite evaluation for prior genuine
results and their limits.
