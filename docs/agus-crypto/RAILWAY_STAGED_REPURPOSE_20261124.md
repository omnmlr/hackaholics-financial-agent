# AGUS Crypto — staged Railway repurpose checkpoint (24 November 2026)

**Status: staged only, NOT live. No successful Crypto API or APK is claimed.**

The founder explicitly authorized reusing the two failed Railway services. The prior configurations were snapshotted in [RAILWAY_REPURPOSE_SNAPSHOT_20261124.md](RAILWAY_REPURPOSE_SNAPSHOT_20261124.md). The old persistent volumes remain retained; their contents were not exported and must not be deleted.

## Staged Railway changes

- Project: `artistic-generosity` (`c8604a04-2913-4edf-b52a-cd333121ad1d`)
- Environment: `production` (`02d06217-6ac8-4de9-9f93-6bc5f48734b7`)
- Pending patch ID: `41d61ad2-6a56-43f5-a3c9-42c4a8038093`, **not committed/deployed**
- `agus-counterpart-acceptance` is configured to serve the **Crypto API** from `feat/agus-crypto-backend`, `deploy/crypto/Dockerfile`, start `sh deploy/crypto/start.sh api`, health `/api/v1/ready`, existing HTTPS domain `https://agusweb.up.railway.app`.
- `agus-zcash-receiving` is configured as the **Crypto worker** from the same source, Dockerfile and start `node --import tsx scripts/crypto-devnet.ts worker --once`, with Railway cron `*/5 * * * *`. **Free-plan restriction:** continuous non-sleeping services were rejected. This cron workaround produces up to roughly five minutes of alert latency and is not the project's intended 30-second polling cadence.
- Staged detach of existing Railway volume IDs `922dc5df-c4d6-48a4-a08d-fe342085b006` and `51b12ab8-36f4-49fa-ab00-bb35bda2cb2b` to preserve their old contents. Do not delete these volumes.
- Both services have staged shared Devnet flags, explicitly disabled live transfer flags and a password-bearing `DATABASE_URL` (not written in this document), referencing Neon with a restricted application login.
- No other Railway services were changed.

## Neon database

- Existing Neon project `agus-isolated-staging-20261023` (`empty-bonus-20525410`), default `staging` branch `br-plain-hat-baqksqhi`.
- New isolated database: `agus_crypto_devnet_20261124` (0 tables when provisioned; independent of historical `agus_staging`).
- Restricted login: `agus_crypto_devnet_runtime`, with `read_write` access scoped to the new DB and no schema CREATE, CREATEDB, CREATEROLE, SUPERUSER or BYPASSRLS privilege. Added `agus_runtime` role membership for Crypto boot checks.
- **Migrations have not run.** Do not use the runtime login as migration owner. Perform the 27 checksummed migrations as database owner and apply `scripts/sql/runtime-role.sql` as prescribed in [DEVNET_DEPLOYMENT.md](DEVNET_DEPLOYMENT.md), then verify `assertSchema` and permissions. Do not migrate the historical `agus_staging` DB.

## Must resolve before applying the staged Railway patch

1. **Credential contamination:** the old API service still has a historical `PAYSTACK_SECRET_KEY` variable and other legacy secrets. The Devnet environment validator rejects any configured Paystack secret. Use the Railway dashboard to remove legacy payment, wallet, operator and Zcash credentials from both repurposed services after securely backing up any still-needed values; do not replace with dummy secrets or deploy with lingering live provider credentials. Connected Railway OAuth allows listing variable names but not deleting individual variables through the available tool.
2. **Database bootstrapping:** perform owner-only migrations and runtime-role grants. Confirm checksum and legacy normalized state needed by `assertSchema`.
3. **Auth/encryption secrets:** configure new durable `BETTER_AUTH_SECRET` and `AGUS_ENCRYPTION_KEYS` / `AGUS_ENCRYPTION_ACTIVE_KEY`. Keep these out of the repo. Existing OAuth/email/Gemini credentials may need reconfiguration. A fresh test account must be invited.
4. **Railway capacity:** while changes can be staged, the Free plan also requires sleep mode for API and only supports periodic cron for the worker. Validate that committing does not exceed plan or service resource limits; do not assume a green deployment.
5. **Signing:** the original signing key is lost. The founder must execute `scripts/android/prepare-release-signing.sh` on a trusted computer with a recoverable GPG recipient, then update Vercel Digital Asset Links to the new public fingerprint. Only then configure the GitHub device API URL and rerun the APK workflow.

**Do not run `accept_deploy` before the above blockers are resolved.** Work done here is an operational staging step, not a verified deployment.
