# Stockholm Devnet verification · November 25, 2026

The founder activated the prebuilt `126a528c2b7b0accc380d2af7cddae58ed6e624a` release and reported that all three containers started. The running release remains at that revision. This checkpoint changes the deployment launcher and future narration, with no host changes. [Stockholm API](https://13-48-206-202.sslip.io)

| Probe | Result |
| --- | --- |
| HTTP `/api/v1/ready` | `308` HTTPS redirect |
| HTTPS `/api/v1/ready` | `200` with `{"status":"ready"}` and successful certificate validation through the workspace HTTPS proxy |
| HTTPS `/api/v1/openapi` | `200` and exact sorted JSON match to the checked-in contract. OpenAPI 3.1.0, 35 Crypto paths. |
| Devnet wallet, portfolio and alerts GET, assistant turn POST | `401 SESSION_REQUIRED` without a session |
| Auth session GET | `200` with `null` without a session |
| Google sign-in initiation | `404 PROVIDER_NOT_FOUND` |
| Isolated Neon query using the restricted role | 27 migrations, zero users, zero active invitations. No authorized hosted user credential was available. |

Direct origin TLS inspection was unavailable from the workspace. An outside client with a direct network path can inspect the origin chain. Worker startup is founder-reported. Authenticated hosted portfolio and multimodal verification await an invited test account.

## Google sign-in

1. In Google Auth Platform, configure the consent screen and a **Web application** OAuth client. While in Testing, add the authorized judge or tester Google accounts to the audience. Register the exact callback `https://13-48-206-202.sslip.io/api/auth/callback/google` if the OAuth project accepts this hostname. If domain ownership is required, use an AGUS-owned verified domain and its matching API origin and callback. [Google OAuth redirect rules](https://developers.google.com/identity/protocols/oauth2/web-server)
2. In a future owner-approved runtime update, supply `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` together in the root-only API configuration. Keep `AGUS_AUTH_PUBLIC=false` for Devnet. Google and AGUS each have their own entry gate, so invite the same Google email in AGUS before its first sign-in.
3. The current Android signing diagnostics screen offers email and password. Android Google sign-in needs a client entry point and verification of the browser-to-app `agus://` callback and session on a signed handset. An enabled server provider alone does not establish that flow.

## Invite-only email

Email and password sign-in are already supported. An owner can invite a disposable tester using `npm run identity:invite -- <tester-email>` with the authorized owner connection for the isolated Crypto database. The tester can register through Better Auth at `POST /api/auth/sign-up/email`, then use the existing Android email sign-in or a securely supplied hosted test session. No credentials or recovery links belong in chat. [Deployment runbook](DEVNET_DEPLOYMENT.md)

Verification and password-reset email require both `RESEND_API_KEY` and `AGUS_AUTH_EMAIL_FROM` from a verified sender domain. Resend can use a sender domain separate from the API hostname. After an approved runtime update, deliver a verification email and a reset link to a disposable mailbox and check that both resolve to the live API origin. Keep invite-only registration through judging. [Resend verified domains](https://resend.com/docs/dashboard/domains/introduction)

## Android publication

The API origin is ready for the Android repository variable. The GitHub integration returned `403` when setting `AGUS_CRYPTO_DEVICE_API_URL`. The public Vercel association still lists the retired November 22 certificate. Restore the encrypted replacement signer on the trusted Windows workstation and publish the new public fingerprint to Vercel before calling the wrapper's `--release` mode. It checks readiness, the contract, and Digital Asset Links before setting the API variable and rerunning the selected workflow. The workflow independently validates the published ARM64 APK and checksum. [Windows procedure](ANDROID_DEVICE_TEST.md)
