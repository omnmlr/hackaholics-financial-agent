# Chisom Android Integration Guide · API 1.1.0

**Canonical development branch:** `main` (with approved [PRD](PRD.md) and [v1 API contract](API_CONTRACT.md) from PR #51)  
**Normative references:** [API Contract v1](API_CONTRACT.md) · [Frontend Contract 1.1.0](FRONTEND_CONTRACT_1_1.md) · [OpenAPI 3.1.0](../../packages/contracts/openapi.json) · [Generated Client](../../packages/api-client/src/generated.ts)

This guide gives Chisom the exact setup, authentication, multimodal API 1.1.0 wiring, wallet-handoff lifecycle, fixture transport, and verification gates to build the Android UI without waiting on live provider credits or duplicating backend work.

---

## 1. Branching, Packages, and Ownership Boundaries

1. **Start from the canonical branch** with Node.js 24 and npm. Open frontend PRs against `main`.
   ```bash
   git clone --branch main https://github.com/omnmlr/hackaholics-financial-agent.git
   cd hackaholics-financial-agent
   git switch -c feat/agus-crypto-android-ui
   ```
2. **Do not modify** backend routes (`src/app/api/v1/crypto/**`), server modules (`src/server/crypto/**`), database migrations/SQL, or the engineering test harness files (`apps/mobile/CryptoDeviceHarness.tsx`, `apps/mobile/src/crypto-signer.ts`, `apps/mobile/src/session.ts`, `apps/mobile/src/crypto-voice.ts`, `apps/mobile/src/crypto-device-state.ts`, `apps/mobile/src/crypto-wallet-policy.ts`, `apps/mobile/plugins/with-wallet-package.cjs`).
3. **Keep the handset diagnostic entry point available.** `EXPO_PUBLIC_AGUS_CRYPTO_DEVICE_TEST=true` selects `CryptoDeviceHarness` in `apps/mobile/App.tsx`. The other branch currently loads `DeveloperHarness`. Wire product screens into that branch.
4. **Install dependencies and regenerate/verify contracts** before coding:
   ```bash
   npm ci --ignore-scripts
   npm run contracts:generate
   npm run mobile:typecheck
   ```
   Never edit `packages/contracts/openapi.json` or `packages/api-client/src/generated.ts` by hand; `npm run contracts:generate` overwrites them from `packages/contracts/src/crypto.ts` and `scripts/crypto-openapi.ts`.

---

## 2. Environment Targets (Fixture Mode vs. Stockholm Devnet)

| Variable | Fixture / Local Dev | Hosted Stockholm Devnet | Source / Constraint |
|---|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://fixture.invalid` for in-process fixtures, or `http://10.0.2.2:3000` for an Android emulator reaching a local backend | Use the HTTPS API origin confirmed by infrastructure. See [Devnet Deployment](DEVNET_DEPLOYMENT.md). | `apps/mobile/src/session.ts` requires HTTPS for release builds. |
| `EXPO_PUBLIC_MWA_ORIGIN` | `https://agus-wallet-devnet-identity.vercel.app` | `https://agus-wallet-devnet-identity.vercel.app` | Must match `apps/mobile/app.json:45` (`autoVerify: true`). |
| `EXPO_PUBLIC_AGUS_CRYPTO_DEVICE_TEST` | `false` | `false` | Set `true` only when running the `CryptoDeviceHarness` diagnostics. |

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local` and set the values for your target. With Android SDK, JDK 17 and an emulator or connected device, run `npm run android --workspace @agus/mobile` from the repository root to build the native development client. With that client installed, use `npm run start --workspace @agus/mobile -- --dev-client` for subsequent UI work.

- **Never** embed `AI_API_KEY`, `ELEVENLABS_API_KEY`, `FIRECRAWL_API_KEY`, `BETTER_AUTH_SECRET`, or `DATABASE_URL` in `apps/mobile/.env*` or `EXPO_PUBLIC_*` variables.
- **No guest mode**: Google and verified email/password identity with per-user authorization are mandatory (`AGENTS.md`, `CONTROL_PLANE.md`).

---

## 3. Fixture-First Development (`@agus/api-client` + `@agus/contracts`)

Import `createApiClient` from `@agus/api-client` (`packages/api-client/src/index.ts`) and schemas/helpers (`decimalToAtomic`, `CryptoPortfolio`, `CryptoAnswer`, etc.) from `@agus/contracts`.

For UI development without a live backend, pass `createCryptoFixtureTransport(scenario)` from `packages/api-client/fixtures/crypto.ts`:

```ts
import { createApiClient } from "@agus/api-client";
// Path below is relative to apps/mobile/*.tsx; use ../../../packages/api-client/fixtures/crypto inside apps/mobile/src/*.ts
import {
  createCryptoFixtureTransport,
  cryptoAssistantFixtureIds,
} from "../../packages/api-client/fixtures/crypto";

const api = createApiClient(
  "https://fixture.invalid",
  createCryptoFixtureTransport("multimodal_assistant"),
);
```

Available scenarios in `packages/api-client/fixtures/crypto.ts`:
- `owned_duplicate_watch` — two owned wallets (A has Phantom + Solflare routes; B has Solflare) + one read-only third-party watch (`100` + `25` USDC = `125` owned total).
- `internal_transfer` — `10,000,000` atoms moved A → B (`90` + `35` = `125`, `classification: "internal"`, single fee).
- `outside_inflow_replay` — external inflow raises owned total to `130` USDC with deduplicated alert evidence.
- `partial_and_stale` — stale balances (`provider_failure`), pruned activity (`pruned`), unpriced holdings.
- `decline_and_wrong_wallet` — wallet decline / route mismatch handling.
- `lost_callback_then_finalized` — `unknown` attempt recovery across restart until finalized receipt.
- `multimodal_assistant` — transcription, image observation, typed follow-up (`facts[0].atoms === "5000"`), Firecrawl citation (`https://solana.com/docs/core/fees`), MP3 chime, and `cryptoAssistantFixtureIds` (`conversationId`, `processingClientTurnId`, `interruptedClientTurnId`).

**Release hygiene:** Visibly label fixture mode in dev UI and exclude `packages/api-client/fixtures/crypto` from production/release bundles.

---

## 4. Session, Better Auth, and App-Switch Locking

`apps/mobile/src/session.ts` already implements the authenticated transport:
- **Origin & cookies**: Every request made through `api` (`session.ts:88-95`) or `cryptoVoiceTransport` (`session.ts:97-108`) injects `origin: "agus://"` and the Better Auth session cookie. The backend requires `origin === expected || origin === "agus://"` (`src/server/auth.ts:170`) and uses `expo({ disableOriginOverride: true })` (`src/server/auth.ts:131`).
- **Biometric local lock**: `lockSession()` sets `unlocked = false` on `AppState` `"background"` transitions (`CryptoDeviceHarness.tsx:214-228`). `unlockSession()` calls `LocalAuthentication.authenticateAsync(...)`. If a call runs while locked, `session.ts:72,74` throws `Error("LOCAL_SESSION_LOCKED")`. Always catch `LOCAL_SESSION_LOCKED` cleanly and prompt `"Unlock AGUS to recover the saved Devnet attempt."` rather than surfacing raw error strings or discarding saved attempt/composer state.
- **401 expiry**: `expireSession()` clears `agus_cookie` and `agus_session_data` on HTTP 401 and locks the session (`session.ts:81-86`). Redirect to sign-in while preserving draft inputs if safe.
- **Invite-only Devnet onboarding**: On Stockholm Devnet (`AGUS_AUTH_PUBLIC=false`), `POST /api/auth/sign-up/email` requires a valid row in `agus_invitations` (created by the founder via `npm run identity:invite -- <tester-email>`) and a minimum 12-character password (`src/server/auth.ts:38`).
- **Hosted authentication:** Ask infrastructure which sign-in methods are ready on the configured HTTPS origin. Google sign-in needs backend OAuth configuration and a verified `agus://` return on a signed handset. Public signup requires Resend, a verified sender and HTTPS. See the [public launch handoff](engineering/INFRA_PUBLIC_LAUNCH_HANDOFF.md).

---

## 5. Capabilities, Scope, Portfolio, and Activity

1. **Fetch capabilities on cluster selection**:
   `GET /api/v1/crypto/capabilities?cluster=devnet` returns `CryptoCapabilities`:
   - `features.portfolio`, `assistant`, `assistantImage`, `assistantResearch`, `assistantTranscription`, `assistantPlayback`, `monitoring`, `requests`, `invoices`, `swap`, `pocketCreate`, `pocketFund`, `pocketSpend`, `pocketManage`.
   - Treat absent or `false` flags as disabled. On current Stockholm Devnet, `swap` and all `pocket*` flags are `false`; `requests`/`invoices` are `false` unless explicitly enabled.
   - `approvedRoutes` lists approved `{ provider, operations }` (`phantom`, `solflare` -> `["transfer"]`).
2. **Pass wallet scope cleanly**:
   `CryptoScope` takes `cluster` (`"devnet" | "mainnet-beta"`) and optional `walletIds?: string[]` (1–12 UUIDs). Repeated `walletIds` query params (`?cluster=devnet&walletIds=id1&walletIds=id2`) are parsed by `src/app/api/v1/crypto/[[...path]]/route.ts:72-75` and handled by `openapi-fetch`'s default array serializer.
3. **Never convert money with JS floats**:
   Always format `CryptoAmount.atoms` (integer string) using `BigInt` / `decimal.js` and `amount.decimals` (9 for SOL, 6 for USDC). Render `source.mode`, `observedAt`, `slot`, and per-wallet `coverage[]` (`ready | partial | stale | unavailable` + `reason`) near balances and activity. Keep `group === "third_party_watch"` out of owned totals.

---

## 6. Unified API 1.1.0 Multimodal Conversation Flow

One `conversationId` per `CryptoScope` (`cluster` + `walletIds`). When scope changes, start a new conversation.

### A. Voice Recording & Transcription
- Use `useCryptoVoice(cryptoVoiceTransport)` from `apps/mobile/src/crypto-voice.ts` (`startRecording`, `stopAndTranscribe`, `playReply`, `stop`, `setMuted`, `state`, `muted`, `durationMs`, `isRecording`).
- `POST /api/v1/crypto/assistant/transcriptions`:
  - Content-Type: `audio/aac` (ADTS AAC-LC, 8–48 kHz, 1–2 ch — hook records 16 kHz mono `.aac` with `aac_adts` capped at 29 s) or `audio/wav` (PCM16).
  - Hard backend limits (`src/server/crypto/voice-audio.ts`): **2 MiB**, **30 seconds**.
  - **Mandatory UX rule**: Populate the editable composer with `CryptoTranscription.text` so the user can review/edit before sending `POST /assistant/turns` with `inputMode: "voice"`. Disclose ElevenLabs processing and warn users never to dictate seed phrases, passwords, or private keys.

### B. Text, Image, and Research Turns
- `POST /api/v1/crypto/assistant/turns`:
  - Required header: `Idempotency-Key` matching `^[a-zA-Z0-9_.:-]{8,128}$` (`src/server/idempotency.ts:8`). Generate a fresh UUID `clientTurnId` and pass the same UUID as `Idempotency-Key`. Reuse both ONLY when retrying an identical failed/timed-out request.
  - **JSON turn**: `body` = `CryptoAsk` (`clientTurnId`, optional `conversationId`, `text` 1–1000 chars, optional `inputMode: "text" | "voice"`, `scope`, `reportingTimeZone` IANA string such as `"Africa/Lagos"`).
  - **Multipart image turn**: `FormData` with `"turn"` (JSON-serialized `CryptoAsk`) and `"image"` (`PNG`, `JPEG`, or `WebP`, **<= 5 MiB**, single-frame, <= 16 MP). Omit manual `Content-Type` header so `fetch` sets the multipart boundary.
  - **Privacy & screening**: Warn users before capture/upload that Gemini analyzes the image and to exclude seed phrases/keys. Backend runs local Tesseract OCR + QR decoding + secret detection (`src/server/crypto/assistant-image.ts`) before Gemini and rejects `SENSITIVE_CONTENT` (`422`).
- **Rendering `CryptoAnswer`**:
  - Display `answer.text`, `facts[]`, `evidence[]` (clickable links to portfolio snapshot, activity event, or receipt), `coverage[]`, `image` observation (explicitly labeled as visual observation, never chain finality), `citations[]` (render `title`, HTTPS `url`, `publishedAt` if present, and `retrievedAt`), and `suggestion`.
  - A `kind: "draft_suggestion"` populates the reviewed transfer form only—it **never** skips review or auto-executes.
- **Recovery**: If interrupted or timed out, poll `GET /api/v1/crypto/assistant/turns/{clientTurnId}` (`processing | interrupted | completed`) or restore via `GET /api/v1/crypto/assistant/conversations/{id}`.

### C. Spoken Playback
- `POST /api/v1/crypto/assistant/conversations/{id}/turns/{turnId}/audio` (empty body, returns `audio/mpeg` stream).
- `useCryptoVoice.playReply(conversationId, turnId)` downloads via `cryptoVoiceTransport` (`expo/fetch`) to private cache (capped at 2 MiB) and plays with `expo-audio`, cancelling automatically on `stop()`, `setMuted(true)`, starting recording, or app backgrounding.
- Always keep written `answer.text` visible when audio fails (`VOICE_LIMIT`, `VOICE_UNAVAILABLE`, `FEATURE_DISABLED`) or is muted.

---

## 7. Wallet Linking, Transfer Review, Handoff, and Recovery

Use `createCryptoSigner` (`apps/mobile/src/crypto-signer.ts`) and `canRecover` / `parseSavedAttempt` (`apps/mobile/src/crypto-device-state.ts`). Never bypass these steps:

1. **Link & prove ownership**: `signer.authorize(provider, "devnet")` -> `POST /wallets/challenge` (`Idempotency-Key`) -> `signer.signProof(...)` -> persist `PendingProof` in `SecureStore` -> `POST /wallets/association` (`Idempotency-Key`).
2. **Check eligibility & prepare immutable review**: `POST /eligibility` -> user chooses source wallet/route -> `POST /reviews` (`Idempotency-Key`). Render exact recipient, amount/atoms, `Devnet` network, `estimatedFeeLamports`, `estimatedRentLamports`, and `expiresAt`.
3. **Begin & one-time handoff**:
   - `POST /reviews/{id}/begin` with `{ revision, reviewDigest }` + `Idempotency-Key` -> persist `attempt.id` in `SecureStore`.
   - `POST /attempts/{id}/handoff` (`Idempotency-Key`) -> proceed to wallet **only if `claim.launchGranted === true`**.
   - `signer.handoff(claim, route, review)` -> persist `{ id, outcome }` in `SecureStore` **before** network submission (`wallet-outcome`) because Android locks the session during wallet switch.
   - After unlock/resume: `POST /attempts/{id}/wallet-outcome` (`Idempotency-Key`), then poll `GET /attempts/{id}` or `POST /attempts/{id}/reconcile` while `canRecover(attempt.state)` (`ready | handoff | pending | unknown`).
   - Fetch `GET /receipts/{attempt.receiptId}` **only** when `attempt.state === "finalized"`.
4. **Device constraints**: Remind testers to disable Android Battery Saver for Solflare (`WALLET_POWER_RESTRICTION`), and never open a new `POST /reviews` while an active attempt is `ready | handoff | pending | unknown`.

---

## 8. Key Error Codes & UI Recovery

| HTTP | Code(s) | Required Mobile UX |
|---|---|---|
| `400` | `INVALID_INPUT`, `INVALID_AMOUNT`, `INVALID_CURSOR`, `IDEMPOTENCY_KEY_REQUIRED` | Keep user edits, highlight field or reset cursor, never generate new `Idempotency-Key` for same retry. |
| `401` | `SESSION_REQUIRED` | Prompt sign-in / biometric unlock; preserve unsent composer state and pending local attempt ID. |
| `403` | `ORIGIN_REJECTED`, `WATCH_ONLY`, `OWNERSHIP_PROOF_REQUIRED`, `APPROVAL_REQUIRED` | Ensure `origin: "agus://"` on transport; prompt wallet ownership proof or explicit approval. |
| `409` | `REVISION_CHANGED`, `IDEMPOTENCY_CONFLICT`, `ATTEMPT_IN_PROGRESS`, `ROUTE_CHANGED` | Re-fetch active attempt/review; never retry conflicting payload with old key. |
| `410` | `REVIEW_EXPIRED`, `CHALLENGE_EXPIRED`, `QUOTE_EXPIRED` | Prompt fresh challenge or fresh review after checking existing attempt status. |
| `413` / `415` / `422` | `BODY_TOO_LARGE`, `AUDIO_TOO_LONG`, `AUDIO_FORMAT_UNSUPPORTED`, `AUDIO_INVALID`, `INVALID_IMAGE`, `TRANSCRIPT_EMPTY`, `TRANSCRIPT_TOO_LONG`, `SENSITIVE_CONTENT` | Keep text composer usable; ask user to re-record/choose valid image or remove secrets (never log rejected text/image). |
| `429` | `AI_LIMIT`, `VOICE_LIMIT`, `IMAGE_LIMIT`, `RATE_LIMITED` | Show calm rate-limit notice; keep deterministic portfolio, activity, manual transfers, and attempt recovery functional. |
| `503` | `FEATURE_DISABLED`, `VOICE_UNAVAILABLE`, `IMAGE_SCREENING_UNAVAILABLE`, `PROVIDER_UNAVAILABLE`, `CHAIN_IDENTITY_MISMATCH` | Keep written/cached views usable; on transfer paths show **Check status** rather than claiming failure. |

---

## 9. Chisom Verification Checklist Before Handoff

1. `npm run contracts:generate` produces zero diff on `packages/contracts/openapi.json` and `packages/api-client/src/generated.ts`.
2. `npm run mobile:typecheck` exits `0`.
3. `npm run mobile:export:android` exits `0`.
4. Fixture and mobile tests pass:
   ```bash
   npx vitest run tests/crypto-contract.test.ts apps/mobile/tests/crypto-mobile.test.ts apps/mobile/tests/crypto-mobile-standalone.test.ts
   ```
5. Release APK passes `ANDROID_DEVICE_TEST.md` (verified `app.agus.prototype`, DAL `/.well-known/assetlinks.json`, and 3 finalized 0.001 Devnet SOL transfers: Phantom → Solflare → Phantom → Solflare).
