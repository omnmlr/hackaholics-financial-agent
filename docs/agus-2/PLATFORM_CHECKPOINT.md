# Shared platform and banking checkpoint — 10 November 2026

Integration branch: `integration/agus2-foundation-20261110`, descended from the
approved `3f767d17e35efb8e84a9fe4da05f231c8e6956b4` baseline. Sprint 0 and
Sprint 1 tools remain preserved. **Genuine wallet execution is pending human
acceptance and is not a prerequisite for this independent engineering work.**

## Delivered implementation

### Sprint 2: identity, persistence and APIs

- Better Auth 1.7.19 with Drizzle/PostgreSQL, its official Expo client integration,
  invite-only enrollment, persistent authentication rate limits, individual
  consumer/support/operations roles, and server-validated device sessions.
  Session cookie caching is disabled so revocation takes effect immediately.
  Credential changes revoke existing sessions. Recovery/verification email is a
  separate production gate; no email delivery is claimed.
- Password plus Better Auth TOTP creates a two-minute, one-use capability bound
  to the exact action, instruction digest, owner and server session. Consumption
  and fiat authorization commit atomically. No device ID, client origin, biometric
  boolean or nonempty token grants financial authority.
- `/api/v1` handlers and an OpenAPI 3.1 document at `/api/v1/openapi`, generated
  TypeScript client in `packages/api-client`, and client-safe shared schemas in
  `packages/contracts`. Financial requests use atomic-unit strings; financial
  instructions use canonical hashes and idempotency keys. Resources expose
  revisions, opaque cursors, stable errors, correlation IDs and private responses.
- Ordered SQL migrations with SHA-256 checksums and a PostgreSQL advisory lock.
  PostgreSQL application startup checks schema compatibility and uses no runtime
  schema creation. Embedded development storage retains compatibility behavior.
- The legacy payment aggregate is archived once and its payment records and
  audits are normalized without indefinite financial aggregate dual writes.
  Submitted/unknown authority and original payment/audit order are retained;
  unused banking and Solana approvals are invalidated during cutover. Solana
  reviewed bytes, signatures and submitted claims remain intact. The legacy
  operator API uses the normalized compatibility store; its reducer transaction
  remains serialized to preserve existing invariants. New source payments use
  independent instruction/attempt rows and row-level claims.
- Inbox/outbox jobs, leased claims, fencing, bounded retries, dead-letter inspection,
  and an independently runnable worker. In-app notifications contain opaque
  resource IDs. Existing responsibility/memory and journal services have owned
  API wrappers; their intelligence behavior is preserved.
- AES-256-GCM envelope encryption with versioned wrapping keys and owner/purpose
  binding. Structured logs accept operational IDs/codes only. Readiness checks
  require schema, identity configuration and encryption configuration.

### Sprint 3: banking and source-payment infrastructure

- Twenty-three candidate institutions, with seven independent live capability
  records apiece, all disabled. Wema/ALAT counts once. Legal entity verification
  and provider identifiers remain explicitly unverified. A separate destination
  directory cannot enable any source operation. Accepted genuine source
  institutions: **zero**.
- Provider contracts separate account data, personal-source payments and
  beneficiary directories. The durable fixture lifecycle covers owner-bound,
  expiring, single-use linking state; multiple accounts; local consent expiry,
  reauthorization and revocation; distinct balance kinds; paginated synchronization;
  duplicates, corrections, partial history, rate limits, delayed data and outages.
- Source payments bind source account/grant revision, beneficiary identity,
  amount/currency/scale, fee quote/version, expiry and environment into approval.
  A committed unique execution claim precedes a provider effect. Ambiguous writes
  stay unknown and are reconciled; they are never automatically resent.
- The realistic provider persists pending reservations, ledger effects and delayed
  reversals. Receipts say **“SIMULATED — no bank transfer occurred”** and never
  assert bank-credit evidence. Disputes are separately idempotent cases.
- Authenticated fixture webhooks enter an encrypted, deduplicated inbox and
  schedule reads. Claimed webhook status alone cannot settle a payment.
- Mono's transport-injected data adapter follows the documented code exchange,
  account information, pagination, reauth initiation and unlink wire contracts.
  Its account identifier is not an OAuth refresh token. Unspecified available/
  ledger balance semantics are left unspecified. Contract fixtures passed;
  genuine partner/sandbox acceptance is blocked by issued access and approval.
- Sponsor Open Banking, Remita consumer payments, Mono personal-source payments,
  Bridge USD and Paycrest settlement have explicit disabled boundaries. Existing
  Paystack merchant payouts remain a different capability. No undocumented
  source-payment endpoint, fee policy or commercial entitlement was invented.

### Independent mobile, requests and P2P work

- Expo SDK 58 / React Native 0.88 Android development-build foundation, SecureStore,
  local biometric unlock, server session revalidation, account/history retrieval,
  TOTP setup, notification permission/token states, and developer state harnesses.
  There is no ordinary-storage session token or credential-bearing deep link.
- Android MWA 3 signs the exact reviewed Devnet transaction. Signing and server
  submission are explicit separate actions; signed bytes and operation IDs are
  kept in SecureStore for recovery. Network recovery, notifications and app resume
  cannot silently submit. Server submission remains the existing Solana service.
  iOS wallet support is deliberately unavailable pending its own verified flow.
- Wallet association uses a short-lived owner-bound Ed25519 challenge. The public
  address alone does not prove ownership. Wallet signature history is paginated
  and explicitly incomplete, including missing incoming token-account coverage.
- Payment-request creation, shared lookup, cancellation, Solana Pay URI parsing,
  exact read-only references and finalized-settlement matching are implemented.
  References aid discovery; they do not enforce on-chain exactly-once execution.
  Late settlements remain explicit. No matching transaction has been claimed
  genuinely paid as part of this checkpoint.
- P2P internal-simulation eligibility, offers, deterministic executable-value/time
  matching, quotes, atomic single-counterparty reservations, cancellation,
  unfunded expiry and dispute records are implemented. Financial quantities carry
  explicit USDC/NGN units. Expiry cannot refund a funded order. Fiat claims and
  screenshots cannot authorize release. Escrow execution returns
  `GENUINE_DEVNET_ACCEPTANCE_PENDING`; no Anchor deployment, funding, release or
  arbitration authority is represented as implemented or accepted.

## Verification and limits

The full regression suite passed with **1,472 tests across 79 files**. This
includes the preserved baseline and real PostgreSQL tests for identity/TOTP,
revocation, ownership isolation, runtime DDL denial, worker fencing, real process
termination before/after commit, migration integrity, source consent, configured
provider failures, reversals, and 100 concurrent duplicate submissions producing
one application/provider submission. Final targeted checks also exercise the
last migration/locking changes.

The actual built Next.js HTTP flow passed against a separate least-privilege
PostgreSQL database: signup → TOTP → connection → beneficiary → instruction →
authorization → duplicate submission → reconciliation → simulated receipt,
then server restart, persisted recovery and remote session revocation. It also
exercises legacy operator API compatibility against normalized PostgreSQL.
Server logs were checked for the generated test passwords, TOTP seed, auth
secret, session cookies and wrapping key. No paid-model, bank-provider or chain calls occur in
these smoke tests.

The maintained `test:agent-workspace`, `test:agent-followup` and
`test:agent-runner` HTTP/Chromium checks passed against the final production
build. They cover existing task/memory controls, reminder delivery, owned
read-only Devnet follow-up and recovery. The older `test:browser:workspace`
visual script is incompatible with the approved baseline: it expects the
removed `.agus-signin-hint` and `Spend` controls and fixed 16px typography.
Diagnostic selector updates exposed those stale expectations; they were
reverted. That historical visual suite is **not passed**. The application UI
was preserved rather than rewritten to satisfy historical selectors.

Web/backend typecheck, lint and production build passed. Mobile typecheck,
Android Hermes bundle export and native Expo prebuild passed. The native APK
build was attempted with official SDK/NDK/JDK dependencies and failed when the
environment exhausted build storage (workspace 7.9 GiB, temporary filesystem
4.9 GiB). Task-owned Gradle caches were cleared; source and acceptance databases
were preserved. **No APK, physical installation, native wallet transfer or real
push delivery is claimed.** Re-run in an Android build environment with more
storage or an approved EAS account using `apps/mobile/eas.json`.

The branch has not been published, merged or deployed. The PR workflow includes
PostgreSQL acceptance, generated-client drift checks, native typecheck/bundling,
and the existing HTTP/browser checks without model/payment secrets. Hosted CI
has not run for this local branch.

## Operational commands

```sh
npm ci --ignore-scripts
MIGRATION_DATABASE_URL=postgresql://migration-role@host/database npm run db:migrate
# As the schema owner, apply scripts/sql/runtime-role.sql and provision a separate
# runtime LOGIN with membership in agus_runtime. Never run migrations as it.
MIGRATION_DATABASE_URL=postgresql://operations-role@host/database npm run identity:invite -- person@example.com
DATABASE_URL=postgresql://runtime-role@host/database npm run platform:worker
AGUS_TEST_DATABASE_URL=postgresql://test-owner@localhost/test npm run test:platform
AGUS_TEST_DATABASE_URL=postgresql://test-owner@localhost/test npm run test:platform:http
npm run contracts:generate
npm run mobile:typecheck
EXPO_PUBLIC_API_URL=https://approved-backend.example npm run mobile:export:android
```

The test database credential must be for a disposable acceptance database/server:
tests create isolated databases and roles, then remove them. Test users and
provider effects are fictional. Production wrapping keys must come from an
approved secret manager/KMS; local test keys are not production configuration.
Apply the role grants after adding migrations. Preserve existing migration
checksums; append migrations rather than editing applied files.

Remaining external gates are genuine wallet acceptance, larger Android build
storage/EAS access and physical-device acceptance, real push credentials/delivery,
production identity email/recovery and key operations, and bank/USD/settlement
partner contracts and issued credentials. These gates do not convert fixture
results into genuine integrations.
