# AGUS Crypto Devnet deployment

Use an isolated Railway project with capacity for `api`, `worker` and PostgreSQL. Use `deploy/crypto/Dockerfile` from the PR branch for both application services. Set the API start command to `sh deploy/crypto/start.sh api` and the worker start command to `sh deploy/crypto/start.sh worker`. Give the API a Railway HTTPS domain and use `/api/v1/ready` as its health check. Keep the worker and database on the private network.

Run `npm run db:migrate` on the isolated database with its schema-owner `MIGRATION_DATABASE_URL`. Execute `scripts/sql/runtime-role.sql` as that owner. Create a separate LOGIN, assign it a unique password using `psql`'s `\password`, and grant it membership in `agus_runtime`. Set `DATABASE_URL` on API and worker to this LOGIN's private PostgreSQL connection. Keep the migration credential on the operations runner. Reapply the grants after future migrations.

| Scope | Variables |
| --- | --- |
| API and worker | `AGUS_ENVIRONMENT=devnet`, `PAYMENT_MODE=fixture`, `AGUS_SOLANA_DEVNET_ENABLED=true`, `AGUS_AUTH_PUBLIC=false`, `AGUS_CRYPTO_DEVNET_ROUTES=phantom,solflare`, `AGUS_CRYPTO_MONITORING=true` |
| API and worker | `AGUS_DEVNET_RPC=https://api.devnet.solana.com`, `AGUS_DEVNET_VERIFY_RPC=https://devnet.rpcpool.com` |
| API | `APP_ORIGIN` and `BETTER_AUTH_URL` set to the API's same canonical HTTPS origin, plus a fresh `BETTER_AUTH_SECRET`, server-side `AGUS_ENCRYPTION_KEYS` and `AGUS_ENCRYPTION_ACTIVE_KEY` |
| API with Gemini | `AI_PROVIDER=gemini` and the existing server-side `AI_API_KEY` |

Use the schema-owner connection to run `npm run identity:invite -- <tester-email>`. Enroll through Better Auth using that invited email. Confirm unauthenticated wallet requests are rejected and the invited account can access its wallet list, Devnet portfolio and activity. Verify ready status and the `POST /api/v1/crypto/attempts/{id}/handoff` OpenAPI entry. The worker startup verifies the database and both RPC providers and logs monitoring and reconciliation cycles. Check grounded Gemini evidence using the invited account.

Set GitHub's `AGUS_CRYPTO_DEVICE_API_URL` only after these checks. Keep Mainnet execution, swaps and Pocket funding disabled. Verify actual transfers, receipts and alerts during handset acceptance with explicit wallet approvals. [Device acceptance](ANDROID_DEVICE_TEST.md)
