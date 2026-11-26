# AGUS Crypto authentication API

Origin `https://agus.grindcity.app`. The examples below apply after activation of the passwordless release. Use HTTPS JSON requests and keep cookies in the clients' existing cookie stores. Native requests use `Origin: agus://`. The public web page at `/auth` uses the web origin.

| Method and path | Request and response |
| --- | --- |
| `POST /api/auth/email-otp/send-verification-otp` | Send `{"email":"you@example.com","type":"sign-in"}`. `200 {"success":true}` means the mail provider accepted the request. |
| `POST /api/auth/sign-in/email-otp` | Send `{"email":"you@example.com","otp":"012345"}`. Success returns `{"user":{...}}` and sets the session cookie. Preserve leading zeros. |
| `POST /api/auth/sign-in/social` | Web sends `{"provider":"google","callbackURL":"https://agus.grindcity.app/auth"}` and follows the returned Google URL. Better Auth processes Google's redirect at `/api/auth/callback/google`. |
| `POST /api/auth/mobile-google/exchange` | The Expo wrapper supplies a 32-byte, lowercase hex verifier generated for this login. Its SHA-256 hex digest is the challenge in `agus://open/auth?challenge=…`. After browser return, send `{"verifier":"…"}`. A Google handoff expires after one minute and is single-use. The deep link carries only the challenge. |
| `POST /api/auth/two-factor/verify-totp` | When OTP or native Google returns `{"twoFactorRedirect":true}`, send `{"code":"123456"}` with the temporary cookie. Continue after the authenticated cookie is issued. |
| `GET /api/auth/get-session` | Returns current user and session, or `null` if signed out. Sessions expire after seven days under the existing Better Auth configuration. |
| `POST /api/auth/sign-out` | Send `{}` with the session cookie. Clear signed-in UI after success. |

Codes expire after five minutes. The server enforces five guesses per code, a 60-second resend window per email, and separate Better Auth request limits. Resends invalidate the earlier challenge. `400 INVALID_OTP` covers expired, wrong and already-used codes. `403 TOO_MANY_ATTEMPTS` requires a new code. For `429`, honor `Retry-After` and retain the email address. `503 OTP_DELIVERY_UNAVAILABLE` means email delivery failed. `401 GOOGLE_HANDOFF_REQUIRED` means restart Google sign-in. JSON syntax and field validation use Better Auth's normal errors.

Successful first sign-in creates a consumer account. Existing verified email and linked Google accounts retain their AGUS user IDs. Implicit linking remains disabled. If Google reports an existing unlinked email, use email OTP for that account. `AGUS_AUTH_PUBLIC=false` keeps the invitation gate on first account creation. Hosted email password registration, password sign-in and verification links are disabled. Crypto transfers still require wallet proof, immutable review, explicit wallet approval and independent reconciliation.

Production activation uses the existing `BETTER_AUTH_SECRET`, OAuth client pair, `RESEND_API_KEY` and verified `AGUS_AUTH_EMAIL_FROM` in the root-only API environment. See the [EC2 activation instructions](DEVNET_DEPLOYMENT.md) and [Android integration guide](CHISOM_ANDROID_INTEGRATION.md).
