# Local checkout and acceptance

Use Node.js 24 LTS, npm and Git. Commands below use a Bash terminal (Linux,
macOS, or WSL on Windows). No production credentials or paid services are needed
for the isolated previews.

```sh
git clone --branch integration/agus2-foundation-20261110 https://github.com/omnmlr/hackaholics-financial-agent.git
cd hackaholics-financial-agent
npm ci --ignore-scripts
npm run build
npm run preview:fixture
```

Open http://127.0.0.1:3000. This preview uses fictional financial data and scripted
model responses, not a paid model or bank. Read its generated local application
password from `.data/finals-fixture-preview/operator-password` to sign in. These
local files are ignored by Git and will be created independently on your PC.

## Genuine Devnet acceptance application

Stop the fixture preview first; both default to port 3000. With the production
build above present, run:

```sh
npm run preview:devnet
```

Open http://127.0.0.1:3000/devnet. Read the generated **application** password from
`.data/agus2-devnet-acceptance/operator-password`. It is not a wallet password.
The application keeps a separate persistent local database, disables AI and real
bank payments, and permits the genuine public Devnet pipeline. No wallet key or
seed phrase should be entered into AGUS.

Use a supported browser wallet set to Devnet and two owner-controlled test
addresses. Fund the sender with faucet SOL and canonical Circle test USDC (mint
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). Test 0.001 SOL and 1 test USDC;
review, approve and sign explicitly, reconcile, and download each saved draft.
Do not resend an unresolved transfer. Run the independent read-only verifier:

```sh
AGUS_ENVIRONMENT=devnet PAYMENT_MODE=fixture \
AGUS_SOLANA_DEVNET_ENABLED=true PAYSTACK_SECRET_KEY= \
npm run solana:acceptance -- \
  --draft-file /path/to/downloaded-draft.json \
  --output .data/agus2-devnet-acceptance/sol-finalized-evidence.json
```

Use a different output file for USDC. Restart the app and recover the same saved
drafts to check persistence. Genuine signing, finality and restart acceptance
remain pending until you perform them. Follow [the full acceptance checklist](SPRINT_1_ACCEPTANCE.md).
For a forwarded HTTPS URL, set `DEVNET_PREVIEW_ORIGIN` to the exact URL before
starting; `DEVNET_PREVIEW_PORT` changes the local port.

## Shared backend for mobile and platform APIs

The previews above use the legacy operator login; they do not configure the
multi-user mobile backend. That requires local PostgreSQL (17 was tested), a
schema-owner migration connection, a separate runtime role, Better Auth identity
configuration and locally generated encryption/auth secrets. Copy `.env.example`
to `.env.local`, fill those values privately, run `npm run db:migrate` with
`MIGRATION_DATABASE_URL`, and apply `scripts/sql/runtime-role.sql` as schema
owner. Provision a runtime LOGIN with membership in `agus_runtime` and use it
for `DATABASE_URL`. Keep `PAYMENT_MODE=fixture`, `AI_PROVIDER=none` and live
payment flags false. Set `APP_ORIGIN` and `BETTER_AUTH_URL` consistently.

Generate a random auth secret of at least 32 characters. `AGUS_ENCRYPTION_KEYS`
is a JSON map such as `{"local-v1":"<base64-encoded random 32 bytes>"}`, with
`AGUS_ENCRYPTION_ACTIVE_KEY=local-v1`; do not use the placeholder literally or
commit these values. Invite an identity using `identity:invite` with the migration
connection, then use `npm run dev` for the backend and configure TOTP. See the
[platform operating instructions](PLATFORM_CHECKPOINT.md#operational-commands).

## Android prerequisites and local build

- JDK 21 with `JAVA_HOME` configured; Android Studio/command-line SDK, platform
  tools/ADB, accepted SDK licenses, and the SDK/Build Tools/NDK/CMake versions
  requested by Expo SDK 58 / React Native 0.88's generated Gradle project.
- Set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) and put platform-tools on PATH.
- Allow substantial free space for SDK, Gradle transforms and native compilation.
  The read-only preflight uses a conservative minimum of 8 GiB free on both
  project and temporary volumes; SDK/cache installation may need more.
- Use a physical Android device with USB debugging and an MWA-compatible wallet
  for actual wallet acceptance. Expo Go is insufficient.

```sh
npm run mobile:typecheck
EXPO_PUBLIC_API_URL=https://your-approved-reachable-backend.example npm run mobile:export:android
npm run mobile:build:storage
npm run mobile:build:preflight
cd apps/mobile
npx expo prebuild --platform android --no-install
EXPO_PUBLIC_API_URL=https://your-approved-reachable-backend.example npx expo run:android --device
```

The public URL must reach the configured multi-user backend from the device;
desktop localhost is not device localhost. An explicitly configured USB/ADB
development connection is another option. A reachable Metro server is needed for
the development build. The URL is public configuration, never a secret.

Only bundle export has passed here. No APK, physical wallet flow or push delivery
is accepted. The cloud APK attempt ran out of storage; no paid EAS service was
invoked. No escrow program is deployed; its backend bindings remain templates.
See [the current evidence and remaining gates](MARKETPLACE_ESCROW_CHECKPOINT.md).
