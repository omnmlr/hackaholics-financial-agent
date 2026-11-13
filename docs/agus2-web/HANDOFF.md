# AGUS 2.0 web integration handoff

Presentation readiness target: **November 14, 2026, 10:00 AM WAT**. This is not a confirmed submission cutoff. Finish and retain a testing/submission buffer before that target.

## Run the working application

```sh
npm ci --workspaces=false --cache /tmp/agus-npm-cache
npm run build
npm run preview:web
```

Open `http://localhost:3000`. The private operator password is generated in `.data/agus-web-preview/operator-password`; do not publish it. The preview uses durable, isolated embedded PostgreSQL at `.data/agus-web-preview/db`, one Node process, fixture bank execution, no seeded balances and no mainnet transactions.

For a genuine model connection using an environment-configured Gemini key:

```sh
AGUS_PREVIEW_AI=true AI_PROVIDER=gemini AI_MODEL=gemini-3.5-flash-lite NODE_USE_ENV_PROXY=1 npm run preview:web
```

Set `AGUS_PREVIEW_ORIGIN` to an exact forwarded HTTPS origin if accessing through a forwarding service. This controls CSRF checks and Secure cookies. Provider secrets belong in environment settings, never chat or Git.

## What is implemented

- Monochrome responsive overview, separate Naira statement balance and digital-asset USD valuation, collapsible summary and independent amount masking.
- Original AGUS companion, black-first typography and navigation, desktop sidebar and mobile navigation.
- Existing authenticated single-operator session entry, server logout/revocation and password reauthentication for conversational payment approval. This is **not** a new multi-user consumer login: people using the same operator login share its records.
- Persisted receivable/payable obligations linked to the existing responsibility service. Reminder approval/pause/resume stays separate from payment authority.
- CSV import through the inherited multi-account intelligence engine, durable import audit, account ownership, overlapping-file deduplication, statement anchoring, independent currencies and internal-transfer reconciliation. No live Nigerian bank connection is claimed; it remains Coming Soon.
- Receivable payment requests, ZIP 321/SEP-7 URIs, QR codes, pending/expired/cancelled/confirmed state handling, candidate-transaction verification and downloadable requests/receipts.
- Conversational standard/private payment proposals, exact trusted recipient review, user-saved contacts, linked payable obligations and explicit blocked states for unsupported currencies, privacy routes or networks.
- Pollar SDK transaction build/signing boundary: parse the actual provider-built Stellar envelope; match amount, asset, issuer, recipient, memo and selected source; cap network fee at 0.01 XLM; require expiry; bind password approval to the exact envelope; consume one authorization before wallet signing. Interrupted sends remain non-retryable until independently checked.
- Activity and obligation links back to outgoing reviews/receipts. Independently confirmed payments complete only the matching obligation/responsibility; changed obligations require separate review.
- Existing personal agent connected to imported financial records and saved obligations. Deterministic snapshot and local payment-intent parser are labelled separately from model inference.
- Privacy Mode closes the companion’s eyes **and** restricts backend model context/tools. It omits saved history/memory, account values and private wallet metadata; private addresses are entered in the owner view. Viewing/spending-key redaction is enforced before model serialization. What the user types into chat may still be visible to the model.
- Existing full conversation, legacy approval/payment workflows and Solana devnet workspace remain available at `/conversation` and `/devnet`.

## Genuine, mocked and blocked

| Capability | Evidence / status |
| --- | --- |
| Web application, SQL persistence and authenticated APIs | Genuine local production application. Browser acceptance exercises the API and database. |
| Multi-account intelligence | Integrated from `feature/multi-account-intelligence` at `2031112ecdaaf99781786eaedf1695c75bbac433`. The initial checkout `292d0b1` was its ancestor; integration used a verified fast-forward on a dedicated branch. Existing migration checksums were preserved. |
| Gemini financial guidance | **Genuine successful call** using `gemini-3.5-flash-lite`, including `read_agus_financial_snapshot`. Both API and browser evidence are retained. A separate `gemini-3.8-flash` attempt returned provider HTTP 503; no fallback transaction or fabricated response was produced. |
| Official Pollar SDK | `@pollar/core@0.12.0` installed and used. SDK initialization/config/balance calls are tested with controlled transport. Actual onboarding and signing remain **unverified**, pending this app’s testnet key, issuer and wallet access. |
| Stellar network | Genuine Horizon testnet root responded with the testnet passphrase and ledger metadata. Receipt validation uses the fixed testnet endpoint. This read is **not** proof of any settlement. |
| Pollar send authorization | Real server logic and actual Stellar XDR parsing, with controlled test envelopes/receipts. No genuine sponsor testnet transfer was made. Fee-bump/multi-operation envelopes deliberately require further integration review. |
| Zcash requests | Real ZIP 321 encoding, shielded Sapling testnet address encoding/checksum checks, base64url memo and wallet URI/QR. This does not prove receipt or enforce a shielded sending account. |
| Zcash receiving verification | Implemented read-only `zcashd` receiving-wallet RPC contract and verified with mocked transport. Requires synchronized testnet wallet viewing access, exact recipient/amount/memo and at least 3 confirmations. No genuine receiving-wallet connection was available. |
| Zcash shielded sending | **Blocked.** Needs the AG-ZCASH sender-wallet adapter, shielded funding, genuine fee quote, signing policy and verified outcome contract. AGUS does not claim to have sent a ZEC payment. |
| Private BTC payout / Pollar–Zcash bridge | Unsupported and explicitly blocked. No currency swap or bridge is fabricated. |
| Browser confirmed receipts | `*-mocked-*-confirmed.png` screenshots use mocked sponsor transport. They are UI/integration acceptance evidence, never proof of an on-chain transaction. |
| Live banking / mainnet | Unavailable / disabled. Imported balances are historical user-supplied records, not live available funds. Test assets are excluded from cash/portfolio valuation. |

## Verification

Run the following against the final source:

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:http
npm run test:browser:web
# Optional genuine inference; synthetic records only:
AI_MODEL=gemini-3.5-flash-lite NODE_USE_ENV_PROXY=1 node scripts/verify-web-ai.mjs
```

`acceptance/results.json` records browser acceptance at **1440, 820, 390 and 320 px**, no horizontal overflow and no browser JavaScript errors. It covers sessions/revocation, amount masking, summary collapse, invoice creation, statement import, snapshot guidance, request QR, failed verification, mocked confirmation, conversational payment reviews, Privacy Mode and unsupported private BTC.

`tests/web-product.test.ts`, `tests/pollar-sdk.test.ts` and `tests/conversational-payments.test.ts` cover owner spoofing, cross-owner isolation, URI encoding, monetary precision, mismatched currency/recipient/issuer/memo/fee/source, immutable envelope approval, password checks, one-use authorization, interrupted sends, rejected client-provided receipts, independent settlement and responsibility completion.

See `verification.txt` for the final captured command results. `genuine-ai.json` and `genuine-ai-browser.json` contain synthetic-only live-model evidence.

Final automated suite: **1,531 passed; 47 skipped** (92 passing test files, 4 skipped). The skipped suites require additional environment capabilities and do not establish provider/network acceptance. Ten axe checks of overview, accounts, assistant, payment review and settings at desktop/mobile widths report zero WCAG A/AA rule violations. This is an automated check, not a complete accessibility certification.

## Repeatable demo

1. Sign in. Show the empty overview, separate currencies and unavailable valuations.
2. Download/import `public/demo/sample-statement.csv` in Accounts. It is explicitly fictional. Show the historical ₦117,950.00 statement balance, provenance and Activity. Re-import into the same account to show deduplication.
3. Create a USDC receivable for a fictional international client. Show the linked responsibility and separately enable its in-app reminder.
4. Prepare the Pollar request after the testnet issuer is configured. Connect Pollar through email/Freighter when the publishable key is available. Show the exact recipient, asset, amount, memo and pending state.
5. Create a separate ZEC receivable and ZIP 321 request using a real wallet-generated Sapling testnet receiving address. Explain that shielded receipt needs authorized receiving-wallet evidence, not a public transaction ID.
6. In Assistant type **“Send Daniel 10 USDC.”** Complete the recipient address in the trusted review. Without credentials, show the accurate blocked state. With a working app key and funded wallet, get the actual provider-built quote, re-enter the operator password, explicitly authorize wallet signing, then check independent settlement.
7. Type **“Send Daniel 0.2 ZEC privately.”** Show Privacy Mode, closed eyes, minimized model context and the truthful missing sender-adapter state. A ZIP 321 handoff alone is not claimed as execution.
8. Type a private BTC request. Show the unsupported privacy explanation and no silent asset substitution.
9. Ask the live personal agent to read the saved financial snapshot and explain remaining obligations. Inspect Activity and the corresponding receipt where genuine settlement evidence is available.

Do not use the browser test’s synthetic recipients as real wallet addresses. Do not present mocked confirmation screenshots as sponsor network evidence.

## Deployment preparation

An isolated Railway service was created alongside the existing deployment; the existing app source/runtime was not changed:

- Project: `c8604a04-2913-4edf-b52a-cd333121ad1d` (`artistic-generosity`).
- Service: `3ddb9556-fdd0-4c67-91b0-89750e8b6958` (`agus2-web-preview`).
- Environment: `02d06217-6ac8-4de9-9f93-6bc5f48734b7`.
- Isolated 500 MB volume: `79f27fb4-a3ce-4a43-b90b-53578720a778`, mounted at `/data`.
- Reserved HTTPS hostname: `https://agus2-web-preview-production.up.railway.app`.
- One replica, Node 24, `npm run build`, `npm start -- --port 3000`, health check `/`.
- Intended persistent database: `pglite:///data/agus`, single-process preview only.

**This hostname is not a verified deployment.** Automatic approval review rejected both the live and staged writes containing the generated operator-password hash and security configuration. Staging was also rejected because it still transmits that sensitive payload to Railway. No runtime variables were written. Explicit owner approval for that payload and destination is required. The service needs that configuration and the final source attached before it can become a working HTTPS preview. No plaintext password or model/provider key is committed.

Deployment approval concerns only the dedicated preview service. No real-money functionality is authorized. A genuine hosted AI response additionally requires a valid server-side model credential configured through the hosting secret manager; the Cloud proxy’s credential is not assumed portable.

## Sponsor handoff integration boundaries

The founder will forward AG-POLLAR and AG-ZCASH handoffs. Their worktrees are not available in this Cloud workspace. Do not wait idly or assume unpushed work is complete.

Review the delivered SHA, ancestry, source, tests, configuration, network restrictions and private-data handling before integrating. Keep the existing adapter/domain split:

- `src/components/agus/pollar-wallet.tsx`: official browser SDK, user-held signing interaction, real application-network guard and balance availability.
- `src/lib/web-product/rails.ts`: request standards and independent receiving verifiers.
- `src/lib/web-product/conversational-payments.ts`: domain preparation, exact envelope review, one-time authorization and settlement.
- `src/lib/web-product/payment-contracts.ts`: provider-neutral persisted payment review/state contract.
- `src/lib/personal-agent/conversation.ts`: read/proposal tools only; no model spending authority.
- `src/lib/personal-agent/privacy.ts`: secret/viewing-key redaction.
- `src/lib/agent-workspace/store.ts`: preserved responsibility/memory service.
- `src/lib/financial-intelligence/**`: inherited multi-account engine; avoid a duplicate financial engine.

Minimum Pollar unblock: `NEXT_PUBLIC_POLLAR_API_KEY` for an actual **Stellar testnet** application, `POLLAR_TESTNET_USDC_ISSUER` matching its enabled token, authorized origin, working onboarding, funded test wallet and a recipient with the appropriate trustline. Verify the SDK’s returned envelope shape against the current strict parser.

Minimum Zcash receiving unblock: `ZCASH_WALLET_RPC_URL`, separate RPC user/password, a synchronized **testnet** receiving wallet with authorized viewing access to the specific Sapling receiver, and optionally `ZCASH_TESTNET_RECEIVING_ADDRESS`. Keys stay inside the wallet, never AGUS prompts/logs. Unified/Orchard address support and shielded source enforcement require the verified AG-ZCASH handoff rather than guessing an address or bridge.
