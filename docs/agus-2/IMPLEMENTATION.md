# AGUS 2.0 implementation checkpoint — 9 November 2026

Recovered source: `6fbbcf66fb5233e4b554f91cbde1508ad72a369d`. Old checkout and every fetched advanced/research branch remain preserved. GitHub has no reachable `fe8f58a`, `b04cb5c`, `130c8db` or `a358532` in the inspected refs/object database; no missing implementation was assumed present. This branch extends the recovered native agent rather than replacing it.

## Run locally

Use the existing operator password setup and a separate development database. Never copy production secrets or customer records. Install with `npm ci --ignore-scripts`, then configure:

```dotenv
DATABASE_URL=pglite://.data/agus2-development
PAYMENT_MODE=fixture
FINANCIAL_DEMO_ENABLED=true
AGUS_AGENT_ARCHITECTURE=native-gemini
AGUS_WORKSPACE_ENABLED=true
AGUS_SOLANA_DEVNET_ENABLED=true
APP_ORIGIN=http://localhost:3000
```

Configure `OPERATOR_ID`/`OPERATOR_PASSWORD_HASH` through existing instructions. A legitimate configured development Gemini provider/model/key is required for actual conversation. No new model requests were made: a generic key binding does not establish provider identity, free entitlement or permission to incur charges. Existing subscriptions are not assumed to provide an API.

Build/start using existing npm commands, sign in at `/`, then open `/responsibilities` or `/devnet`. No production deployment was performed. In the managed environment, use supported subprocess permissions for tests and `NODE_USE_ENV_PROXY=1` for Node RPC access through the inherited proxy; do not bypass the proxy or disable TLS.

## Working contracts

- `GET/POST /api/agent-workspace`: owner-scoped tasks, memory, in-app notifications and event history. Mutations require existing session/origin protections and strict bounded JSON. Human approval activates reminders; pause/resume/cancel use expected versions. Optional task `requestId` makes repeated creation idempotent and rejects changed instructions under the same ID.
- Memory proposals remain unconfirmed until human confirmation. Forget deletes the stored fact; memory is never permission, bank truth or independently verified agreement. It is not a credential vault.
- `npm run responsibilities:run -- --watch` runs local due reminders; omit `--watch` for one pass. Due-time state persists across process restart. Notifications and advancement are one SQL transaction with unique occurrence IDs. No calls, bank reads, external sends or financial effects occur. An unattended service is **not provisioned**; the runner must actually be running for automatic updates.
- Native tools can read the workspace, propose memory/reminders, read devnet balances, prepare unsigned transfers and reconcile owned drafts. They cannot approve, activate, sign or submit transfers. Existing financial authority, calculations, consented fixture reads and payment controls remain intact.

## Solana devnet

Fixed public endpoint `https://api.devnet.solana.com`, verified full devnet genesis, no custom/mainnet RPC. Actual SOL and classic SPL account/mint discovery; integer atomic units and decimal strings. Token-2022 and extension-bearing assets are intentionally unsupported. Discovery is bounded at128token accounts/32mints; oversized wallets fail explicitly rather than imply complete coverage. No token label or USD value is inferred.

`POST /api/agent-workspace/solana` actions: `discover`, `prepare`, `approve`, `submit`, `reconcile`, `cancel`. GET lists owned drafts. Preparation returns exact sender, recipient, asset/mint, amount, quoted fee/rent, blockhash expiry and unsigned legacy transaction. Approval binds a digest and requires existing operator password reauthentication. User wallet signs; server never receives seed phrases/private keys. Signed bytes must have the exact approved message and valid sender signature. A durable CAS claim and signature are saved before the single RPC send; uncertain outcomes are reconciled, never automatically resent. Cancellation cannot reverse a broadcast. Confirmation checks the returned transaction/message/signature and on-chain execution status; RPC acknowledgement is not success.

`/devnet` connects injected Phantom/Solflare, separates review, password approval and wallet signing, invalidates stale account/signature actions, and exposes reconciliation. No arbitrary wallet signing request, auto-connect, signAndSend or effect-driven send. Physical wallet signing and a funded SOL/SPL transfer still need user-owned test funds and manual acceptance; none was claimed or performed here.

USD receiving accounts, production USDC, FX and NGN off-ramping remain separate authorized provider requirements. Devnet tokens are not production dollars. At least20existing Nigerian personal SOURCE banks, consented history/balances, real beneficiary payments and no AGUS transfer markup remain launch requirements, not implemented connectivity. Prior multibank research remains on its existing remote branches; no speculative adapter or repeated banking investigation was added.

## Verification and limits

Existing unit suite plus added responsibility/native/Solana tests, actual process-restart tests, typecheck/lint/build and local HTTP/browser smoke are run for this checkpoint; exact outcomes are reported alongside the pushed commit. Scripted model and RPC fixtures verify safety, not provider semantics. Genuine public devnet RPC reads are recorded separately from wallet connection or transfers. Budget spent:₦0; no purchases, paid API calls, merges, production changes, external communications or live financial operations.

The first genuine RPC probe caught a truncated genesis constant; the guard rejected it. The constant was corrected from the actual public response and an independent full-hash regression added. This is why mocked tests are not sufficient proof of integration.

Dependency hardening: production token parsing/building is a strictly bounded classic-SPL codec using native bigint and web3 cryptography. Byte layouts, PDA addresses, instruction keys/data and full transaction messages are compared against the official SPL SDK in development-only oracle tests. The SDK's vulnerable native bigint dependency is not in production traces. The JSON-RPC client is pinned to jayson5.0.0; actual devnet compatibility was verified. Production advisory lookup reports0advisories; development-only oracle dependencies still have upstream advisories and must not be promoted to runtime or used on untrusted arbitrary inputs. No automatic audit-force downgrade or cryptography replacement was used.

Memory forgetting removes the memory record, not separately retained chat transcripts. Queries return bounded collections; no promise of unlimited memory, scheduler uptime, bank connectivity or completed external actions is made.

Final acceptance of implementation commit `8b3535915db53ab3b31f54dbfa035da58d213112`: **1,338 tests in61files pass**,107.27s; typecheck, lint, production build, existing fixture payment HTTP safety and new actual production HTTP/Chromium workspace smoke pass. [Closed validation](evidence/implementation-validation.json) separates these results from [genuine public devnet reads](evidence/devnet-read.json). The implementation commit was pushed and its remote SHA verified before the final suite.

## Integrated conversation checkpoint

The chat renders saved personal-action references instead of appending raw tool JSON. Multiple native personal tools can run in one turn; completed proposals and review cards survive a later model error. Model prose cannot turn an unconfirmed note into confirmed memory or activate a reminder. Historical cards fetch authenticated current records on demand; the sidebar workspace opens responsibilities/memory and a lazily loaded devnet wallet inside the conversation. Versioned human controls remain server-enforced.

Every newly prepared devnet transfer must pass simulation of its **exact unsigned bytes and blockhash** before storage/approval. The simulation timestamp, slot and units are part of the review digest and displayed in the wallet. A simulation is not execution evidence. Historical unsimulated drafts remain readable and previously submitted records remain reconcilable, but cannot receive new approval or submission authority. No funds, token minting, wallet signatures or genuine new model calls were performed in this checkpoint.

Validation: 1,344 tests in 62 files pass (124.56s); targeted agent follow-up 44/44, typecheck, lint and production build pass. Actual local production HTTP/Chromium acceptance covers in-chat human approval, pause/resume/cancel, confirmed memory, reopening persisted state, mobile overflow, dialog Escape and lazy wallet loading. Scripted tool/RPC tests establish controlled behavior, not real model or funded-chain acceptance. [Dev3pack decisions](competition/DEV3PACK.md) record the open-source submission constraint and bounded official resource findings. Security-sensitive changes still require independent review before merge/release; no merge or release was performed.
