# AGUS Crypto

**Android-first, non-custodial Solana AI workspace (Devnet).**  
**Canonical development branch:** [`integration/agus-crypto-hackathon-20261129`](https://github.com/omnmlr/hackaholics-financial-agent/tree/integration/agus-crypto-hackathon-20261129)

AGUS Crypto combines natural-language portfolio analysis, owner-reviewed Solana Devnet payment requests and transaction preparation, multimodal AI interaction (Gemini chat/image understanding, ElevenLabs voice synthesis, Firecrawl research), and Mobile Wallet Adapter (MWA) signing on Android. All private keys remain on the user's device; the backend prepares and reconciles unsigned Devnet transactions without holding standing wallet authority.

> [!IMPORTANT]
> **Safety & Network Scope:** This codebase targets **Solana Devnet and simulated/fixture bank data only** (`PAYMENT_MODE=fixture`, `AGUS_SOLANA_DEVNET_ENABLED=true`). Mainnet execution, live transfers, guest mode, and unreviewed agent signing remain disabled.

---

## Quick Clone (for Contributors & CTO)

```bash
git clone --branch integration/agus-crypto-hackathon-20261129 https://github.com/omnmlr/hackaholics-financial-agent.git
cd hackaholics-financial-agent
npm ci
```

---

## Architecture Overview

| Layer | Paths | Stack & Responsibilities |
| --- | --- | --- |
| **Web & API Backend** | `src/app/`, `src/server/`, `src/lib/` | Next.js 16 App Router (`next build --webpack`), React 19, Better Auth (`better-auth`, `@better-auth/expo`) on `agus_*` PostgreSQL tables, Drizzle ORM / `pg` (with `@electric-sql/pglite` for offline test suites), SQL least-privilege runtime role (`scripts/sql/runtime-role.sql`). |
| **Solana Devnet Engine** | `src/server/crypto/`, `src/lib/solana/` | Non-custodial wallet registration, Devnet balance & activity sync, transfer/swap quote review, MWA handoff lifecycle, Solana Pay request & invoice creation, public `/api/v1/crypto/share/:reference` lookup (IP + global PostgreSQL rate-limited), and immutable receipt/audit recording. |
| **Multimodal AI & Research** | `src/server/crypto/assistant*.ts`, `voice*.ts`, `research*.ts` | Gemini (`@google/genai`) assistant with optional local Tesseract image screening, ElevenLabs speech streaming, and Firecrawl public research under per-user/global daily quotas. |
| **Contracts & Typed Client** | `packages/contracts/`, `packages/api-client/`, `scripts/generate-openapi.mjs` | Zod contracts mapped to OpenAPI 3.1.0 (`packages/contracts/openapi.json`) and TypeScript client types (`packages/api-client/src/generated.ts`). |
| **Android Client Workspace** | `apps/mobile/` | Expo / React Native TypeScript workspace (`@agus/mobile`), authenticated Better Auth Expo client, and Devnet wallet handoff harness. |
| **Deploy & Infra Tooling** | `deploy/crypto/aws/`, `deploy/crypto/ec2/`, `scripts/` | Docker build (`deploy/crypto/Dockerfile`), Caddy TLS reverse proxy, AWS/Neon preflight checks, Stockholm EC2 activation scripts, and CI workflows under `.github/workflows/`. |

---

## Environment Requirements

- **Node.js:** v22+ (v24 used in backend container & test runner) and **npm** (workspaces enabled for `packages/*` and `apps/*`)
- **Python:** 3.11+ (for EC2 deployment utilities and unit tests under `deploy/crypto/ec2/`)
- **Database:**
  - **Server / Devnet runtime:** PostgreSQL 16+ (two roles recommended: schema owner `MIGRATION_DATABASE_URL` for `npm run db:migrate`, and least-privilege runtime `DATABASE_URL` after running `scripts/sql/runtime-role.sql`)
  - **Local development & offline unit/adversarial tests:** `@electric-sql/pglite` (embedded, zero external DB required)
- **Android / Mobile builds:** Android SDK & JDK 17 (optional unless building native APK artifacts)

### Configuration Variables (Reference: [`.env.example`](.env.example))

Never commit secrets, API keys, passwords, or private wallet material. Copy `.env.example` to `.env.local` and supply secrets from your secret manager:

- **Core & Database:** `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `APP_ORIGIN`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `AGUS_ENCRYPTION_KEYS`, `AGUS_ENCRYPTION_ACTIVE_KEY`, `AGUS_ENVIRONMENT` (`fixture` | `sandbox` | `devnet` | `live`), `PAYMENT_MODE`, `AGUS_SOLANA_DEVNET_ENABLED`
- **Authentication & OAuth:** `AGUS_AUTH_PUBLIC`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `AGUS_AUTH_EMAIL_FROM`
- **Solana Devnet RPC & Routing:** `AGUS_DEVNET_RPC`, `AGUS_DEVNET_VERIFY_RPC`, `AGUS_CRYPTO_DEVNET_ROUTES`, `AGUS_CRYPTO_MONITORING`, `AGUS_CRYPTO_REQUESTS`, `AGUS_CRYPTO_INVOICES`, `AGUS_CRYPTO_REQUIRE_STEP_UP`
- **AI, Image, Voice & Research:** `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AGUS_CRYPTO_AI_DAILY`, `AGUS_CRYPTO_AI_GLOBAL_DAILY`, `AGUS_CRYPTO_IMAGES`, `AGUS_CRYPTO_VOICE_ENABLED`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_ZERO_RETENTION`, `FIRECRAWL_API_KEY`, `AGUS_CRYPTO_RESEARCH_DAILY`, `AGUS_CRYPTO_RESEARCH_GLOBAL_DAILY`
- **Mobile Export:** `EXPO_PUBLIC_API_URL` (for `npm run mobile:export:android`)

---

## Local Setup

1. **Install dependencies:**
   ```bash
   npm ci
   ```
2. **Configure local environment:**
   ```bash
   cp .env.example .env.local
   ```
   Fill in `BETTER_AUTH_SECRET` (32+ random characters) and `AGUS_ENCRYPTION_KEYS` / `AGUS_ENCRYPTION_ACTIVE_KEY` for local runtime, or keep fixture settings for offline validation.
3. **Run database migrations (PostgreSQL runtime):**
   ```bash
   npm run db:migrate
   ```
   Then apply [`scripts/sql/runtime-role.sql`](scripts/sql/runtime-role.sql) as the schema owner so `agus_runtime` has least-privilege access (no `UPDATE`/`DELETE`/`TRUNCATE` on ledger, receipt, review, or audit tables).
4. **Verify configuration & contract parity:**
   ```bash
   npm run contracts:generate
   AGUS_ENVIRONMENT=fixture npm run config:validate
   ```
5. **Start the development server:**
   ```bash
   npm run dev
   ```

---

## Verification & Quality Gates

Run these checks locally before opening a pull request:

```bash
# 1. Regenerate OpenAPI & typed API client (must leave zero unexpected diff)
npm run contracts:generate

# 2. Typechecking & ESLint
npm run typecheck
npm run mobile:typecheck
npm run lint

# 3. Environment & Android JS bundle export
AGUS_ENVIRONMENT=fixture npm run config:validate
EXPO_PUBLIC_API_URL=https://prototype.fixture.invalid npm run mobile:export:android

# 4. Production Next.js webpack build
npm run build

# 5. Test suites
npm test
npx vitest run --config deploy/crypto/aws/vitest.config.ts
python3 -B -m unittest discover -s deploy/crypto/ec2 -p "test_*.py"
```

---

## Contribution Guidelines

1. **Branch from canonical integration:** Create a descriptive feature branch from `integration/agus-crypto-hackathon-20261129`. Never force-push or rewrite shared branches.
2. **Contract-first API changes:** Edit `packages/contracts/` and `src/` handlers together, regenerate `packages/contracts/openapi.json` and `packages/api-client/src/generated.ts` via `npm run contracts:generate`, and verify `git diff` includes regenerated artifacts.
3. **Preserve ownership boundaries:**
   - **Android / Frontend UI:** Follow [`docs/agus-crypto/CHISOM_ANDROID_INTEGRATION.md`](docs/agus-crypto/CHISOM_ANDROID_INTEGRATION.md); consume `@agus/api-client` and preserve the approved identity/mascot assets and authenticated Better Auth flow (no guest mode).
   - **Security & Devnet Guardrails:** Never bypass ownership/authorization checks, never persist private keys or mnemonic phrases server-side, and keep all execution gated to Solana Devnet.
   - **Dev3pack Attribution:** Respect the pre-event vs. hackathon window separation rules in [`docs/agus-crypto/DEV3PACK_SUBMISSION.md`](docs/agus-crypto/DEV3PACK_SUBMISSION.md).

---

## Key Documentation

- [Product Requirements Document (PRD)](docs/agus-crypto/PRD.md)
- [API Contract v1](docs/agus-crypto/API_CONTRACT.md) & [Frontend Contract 1.1.0](docs/agus-crypto/FRONTEND_CONTRACT_1_1.md)
- [Chisom Android Integration Guide](docs/agus-crypto/CHISOM_ANDROID_INTEGRATION.md)
- [Engineering Control Plane](docs/agus-crypto/engineering/CONTROL_PLANE.md) & [Task Board](docs/agus-crypto/engineering/TASK_BOARD.md)
- [Devnet Deployment](docs/agus-crypto/DEVNET_DEPLOYMENT.md) & [AWS Preflight](docs/agus-crypto/engineering/AWS_PREFLIGHT.md)
- [Pre-Event Implementation Record](docs/agus-crypto/IMPLEMENTATION.md) & [Dev3pack Submission Rules](docs/agus-crypto/DEV3PACK_SUBMISSION.md)
- [Repository Consolidation Audit (Nov 25)](docs/agus-crypto/engineering/CONSOLIDATION_AUDIT_20261125.md)
- [Historical Zcash / AGUS 2.0 Notes](docs/zcash-native/README.md) (pre-Crypto prototype reference)
