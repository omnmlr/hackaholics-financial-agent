# AGUS Crypto Devnet deployment

The EC2 target runs the Crypto API, the continuous monitoring and reconciliation worker, and Caddy on a single Frankfurt `t3.small`. Neon stores durable application state. Caddy serves the canonical HTTPS origin on a stable IPv4 address and forwards only the Crypto, identity, OpenAPI and health endpoints. The staged Railway fallback is recorded separately. [Railway checkpoint](RAILWAY_STAGED_REPURPOSE_20261124.md)

## AWS access and cost

The 730-hour list-price estimate is **$23.07/month** before credits and variable egress. It includes $17.52 for Linux `t3.small`, $1.90 for 20 GB encrypted gp3, and $3.65 for one IPv4 address. The CPU credit mode is `standard`. Containers have rotating logs and combined memory limits of 1,430 MiB on the 2 GiB host. GitHub builds the image and the host runs it. [EC2 Free Tier](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-free-tier-usage.html), [Frankfurt rate breakdown](https://cloud-credits.org/prices/ec2/t3-small/eu-central-1), [IPv4 pricing](https://aws.amazon.com/vpc/pricing/)

Use a time-limited AWS session with `freetier:GetAccountPlanState` and read access to the existing Frankfurt subnet and EC2 offerings. The deployment operator needs permission to manage the dedicated CloudFormation stack and its EC2, IAM and Session Manager resources. Use the founder's chosen API hostname and an existing public subnet. Find both VPC and subnet IDs in EC2 or the VPC console.

```bash
bash deploy/crypto/ec2/preflight.sh "$AGUS_EC2_PUBLIC_SUBNET" 168
```

Use the expected hold time in hours. The script checks the active Free account plan, remaining credits, expiry, instance eligibility, and the subnet's Internet Gateway. Confirm the final forecast in Billing and create **one $25 monthly cost budget** that excludes credits, with an actual alert at 80% and a forecast alert at 100%. Set a reminder to remove the Devnet stack when the agreed run window ends. Stopping the instance leaves EBS and IPv4 charges in place. [Track credits](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/tracking-free-tier-usage.html), [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html)

```bash
aws cloudformation deploy --region eu-central-1 --stack-name agus-crypto-devnet \
  --template-file deploy/crypto/ec2/host.yml --capabilities CAPABILITY_IAM \
  --parameter-overrides VpcId="$AGUS_EC2_VPC" PublicSubnetId="$AGUS_EC2_PUBLIC_SUBNET" \
  --no-execute-changeset
```

Inspect the change set for the one host, IPv4 address, security group and Session Manager role and profile. Execute it after the account, credits, budget and DNS owner are confirmed. Publish an A record for the chosen API hostname pointing to `StableIPv4` from the stack outputs. The host has one encrypted root volume and inbound HTTP/HTTPS. Use AWS Systems Manager Session Manager for administration. [Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)

## Neon and runtime secrets

The database is `agus_crypto_devnet_20261124`, project `empty-bonus-20525410`, branch `staging`. The existing runtime login is `agus_crypto_devnet_runtime`. Run future migrations in a trusted operations session using the direct, TLS-verified `agus_staging_owner` connection as `MIGRATION_DATABASE_URL`. Run `npm run db:migrate`, then apply `scripts/sql/runtime-role.sql` and `scripts/sql/crypto-devnet-runtime-login.sql` with `psql -v ON_ERROR_STOP=1` on that same database as the owner. The second SQL file guards its target and removes any direct grants that could bypass the runtime group's restrictions. The owner credential stays in the operations session.

The 27 migration checksums through `0027_crypto_requests.sql` and the normalized archive marker were independently checked on 24 November 2026. Runtime access to alerts, invitation consumption and migration status was verified through the restricted login. Runtime writes to the archive and ledger, schema creation, and invitation email updates were denied after grant correction. The historical `agus_staging` database defaults let the runtime login connect but give it no access to any of its 13 existing public relations.

On the EC2 host create `/etc/agus-crypto/shared.env` and `/etc/agus-crypto/api.env` as root-owned files with mode `0600`. Use one `NAME=value` per line without surrounding quotes. The host volume is encrypted. Keep durable auth and encryption material in the approved secret store for recovery. Avoid printing these files or Docker container environment values. Fill the values through the secure operations session.

| File         | Settings                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared.env` | `DATABASE_URL` for the restricted runtime login with TLS certificate verification, `AGUS_DEVNET_RPC=https://api.devnet.solana.com`, `AGUS_DEVNET_VERIFY_RPC=https://devnet.rpcpool.com`.      |
| `api.env`    | `BETTER_AUTH_SECRET` with at least 32 characters, `AGUS_ENCRYPTION_ACTIVE_KEY=devnet-v1`, `AGUS_ENCRYPTION_KEYS` as a JSON object mapping `devnet-v1` to a base64-encoded random 32-byte key. |
| `api.env`    | `AI_PROVIDER=gemini` and `AI_API_KEY`.                                                                                                                                                        |
| `api.env`    | For voice, set `AGUS_CRYPTO_VOICE_ENABLED=true`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` and, on the verified free tier, `ELEVENLABS_ZERO_RETENTION=false`.                               |
| `api.env`    | For live research, set `FIRECRAWL_API_KEY`.                                                                                                                                                   |

Compose sets the Devnet profile, invite-only authentication, the approved external-wallet routes, and the worker schedule. Leave Mainnet and experimental transaction capabilities disabled during Devnet acceptance. Cloud HTTP secret binding placeholders work only in that Cloud environment. The EC2 runtime uses its own secure bindings.

## Build and activate

Dispatch **AGUS Crypto Devnet release image** from the intended revision and set `retain_bundle` after checking Actions artifact allowance. The workflow builds the same AMD64 image for API and worker. The bundle contains the exact Git revision, image ID, image archive and checksums. Use a trusted GitHub session to download it and check `SHA256SUMS.txt` on the operations workstation before transferring the directory to EC2.

Use Session Manager SSH to transfer the checked directory without opening port 22. For a host without an SSH key, install a temporary public key for the `ubuntu` account through a Session Manager shell, transfer over `AWS-StartSSHSession`, then remove that temporary key. [SSH through Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-getting-started-enable-ssh-connections.html)

```bash
sudo bash /path/to/bundle/activate-release.sh /path/to/bundle "$AGUS_CRYPTO_HOST"
```

Activation checks the bundle again, verifies the Linux AMD64 image's ID and revision label, then starts the three services. It waits for `/api/v1/ready`, a successful monitoring and reconciliation cycle, and a trusted TLS certificate. On replacement failure it reapplies the previous Compose release. Keep the previous image until the new version passes acceptance. Do not roll back database schemas to revert an image. Docker starts on boot and the three containers restart after process or host restarts. Certificate state stays in the Caddy volumes.

## Hosted acceptance

1. From an independent client, check the HTTPS origin and `/api/v1/ready`, then inspect `/api/v1/openapi` for the Crypto endpoints, including the attempts handoff, assistant, voice and receipt endpoints. Verify unauthorized wallet requests require a session.
2. Using the direct owner connection, run `npm run identity:invite -- <tester-email>`. Enroll with that invitation and confirm an uninvited sign-up fails. Verify Devnet wallet portfolio balances and transaction activity using the two RPC providers. Ask Gemini a scoped balance question and compare its structured evidence with those reads.
3. Check that the worker logs a successful cycle. Exercise a reviewed transfer on the signed Android build, verify wallet approval, handoff, finalized receipt recovery, and the resulting persistent alert. Reboot the EC2 host, verify readiness and worker health return, and recheck the same receipt and alert without resubmission.
4. Set GitHub's `AGUS_CRYPTO_DEVICE_API_URL` after HTTPS, readiness, the contract, invite-only sign-in and authenticated portfolio reads are verified. Follow the signed APK and three-transfer procedure. [Device acceptance](ANDROID_DEVICE_TEST.md)
