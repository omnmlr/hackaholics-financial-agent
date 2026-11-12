# Android Physical-Device Acceptance Checklist

Status: **Automated JS/TS/policy/MWA unit checks, dual-ABI debug APK build (`arm64-v8a`, `x86_64`), and emulator startup/harness smoke checks passed; physical Android biometric, MWA wallet signing, push delivery, and Devnet finality remain pending physical device interaction.**

## 1. Local Build & Device Prerequisites

1. **Android SDK / JDK / Build Toolchain (Windows host verified 2026-11-12):**
   - `C:` free space: `~150+ GiB` (exceeds `8 GiB` minimum per build volume).
   - `JAVA_HOME`: `C:\Program Files\Android\Android Studio\jbr` (OpenJDK `25.0.3` works when passing `"-Dkotlin.compiler.execution.strategy=in-process"` to Gradle `9.4.1`).
   - `ANDROID_HOME`: `%LOCALAPPDATA%\Android\Sdk` with `cmdline-tools;latest`, `platforms;android-36`, `platforms;android-37.0`, `build-tools;37.0.0`, `ndk;27.1.12297006`, `cmake;3.22.1`, `cmake;3.31.6`, `platform-tools`, and `licenses`.
   - **Windows long-path CMake/Ninja fix:** `cmake;3.22.1` (`ninja 1.10.2`) fails with `ninja: error: manifest 'build.ninja' still dirty after 100 tries` when repo worktree paths push `../prefab/.../kolibri-androidConfigVersion.cmake` past `260` characters. Point `apps/mobile/android/local.properties` (`cmake.dir`) at `cmake;3.31.6` (`ninja 1.12.1`).
   - Verify readiness before building:
     ```powershell
     $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
     $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
     npm.cmd run mobile:build:preflight
     ```
2. **Reproducible Debug APK Build:**
   ```powershell
   $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
   $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
   Set-Location apps\mobile
   npx.cmd expo prebuild --platform android --no-install
   Set-Content -Path "android\local.properties" -Value "sdk.dir=$($env:ANDROID_HOME -replace '\\','\\')`ncmake.dir=$($env:ANDROID_HOME -replace '\\','\\')\\cmake\\3.31.6" -Encoding Ascii
   Set-Location android
   .\gradlew.bat :app:assembleDebug --no-daemon --max-workers=2 "-PreactNativeArchitectures=arm64-v8a,x86_64" "-Dkotlin.compiler.execution.strategy=in-process"
   ```
   - Single-ABI `arm64-v8a` works on physical `arm64-v8a` devices; adding `x86_64` produces one APK installable on both physical devices and `x86_64` Windows/macOS emulators (required when `expo.useLegacyPackaging=false` uses `DirectApkSoSource`).
   - Verified APK output: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (`107,509,332` bytes, SHA-256 `95d1c9bef75c32fac59706525a70d95275ee28ce052fc7aaa8010edf430f7d66`, `app.agus.prototype`).
3. **Physical Device / Emulator Setup:**
   - Enable USB debugging on a physical Android phone with:
     - Screen lock **and enrolled biometrics** (fingerprint/face — `expo-local-authentication` `isEnrolledAsync()` requires biometrics, not PIN alone, to unlock a stored session).
     - An MWA-compatible Devnet wallet installed (e.g., Phantom or Solflare configured for **Solana Devnet** with test SOL and canonical Circle test-USDC `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).
     - An authenticator app (Google Authenticator / 1Password / Authy) for TOTP sign-in and step-up.
   - Install and launch APK:
     ```powershell
     adb devices -l
     adb install -r apps\mobile\android\app\build\outputs\apk\debug\app-debug.apk
     adb reverse tcp:8081 tcp:8081
     adb shell am start -W -a android.intent.action.VIEW -d "agus://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081" app.agus.prototype
     ```
   - Ensure the device can reach the configured multi-user PostgreSQL backend (`EXPO_PUBLIC_API_URL`, or `adb reverse tcp:3000 tcp:3000` with `http://127.0.0.1:3000` in `__DEV__` mode) and a running Metro server for the Expo dev-client bundle (`EXPO_PUBLIC_API_URL=... npm run start --workspace @agus/mobile`).
   - **Emulator smoke results (MuMu Player 12, `SM_A546E`, Android 15, `emulator-5554`):**
     - `adb install -r` succeeded (`107,509,332` bytes); cold launch loaded `MainActivity` + Metro bundle (`1181` modules) with zero fatal runtime errors.
     - `Unlock local session` returned `FRESH_SIGN_IN_REQUIRED` without enrolled biometrics.
     - `Sign in with invited account` against unserved `http://127.0.0.1:3100` handled missing backend cleanly (`Operation unavailable. Recover server state before a new financial action.`).
     - Home background/relaunch (`HOT`) and `agus://open/solana/...` + `agus://approve/payment/...` intents delivered without crash.
     - Observed note: system dark mode on Android 15 rendered low-contrast dark text over dark background in the prototype harness.

---

## 2. Authentication & TOTP Step-Up

- [ ] **Uninvited signup rejected:** Attempt sign-up/sign-in with an uninvited email -> fails cleanly without storing a session.
- [ ] **Invited sign-in & TOTP enrollment:** Invite account via `MIGRATION_DATABASE_URL=... npm run identity:invite -- user@example.com`, sign in on device, tap **Set up authenticator privately**, copy URI into authenticator app, record recovery codes privately, enter 6-digit code, tap **Verify authenticator enrollment** -> succeeds.
- [ ] **Authenticator app switch mid-login:** Sign out, sign in with email + password (triggering `twoFactorRedirect`), switch to authenticator app to copy the 6-digit TOTP code, return to AGUS, enter code, tap **Verify sign-in TOTP** -> succeeds without losing the pending 2FA challenge cookie.
- [ ] **Step-up throttling:** Enter wrong password or wrong TOTP code repeatedly during financial approval -> rejected (`STEP_UP_REJECTED` / `STEP_UP_THROTTLED` after threshold), persistent across app restart.

## 3. Secure Storage & Remote Revocation

- [ ] **No plaintext secrets in ordinary storage or logs:** Inspect `adb logcat` during sign-in, TOTP setup, and step-up -> verify no password, TOTP seed, backup codes, `agus_cookie`, `agus_session_data`, or `signedTransactionBase64` appears in logs.
- [ ] **Biometric lock on background:** Once signed in (`Session verified`), press Home / switch apps, return to AGUS -> UI shows `Session locked`, sensitive draft/account views are cleared from memory, and API buttons are inaccessible until **Unlock local session** succeeds via Android biometric prompt.
- [ ] **Biometric prompt cancellation:** Cancel the Android biometric prompt -> session remains locked (`FRESH_SIGN_IN_REQUIRED` / `LOCAL_SESSION_LOCKED`), no fallback boolean bypasses unlock.
- [ ] **Remote session revocation:** From another authenticated session/admin check, delete the mobile session (`DELETE /api/v1/sessions/{sessionId}`). Return to mobile, unlock locally -> `Refresh authenticated state` immediately fails with `401` (`UNAUTHENTICATED`), locks local session, and wipes `agus_cookie` and `agus_session_data` from `SecureStore`.

## 4. Android Wallet Connection (MWA)

- [ ] **Connect Android Devnet wallet:** Tap **Connect Android Devnet wallet** -> Android launches MWA wallet selector; approve authorization on `solana:devnet` -> returning displays the exact Base58 public key; **no** signing request occurs during connect.
- [ ] **Connection cancellation / rejection:** Tap **Connect Android Devnet wallet** and cancel/reject inside the wallet app -> returns cleanly without crashing or setting a wallet address.
- [ ] **Missing wallet handling:** Test on a profile/device with no MWA wallet installed -> surfaces clean error notice without crashing.

## 5. Solana Devnet Prepare, Approval, Signing & Finality

- [ ] **Prepare 0.001 Devnet SOL transfer:** Enter a different owner-controlled recipient address and `0.001`, tap **Prepare and simulate new Devnet instruction** -> displays `prepared`, sender, recipient, `0.001 SOL`, fee lamports, rent lamports, and 64-hex `Digest`.
- [ ] **Human step-up approval:** Enter password + fresh 6-digit TOTP, tap **I reviewed this instruction — approve with password and TOTP** -> state transitions to `approved`; **no wallet prompt or broadcast happens yet**.
- [ ] **MWA exact signing & local unlock:** Tap **Sign exact instruction in Android wallet** -> wallet displays the exact Devnet transaction. Approve signature in wallet -> AGUS returns in `Session locked` state (backgrounding locked session), saves `signedTransactionBase64` in `SecureStore`. Unlock locally -> draft recovers with **Submit saved signed instruction once** visible. **Nothing was broadcast before tapping Submit.**
- [ ] **Wallet rejection / account switch during signing:** Prepare & approve a second draft; during MWA signing either reject in wallet OR switch to a different wallet account -> `signExactDraft` rejects (`WALLET_ACCOUNT_CHANGED` or user cancellation) and never saves/submits a mismatched signature.
- [ ] **Explicit single submission & reconciliation:** Tap **Submit saved signed instruction once** -> state becomes `submitted` with signature. Tap **Read chain status for existing signature** until `finalized`. Verify transaction on Solana Devnet (`meta.err = null`, exact sender/recipient/amount/fee).
- [ ] **Canonical Circle test-USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`):** Repeat with `1` token unit and mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` to a recipient without an existing ATA -> verify `estimatedRentLamports` is reviewed before approval, MWA signs, single submit succeeds, and `reconcile` reaches `finalized`.

## 6. App Switching, Termination Recovery, Offline Safety & Deep Links

- [ ] **Kill app after signing, before submit:** Force-stop AGUS (`adb shell am force-stop app.agus.prototype`) after MWA signing and before tapping Submit. Relaunch, unlock locally -> **Recover existing Devnet instruction** restores the `approved` draft + saved signature (`hasSigned = true`) ready for single explicit submission.
- [ ] **Kill app after submit / duplicate prepare blocked:** Force-stop while draft is `submitted` or `unknown`. Relaunch, unlock -> tapping **Prepare and simulate new Devnet instruction** before reconciling throws `RECOVER_EXISTING_SUBMISSION`; tapping **Recover existing Devnet instruction** restores the existing draft and allows read-only reconciliation without resending.
- [ ] **Offline / Airplane mode safety:** Enable Airplane mode -> UI shows `Offline — financial actions unavailable` and action buttons disable. Disable Airplane mode -> **no network operation or transaction submission runs automatically on reconnect.**
- [ ] **Deep link validation:**
  - Trigger valid opaque link: `adb shell am start -a android.intent.action.VIEW -d "agus://open/solana/<draft-uuid>" app.agus.prototype` -> unlocks/retrieves read-only state only (`Read authenticated notification resource`).
  - Trigger deceptive/malformed links (`agus://approve/payment/<uuid>`, `agus://open/payment/<uuid>?token=x`, `agus://open/solana/<uuid>/submit`) -> ignored (`parseNotificationLink` returns `null`); nothing approves or submits.
- [ ] **Notification permission & token state:** Deny notification permission -> **Notification permission and registration** records `pushState: "denied"` cleanly. Grant permission without EAS `projectId` -> records `pushState: "unavailable"` cleanly without crashing.
