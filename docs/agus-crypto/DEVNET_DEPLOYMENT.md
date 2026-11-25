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

On the EC2 host use `/etc/agus-crypto/shared.env` and `/etc/agus-crypto/api.env` as root-owned files with mode `0600`. Use one `NAME=value` per line without surrounding quotes. Recover existing Crypto auth and encryption settings from the host or the approved secret store before writing configuration. Preserve the current active key and every existing decryption key. Fill missing values through the secure operations session and keep values out of command arguments, logs and Docker inspection output.

| File         | Settings                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.env` | `DATABASE_URL` for the restricted runtime login with TLS certificate verification, `AGUS_DEVNET_RPC=https://api.devnet.solana.com`, `AGUS_DEVNET_VERIFY_RPC=https://devnet.rpcpool.com`.      |
| `api.env`    | `BETTER_AUTH_SECRET` with at least 32 characters, `AGUS_ENCRYPTION_ACTIVE_KEY=devnet-v1`, `AGUS_ENCRYPTION_KEYS` as a JSON object mapping `devnet-v1` to a base64-encoded random 32-byte key. |
| `api.env`    | `AI_PROVIDER=gemini` and `AI_API_KEY`.                                                                                                                                                        |
| `api.env`    | Set `AGUS_CRYPTO_IMAGES=true` for Gemini image turns. For Jessica, set `AGUS_CRYPTO_VOICE_ENABLED=true`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID=cgSgspJ2msm6clMCkdW9` and `ELEVENLABS_ZERO_RETENTION=false` on the verified free tier. |
| `api.env`    | For live research, set `FIRECRAWL_API_KEY`.                                                                                                                                                   |

Compose sets the Devnet profile, invite-only authentication, the approved external-wallet routes, and the worker schedule. Leave Mainnet and experimental transaction capabilities disabled during Devnet acceptance. Cloud HTTP secret binding placeholders work only in that Cloud environment. The EC2 runtime uses its own secure bindings.

## Verify and activate the existing bundle

PR #57 packaged backend revision `126a528c2b7b0accc380d2af7cddae58ed6e624a`. The founder reports that the archive was downloaded to `/home/ssm-user/agus-release`, extracted and checked. Image loading was initiated. Verify the existing image ID and labels before running the bundled activation script. Its explicit image load path applies only if inspection shows the verified image is missing. [Bundle workflow](https://github.com/omnmlr/hackaholics-financial-agent/pull/57)

```bash
sudo bash -euo pipefail <<'BASH'
mapfile -t manifests < <(find /home/ssm-user/agus-release -maxdepth 4 -type f -name SHA256SUMS.txt)
(( ${#manifests[@]} == 1 ))
bundle=$(dirname -- "${manifests[0]}")
cd "$bundle"
sha256sum --check --strict --status SHA256SUMS.txt
expected=126a528c2b7b0accc380d2af7cddae58ed6e624a
[[ $(<revision.txt) == "$expected" ]]
image=$(<image-id.txt)
[[ $image =~ ^sha256:[0-9a-f]{64}$ ]]
if docker image inspect "$image" >/dev/null 2>&1; then
  [[ $(docker image inspect --format '{{.Os}}/{{.Architecture}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") == "linux/amd64 $expected" ]]
  printf 'Verified the existing Linux AMD64 image.\n'
else
  printf 'The verified local archive is present and activation will load its image.\n'
fi
bash "$bundle/activate-release.sh" "$bundle" 13-48-206-202.sslip.io
BASH
```

Activation checks the bundle again, verifies the Linux AMD64 image's ID and revision label, then starts the three services. It waits for `/api/v1/ready`, a successful monitoring and reconciliation cycle, and a trusted TLS certificate. On replacement failure it reapplies the previous Compose release. Keep the previous image until the new version passes acceptance. Do not roll back database schemas to revert an image. Docker starts on boot and the three containers restart after process or host restarts. Certificate state stays in the Caddy volumes.

At the initial takeover, independent public probing could not establish HTTPS readiness. The restricted Neon login still returned all 27 migrations and its expected financial write restrictions. Host activation, authenticated acceptance, and publication of the signed APK require the outstanding release access and signing inputs.

## Hosted acceptance

1. From an independent client, check the HTTPS origin and `/api/v1/ready`, then inspect `/api/v1/openapi` for the Crypto endpoints, including the attempts handoff, assistant, voice and receipt endpoints. Verify unauthorized wallet requests require a session.
2. Using the direct owner connection, run `npm run identity:invite -- <tester-email>`. Enroll with that invitation and confirm an uninvited sign-up fails. Verify Devnet wallet portfolio balances and transaction activity using the two RPC providers. Ask Gemini a scoped balance question and compare its structured evidence with those reads.
3. Check that the worker logs a successful cycle. Exercise a reviewed transfer on the signed Android build, verify wallet approval, handoff, finalized receipt recovery, and the resulting persistent alert. Reboot the EC2 host, verify readiness and worker health return, and recheck the same receipt and alert without resubmission.
4. Set GitHub's `AGUS_CRYPTO_DEVICE_API_URL` after HTTPS, readiness, the contract, invite-only sign-in and authenticated portfolio reads are verified. Follow the signed APK and three-transfer procedure. [Device acceptance](ANDROID_DEVICE_TEST.md)
