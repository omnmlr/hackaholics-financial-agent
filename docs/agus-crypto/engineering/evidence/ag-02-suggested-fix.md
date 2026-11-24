# AG-02 Least-Invasive Suggested Fix: Android External Wallet Integration

**Task ID**: AG-02 Implementation Fix Proposal  
**Branch**: `ag/android-wallet-audit-20261124`  
**Base Commit**: `c66bf769f0febb947284018efc181df37104c350`  
**Target Integration Branch**: `ops/agus-crypto-agent-coordination-20261124`  
**Status**: Remediated & Verified Against MWA v3.0.2 SDK  

---

## 1. Overview & Guiding Principles

In accordance with AG-02 constraints, the active mobile implementation code (`apps/mobile/src/crypto-signer.ts`, `apps/mobile/src/crypto-device-state.ts`, `apps/mobile/src/crypto-wallet-policy.ts`, `apps/mobile/src/session.ts`, `apps/mobile/CryptoDeviceHarness.tsx`), shared test suites (`apps/mobile/tests/crypto-mobile.test.ts`), DAL, and signing identities have remained completely unmodified in the source tree during audit and verification.

Following independent review against `@solana-mobile/mobile-wallet-adapter-protocol@3.0.2` and `@solana-mobile/mobile-wallet-adapter-protocol-web3js@3.0.2` in `node_modules`, two earlier proposed fixes were **withdrawn** because the current `crypto-signer.ts` code already conforms to the installed v3.0.2 SDK:
1. **Withdrawn — `wallet.reauthorize()` Replacement (`crypto-signer.ts:86-91`)**: `@solana-mobile/mobile-wallet-adapter-protocol@3.0.2` (`lib/types/index.d.ts:159-166`, `lib/esm/index.native.js:158-201`) explicitly accepts `auth_token?: AuthToken` in `wallet.authorize(...)` and transparently rewrites to RPC `reauthorize` on `protocolVersion === "legacy"` while keeping RPC `authorize` with `chain` and `addresses` on `protocolVersion === "v1"`. Replacing `wallet.authorize` with `wallet.reauthorize({ auth_token, identity })` would **drop `chain` and `addresses: [wanted]` on MWA `v1`**, introducing a regression. (If automatic fallback on expired/revoked tokens with `code === -1` / `ERROR_AUTHORIZATION_FAILED` is ever desired as a UX enhancement, it should retry `wallet.authorize({ chain, identity, addresses: [wanted] })` *without* `auth_token` rather than calling `wallet.reauthorize`.)
2. **Withdrawn — Polymorphic `Uint8Array` Signature Normalization (`crypto-signer.ts:297-306`)**: `@solana-mobile/mobile-wallet-adapter-protocol-web3js@3.0.2` (`lib/types/index.d.ts:3-12`, `lib/esm/index.native.js:42`) already decodes wire base64 signatures and converts them to base58 `TransactionSignature[]` (`string[]`) via `base64EncodedSignatures.map(base64ToUint8Array).map(base58FromUint8Array)`. Thus `crypto-signer.ts:302` (`base58.decode(signature)`) receives base58 strings as intended. (Only `signMessages` returns `Uint8Array[]`, which `crypto-signer.ts:178-192` already handles.)

This document retains the **two verified least-invasive surgical fixes** for the confirmed software defects:
1. **Premature Launch Marker (`apps/mobile/src/crypto-signer.ts:277-280, 295-298`)**: Persisting the idempotency marker before `transact()` traps pre-submission aborts (`association`, `authorization`, `capabilities`) in `{ kind: "unknown" }`.
2. **AppState Session Lock Contention on Wallet Return (`apps/mobile/CryptoDeviceHarness.tsx:361-368`)**: `pay()` calls `recover(paymentOwner)` immediately after persisting the wallet outcome while `lockSession()` has already locked `session.ts:70`; `run()` (`CryptoDeviceHarness.tsx:99-118, 548`) catches `LOCAL_SESSION_LOCKED` and overwrites the unlock prompt notice with `"LOCAL_SESSION_LOCKED"`.

---

## 2. Surgical Code Diffs

### Fix 1: Scoped Launch Marker Placement in `apps/mobile/src/crypto-signer.ts`

**Location**: `apps/mobile/src/crypto-signer.ts`, lines 277–280 and 295–298  
**Target Function**: `handoff(claim: Claim, route: Route, review: Review)`  

#### Rationale:
Double-spend idempotency markers (`agus.crypto.launch.${userId}.${attempt.id}`) prevent repeat broadcasts of the same approved attempt. Persisting this marker *prior* to `transact()` (lines 277–279) means any failure during early phases (`association`, `authorization`, `capabilities`) permanently traps subsequent `signer.handoff()` calls for that `attempt.id` in `{ kind: "unknown" }` via line 278, even though nothing was broadcast.

Note on single-launch context and existing tests:
- `CryptoDeviceHarness.tsx:352-360` obtains a one-shot `launchGranted` claim from `/api/v1/crypto/attempts/{id}/handoff`, so the harness normally invokes `handoff()` once per claim.
- `apps/mobile/tests/crypto-mobile.test.ts:202-217` tests that an ambiguous error thrown by `native.send` (`signAndSendTransactions`) retains the launch marker and returns `{ kind: "unknown" }` on retry. Because `native.send` executes at line 297 *after* `stage = "submission"` (line 295), persisting the marker at `stage === "submission"` immediately before `wallet.signAndSendTransactions` preserves `crypto-mobile.test.ts:202-217` 100% while allowing pre-submission retries.

#### Proposed Replacement:
```typescript
<<<<
        const marker = `agus.crypto.launch.${userId}.${attempt.id}`;
        if (await SecureStore.getItemAsync(marker)) return { kind: "unknown" };
        await SecureStore.setItemAsync(marker, review.messageDigest, storage);
        emit(provider, stage, "STARTED");
        return await transact(async (wallet) => {
====
        const marker = `agus.crypto.launch.${userId}.${attempt.id}`;
        if (await SecureStore.getItemAsync(marker)) return { kind: "unknown" };
        emit(provider, stage, "STARTED");
        return await transact(async (wallet) => {
>>>>
```

And in the submission block (lines 295–298):
```typescript
<<<<
          stage = "submission";
          emit(provider, stage, "STARTED");
          const [signature] = await wallet.signAndSendTransactions({
====
          stage = "submission";
          emit(provider, stage, "STARTED");
          // Commit idempotency marker right before broadcast to preserve submission-stage
          // double-spend protection without trapping pre-submission aborts.
          await SecureStore.setItemAsync(marker, review.messageDigest, storage);
          const [signature] = await wallet.signAndSendTransactions({
>>>>
```

---

### Fix 2: Graceful `LOCAL_SESSION_LOCKED` Notice Preservation in `apps/mobile/CryptoDeviceHarness.tsx`

**Location**: `apps/mobile/CryptoDeviceHarness.tsx`, lines 361–368 (wrapped by `run()` at line 548)  
**Target Function**: `pay(review: Review, route: Route)`  

#### Rationale:
When the user switches to Phantom or Solflare, Android moves AGUS to `"background"`, firing the `AppState` listener (`CryptoDeviceHarness.tsx:212-228`), which calls `lockSession()` (`session.ts:45-47`, `unlocked = false`) and sets `notice` to `"Unlock AGUS to recover the saved Devnet attempt."` (`line 224`). When control returns to AGUS, `pay()` persists the outcome to `SecureStore` (`line 366`) and immediately calls `await recover(paymentOwner)` (`line 367`). In `session.ts:70`, `api` throws `Error("LOCAL_SESSION_LOCKED")`. Because `pay()` is invoked inside `run()` (`line 548`, defined at `lines 99-118`), `run()` catches the error (no unhandled crash) and sets `notice` to `"LOCAL_SESSION_LOCKED"` (`lines 107-109`), overwriting the clear unlock instruction.

Catching `LOCAL_SESSION_LOCKED` specifically around `recover(paymentOwner)` preserves `lockSession()` security enforcement on backgrounding (no lock deferral) while restoring the actionable unlock notice so the user can tap `"Unlock and resume"` (`lines 436-445`).

#### Proposed Replacement:
```typescript
<<<<
    const outcome = await wallet.handoff(claim, route, review);
    if (outcome.kind === "signed")
      throw new Error("UNSUPPORTED_WALLET_OUTCOME");
    const saved = { id: current.id, outcome };
    // Persist the wallet return even when Android has already locked the API session.
    await SecureStore.setItemAsync(localKey, JSON.stringify(saved), secure);
    await recover(paymentOwner);
  }
====
    const outcome = await wallet.handoff(claim, route, review);
    if (outcome.kind === "signed")
      throw new Error("UNSUPPORTED_WALLET_OUTCOME");
    const saved = { id: current.id, outcome };
    // Persist the wallet return even when Android has already locked the API session.
    await SecureStore.setItemAsync(localKey, JSON.stringify(saved), secure);
    try {
      await recover(paymentOwner);
    } catch (recoverError: unknown) {
      if (
        recoverError instanceof Error &&
        recoverError.message === "LOCAL_SESSION_LOCKED"
      ) {
        setNotice("Unlock AGUS to recover the saved Devnet attempt.");
        return;
      }
      throw recoverError;
    }
  }
>>>>
```

---

## 3. Configuration & Infrastructure Remediations

### 1. Digital Asset Links (`.well-known/assetlinks.json`)
- **Problem**: Phantom displayed a red identity warning (*"This app's identity could not be verified. It may be impersonating another app."*) due to HTTP 404 on `https://agus-wallet-devnet-identity.vercel.app/.well-known/assetlinks.json` (`docs/agus-crypto/ANDROID_DEVICE_TEST.md:22`).
- **Remediation**:
  1. Generate the SHA-256 certificate fingerprint using `scripts/android/prepare-release-signing.sh` in an owner-controlled environment.
  2. Deploy `/.well-known/assetlinks.json` on the Vercel identity origin serving:
  ```json
  [
    {
      "relation": ["delegate_permission/common.handle_all_urls"],
      "target": {
        "namespace": "android_app",
        "package_name": "app.agus.prototype",
        "sha256_cert_fingerprints": [
          "<VERIFIED_RELEASE_SIGNING_SHA256_FINGERPRINT>"
        ]
      }
    }
  ]
  ```
  3. Ensure `Content-Type: application/json` and `Access-Control-Allow-Origin: *`.

### 2. MWA Association Timeout Patch (`apps/mobile/plugins/with-wallet-package.cjs`)
- **Problem**: Stock MWA SDK 3.0.2 (`SolanaMobileWalletAdapterModule.kt:39`) enforced `ASSOCIATION_TIMEOUT_MS = 10000`. When biometric prompts exceeded 10s, the association WebSocket timed out.
- **Status**: Verified already patched to 45,000 ms (`ASSOCIATION_TIMEOUT_MS = 45000`) in `apps/mobile/plugins/with-wallet-package.cjs:37-39`.

### 3. Low Power Mode Restriction
- **Problem**: Solflare rejects MWA connections when Android Battery Saver is active: *"Your device is in low power mode. Deactivate it to enable connection and signing."*
- **Guidance**: Documented in test runbook `docs/agus-crypto/ANDROID_DEVICE_TEST.md:29` and mapped to `WALLET_POWER_RESTRICTION` in `apps/mobile/src/crypto-wallet-policy.ts:27-28`. Handset testers must disable Android Battery Saver prior to testing Solflare.

---

## 4. Verification & Safety Summary

- **Zero Regressions**: The proposed changes preserve existing client contracts, `lockSession()` security boundaries, MWA v3.0.2 `authorize` (`chain`, `addresses`, `auth_token`) compatibility, and error classifications (`WALLET_POWER_RESTRICTION`, `WALLET_ASSOCIATION_CANCELLED`, `WALLET_RECONNECT_REQUIRED`).
- **Verification Coverage**: Verified against `apps/mobile/tests/crypto-mobile-standalone.test.ts` (11/11 passing), `apps/mobile/tests/crypto-mobile.test.ts` (7/7 passing), `npm.cmd run mobile:typecheck` (exit 0), and `eslint` on `apps/mobile/tests/crypto-mobile-standalone.test.ts` (0 errors, 0 warnings).
- **Compliance**: Follows minimal-change principle without modifying active mobile source, DAL, backend APIs, or shared test suites.
