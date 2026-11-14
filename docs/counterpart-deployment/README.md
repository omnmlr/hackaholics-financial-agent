# Counterpart founder acceptance preview

Live HTTPS application: https://agus-counterpart-acceptance-production.up.railway.app

Deployed source commit: `76a6349772326387cb2de9e90652f8c8a02adf58` on `implementation/agus-counterpart-20261114`. The service is pinned to this commit; subsequent evidence/documentation commits do not change the deployed application. No visual redesign was made for this deployment.

## Secure sign-in

Open the authenticated [Railway service dashboard](https://railway.com/project/c8604a04-2913-4edf-b52a-cd333121ad1d/service/011ff58d-77ec-40f9-ae9f-67eca3e6972e?environmentId=02d06217-6ac8-4de9-9f93-6bc5f48734b7), select **Variables**, and reveal `COUNTERPART_PREVIEW_LOGIN_PASSWORD`. Paste it into the preview's **Operator password** field. No username is required. Do not share the password through chat or source control. The dashboard requires your Railway account and project access.

The credential is unique to this preview. Server authentication verifies a salted scrypt hash and issues the existing secure session cookie. Unauthenticated financial API access returned HTTP 401. The password screen is not the access-control boundary. This remains the application's existing shared-operator preview authentication, not individual user accounts.

Browser checks completed onboarding for this shared preview owner. To inspect it again, use **Settings → Explore AGUS**. The local generated credential file is ignored by Git and is not shipped.

## Infrastructure

- New service: `agus-counterpart-acceptance` / `011ff58d-77ec-40f9-ae9f-67eca3e6972e`.
- New isolated persistent volume: `922dc5df-c4d6-48a4-a08d-fe342085b006`, mounted at `/data`, with database `pglite:///data/counterpart-db`. Single replica in iad. No existing database was copied or reused.
- Successful deployment: `0d40e052-4b43-4f31-9944-d0703214c111`. Node 24; `npm run build`; `npm start -- --port 3000`; `PORT=3000`. The explicit port corrected an initial health-check failure.
- Native Gemini uses a server-only Railway credential reference from the existing project, without copying its value into code, logs or chat. Its genuine deployed request returned HTTP 200 with successful native financial-snapshot tool execution. The original preview's credential reference resolved as missing; the existing legacy service credential reference worked. Neither source service was modified or redeployed.
- Bank execution uses fixture mode, live-transfer flags are false, and no bank provider secret is supplied. Pollar and Zcash are restricted to their existing testnet paths. No mainnet execution was enabled.
- Original `agus2-web-preview` service remains at successful deployment `e7a9a01b-b71e-45d6-93fa-1a9248e0ce47`, without staged changes. No existing Railway resource was deleted or replaced.

## Verified on the public deployment

[acceptance.json](acceptance.json) records the actual deployed browser checks. [followup.json](followup.json) records mobile saved-chat restoration after reload and payment review. [public-secret-scan.json](public-secret-scan.json) checks served JavaScript for the preview credential and hash.

- HTTPS loading, server-side authentication, onboarding skip/completion/reload and Settings replay.
- Home, Money, AGUS, Obligations and Activity at 1440, 390 and 320 pixels, without horizontal overflow or browser JavaScript errors.
- Explicit account chooser, disabled unavailable bank linking, wallet discovery, Zcash receiving entry point and disabled unsupported sending.
- Real Gemini conversation and native `read_agus_financial_snapshot`; saved chat selection/restoration from the backend after mobile reload.
- Obligation form and persisted payment preparation/review. A clearly labeled **Acceptance check · 1 USDC** test draft is retained for review. It has not been approved or sent. No accounts, financial balances or payment confirmations were manufactured.
- The retained `/conversation` route enters its recording state with a synthetic browser microphone. Browser recognition ended automatically in the headless test. Physical microphone quality and transcription accuracy were not verified. Voice is not integrated into the current Counterpart composer; no new control or redesign was added.

The managed Cloud browser uses the environment's HTTPS proxy with its CA public key pinned. HTTPS was also checked through the trusted system CA store. The application itself uses Railway's public HTTPS domain.

## Actual remaining limitations

Pollar has no configured preview publishable testnet key or USDC issuer, so wallet connection, live balances and signing remain unavailable. Zcash receiving requests can be prepared with supported addresses, but receiving verification needs authorized testnet RPC configuration; integrated ZEC sending remains disabled. Nigerian live bank linking is unavailable. No genuine sponsor payment, mainnet transaction, physical-device microphone or speech transcription was claimed as verified.

## Actual deployed screenshots

| Screen                | Desktop                                                 | Mobile                                                       |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| Home                  | [1440](1440-home.png)                                   | [390](390-home.png), [320](320-home.png)                     |
| Gemini response       | [Genuine deployed response](desktop-agus-response.png)  | [Restored chat](390-saved-chat.png)                          |
| Money                 | [1440](1440-money.png)                                  | [390](390-money.png), [320](320-money.png)                   |
| Add account           | [1440](1440-account-picker.png)                         | [390](390-account-picker.png), [320](320-account-picker.png) |
| Obligations           | [1440](1440-obligations.png)                            | [390](390-obligations.png)                                   |
| Activity              | [1440](1440-activity.png)                               | [390](390-activity.png)                                      |
| Payment review        | [1440](desktop-payment-review.png)                      | [390](390-payment-review.png), [320](320-payment-review.png) |
| Voice, retained route | [Synthetic recording state](legacy-voice-recording.png) | Physical-device testing pending                              |
