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

For local development and tests, pass `createCryptoFixtureTransport(scenario)` from `packages/api-client/fixtures/crypto.ts` as the second argument. Available fixtures exercise the duplicate-route portfolio, internal transfer, outside inflow and stale coverage. They are in-memory transports with deterministic timestamps and no explorer links. Keep this import out of release builds. The generated contract includes disabled operations so feature-labeled screens can compile as backend work progresses.
