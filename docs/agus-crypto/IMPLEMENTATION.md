# AGUS Crypto backend implementation

The [PRD and API contract](https://github.com/omnmlr/hackaholics-financial-agent/pull/51) govern the implementation from baseline `a26880a`. Founder decisions supersede the release and authentication assumptions there. Backend PRs target `integration/agus-crypto-hackathon-20261129`. Chisom owns frontend screens, design, branding and the marketing site.

| Order | Workstream | Release evidence |
| --- | --- | --- |
| 1 | Shared runtime schemas, generated API client and small fixture set | Contract generation, drift check and frontend typecheck |
| 2 | Verified wallet registry, exact SOL and SPL balances, finalized activity | Public RPC genesis and read evidence, dedupe and coverage tests |
| 3 | Scoped financial tools, Gemini intent routing, Google and verified email authentication | Tool and API tests, live model ID and provider evidence, email and OAuth configuration |
| 4 | Review, handoff, settlement and recovery with Phantom and Solflare | Test and Devnet evidence, signed APK and physical Android acceptance |
| 5 | Durable finalized inflow alerts | Worker restart and replay tests, one live Devnet alert |
| 6 | Founder-authorized Mainnet demonstration | Separate genesis and mint configuration, independently verified settlement, fresh limited-fund demo wallets |
| 7 | Swig Pocket, requests, receipts, QR, invoices and swaps where separately verified | Relevant PRD evidence gates |

Core actions remain usable during AI throttling or provider failure. Gemini credentials stay server-side and answers use deterministic amounts. Mainnet transaction execution requires device and security validation and explicit founder authorization. Standing permissions and Pocket funding require explicit founder authorization. The 80-point target requires the PRD handset and signing evidence.

## Evidence

- The published integration branch resolves to the pinned baseline. PR #51 remains separate.
- Public Devnet RPC returned genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.

## Frontend integration

Run `npm run contracts:generate` and import `createApiClient` from `@agus/api-client`. The generated HTTP namespace is `/api/v1/crypto`. Wallet scope uses repeated `walletIds` query parameters. With openapi-fetch, use the default form-array serializer. All credentials are handled by the existing authenticated transport.

For local development and tests, pass `createCryptoFixtureTransport(scenario)` from `packages/api-client/fixtures/crypto.ts` as the second argument. Available fixtures exercise the duplicate-route portfolio, internal transfer, outside inflow, stale coverage and transfer lifecycle states. They are in-memory transports with deterministic timestamps and no explorer links. Keep this import out of release builds. The generated contract includes disabled operations so feature-labeled screens can compile as backend work progresses.

## Backend checkpoint · November 23

| Workstream | Result | Acceptance still open |
| --- | --- | --- |
| Contracts | Generated HTTP client and runtime Zod validation. Six versioned fixture scenarios include duplicate routes, internal transfer, inflow replay, stale coverage, decline and lost callback. | Chisom's physical device journey and screen integration. |
| Registry and reads | Better Auth sessions scope ownership proof and wallet resources. Finalized owner and observed classic SPL token account feeds share stable transaction and instruction IDs. Exact balances survive partial RPC failure through per-feed caches. | Complete historical token account discovery, verified price sources, and full benchmark samples. Activity states coverage gaps explicitly. |
| Financial chat | Gemini routes bounded questions to deterministic portfolio, activity, flows and transfer eligibility. Server-side usage limits and one job per user turn. Basic balance reads can finish from deterministic tools if Gemini times out. | More live question coverage and evidence navigation on Android. |
| Identity | Better Auth Google OAuth and verified email registration, sign-in and recovery are wired. Email verification and password reset passed end to end with disposable mail transport. | Deploy Google OAuth client credentials and register the callback URL. Configure Resend with a verified sender and test real delivery and callback from Android. |
| Execution | Devnet SOL and allowlisted classic SPL review bytes, fee and ATA rent checks, exact digest approval, one-time handoff, attempt polling and finalized receipt verification. Pending and unknown attempts are reconciled by the worker. | Live SPL execution, signed handset return and recovery, and both wallet routes. |
| Monitoring | Durable opt-in external inflow rule, worker, scoped inbox, mark read and replay-safe deduplication tested in Postgres. | Verify delivery in the signed Android demo. |
| Pocket and supporting tools | Outgoing receipts and gated Devnet payment requests, PNG share QR, basic invoices and request receipt verification are implemented. | Verify a newly paid request and its receipt on Devnet before enabling request flags. Swaps and Pocket remain unavailable pending separate acceptance. |

### Frontend and deployment settings

- The authenticated client uses the same Better Auth session transport as the existing app. Google OAuth uses `POST /api/auth/sign-in/social` with provider `google`. Register `https://<api-origin>/api/auth/callback/google` and return to the verified app link or configured native callback. Email screens use Better Auth sign-up, sign-in, send-verification-email, verify-email, request-password-reset and reset-password APIs.
- Set `AGUS_AUTH_PUBLIC=true` on the HTTPS Crypto deployment when `RESEND_API_KEY` and `AGUS_AUTH_EMAIL_FROM` are ready. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together. Legacy invitation deployments continue to use the configured invitation path when public registration is off.
- Configure PostgreSQL and use `npm run db:migrate` with the migration role. Apply the existing runtime-role grants, then run `npm run platform:worker` with a separate persistent process. Set `AGUS_CRYPTO_MONITORING=true` in the API and worker to accept and evaluate rules. The worker checks on a 30-second cadence.
- Set `AI_PROVIDER=gemini` with the existing server-side `AI_API_KEY`. The configured adapter resolves `AI_MODEL` or falls back to the verified `gemini-3.5-flash-lite`. Default budgets are 30 turns per user and 500 globally per UTC day, with one in-flight job per user. Set either allowance to zero for a cutoff.
- Android calls `createCryptoSigner` from `apps/mobile/src/crypto-signer.ts`. Pair the backend ownership challenge with `signProof` and register the proof with the API. For a transfer, render the immutable review, begin after explicit approval, then request the one-time handoff grant. Submit the returned outcome and poll the same attempt. The adapter stores provider grants and launch markers in SecureStore. The Android config plugin scopes each MWA intent to the selected Phantom or Solflare package.
- Use a private Devnet test deployment with disposable wallets for signer acceptance. Set `AGUS_SOLANA_DEVNET_ENABLED=true` and opt the test vendor into `AGUS_CRYPTO_DEVNET_ROUTES` on that deployment. Leave release routes gated until they pass the PRD handset checks. Reassociate wallets through the new session-bound proof before exercising transfer review. Use a separately operated `AGUS_DEVNET_VERIFY_RPC` to corroborate unresolved expiry. Without adequate history, keep the attempt unresolved.
- On the signed physical build, recheck the intended package, published origin, app-link fingerprint and wallet version. Retry Solflare with Android Battery Saver disabled after checking existing attempts. For Phantom, capture vendor diagnostics for the identity warning and force-close. Use the same signed handset for the three public Devnet transfers required by A05.

### Network evidence

- Verified public Devnet portfolio and finalized activity through the authenticated Crypto API and compared the balance with a separate direct RPC call. The public Devnet test address held 10 SOL at observation. The following signature was already on chain when the test began. [Devnet activity](https://explorer.solana.com/tx/HToPkwpMHJF9cyQmNAWV2RzzCu2MN5qq8CYQrAaD8AVqS5wEZqCT6ZQqj8DKjk3cnu37koXZ9Xheav2TxHieAtY?cluster=devnet)
- Circle test USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` was finalized at Devnet slot 525446289. Circle USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` was finalized at Mainnet slot 472960100. Both mint accounts reported six decimals and classic SPL Token ownership. Mainnet genesis is `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d`. [Circle mint registry](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- The existing Gemini credential returned HTTP 200 and reported `gemini-3.5-flash-lite` in a live GenerateContent response. The application smoke test exercised a grounded SOL balance and verified that reaching the per-user quota leaves the portfolio endpoint usable.
- The public RPC faucet returned HTTP 410 with instructions to use the web faucet. The founder funded the existing disposable signer through the web faucet. The funded SOL transfer and alert evidence appear below.

### Mainnet demonstration gate

Mainnet uses its own pinned RPC and mint registry in `src/server/crypto/rpc.ts`. Mainnet capability advertises watch-only and portfolio access. A separately approved demo should cap each transfer at 0.01 SOL or 1 USDC, each network fee at 0.00005 SOL and any recipient token-account rent at 0.003 SOL. These are proposed demo limits to implement and verify before enabling Mainnet execution. Require a verified signed handset, fresh minimally funded demo wallets, founder authorization for each send and a separate independently operated verifier. Retain the complete review, exact transaction digest and finalized on-chain signature for acceptance.

### Verification commands

- `npm run contracts:generate`, `npm run typecheck`, `npm run mobile:typecheck`
- `AGUS_TEST_DATABASE_URL=<disposable-postgres> npm run test:platform`
- `AGUS_TEST_DATABASE_URL=<disposable-postgres> npx vitest run tests/crypto-backend.test.ts tests/crypto-contract.test.ts`
- Add `AGUS_CRYPTO_LIVE_READS=true` to run the read-only public Devnet and Gemini checks. Use a server environment with the existing Gemini credential.
- `npm run mobile:export:android` validates the JS bundle. The physical-device gate additionally requires a signed APK and a real handset session. The local signed-build preflight found no Android SDK configured.

The 80/100 acceptance target remains conditional on the complete handset journey and two verified wallet routes. The integration branch is open for frontend work. No merges were performed.

### Disposable transfer acceptance

The opt-in software-signer test requires a disposable Postgres environment, `AGUS_CRYPTO_DEVNET_SIGNER_FILE` pointing to an owner-only Devnet keypair outside the repository, `AGUS_CRYPTO_DEVNET_EXPECTED_SENDER`, `AGUS_DEVNET_VERIFY_RPC` on a separate hostname, and an unused absolute `AGUS_CRYPTO_DEVNET_EVIDENCE_FILE` path. Run `npx vitest run tests/crypto-backend.test.ts -t 'explicitly enabled disposable Devnet transfer'` only for a separately authorized transfer. The test journals the expected signature and reference before one submission. If the result is uncertain, reconcile those identifiers with read-only calls using the retained journal and database.

For request and invoice acceptance, enable `AGUS_CRYPTO_REQUESTS` and optionally `AGUS_CRYPTO_INVOICES` on private Devnet. QR content is a network-labeled share URL. The public resource omits invoice metadata. The worker verifies finalized exact Solana Pay evidence before publishing a receipt and routes ambiguous candidates to review.

### Recorded test results

| Check | Result |
| --- | --- |
| Repository suite with disposable Postgres and live providers off | 1,698 passed, three opt-in cases skipped |
| Crypto contract and backend suites with public read verification on | 14 passed during the initial read-only run. The funded transfer ran separately and passed below. |
| PostgreSQL platform suite | 39 passed |
| Production HTTP smoke | Passed session enforcement, owner isolation and the existing platform restart checks |
| Contract regeneration, root and mobile TypeScript, ESLint | Passed |
| Android JavaScript export | Passed. The SDK and physical handset are required for signed APK acceptance. |

The live Crypto test decoded finalized public activity and simulated the exact unsigned Devnet transfer message against RPC. The Gemini SDK separately returned the expected structured portfolio route using the existing server credential. The finalized settlement test verifies the sender signature, message digest, finalized status and actual balance deltas, and withholds the receipt for mismatched evidence. The initial settlement and alert replay tests used controlled blockchain responses in disposable Postgres.


### Finalized Devnet transfer and alert · November 23

The opt-in software-signer test submitted one **0.001 SOL** transfer. Devnet finalized it at slot **525464932** at 14:45:38 UTC. Solana's public Devnet RPC and `devnet.rpcpool.com` agreed on the signature, finalized status, reviewed message digest, balance deltas and 5,000-lamport fee. Each endpoint returned exactly one transaction for the payment reference and the recipient. [Solana Explorer](https://explorer.solana.com/tx/2ztFGAyjsrKmPLG84fY1jXYbZuEsaRBnVFVT9DmF4QJuBAd1GbHXaqWszd469fJSL98mBgQ78MsuJxFZo8bLidds?cluster=devnet)

| Evidence | Verified value |
| --- | --- |
| Sender | `FBaYNnwfxbVFFuetTZGs4GDy8ccEqR3ggXDs78swm7qy` |
| Recipient | `AAQKVK6jegecXLDr2ssP1jcNFF5meVQdhbVPMFpz9YzZ` |
| Sender balance | 5 SOL → 4.998995 SOL |
| Recipient balance | 0 SOL → 0.001 SOL |
| Reviewed message SHA-256 | `5666b3c3387c1bdc44036c28d59ce51fb098dad7b4d5fc7ca85cb07bccd87530` |
| Attempt and receipt | `090b6457-dc52-4e9b-b8af-cf123809dbc7` and `f295cfc3-5ffc-4026-8d95-7d06da8e236c` |
| Alert and rule | `c46a6ce3-3f12-40c9-95b9-ae7fd64307ef` and `9bee048d-720e-43bc-8a6d-7efad1444002` |
| Alert timestamps | Created at 14:45:43.418 UTC and marked read at 14:45:43.461 UTC |

The attempt entered `unknown` before submission to reproduce a lost wallet callback. Reconciliation found the transfer through its saved Devnet reference and finalized the same attempt. Replayed approvals and three concurrent handoff requests produced one approval and one launch grant. A late callback and later reconciliation returned the same receipt. A new worker process replayed monitoring against the same disposable Postgres database and returned exactly one alert with its read timestamp intact. The test used the existing software signer. Phantom and Solflare signing still require a signed physical-device run.

The failing foundation smoke test had opened `/`, which serves the newer workspace in fixture mode. It now opens `/conversation`, where the legacy records-account control and conversation drawer are rendered. The workspace, follow-up and runner browser smokes passed locally with the fixed navigation. Chisom can wire the generated attempt and inbox APIs on Devnet, restore the same attempt on app resume, and use the verified receipt and alert to check the UI states.

### Android acceptance continuation

The engineering test build now has a gated entry point that exercises the generated Crypto client, exact MWA review and durable attempt flow. It records the wallet outcome locally across Android backgrounding, submits it after the session is restored and shows the server receipt. Fixed diagnostics identify the last MWA phase without saving a wallet payload or grant in logs. The Android bridge opens the selected wallet on the main thread and allows 45 seconds for initial association. The immutable review is rechecked before the wallet submission request.

For Chisom, continue using `createApiClient` with Better Auth. Wallets, portfolio, activity, assistant, eligibility, reviews, attempts, receipts and alerts use the `/api/v1/crypto` namespace and the repository-generated types. The only contract addition is an optional fixed `reason` on an `unknown` wallet outcome. Keep the server handoff claim and local attempt ID across app return. Only the server receipt establishes finalization. The handset harness provides a reference for these calls and leaves the product screens to the frontend. [Android build and handset procedure](ANDROID_DEVICE_TEST.md)

The Foundation verification runs its deterministic suite and production browser suite in separate jobs. The browser job reports the Android export, production build and browser smokes as individually bounded steps. Each verification step retains local-only networking and disposable Postgres. The earlier run was canceled during cache upload after its checks passed, and the isolated retry was canceled during the fixture suite. The logs did not identify the source of those cancellations. The current local fixture suite passed 1,706 tests, with four opt-in cases skipped. The production HTTP checks, the three workspace smoke modes and all six browser viewports also passed locally.

The next hosted run passed both HTTP checks and all three agent smoke modes before logging a Playwright timeout waiting for a spending reply after account selection. The workspace test now waits for the restored chat and selected account and verifies the exact conversation request and response before checking the visible reply. All six updated viewports passed with the CI-pinned Chromium build.

The Android adapter, Crypto API and contract suites passed 23 tests, with the funded signer test skipped. The read-only checks matched the two public Devnet wallets’ aggregated SOL balance to finalized RPC and indexed their shared transfer once. The scoped Gemini answer used deterministic balance evidence. A new concurrency test reproduced HTTP 503 responses and a PostgreSQL deadlock when registering watch wallets in parallel. The fix allows those registrations to complete while still serializing enforcement of the wallet limit.

### Isolated Devnet release preparation

The production server and Crypto worker now have separate launch commands in the Railway image. Startup verifies migrated PostgreSQL, least-privilege runtime credentials, invite-only authentication settings and two independent Devnet RPC providers. A local production HTTP run verified readiness, the handoff contract, invite-only sign-up, the Android app origin, two watched wallets totaling 4,999,995,000 finalized lamports, one shared Devnet activity and a Gemini balance answer matching independent RPC. The worker completed a monitoring and reconciliation cycle. A privileged database connection was rejected. No transaction was submitted during this verification.

Railway rejected a new project and a service in the separate empty project under its Free plan resource limit. The hosted API, worker and database remain pending available capacity. The replacement Android release uses a stable Vercel alias and a certificate pin from the verified backup setup. The old association remains published until the replacement signer is available. [Deployment procedure](DEVNET_DEPLOYMENT.md) · [Signing and handset procedure](ANDROID_DEVICE_TEST.md)
