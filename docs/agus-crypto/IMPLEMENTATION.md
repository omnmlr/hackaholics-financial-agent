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
| Execution | Devnet SOL and allowlisted classic SPL review bytes, fee and ATA rent checks, exact digest approval, one-time handoff, attempt polling and finalized receipt verification. Pending and unknown attempts are reconciled by the worker. | Real Devnet SOL and SPL execution, independent provider setup, signed handset return/recovery, and both wallet routes. |
| Monitoring | Durable opt-in external inflow rule, worker, scoped inbox, mark read and replay-safe deduplication tested in Postgres. | A newly finalized public inflow observed by the worker without a chat or activity request. |
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
- The public RPC faucet returned HTTP 410 with instructions to use the web faucet. A funded disposable Devnet signer is needed for a new public transfer or fresh alert run. Local handoff and settlement test receipts use fixture evidence. No Mainnet funds or permissions were used.

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

Set `AGUS_CRYPTO_DEVNET_SIGNER_FILE` only for the explicit live test, and point it to a fresh funded Devnet-only keypair outside the repository. The test prepares and approves one 0.001 Devnet SOL transfer to a new recipient and sends exactly once. It exercises lost-callback recovery, a finalized receipt and the recipient's opt-in inbox rule. Run `npx vitest run tests/crypto-backend.test.ts -t 'explicitly enabled disposable Devnet transfer'` with the disposable Postgres environment. This phase produces software-signer evidence. Signed Android and wallet-vendor acceptance still require the physical handset.

For request and invoice acceptance, enable `AGUS_CRYPTO_REQUESTS` and optionally `AGUS_CRYPTO_INVOICES` on private Devnet. QR content is a network-labeled share URL. The public resource omits invoice metadata. The worker verifies finalized exact Solana Pay evidence before publishing a receipt and routes ambiguous candidates to review.

### Recorded test results

| Check | Result |
| --- | --- |
| Repository suite with disposable Postgres and live providers off | 1,698 passed, three opt-in cases skipped |
| Crypto contract and backend suites with public read verification on | 14 passed. The funded transfer case was skipped because the disposable wallet held zero lamports. |
| PostgreSQL platform suite | 39 passed |
| Production HTTP smoke | Passed session enforcement, owner isolation and the existing platform restart checks |
| Contract regeneration, root and mobile TypeScript, ESLint | Passed |
| Android JavaScript export | Passed. The SDK and physical handset are required for signed APK acceptance. |

The live Crypto test decoded finalized public activity and simulated the exact unsigned Devnet transfer message against RPC. The Gemini SDK separately returned the expected structured portfolio route using the existing server credential. The finalized settlement test verifies the sender signature, message digest, finalized status and actual balance deltas, and withholds the receipt for mismatched evidence. Settlement and alert replay tests used controlled blockchain responses in disposable Postgres.
