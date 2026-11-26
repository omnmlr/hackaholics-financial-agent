# AGUS Crypto Public Launch & Infrastructure Handoff

**Date:** November 25, 2026  
**Branch:** `infra/agus-public-launch-20261125` (branched from `feat/agus-crypto-backend` at `63abaebee506efc45308039167a7ffddef29257a`)  
**Scope:** Public website (`agus.grindcity.app`), legal/support/auth pages, Caddy routing, `AGUS_AUTH_PUBLIC` + Resend/Google OAuth deployment readiness, and external dashboard blocker inventory for Codex and founder execution.

---

## 1. Existing Deployment State & Root Blockers Identified

1. **DNS (`grindcity.app`, Name.com):**
   - Nameservers: `ns1bqx.name.com`, `ns2dky.name.com`, `ns3ckl.name.com`, `ns4lqx.name.com`.
   - `grindcity.app`, `agus.grindcity.app`, and `mail.grindcity.app` currently resolve `A` -> `91.195.240.94` (`Server: Parking/1.0`, Name.com wildcard parking) instead of Stockholm EC2 (`13.48.206.202`).
2. **Stockholm Ubuntu Server (`i-0b608f6472205b337`, `13.48.206.202`, `eu-north-1`):**
   - Live on `https://13-48-206-202.sslip.io` at revision `126a528c2b7b0accc380d2af7cddae58ed6e624a`:
     - `/api/v1/ready` -> `200 OK` (`{"status":"ready"}`)
     - `/api/auth/get-session` -> `200 OK` (`null`)
     - `POST /api/auth/sign-in/social` (`{"provider":"google"}`) -> `404 PROVIDER_NOT_FOUND` (Google OAuth env vars not configured yet)
     - `/`, `/privacy`, `/terms` -> `404 Not Found` (`deploy/crypto/ec2/Caddyfile` blocked all non-`/api/*` routes)
3. **Public Website & Legal Routes Missing in Code:**
   - No `/privacy`, `/terms`, `/support`, `/auth`, `/reset-password`, `/robots.txt`, or `/sitemap.xml` existed in `src/app/`.
4. **Public / Judge Authentication Blocked in Runtime Config:**
   - `scripts/crypto-devnet.ts` rejected `AGUS_AUTH_PUBLIC=true` unconditionally with `INVITE_ONLY_DEVNET_REQUIRED`, even though `src/server/identity-email.ts` and `docs/agus-crypto/IMPLEMENTATION.md` support `AGUS_AUTH_PUBLIC=true` once `RESEND_API_KEY`, `AGUS_AUTH_EMAIL_FROM`, and an `https://` origin are configured.
   - `deploy/crypto/ec2/compose.yml` hardcoded `AGUS_AUTH_PUBLIC: "false"` in `environment:` (overriding `env_file`), and `deploy/crypto/ec2/deploy-stockholm.py` hardcoded `HOST = "13-48-206-202.sslip.io"` without supporting `GOOGLE_CLIENT_ID/SECRET`, `RESEND_API_KEY`, `AGUS_AUTH_EMAIL_FROM`, or `AGUS_AUTH_PUBLIC`.

---

## 2. Completed Code & Deployment Infrastructure Changes (`infra/agus-public-launch-20261125`)

- **Public Website & OAuth/Verification Pages:**
  - `src/app/page.tsx`: When `AGUS_ENVIRONMENT === "devnet"`, serves `<CryptoPublicHome />` (`src/components/agus/crypto-public-home.tsx`) using the approved `/brand/agus-lockup-dark.png` and `/brand/agus-wordmark-dark.png` assets. Leaves `fixture`, `live`, and unset environments untouched (`AgusWorkspace` / `FinancialConversation`).
  - `src/components/agus/public-shell.tsx` & `src/components/agus/public-site.module.css`: Responsive dark-theme public shell matching `AgusBrand`, linking Overview (`/`), Sign in (`/auth`), Support (`/support`), Privacy (`/privacy`), and Terms (`/terms`).
  - `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/app/support/page.tsx`: Discloses Google OAuth (`openid`, `email`, `profile`), Resend email (`mail.grindcity.app`), Solana Devnet public RPC reads, Gemini/ElevenLabs/Firecrawl boundaries, non-custodial MWA key custody, and `support@mail.grindcity.app`.
  - `src/app/auth/page.tsx` & `src/components/agus/public-auth-panel.tsx`: Runtime-dynamic portal supporting Google OAuth sign-in, email sign-up (`callbackURL` -> `/auth?verified=1`), email sign-in, password reset requests, and session sign-out.
  - `src/app/reset-password/page.tsx` & `src/components/agus/reset-password-form.tsx`: Browser completion form for Resend password-reset links (`/api/auth/reset-password`).
  - `src/app/robots.ts` & `src/app/sitemap.ts`: Sitemap and crawl rules targeting `https://agus.grindcity.app`.
- **EC2 Reverse Proxy & Launcher Updates:**
  - `deploy/crypto/ec2/Caddyfile`: Allows `@public_web` (`/`, `/privacy`, `/terms`, `/support`, `/auth`, `/auth/*`, `/reset-password`, `/robots.txt`, `/sitemap.xml`, `/_next/static/*`, `/_next/image`, `/brand/*`, `/fonts/*`) alongside `@api`, `/favicon.png`, and `/favicon.ico`, keeping unexposed legacy routes returning `404`.
  - `deploy/crypto/ec2/compose.yml`: Removed the hardcoded `AGUS_AUTH_PUBLIC: "false"` override so `/etc/agus-crypto/api.env` governs public vs invite-only registration while `scripts/crypto-devnet.ts` fails closed if omitted.
  - `deploy/crypto/ec2/deploy-stockholm.py`: Defaults to `--host agus.grindcity.app`, adds `--revision`, `--configure-identity`, and `--public-auth`, validates paired `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and Resend prerequisites for `AGUS_AUTH_PUBLIC=true`, and verifies HTTPS `200` on `/`, `/privacy`, `/terms`, `/support`, `/auth`, `/api/v1/ready`, and `/api/v1/openapi`.
- **Devnet Public-Auth Guard & Preflight Updates:**
  - `scripts/crypto-devnet.ts`: Accepts `AGUS_AUTH_PUBLIC="true"` only when `RESEND_API_KEY`, `AGUS_AUTH_EMAIL_FROM`, and an `https://` `APP_ORIGIN` are set; fails closed with `INVITE_ONLY_DEVNET_REQUIRED` otherwise.
  - `deploy/crypto/aws/preflight-check.sh`, `deploy/crypto/aws/tests/preflight.test.ts`, `deploy/crypto/ec2/test_deploy_stockholm.py`, `tests/crypto-public-web.test.ts`: Updated tests covering public-auth fail-closed invariants, EC2 identity validation, and SSR web rendering.

---

## 3. Remaining External Service Actions (Blocked on Browser / Portal Access)

Browser automation (`AUIT webview`, subagent `212a6e9f`) timed out on `about:blank` (`SCRIPT_ERROR: script timed out after 30000ms`), and local `aws`, `gcloud`, `RESEND_API_KEY`, `GOOGLE_CLIENT_ID`/`SECRET`, and SSH credentials are absent on this workstation. Complete these steps once browser / SSM access is available:

1. **Resend (`mail.grindcity.app`):**
   - Add domain `mail.grindcity.app` (transactional email subdomain) and record its generated DKIM/SPF DNS records.
   - Create a sending-only API key scoped to `mail.grindcity.app` (`RESEND_API_KEY`) and use sender `AGUS <noreply@mail.grindcity.app>` (`AGUS_AUTH_EMAIL_FROM`).
2. **Name.com DNS (`grindcity.app`):**
   - Preserve any unrelated existing records.
   - Add `A` record `agus` -> `13.48.206.202` (`agus.grindcity.app`).
   - Add Resend DKIM, SPF (`MX`/`TXT` for `mail.grindcity.app` / return-path), and DMARC (`_dmarc.mail.grindcity.app` / `_dmarc.grindcity.app`) records, then verify `mail.grindcity.app` in Resend.
   - Add any Google Search Console DNS TXT verification record required for `grindcity.app`.
3. **Google Cloud Console (`gen-lang-client-0539637580` / AGUS CRYPTO):**
   - Configure Auth Platform Branding: app name `AGUS`, homepage `https://agus.grindcity.app`, privacy policy `https://agus.grindcity.app/privacy`, terms `https://agus.grindcity.app/terms`, authorized domain `grindcity.app`, support email `support@mail.grindcity.app`.
   - Configure Web OAuth Client authorized JavaScript origin `https://agus.grindcity.app` and redirect URI `https://agus.grindcity.app/api/auth/callback/google`.
   - Complete Search Console domain verification and publish OAuth Audience from **Testing** to **In production** (removing Google's test-user allowlist restriction).
4. **Stockholm Ubuntu EC2 (`i-0b608f6472205b337`) Deployment & Verification:**
   - Coordinate with Codex (`feat/agus-crypto-backend`), merge/build Linux AMD64 release bundle via `.github/workflows/agus-crypto-devnet-image.yml` (`retain_bundle: true`).
   - Activate in AWS SSM (`aws ssm start-session --region eu-north-1 --target i-0b608f6472205b337`):
     ```bash
     sudo python3 ./deploy-stockholm.py --host agus.grindcity.app --configure-identity --public-auth
     ```
   - Verify live DNS (`agus.grindcity.app` -> `13.48.206.202`, Resend DKIM/SPF/DMARC), HTTPS (`/` `/privacy` `/terms` `/support` `/auth` `/api/v1/ready` `/api/v1/openapi`), real Resend email verification + password reset delivery, and production Google OAuth login.
   - Update Android builds (`AGUS_CRYPTO_DEVICE_API_URL=https://agus.grindcity.app`) when cutting the release APK.

---

## 4. Verification Summary on `infra/agus-public-launch-20261125`

- `wsl.exe python3 -B -m unittest discover -s deploy/crypto/ec2 -p "test_*.py"`: `Ran 2 tests in 0.056s`, `OK` (`exit 0`).
- `python -m py_compile deploy/crypto/ec2/deploy-stockholm.py`: `exit 0`.
- `wsl.exe bash -lc "tr -d '\r' < deploy/crypto/aws/preflight-check.sh | bash -n"`: `exit 0`.
- `npm.cmd run typecheck`: `exit 0`.
- `npm.cmd run lint`: `exit 0`.
- `node ./node_modules/vitest/vitest.mjs run tests/crypto-public-web.test.ts`: `4 passed (4)` (`exit 0`).
- Direct `scripts/crypto-devnet.ts api` checks:
  - `AGUS_AUTH_PUBLIC=true` without Resend: `Crypto Devnet startup failed (INVITE_ONLY_DEVNET_REQUIRED)` (`exit 1`).
  - `AGUS_AUTH_PUBLIC=true` with `RESEND_API_KEY`, `AGUS_AUTH_EMAIL_FROM`, and HTTPS origin (`valid-runtime` harness): `Crypto Devnet API startup verified` (`exit 0`). (Vitest wrapper `preflight.test.ts -t "AGUS_AUTH_PUBLIC"` hit the 50,000 ms Windows `tsx` spawn timeout at `51228ms`/`51979ms`.)
- `npm.cmd run build` (`next build --webpack`): Compiled (`2.3min`), finished TypeScript (`89s`), generated all 11 static/route pages including `/`, `/privacy`, `/terms`, `/support`, `/auth`, `/reset-password`, `/robots.txt`, `/sitemap.xml`, then exited `1` solely due to Next.js 16.4.1's `SecurityFatalError` upgrade nudge (`package.json` left untouched per coordination constraints).
