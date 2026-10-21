# PR #43 isolated Railway preview — plan only

**NOT DEPLOYED. Explicit owner approval is required before creating resources or deploying.** This plan uses the [Railway skill](skill://plugin_asdk_app_6a502589384081919c5decf93496c9d1/use-railway/SKILL.md) and read-only Railway documentation. No existing project's variables, database, volumes or deployment configuration were inspected or copied.

## Isolation and source

Create a new project named `agus-pr43-preview`, with its own `preview` environment, empty `agus` service and a **new empty PostgreSQL service/volume**. Do not duplicate production, enable automatic PR environments from production, restore a backup or clone the Neon database. Railway private networks are isolated by both project and environment. Leave the database's public TCP proxy disabled; only the app gets a new Railway HTTPS domain. No custom production domain, webhook or provider connection is needed.

Pin application source to **`869b5b9b488299007ece130e78d76cf5fc102d45`** from `omnmlr/hackaholics-financial-agent`, PR #43. Later documentation-only commits do not change that application candidate. Use a clean temporary export of that exact commit, with no `.env*`, local data or existing Railway link metadata. Deploy it manually to the explicit new project/environment/service IDs after approval. No new Git branch or PR is needed. Do not connect an auto-deploying repository before configuration. Leave GitHub autodeploys disconnected/disabled throughout this preview; record the actual source SHA in the deployment evidence.

## Proposed service configuration

| Setting              | Preview value                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Runtime              | Node 22.16.0, matching the passed CI job; verify actual build/runtime version                                   |
| Dependencies / build | Lockfile-based `npm ci`; `npm run build` (webpack); no database access during build                             |
| Pre-deploy           | `node --import=tsx scripts/migrate.ts`, against the new preview DB only; failure stops deployment               |
| Start                | `npm run start` (existing script binds `0.0.0.0`, uses Railway `PORT`)                                          |
| Health check         | `/` for HTTP readiness; separately authenticate and inspect fixture account/state readiness                     |
| Instances            | One app replica initially; small resource limits, explicit Railway spend alert/limit and short preview lifetime |
| Database             | Fresh PostgreSQL service, reference its **private** `DATABASE_URL` from this project/environment                |
| Public access        | New HTTPS Railway domain for app; application operator sign-in required for financial APIs                      |

The existing initializer creates workflow/auth/financial tables and fictional seed records; it does not require a new SQL migration for this RC. Initializing the empty preview DB is the only intended schema/data change. First verify destination service identity and host without printing the connection string. Abort on any external/production DB hostname. Private networking is available to pre-deploy/runtime, not the build. Set a 300-second pre-deploy timeout; that container has no application volume and must write only to the dedicated PostgreSQL service. Confirm the selected Railway Node-version control and that `tsx` is present in the pre-deploy image; no pruning step may remove it before initialization. These platform settings have not been exercised here.

## Explicit environment allowlist

Configure these on the **new app service only**, before its first deployment. Create secrets independently; do not import shared/production variables.

| Variable                                                                                                                                   | Value / handling                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                                                                                                                 | `production` (Next runtime mode, not the production banking environment)                                                                                                                          |
| `NEXT_TELEMETRY_DISABLED`                                                                                                                  | `1`                                                                                                                                                                                               |
| `DATABASE_URL`                                                                                                                             | Reference `${{Postgres.DATABASE_URL}}` for the newly created private DB; verify actual service name/private host                                                                                  |
| `APP_ORIGIN`                                                                                                                               | Exact new preview HTTPS origin, without trailing slash; never the existing production URL                                                                                                         |
| `OPERATOR_ID`                                                                                                                              | Unique `agus-pr43-preview`                                                                                                                                                                        |
| `OPERATOR_PASSWORD_HASH`                                                                                                                   | New preview-only scrypt hash; generate locally using `npm run operator:password` in a private terminal (input is visible); share the password through an approved private channel, never chat/Git |
| `PAYMENT_MODE`                                                                                                                             | `fixture`                                                                                                                                                                                         |
| `FINANCIAL_DEMO_ENABLED`                                                                                                                   | `true`                                                                                                                                                                                            |
| `AGUS_AGENT_ARCHITECTURE`                                                                                                                  | `native-gemini`                                                                                                                                                                                   |
| `AI_PROVIDER`                                                                                                                              | `gemini`                                                                                                                                                                                          |
| `AI_MODEL`                                                                                                                                 | Explicit multimodal Gemini model selected in the real-model campaign; availability must be verified                                                                                               |
| `AI_API_KEY`                                                                                                                               | Separate development-only key, set directly in preview secret configuration; restricted API/quota, no production key                                                                              |
| `MAX_PAYMENT_KOBO`                                                                                                                         | `1000000` (₦10,000 maximum fictional payment)                                                                                                                                                     |
| `MAX_BATCH_KOBO`                                                                                                                           | `3000000` (₦30,000 maximum fictional batch)                                                                                                                                                       |
| `FEE_RESERVE_KOBO`                                                                                                                         | `5000` (₦50 reserve per fictional payment; not a claim of a confirmed fee)                                                                                                                        |
| `LIVE_TRANSFERS_ENABLED`, `PAYSTACK_TRANSFERS_ENABLED`, `LIVE_OWNER_AUTHORIZED`, `LIVE_WEBHOOK_VALIDATED`, `LIVE_RECONCILIATION_VALIDATED` | Each explicitly `false`                                                                                                                                                                           |
| `PAYSTACK_SECRET_KEY`, `PAYSTACK_INTEGRATION_ID`, `LIVE_BENEFICIARY_ALLOWLIST`                                                             | Absent/empty                                                                                                                                                                                      |
| `PAYMENTS_EMERGENCY_DISABLED`                                                                                                              | `false` only for approved fixture lifecycle tests; emergency stop is available if needed                                                                                                          |

No real bank passwords, genuine recipient accounts, customer exports or production session secrets belong in the preview. Arbitrary synthetic OPay `9812345670` remains **unverified** and cannot submit. Supported predefined fictional beneficiaries may be used to exercise simulated execution. Never weaken resolution rules to make a model scenario pass.

## Execution sequence after explicit approval

1. Record approved scope, new project/environment/service IDs, source SHA, resource cost/lifetime and development key provenance. Create only the isolated resources above. Do not link a CLI to the existing production project.
2. Configure the DB reference, unique credentials, fixture flags, model and new origin; inspect non-secret configuration and test the negative live execution gates. Keep DB external access disabled. Ensure the app cannot inherit production payment/provider variables.
3. Build the pinned export, initialize only the empty preview database via pre-deploy, then start one instance. Record build/deployment IDs and actual Node version. Generate/use the app's new HTTPS domain; never repoint production DNS. Stop if configuration/source identity differs.
4. Check unauthorized API requests fail, sign in with the preview credential, verify fictional account source labels, and confirm no live provider configuration. Test prepare → edit → verify → explicit review/approval → separate submit → status/reconciliation → simulated confirmation → reload against synthetic recipients. Approval alone must not submit. Processing/unknown must not display success.
5. Perform the bounded [real-model matrix](REAL-MODEL-ACCEPTANCE.md), recording true responses/usage; a public preview is **not itself a request/cost limiter**. Keep the origin/operator credential private and restrict developer-key quota. The 40-call/US$1 campaign guard belongs in the acceptance runner; ordinary manual preview interactions incur additional usage and must be scheduled separately within the development quota.
6. Physical Android Chrome and the affected embedded browser follow [the device checklist](REAL-DEVICE-CHECKLIST.md), including keyboards, interrupted uploads, camera permissions and voice transcription. Record device/browser versions and synthetic screenshots. Do not assert physical-device acceptance until actually observed.

On any unauthorized action, invented verification, false success, wrong database target or unexpected provider traffic: stop testing, disable preview payment operations, preserve sanitized synthetic evidence and keep the release blocked. Do not auto-retry an uncertain payment.

## Rollback and cleanup

Stop the preview app, revoke/rotate its development key and operator credential, and remove the preview domain. Retain only sanitized synthetic acceptance evidence; back up the preview-only DB if needed for a defect investigation, then delete only the recorded preview project/resources at the agreed expiry. Never roll back, migrate, redeploy or change configuration in the production project as part of this plan. Cleanup is limited to resources created under the eventual preview approval; nothing has been created yet.

## Documentation verified

- [Private networking and project/environment isolation](https://docs.railway.com/networking/private-networking/how-it-works#network-isolation).
- [Disable GitHub automatic deployments](https://docs.railway.com/deployments/github-autodeploys#disable-automatic-deployments).
- [Pre-deploy commands: private network, variables and failure gate](https://docs.railway.com/deployments/pre-deploy-command).
- [Next.js and a dedicated Postgres connection](https://docs.railway.com/guides/nextjs#connect-your-nextjs-service-to-postgres).

The Postgres connection guidance was found through Railway documentation search; the networking, autodeploy and pre-deploy pages were also fetched. Runtime/deployment behavior remains to be validated after approval. Read-only documentation calls do not constitute a deployed preview or platform acceptance.
