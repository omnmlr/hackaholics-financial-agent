# AGUS Crypto Devnet deployment

The existing Stockholm EC2 host is the Devnet target for the Crypto API, monitoring and reconciliation worker, and Caddy. Neon stores durable application state. Caddy serves `https://agus.grindcity.app` and forward the Crypto, identity, OpenAPI and health endpoints. [Railway checkpoint](RAILWAY_STAGED_REPURPOSE_20261124.md)

## Activate the passwordless backend on the existing host

This release reuses the deployed identity tables. Keep the existing Neon login, Better Auth secret, encryption keys, Google OAuth settings, and Resend credentials. No migration or infrastructure setup is required.

1. On an approved GitHub revision, dispatch and download the existing Linux AMD64 packaging workflow. Use the exact run ID and commit printed by the run list. The workflow retains its checksum-bound bundle for one day.

   ```bash
   repo=omnmlr/hackaholics-financial-agent
   gh workflow run agus-crypto-devnet-image.yml --ref main -f retain_bundle=true --repo "$repo"
   gh run list --workflow agus-crypto-devnet-image.yml --branch main --event workflow_dispatch --limit 3 --repo "$repo"
   run_id=<successful-run-id>
   revision=$(gh run view "$run_id" --repo "$repo" --json headSha --jq .headSha)
   bundle="$PWD/agus-release-$revision"
   gh run download "$run_id" --repo "$repo" --name "agus-crypto-ec2-$revision" --dir "$bundle"
   (cd "$bundle" && sha256sum --check --strict SHA256SUMS.txt)
   ```

2. Transfer the verified bundle unchanged to the existing EC2 host using the approved operator access, for example an already configured SCP-over-SSM host alias. The target directory in the examples below is `/home/ssm-user/agus-release-$revision`. In the existing SSM shell:

   ```bash
   revision=<artifact-commit>
   bundle="/home/ssm-user/agus-release-$revision"
   (cd "$bundle" && sha256sum --check --strict SHA256SUMS.txt)
   test "$(cat "$bundle/revision.txt")" = "$revision"
   sudo test -f /etc/agus-crypto/api.env
   sudo test -f /etc/agus-crypto/shared.env
   previous=$(sudo readlink -f /opt/agus-crypto/current)
   printf 'Previous release %s\n' "$previous"
   sudo bash "$bundle/activate-release.sh" "$bundle" agus.grindcity.app
   curl --fail --silent --show-error https://agus.grindcity.app/api/v1/ready
   curl --fail --silent --show-error https://agus.grindcity.app/api/auth/get-session
   ```

3. Confirm the code routes are active by requesting a code for the authorized disposable tester. Check actual delivery, OTP sign-in and repeat sign-in to the same user ID. Also check Google sign-in and a signed handset. Use the existing public audience setting (`AGUS_AUTH_PUBLIC=true` for open first sign-in). [Authentication API](HOSTED_AUTHENTICATION.md)

The activation script verifies checksums, image platform and revision, API and worker health, and local HTTPS. If startup fails it attempts to restore the previous release automatically. To roll back after a successful activation, use the saved previous directory and its original configuration from the same elevated operator session:

```bash
sudo env -u AGUS_CRYPTO_IMAGE -u AGUS_CRYPTO_HOST docker compose \
  --project-directory "$previous" --env-file "$previous/release.env" \
  --file "$previous/compose.yml" up --detach --wait --wait-timeout 180
curl --fail --silent --show-error https://agus.grindcity.app/api/v1/ready
sudo ln -sfn "$previous" /opt/agus-crypto/current.rollback
sudo mv -Tf /opt/agus-crypto/current.rollback /opt/agus-crypto/current
```

## Previous Stockholm deployment · November 25, 2026

| Item | Provisioned target reported by the founder |
| --- | --- |
| Region | Stockholm, `eu-north-1` |
| CloudFormation stack | `agus-crypto-devnet` |
| Instance | `i-0b608f6472205b337`, `t3.small`, Ubuntu 24.04 |
| Public IPv4 | `13.48.206.202` |
| Original deployment origin | `https://13-48-206-202.sslip.io` |
| Host administration | AWS Systems Manager Session Manager |
| Billing | Active Free plan, approximately $108.42 verified by the founder, intended for about one week through judging |

Use the existing instance and a time-limited identity permitted to open a Session Manager shell on that instance and close its own session. The current task requires no CloudFormation deployment. Verify host and resource status through the existing Stockholm stack. [Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)

```bash
aws ssm start-session --region eu-north-1 --target i-0b608f6472205b337
```

Review the actual Stockholm charges after judging before authorizing stack cleanup. Stopping the instance leaves EBS and IPv4 charges in place. [Track credits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/tracking-free-tier-usage.html)

## Neon and runtime secrets

The database is `agus_crypto_devnet_20261124`, project `empty-bonus-20525410`, branch `staging`. The existing runtime login is `agus_crypto_devnet_runtime`. Run future migrations in a trusted operations session using the direct, TLS-verified `agus_staging_owner` connection as `MIGRATION_DATABASE_URL`. Run `npm run db:migrate`, then apply `scripts/sql/runtime-role.sql` and `scripts/sql/crypto-devnet-runtime-login.sql` with `psql -v ON_ERROR_STOP=1` on that same database as the owner. The second SQL file guards its target and removes any direct grants that could bypass the runtime group's restrictions. The owner credential stays in the operations session.

The 27 migration checksums through `0027_crypto_requests.sql` and the normalized archive marker were independently checked on 24 November 2026. Runtime access to alerts, invitation consumption and migration status was verified through the restricted login. Runtime writes to the archive and ledger, schema creation, and invitation email updates were denied after grant correction. The historical `agus_staging` database defaults let the runtime login connect but give it no access to any of its 13 existing public relations.

The staged Railway plan called for new Crypto-specific auth and encryption secrets. Its snapshot preserved variable names only and the patch was never deployed. No recoverable Crypto auth or encryption values were found in the checked repository or workspace. On November 25, a read-only query on the isolated Neon database found zero users and zero encrypted records in the four envelope-bearing tables. The launcher checks again before offering first-time initialization.

### Get the credentials

1. Open the Neon project **agus-isolated-staging-20261023**. Click **Connect**, select branch **staging**, database **agus_crypto_devnet_20261124**, and role **agus_crypto_devnet_runtime**. Copy the PostgreSQL connection string with its existing password. You can leave pooling enabled. Paste it at the launcher's hidden **Restricted Neon DATABASE_URL** prompt. The launcher verifies TLS, database name, role, migration checksums and effective grants. Use the original password from the approved vault if the console cannot show it. [Neon project](https://console.neon.tech/app/projects/empty-bonus-20525410)
2. Locate any Crypto-specific recovery material in your approved vault. The launcher first checks root-owned `/etc/agus-crypto/api.env` and `/etc/agus-crypto/shared.env`. To restore a separate backup, place it on EC2 as a root-owned mode-`0600` file of raw `NAME=value` lines and pass `--recover-from /absolute/path/to/crypto.env`. Preserve all key versions in `AGUS_ENCRYPTION_KEYS` and the existing `AGUS_ENCRYPTION_ACTIVE_KEY`. If the three settings never existed, the launcher offers `INITIALIZE` only after it verifies that there are no accounts or encrypted data. Keep a protected recovery copy afterward.
3. Supply the Gemini, Firecrawl and ElevenLabs API keys at the hidden terminal prompts. The launcher enables image turns and selects the verified ElevenLabs premade **Jessica**, voice ID `cgSgspJ2msm6clMCkdW9`. To confirm it in ElevenLabs, open **Voices**, locate Jessica, and choose **Copy voice ID** from the voice menu. [ElevenLabs Voices](https://elevenlabs.io/app/voice-library)

## Activate in the open SSM session

[PR #57](https://github.com/omnmlr/hackaholics-financial-agent/pull/57) packaged backend revision `126a528c2b7b0accc380d2af7cddae58ed6e624a`. The bundle is already on the host under `/home/ssm-user/agus-release`. Transfer only [deploy-stockholm.py](../../deploy/crypto/ec2/deploy-stockholm.py) to the EC2 host and run it in the existing SSM terminal.

```bash
sudo python3 ./deploy-stockholm.py
```

The launcher verifies the seven bundle files and the Linux AMD64 image label. It loads the already downloaded archive only if the expected image is absent. It installs root-owned mode-`0600` shared and API files and invokes the bundled `activate-release.sh`. Activation waits for local TLS, readiness and the worker health check. The launcher then checks HTTPS readiness and the Crypto OpenAPI contract via the public hostname from EC2. Runtime files remain available for a safe retry if activation stops. The Caddy volumes retain certificate state.

On November 25, the founder activated the approved image on Stockholm EC2 after adding a bounded writable `/tmp` to the launcher's read-only database-check container. The checked-in launcher now includes the same mount and a Foundation regression test. The host deployment does not need to be repeated to pick up this launcher change. Independent checks passed for public readiness, the exact OpenAPI document, HTTPS access and session enforcement on wallet, portfolio, alert and assistant routes. See the authentication handoff for evidence and remaining checks. [Hosted verification and authentication](HOSTED_AUTHENTICATION.md)

## Hosted acceptance

1. From an independent client, check the HTTPS origin and `/api/v1/ready`, then inspect `/api/v1/openapi` for the Crypto endpoints, including the attempts handoff, assistant, voice and receipt endpoints. Verify unauthorized wallet requests require a session.
2. Sign in with a disposable tester account by email OTP and Google. When enrollment is invite-only, create the invitation from the direct owner connection via `npm run identity:invite -- <tester-email>`. Verify Devnet portfolio and activity against independent RPC reads. Ask Gemini a scoped balance question and compare its structured evidence with the portfolio.
3. Check that the worker logs a successful cycle. Exercise a reviewed transfer on the signed Android build, verify wallet approval, handoff, finalized receipt recovery, and the resulting persistent alert. Reboot the EC2 host, verify readiness and worker health return, and recheck the same receipt and alert without resubmission.
4. Follow the signed APK and three-transfer procedure. [Device acceptance](ANDROID_DEVICE_TEST.md)
