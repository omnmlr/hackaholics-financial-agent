# AGUS finals release candidate — 20 October 2026

**CONDITIONAL GO for isolated fictional-data integration. Keep the consolidated PR draft. Railway release is blocked pending the external checks below.** This is the native Gemini architecture from #38, including #37 and #36; no architecture comparison or rewrite was performed.

Branch: `release/agus-finals-rc-20261020`, proposed against `main`. Starting head: `c28f4d2d38c1f97906f77af4c65468cae1d47e2b` (#38). Its ancestry includes exact #37 head `9d10d49f2df6c2c32faf51db3582e79a5e6187dc` and #36 head `dac1f769bff31a3c5ef5820e222e9545025163cd`. This branch contains the complete integration; merging the three stacked PRs separately is unnecessary. Existing branches and PRs were left intact.

## Repairs added to the preferred implementation

- Valid ISO calendar dates no longer disappear in the shared privacy filter. Invalid dates, account numbers and credential-assigned dates remain withheld. Native tests and the production browser cover explicit dates through account-picker resumption and Lagos midnight conversion.
- A fresh transaction search replaces obsolete selection constraints. An ambiguous search cannot be silently narrowed by another model search in the same turn; a later user turn can resolve it.
- Local model timeouts retain verified fictional records through the same current-consent, revision and post-persistence checks as other factual fallbacks. Revoked consent suppresses the response.
- Payment handoff sources strip credential-like text and URLs before persistence and again before legacy-source extraction, retaining beneficiary digits deliberately supplied for the editable draft. An authenticated payment-draft POST regression covers the disclosure boundary.
- Model dialogue restoration reads eight recent SQL rows instead of materializing the entire saved transcript. Ownership, chronological order and full display-history API behavior are preserved. This bounds data returned to the application; no general measured latency improvement is claimed.
- Added a persistent local fixture preview and credential-free release CI. Preview environment is explicitly isolated from inherited deployment databases/keys, and external fetches and redirects are blocked.

No changes relative to #38 to authentication, database configuration/schema, payment execution, OTP, approval snapshots, idempotency, reconciliation, dependency versions, main startup command or Next configuration. Existing voice/UI are retained. Exact arithmetic remains server-owned; semantic model interpretation remains fallible.

## Verification and evidence

Use [verification.json](verification.json), the adjacent command logs and browser JSON/screenshots for actual local results. The consolidated PR links the final credential-free GitHub Actions run and its downloadable evidence. Prior #38 quality CI [39466798924](https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/39466798924) independently passed on `6dbabf6e7a1fdfc746c32cc2b6f19a57341a2780`; it is historical evidence, not this release branch's new CI.

Unit/integration coverage includes provider transport/signatures, exact calculations, ISO date privacy/Lagos intervals, ownership, consent/revision races, ambiguity, SQL CAS/restart persistence, saved chats and payment safeguards. Production HTTP smoke exercises login/protection, editable recipients, verification, password approval, separate fixture submission, duplicate rejection, reconciliation and saved status. Chromium journeys exercise desktop/mobile conversation, account choice, source-backed financial cards, correction after reload, provider failure, editable persistent drafts and voice lifecycle.

Browser model responses, speech recognition and playback are scripted. Web Audio lifecycle tests use a synthetic PCM microphone. They do not establish genuine provider reliability, physical microphone accuracy or audible device playback. No real account or money is used.

### Genuine Gemini spending remains closed

Reviewed actual provider evidence in [genuine-repair.json](../native-hardening/genuine-repair.json), [genuine-initial.json](../native-hardening/genuine-initial.json) and the previous reports/workflows. The native campaign spent **40/40 attempts** (25 initial + 15 repair), including reviews, continuations and retries. The repair had four HTTP 504s; the earlier separate architecture campaign stopped on 429. Neither campaign was reopened. **This task made zero genuine provider calls.** No new bounded allocation was granted and no provider credential is configured in this workspace. The release workflow contains no provider secret and does not trigger prior provider campaigns.

Before further genuine testing, obtain a new explicit attempt allocation, count every generation/review/continuation/retry, pace requests, stop immediately on 401/403/429, and preserve the ledger. Do not rerun closed provider workflows, switch credentials/projects, or add paid resources.

## Persistent isolated preview / UI-agent entry point

On Node 24, from the repository root:

```sh
npm ci
npm run build
npm run preview:fixture
```

Open `http://127.0.0.1:3000` on the machine running the preview. The generated sign-in password is in ignored, mode-0600 `.data/finals-fixture-preview/operator-password`; read it privately in that machine's terminal. It is never printed into evidence. Records persist under `.data/finals-fixture-preview/db` across restarts. Stop with Ctrl-C. `FIXTURE_PREVIEW_PORT` selects another local port. This is a workspace-local preview, not a public hosted service or Railway deployment. Do not replace an existing service's startup with this preview command.

The preview deliberately uses the existing scripted native transport; these sample prompts work:

1. `Tell me a short joke about robots`
2. `What is (47 plus 13) times 9?` → reload → `Use 18 instead of 9 and keep the rest`
3. `If my budget is ₦150,000 and rent is ₦80,000 and food is ₦25,000, what remains?`
4. `Show my spending from 2026-10-01 to 2026-11-01` → choose fictional Amina current account.
5. `Prepare 500 to Ada at Wema account 0000000001 for Lunch and 600 to Chidi at Access account 0000000002 for Books` → click Prepare payment draft → edit → reload.

Unscripted prompts may return unavailable. This is UI integration evidence, not a replacement reasoning engine. For real inference use the normal application entrypoint and existing private Gemini configuration only after a separate provider allocation.

UI changes should preserve the existing contracts in `src/lib/financial-agent/protocol.ts`, `src/lib/financial-integration/conversation.ts`, `src/lib/conversation-payment.ts` and `src/app/api/`. `POST /api/conversation` takes `{conversationId,text,accountIds}`; principal/provider/architecture are server-owned. `GET /api/conversations` lists chats and `?id=<uuid>` returns saved turns. `POST /api/conversation/payment-draft` takes `{conversationId,turnId}` only. Preserve reply `kind`, source cards/citations, account action, error/recovery states and explicit draft handoff. Editing a draft must continue to invalidate verification/approval. Never wire a chat response, account selection or voice callback to approval/execution. Preserve microphone stop/cancel/review/send and opt-in spoken replies.

UI acceptance commands: `npm run test:browser`, `npm run test:browser:native`, `npm run test:http`. These launch their own disposable fixture servers and need a completed production build. Set `CHROMIUM_PATH` to installed Chromium if necessary. Finish builds before running browser suites; do not replace `.next` while a journey is using it.

## Railway investigation, integration and exact rollback procedure

No Railway CLI/management connector, configured service credential, active-service manifest or tracked Railway/Nixpacks/Procfile configuration is available. The GitHub connector rejected the deployments endpoint as unsupported. All remote branch names/history and existing deployment handoffs were inspected. `deploy/agus-render-fixture-20261020` at `5f481dad73c737b58c7db819ec7692ecf90aeaa6` contains `scripts/render-preview-start.mjs`; its name and contents establish a Render fixture bootstrap only. There is no evidence that Railway executes it. Branch names likewise do not prove the deployed Railway SHA. No live-service request/configuration mutation or production database operation was performed.

This release branch is compatible source preparation: normal `npm ci`, `npm run build`, existing `npm start`/`PORT`, native selector, existing DB/auth configuration. It adds no platform bootstrap. Compatibility with the unknown service-specific tree remains conditional. Before a separately authorized release, the operator must:

1. Record the actual Railway project/environment/service IDs, connected branch and deployed SHA, auto-deploy state, build/start commands and startup-file checksum, Node version, healthcheck path, replicas, volume mount, database endpoint identity (no password), and variable **names**. Securely retain the existing values; do not paste secrets in the report. Record the previous `AGUS_AGENT_ARCHITECTURE` value or its absence. Obtain/verify the existing backup and restore process without resetting data.
2. In an isolated worktree based on that recorded deployed SHA, integrate this reviewed candidate. Retain service-specific startup files and configuration verbatim; review any conflicts explicitly. Compare the actual startup file/checksum and database/auth settings against the recorded deployment. Do not substitute the Render or local-preview bootstrap. No claim is made that an unknown Railway deployment has already been reconciled.
3. Preserve `DATABASE_URL`, TLS parameters, volume, operator identity/password hash, sessions, `APP_ORIGIN`, provider credentials, port, webhook and reconciliation settings. Keep fixture mode and all live execution flags disabled. Embedded PGlite requires one process and a durable volume; do not change a managed PostgreSQL service to embedded storage. Existing lazy table initialization remains part of the inherited app; do not run test/reset/seed commands against the service database.
4. Use an isolated disposable database for release checks. Enable native chat with server-only `AGUS_AGENT_ARCHITECTURE=native-gemini`; preserve the existing Gemini provider/key/model. Verify final genuine date/correction acceptance under a new bounded allocation before authorizing rollout. This task authorizes no deployment or merge.
5. **Agent rollback:** restore the recorded architecture setting, or choose `baseline` to use the preserved #36 implementation, then use the service's existing restart mechanism. No schema rollback or payment replay is required. Confirm sign-in, saved chats and read-only saved payment status.
6. **Code rollback:** select the exact previously recorded known-good deployed SHA/deployment through the existing Railway release process. Restore its exact build/start command and startup file if altered, keep the same database/volume/auth/session/provider settings, and restart using the existing process. Preserve records and uncertain transfer references for reconciliation. Do not restore a stale database snapshot or resubmit payments as a routine code rollback. If data restoration is ever necessary, stop and use the separately authorized database recovery process.

## Remaining gates and verdict

| Gate                                               | State / required action                                                                                                                                                                         |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consolidated fixture application                   | Review local evidence and final secret-free CI; suitable for isolated UI work.                                                                                                                  |
| Genuine repaired date read and narrated correction | Open: previous attempts hit 504. Requires a new bounded allocation; local scripted evidence is not provider acceptance.                                                                         |
| Active Railway runtime/startup/storage             | Open: needs the service manifest and deployed SHA above, then source reconciliation.                                                                                                            |
| Physical-device voice                              | Open for voice-quality claims: microphone recognition and audible playback on target devices.                                                                                                   |
| Multi-turn payment recipient details               | Current handoff extracts the current turn. Earlier-turn account digits are intentionally absent from model dialogue; complete/review the durable editable card manually if details are missing. |
| Product limits                                     | Shared operator login, fictional financial records and fixture-only payment claims remain explicit.                                                                                             |

**CONDITIONAL GO for isolated fixture integration; NO-GO for live Railway release until genuine provider and service-configuration gates close.** No merge, production deployment, database reset, credential change, real-bank access or real-money transfer was performed.
