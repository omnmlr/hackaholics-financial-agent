# AGUS production release — approved preparation record

Execution update: the owner subsequently approved this release and its normal
application test records. Production deployment and genuine public acceptance
passed; see [PRODUCTION_ACCEPTANCE.md](PRODUCTION_ACCEPTANCE.md). The sections
below retain the preparation record. The execution report documents Netlify's
model-context canonicalization and the corrected whole-value model rollback.

Prepared 23 October 2026 (Africa/Lagos). No production configuration, deployment,
database, payment settings or Railway resources were changed during preparation.
PR #44 remains draft, with application head `6fbbcf6`.

## Exact proposed changes

Site: `askagus`, `fee8fc4a-b59d-4c8c-894b-599cf6d5a1e6`.

1. Publish the independently built application from
   `6fbbcf66fb5233e4b554f91cbde1508ad72a369d` to
   `https://askagus.netlify.app`. This is the source accepted on isolated staging.
2. Value-only PATCH of existing `AI_API_KEY`, **production context only**, to the
   tested new Gemini key. Keep `is_secret: true`, existing scopes
   `builds`, `functions`, `runtime`, and every other context unchanged. No downgrade
   to a standard variable, no `NEXT_PUBLIC` variable, no account/shared variable.
   Abort on a permission rejection; do not recreate or broaden the binding.
3. Add `AI_MODEL=gemini-3.5-flash-lite` in the production context. Preserve the
   existing all-context `gemini-3.6-flash` value and other environments.
4. Lock the new published deployment against automatic publishing. The connected
   production Git branch `deploy/agus-netlify-emergency-20261022` still points to
   `869b5b9`; the lock prevents a subsequent build of that branch from replacing
   the recovery. No Git branch retarget, merge or Railway change is included.

The staging approval for readable standard variables is **not reused**. Production
keeps its existing secret protection. Only the tested AI key is intentionally used
in both environments; staging's database, operator credentials and settings are
not copied. Rotation remains possible by value-only updates and new deployments.

Production retains its existing database binding, operator identity/password hash,
origin, Node 22, native Gemini architecture, fixture payment mode and five false
live-transfer authority flags. There are no schema migrations, fixture resets,
database branch switches, real-money configuration changes or transfer submissions.

## Prepared artifact and checks

- All 1,013 tracked source files match `6fbbcf6` byte-for-byte.
- Five-file application diff from current production; investigation documents and
  runners stay on this separate evidence branch.
- Independent Node 22.23.4 production-context Netlify build passed.
- Function archive contains 2,194 entries, required Next/Postgres dependencies and
  no filesystem symlinks. An initial shared-dependency package was rejected during
  preparation and replaced with an independent dependency copy before approval.
- 2,231 package files plus decompressed function entries scanned: no tested key,
  staging database URL/hostname, operator password or hash found.
- Artifact manifest SHA-256:
  `766020e4cd21a789ae63e513ac69915eee10e80ad83f0b9aee60bbdebc58ac9a`.
- Guarded rollout preflight passed: current deployment and environment match the
  snapshot; required credentials are locally available; staging password differs.
  No signed-in production request or new Google inference was made in preparation.
- Public production `/conversation` returned 200; anonymous `/api/conversations`
  returned 401. These checks do not establish production AI functionality.
- Existing genuine isolated staging acceptance and all earlier evidence remain
  preserved. Quota capacity remains unestablished; conservative trial only.

Prepared release and private backup directory:
`/workspace/work/agus-production-release` (0700; configuration/credential files
0600, outside Git). The operator password supplied for testing is stored privately
outside the release artifact and is not passed to the deployment command.

## Configuration preservation and verified rollback

Saved site configuration, site environment metadata/retrievable values, account
environment configuration and published deployment metadata. Their SHA-256 values
are in `production-preparation-summary.json`. No secrets were printed or published.
The previous immutable deployment is:

- Deploy `6ada1aa358e288da5818c039`, ready and currently published.
- Source `869b5b9b488299007ece130e78d76cf5fc102d45`.

Netlify Secrets Controller makes old secret values write-only. The local snapshot
therefore cannot contain the original AI key, database URL or password-hash
plaintext. Those original runtime values remain sealed in the retained previous
deployment. No attempt was made to expose them through application code.

Rollback was rehearsed on a separate site containing **only a non-secret marker**,
no database or credentials. Deploy A returned the original value; editing the site
variable did not change A; deploy B returned the new value; restoring A restored
its original function environment while the site variable still held the new
value. Deploy lock/unlock operations also passed. The accepted staging alias and
production were not changed by this rehearsal. This confirms the documented
deployment snapshot behavior, not an executed rollback of production itself.
Restoring another deploy while the current deploy was locked also passed, and the
unlock/restore/lock sequence was independently rehearsed on that same scratch site.

On deployment failure or material acceptance regression:

1. POST `/sites/{site_id}/deploys/6ada1aa358e288da5818c039/restore`.
2. Lock that restored deployment to prevent automatic replacement.
3. Remove only the newly added production `AI_MODEL` override, restoring its
   existing all-context value. Preserve all unrelated configuration.
4. Verify the published deployment ID and public/authentication behavior.

This restores the previous **runtime** and its captured secret values. The site
`AI_API_KEY` production binding can still hold the new tested key; restoring its
old plaintext for a future rebuild would require an owner-held secure copy.
The lock prevents an accidental rebuild/publish under that mixed configuration.
Do not claim the local snapshot can restore a concealed secret. Also, the previous
application had the 401 defect: rollback restores the previous state, not a proven
healthy AI service. A key/model-only regression may instead warrant retaining the
fixed application, but no alternative production changes are pre-authorized.

Official references checked:

- <https://docs.netlify.com/build/functions/environment-variables/#overrides-and-limitations>
- <https://docs.netlify.com/build/environment-variables/secrets-controller/>
- Netlify API `setEnvVarValue`, `restoreSiteDeploy`, `lockDeploy` operations.

## Post-release acceptance scope — include in final approval

Genuine signed-in end-to-end tests necessarily write ordinary application records.
Approval must explicitly cover login sessions/authentication bookkeeping, new test
chats/turns, account-selection context and an **unverified simulated payment draft**
from a synthetic screenshot. These are not direct database maintenance operations.
If “do not change the production database” prohibits even these normal application
records, full signed-in persistence/payment-preparation testing cannot run.

Use the provided production operator password, never the staging password. Run
one request at a time, at least 15 seconds between generation turns, with a small
budget of at most 16 observed model calls. Verify two ordinary genuine responses,
account-selection authorization, fixture account financial search, screenshot to
editable payment preparation, idempotent draft reopening, saved chats, browser
reload and a fresh login. No verification, approval, submission or payment batch
creation endpoints are called. No load/capacity claim is permitted.

Read-only production baseline: 3 accounts, 77 transactions, fixture seed present,
25 chats, 65 turns, and **one existing payment batch**. The runner compares existing
batches instead of assuming staging's zero-batch state. Financial account,
transaction, consent and payment-batch fingerprints are retained for before/after
comparison. Do not delete test chats or drafts afterward without separate approval.

Signed-in production tests and rollout remain **not executed**. Production success
is not established until the public website passes the genuine tests. Preserve any
failure evidence and report fallback narration separately from provider failures.
