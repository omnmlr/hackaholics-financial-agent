# AGUS Counterpart implementation

The approved black Counterpart direction is implemented in the integrated application. The five destinations use real authenticated APIs and persisted records. No concept balances, accounts or wallets are automatically seeded.

Implementation branch: `implementation/agus-counterpart-20261114`, based on integrated commit `f8cdcb3b1f93cb467ddb4b49e6f8bbd3509ad259`. Foundation checkpoint: `9ab19ab` (Pollar publishable-key contract and safe model-readiness diagnostics). Implemented product checkpoint: `5162067`. See the branch's latest commit for the accompanying acceptance evidence.

**Railway has not been deployed or modified. Credentials were not changed.** Read-only inspection confirmed deployment `e7a9a01b-b71e-45d6-93fa-1a9248e0ce47` remains successful on the integration branch, with no staged service changes.

## Product behavior

- Black, layered surfaces; local General Sans and Plex Mono; original repository AGUS wordmark; approved Counterpart companion silhouette. The official tagline is retained.
- Desktop rail and bottom-centered companion. Mobile navigation places AGUS in the center. Motion includes idle breathing, thinking, analysis, privacy eyes, page and sheet entry, pending and completion feedback. Reduced-motion settings disable animation and smooth scrolling.
- Home uses imported-statement balances with dates/confidence, actual obligations and saved payment reviews. No fictitious combined wallet conversion is presented.
- Onboarding is brief, interactive and skippable. Completion persists through the existing backend; Settings → Explore AGUS reopens it. No wallet connection is required to explore.
- Add account opens explicit choices: Pollar crypto wallet, historical CSV statement, disabled Nigerian bank linking, and Zcash receiving options. CSV imports are labeled as imported records rather than live bank connections.
- Money exposes Pollar connection, SDK-reported activation status, on-demand balances and supported USDC testnet payments. Unknown balances remain unknown. Zcash exposes receiving-request creation; unsupported ZEC sending is disabled. No ZEC wallet import is offered.
- AGUS uses the existing native Gemini endpoint and tools. Saved conversations are loaded from the existing owner-scoped SQL backend, selectable from History and restored after reload. Browser storage holds only an active conversation ID and privacy preference. Financial Activity remains a distinct destination.
- Existing authentication, server-side owner approval, exact envelope verification, one-use signing authority, independent settlement checks and responsibilities are preserved. Zcash request creation does not imply shielded sending support.

## Run the actual app locally

```sh
npm ci
npm run build
AGUS_PREVIEW_PORT=3140 npm run preview:web
```

Open <http://localhost:3140>. The private operator password is in `.data/agus-web-preview/operator-password`; it is ignored by Git. This preview uses its own persistent embedded database, forces fixture bank-payment mode and disables live bank transfers. It initially seeds nothing.

For genuine Gemini conversation, provide an authorized **server-side** credential through the environment and run:

```sh
AGUS_PREVIEW_PORT=3140 AGUS_PREVIEW_AI=true AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite npm run preview:web
```

In the managed Cloud environment, the verified command also used `NODE_USE_ENV_PROXY=1`. A Cloud proxy credential must not be copied into Railway or assumed to work outside that environment.

### Evidence classification

The screenshots are browser renders of the actual production build, not the earlier static prototype. The persistent local preview contains an explicitly synthetic 9 USDC invoice and a manually imported fictional CSV account. These are isolated acceptance records, never production defaults. Payment acceptance uses ephemeral test databases and explicitly mocked provider/Horizon/Zcash responses. No genuine funds moved.

| Actual screen                                           | Desktop                                          | Mobile 390                                     | Mobile 320                                     |
| ------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------- |
| Home                                                    | [1440](1440-home.png)                            | [390](390-home.png)                            | [320](320-home.png)                            |
| AGUS, genuine saved responses                           | [1440](1440-agus.png)                            | [390](390-agus.png)                            | [320](320-agus.png)                            |
| Money                                                   | [1440](1440-money.png)                           | [390](390-money.png)                           | [320](320-money.png)                           |
| Add account                                             | [1440](1440-add-account.png)                     | [390](390-add-account.png)                     | [320](320-add-account.png)                     |
| Obligations                                             | [1440](1440-obligations.png)                     | [390](390-obligations.png)                     | [320](320-obligations.png)                     |
| Activity                                                | [1440](1440-activity.png)                        | [390](390-activity.png)                        | [320](320-activity.png)                        |
| Payment review, mocked SDK transport                    | [1440](pollar/1440-mocked-pollar-review.png)     | [390](pollar/390-mocked-pollar-review.png)     | [320](pollar/320-mocked-pollar-review.png)     |
| Authorized, separate signing step, mocked SDK transport | [1440](pollar/1440-mocked-pollar-authorized.png) | [390](pollar/390-mocked-pollar-authorized.png) | [320](pollar/320-mocked-pollar-authorized.png) |

The Money acceptance [connected-wallet capture](pollar/1440-mocked-pollar-money.png) uses the actual SDK with mocked activation and balance responses. The persistent preview correctly shows wallet connection unavailable while its real sponsor credentials are absent. Onboarding is captured [here](regression/1440-onboarding.png).

| Evidence                                                         | Result and limit                                                                                                                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [genuine-gemini.json](genuine-gemini.json)                       | Real Gemini HTTP 200, Nigerian Pidgin reply, successful native `read_agus_financial_snapshot` tool invocation. No payment requested or authorized.                                                      |
| [genuine-context.json](genuine-context.json)                     | Real follow-up in the saved conversation resolved “that invoice” as 9 USDC. No extra tool call or payment.                                                                                              |
| [preview.json](preview.json)                                     | Home, AGUS, Money, Obligations and Activity at 1440, 390 and 320 pixels; saved-history restoration, overflow checks and browser errors.                                                                 |
| [regression/accessibility.json](regression/accessibility.json)   | Automated WCAG A/AA browser audits of the real UI, including onboarding, Money, AGUS and payment review. This is not a substitute for assistive-technology testing.                                     |
| [regression/results.json](regression/results.json)               | Actual browser → authenticated API → SQL acceptance. Mocked network evidence only for sponsor settlement.                                                                                               |
| [pollar/pollar-sdk-browser.json](pollar/pollar-sdk-browser.json) | Official SDK 0.12, dashboard-format publishable key, exact review/password approval, one signing call, rejected nonce replay and independent receiving evidence. Provider and Horizon transport mocked. |

## Verification

[verification.json](verification.json) consolidates the final results, genuine-versus-mocked classification, unclipped source-address checks and browser credential-exposure scan. The main browser suite passed 11 automated WCAG A/AA audits; the SDK approval flow also passed audits at 1440, 390 and 320 pixels.

```sh
npm run lint
npm run typecheck
npm run build
AI_API_KEY= AI_PROVIDER=none npm test
AGUS_WEB_EVIDENCE_DIR=docs/counterpart-implementation/regression npm run test:browser:web
AGUS_WEB_EVIDENCE_DIR=docs/counterpart-implementation/pollar npm run test:browser:pollar
npm run test:http
node scripts/counterpart-preview-capture.mjs
```

The complete unit suite passed **1,550 tests**, with 47 skipped. The HTTP suite covers authentication, route protection, verification, explicit approval/submission, duplicate rejection, reconciliation, persistent conversation and CSV import. Browser acceptance exercises first-use onboarding skip/replay, all account-chooser routes, historical imports, wallet discovery, obligations, exact payment review, unsupported private sends, receiving evidence and settings at desktop and narrow mobile widths. Final JSON reports above are the executable evidence for the browser runs.

Capture options `COUNTERPART_IMPORT_SAMPLE=true`, `COUNTERPART_GENUINE_AI=true` and `COUNTERPART_VERIFY_CONTEXT=true` are explicit opt-ins for the isolated preview only. Genuine requests are never automatically retried on quota or provider failure. Normal capture does not call the model or create financial records.

## Actual unresolved blockers

**Hosted Gemini:** The old deployed “Chat is unavailable” message is emitted when product capabilities report AI unconfigured. Read-only Railway inspection shows the `AI_PROVIDER`, `AI_API_KEY` and architecture variable names; their sensitive values are redacted. `AI_MODEL` is absent. Runtime diagnostics and actual secret values cannot be inspected through the available connector, so the exact hosted misconfiguration cannot be determined here. Local native Gemini works with the configuration above. The new safe readiness diagnostics distinguish missing credentials from a native-Gemini/provider mismatch; they do not expose a key. A valid key still requires a genuine request to establish availability/quota.

**Pollar:** The SDK configuration contract is `apiKey: string`; dashboard `pub_testnet_…` publishable keys are accepted, with existing `pk_…` compatibility. Network and spending authority still require actual remote testnet app verification and independent XDR checks. Railway currently lacks `NEXT_PUBLIC_POLLAR_API_KEY` and `POLLAR_TESTNET_USDC_ISSUER`. A genuine funded-wallet payment has not been verified. SDK acceptance here uses mocked transport and proves no live settlement.

**Zcash:** Railway currently lacks receiving-wallet RPC configuration. ZIP 321 Sapling testnet requests are available, but actual receiving verification needs an authorized, synchronized testnet wallet with viewing access to the receiver. Integrated ZEC sending has no operational sender adapter and remains blocked. Experimental execution elsewhere in the repository is not represented as supported integrated sending.

**Bank linking:** Nigerian personal-bank linking and live NGN settlement remain unavailable. Imported statements are historical data. No redesign control claims otherwise.

Physical devices, software keyboards, real sponsor credentials, real testnet signing/funding and production login were not independently verified in this workspace.

## Safe Railway deployment — only after explicit founder approval

No deployment commands have been executed. The following is a runbook, not authorization.

1. Review the implementation branch diff against `integration/agus2-web-hackathon-20261113`. Record the approved immutable commit. Keep unrelated services unchanged.
2. Snapshot/export the existing persistent database using the current operational procedure. Preserve `/data`, `DATABASE_URL`, `OPERATOR_ID`, password hash and `APP_ORIGIN`. This redesign needs no schema migration; existing application initialization remains unchanged. Keep a single replica when using PGlite.
3. Target project `artistic-generosity` (`c8604a04-2913-4edf-b52a-cd333121ad1d`), production environment `02d06217-6ac8-4de9-9f93-6bc5f48734b7`, service **agus2-web-preview** (`3ddb9556-fdd0-4c67-91b0-89750e8b6958`). Do not target the older AGUS service.
4. Confirm `AGUS_WORKSPACE_ENABLED=true`, `AGUS_AGENT_ARCHITECTURE=native-gemini`, `AI_PROVIDER=gemini`, and explicitly set `AI_MODEL=gemini-3.5-flash-lite`. Validate an authorized server Gemini key in Railway's secret UI. Never place it in a public variable, PR, screenshot or model message.
5. If sponsor connectivity is approved, configure only a dashboard-issued **testnet publishable** Pollar key and the exact Stellar USDC issuer enabled for that application. Verify allowed origin and remote testnet application settings. Configure Zcash RPC credentials privately only for an authorized receiving testnet wallet; optionally set `ZCASH_TESTNET_RECEIVING_ADDRESS`. Never supply viewing/spending keys to the browser or model. Leave unsupported sending blocked.
6. Preserve all existing live-transfer safeguards and disabled live flags. Leave `FINANCIAL_DEMO_ENABLED=false`. Do not copy `.data`, preview credentials or synthetic acceptance records. Bank provider credentials do not need to change.
7. Only after approval, select the reviewed implementation commit/branch as this service's source and trigger its build. Current runtime is Node 24, build `npm run build`, start `npm start -- --port 3000`, one replica with the existing `/data` volume. Rebuild after any public build-time environment change. Keep the existing domain and `APP_ORIGIN` aligned.
8. Validate sign-in, first-use onboarding/reload/replay, genuine Gemini tool use and context, chat restore, historical statement provenance, wallet discovery and unsupported-send blocking at 1440/390/320. A genuine sponsor transfer requires its own exact, explicit owner approval. Provider success alone must not settle an obligation.
9. If checks fail, roll back to the prior recorded deployment/source commit while preserving the volume and credentials. Do not reset data or enable live transfers as a workaround.

Previous live deployment: `e7a9a01b-b71e-45d6-93fa-1a9248e0ce47`, integrated source `f8cdcb3b1f93cb467ddb4b49e6f8bbd3509ad259`. Existing domain: <https://agus2-web-preview-production.up.railway.app> (it still serves the previous build until an approved deployment).
