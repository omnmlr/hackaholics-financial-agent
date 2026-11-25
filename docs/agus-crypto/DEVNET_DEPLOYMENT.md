# AGUS Crypto Devnet deployment

The existing Stockholm EC2 host is the Devnet target for the Crypto API, monitoring and reconciliation worker, and Caddy. Neon stores durable application state. Caddy will serve the canonical HTTPS origin and forward the Crypto, identity, OpenAPI and health endpoints. [Railway checkpoint](RAILWAY_STAGED_REPURPOSE_20261124.md)

## Stockholm handoff · November 25, 2026

| Item | Provisioned target reported by the founder |
| --- | --- |
| Region | Stockholm, `eu-north-1` |
| CloudFormation stack | `agus-crypto-devnet` |
| Instance | `i-0b608f6472205b337`, `t3.small`, Ubuntu 24.04 |
| Public IPv4 | `13.48.206.202` |
| Canonical origin | `https://13-48-206-202.sslip.io` |
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

## Hosted acceptance

1. From an independent client, check the HTTPS origin and `/api/v1/ready`, then inspect `/api/v1/openapi` for the Crypto endpoints, including the attempts handoff, assistant, voice and receipt endpoints. Verify unauthorized wallet requests require a session.
2. Using the direct owner connection, run `npm run identity:invite -- <tester-email>`. Enroll with that invitation and confirm an uninvited sign-up fails. Verify Devnet wallet portfolio balances and transaction activity using the two RPC providers. Ask Gemini a scoped balance question and compare its structured evidence with those reads.
3. Check that the worker logs a successful cycle. Exercise a reviewed transfer on the signed Android build, verify wallet approval, handoff, finalized receipt recovery, and the resulting persistent alert. Reboot the EC2 host, verify readiness and worker health return, and recheck the same receipt and alert without resubmission.
4. Set GitHub's `AGUS_CRYPTO_DEVICE_API_URL` after HTTPS, readiness, the contract, invite-only sign-in and authenticated portfolio reads are verified. Follow the signed APK and three-transfer procedure. [Device acceptance](ANDROID_DEVICE_TEST.md)
