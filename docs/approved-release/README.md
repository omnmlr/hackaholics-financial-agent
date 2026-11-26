# AGUS approved visual release candidate

This is the single integrated application from PR #41, on `ui/agus-premium-experience-20261020`, updated to the final approved screenshot supplied on October 21, 2026. It retains PR #40 and consolidated PR #39. **No merge or deployment is authorized or performed.** The commit selected for approval is the PR head SHA; verify it with `git rev-parse HEAD` and the PR's passing integrated CI checks before release.

## What changed

The welcome screen uses the original `agus.` artwork, “Let's talk money.”, “Ask agus anything...”, and the three original actions below the compact composer. The added emblem, slogans and descriptive welcome cards are removed. Black surfaces, locally hosted typography, faint decorative data lines/bars/dots, round blue Send and microphone controls, subtle borders and depth follow the approved reference. Decorative graphics are explicitly hidden from assistive technology and carry no financial meaning.

The original wordmark opens saved conversations. On desktop, additional header controls appear on hover or keyboard focus; touch layouts retain visible session controls. The three suggestion pills wrap at narrow widths without changing their wording. Conversation results, calculation evidence, transaction rows, dialogs and editable payment cards share the black/blue surfaces and preserve their existing information and safeguards. Motion remains limited to actual pending work and short response entrances, with reduced-motion support.

Backend source, native Gemini function calling, financial arithmetic, fictional account scoping, authentication, stored conversations, voice capture/playback, payment safety and all PR #41 Stop/cancellation/recovery logic are unchanged. Database schema, dependencies, Next configuration and the Railway startup file are unchanged.

## Visual review

Actual production-browser screenshots were inspected against the user-supplied reference, including its exact 1672×941 size, desktop 1440px, tablet 820px, mobile 390px and small mobile 320px. Automated pass results were not used as evidence of visual fidelity. The review corrected the initially undersized heading, excessive background contrast, composer height, wordmark placement and a roughly 20px downward offset of the composer/actions. The final desktop reading order is wordmark → heading → composer → suggestion pills. Mobile retains that composition, allowing the pills to wrap and keeping the composer readable at 320px.

The supplied reference is visible in the request; its Windows download path is not a file in this workspace. The captures below are rendered application output, not generated mockups or pasted backgrounds. Desktop/mobile checks are a human visual comparison, not a pixel-difference score or a claim that a separate mobile reference was provided.

| View                      | Welcome                                           | Financial result                         | Editable payment                            |
| ------------------------- | ------------------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| Exact reference, 1672×941 | [Welcome](screenshots/1672-reference-welcome.png) | —                                        | —                                           |
| Desktop, 1440×810         | [Welcome](screenshots/1440-welcome-16x9.png)      | —                                        | —                                           |
| Desktop, 1440×1000        | [Welcome](screenshots/1440-welcome.png)           | [Result](screenshots/1440-financial.png) | [Draft](screenshots/1440-payment-draft.png) |
| Tablet, 820×1000          | [Welcome](screenshots/820-welcome.png)            | [Result](screenshots/820-financial.png)  | [Draft](screenshots/820-payment-draft.png)  |
| Mobile, 390×844           | [Welcome](screenshots/390-welcome.png)            | [Result](screenshots/390-financial.png)  | [Draft](screenshots/390-payment-draft.png)  |
| Small mobile, 320×844     | [Welcome](screenshots/320-welcome.png)            | [Result](screenshots/320-financial.png)  | [Draft](screenshots/320-payment-draft.png)  |

Additional captures show account selection, transactions, expanded drafts, short viewports, generation, Stop, network recovery, long conversations and navigation. [Browser results](screenshots/browser-results.json) contain layout, accessibility and request-safety results. [Verification](verification.json) and `validation/` record the local checks. The integrated GitHub Actions workflow checks the exact PR commit on Node 22.16.0 and Node 24, including the complete production application and browser suites; its artifacts include freshly generated screenshots and reports.

## Reproduce without credentials

Use Node 22.16.0 or Node 24 and installed Chromium (`CHROMIUM_PATH` if needed):

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:http
npm run test:browser
npm run test:browser:native
npm run test:browser:premium
```

Finish the production build before browser tests; do not replace `.next` while they run. Each suite starts its own isolated server and disposable database. All financial data and payments are fictional; model/speech transport is scripted and microphone lifecycle checks use synthetic PCM. No service credential is required. These checks exercise frontend and backend together, including the native function-calling adapter, rather than preparing separately deployed components.

For manual review, run `npm run preview:fixture` after building. It prints the **path** of a private local sign-in password file, never the password. It retains an isolated local PGlite database and blocks external fetches. This command is for local review only; preserve Railway's existing startup command below.

## Deploy to the existing Railway service — only after explicit approval

1. In the existing project/environment/service, record the current successful deployment ID and exact SHA, connected branch, auto-deploy state, Node version, build/start commands, healthcheck, database identity, and the current architecture setting (including absence). Confirm a current PostgreSQL backup/snapshot and its restore procedure. Privately preserve the current service variables. Do not expose values in logs, PRs or screenshots. PR #40 identifies the prior working source as `5f481dad73c737b58c7db819ec7692ecf90aeaa6`; use the service's actual current known-good deployment for rollback, not that historical SHA by assumption.
2. Select the **approved exact PR #41 head SHA** as one deployment of the existing service. Build with `npm ci` then `npm run build`, using Node 22.16.0 (validated) or the validated Node 24 runtime. Keep **`node scripts/render-preview-start.mjs`** as the start command. The preserved script starts the integrated Next application, initializes its existing schema and enforces fictional payment mode. There is no separate backend/frontend release and no new service/database to create.
3. Set **server-only `AGUS_AGENT_ARCHITECTURE=native-gemini`**. Preserve the existing legitimate Gemini configuration: `AI_PROVIDER=gemini`, the existing `AI_API_KEY` and existing `AI_MODEL`. Do not substitute the scripted test model/key or introduce `NEXT_PUBLIC_` credentials. Keep the existing `DATABASE_URL` and TLS configuration, `AGUS_OPERATOR_PASSWORD`, `OPERATOR_ID`, `APP_ORIGIN` (the assigned Railway HTTPS origin) and platform `PORT`. Keep `PAYMENT_MODE=fixture`, `FINANCIAL_DEMO_ENABLED=true`, `PAYSTACK_TRANSFERS_ENABLED=false` and `LIVE_TRANSFERS_ENABLED=false`; the unchanged startup script also clears the Paystack secret and all live execution gates. No reset, seed, schema replacement or database import is required. Do not point any test suite at the service database.
4. After approval and rollout, confirm the existing healthcheck and `/`, sign-in/out, existing saved conversations, fictional account selection, calculation/financial reads, an editable payment draft, Stop/cancellation and voice. Confirm the running deployment SHA and native architecture setting, and verify that the same PostgreSQL data is retained. Review actual Gemini responses, including Lagos date boundaries and narrated corrections, before calling provider acceptance complete. These requests stay fictional and do not approve or submit real payments.

Startup SHA-256, identical to PR #40: `74f29e366a0e9ac461a9beeee6d64a8ba55c18302f6800e34b5c44aadebf8cbf`.

## Database preservation and rollback

This candidate changes no backend or schema files. Keep the same managed PostgreSQL service, connection/TLS settings, operator identity and application origin. Existing chats, sessions and payment references remain in their current database. The inherited bootstrap runs the existing idempotent initialization; it does not drop or reseed existing records. Missing financial tables are created if necessary; the inherited transactional fictional seed runs only if its `fm_seed` marker is absent. A backup is a recovery safeguard, not part of normal rollout.

If release acceptance fails, select the recorded last successful Railway deployment/SHA and restore its recorded start/build commands and architecture setting. Keep the same database and service variables. For an architecture-only fallback, restore the recorded selector (or `baseline`, the preserved implementation) using the existing restart procedure. Confirm sign-in, saved chats and saved payment state. No schema downgrade, stale snapshot restore, payment replay or resubmission belongs in an ordinary code rollback. Keep uncertain payment references for the existing reconciliation process.

## Verification limits

The workspace has no configured Gemini credential or Railway management connection. The current service's build availability, configuration, deployment SHA, database backup and a genuine-provider response were not independently inspected or changed. PR #40 establishes the startup contract; source checks establish that it is preserved. The previous genuine-provider date/correction acceptance remains a release check, not a result established by scripted transport. Physical iOS/Android keyboards and real-device speech recognition/playback also remain manual checks. None of these limits changes the implemented visual candidate or authorizes a merge or deployment.
