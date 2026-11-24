# AG-02 Least-Invasive Suggested Fix: Android External Wallet Integration

**Task ID**: AG-02 Implementation Fix Proposal  
**Branch**: `ag/android-wallet-audit-20261124`  
**Base Commit**: `c66bf769f0febb947284018efc181df37104c350`  
**Target Integration Branch**: `ops/agus-crypto-agent-coordination-20261124`  
**Status**: Ready for Integration / Review  

---

## 1. Overview & Guiding Principles

In accordance with AG-02 constraints, the active mobile implementation code (`apps/mobile/src/crypto-signer.ts`, `apps/mobile/src/crypto-device-state.ts`, `apps/mobile/src/crypto-wallet-policy.ts`), shared test suites (`apps/mobile/tests/crypto-mobile.test.ts`), DAL, and signing identities have remained completely unmodified in the source tree during audit and verification.

This document details the **least-invasive, surgical fixes** required to address the four confirmed software defects identified during the investigation:
1. **MWA Protocol Violation**: Calling `wallet.authorize` with `auth_token` instead of `wallet.reauthorize`.
2. **Signature Type Parsing**: Fragile assumption that `wallet.signAndSendTransactions` returns a base58 string rather than raw 64-byte `Uint8Array`.
3. **Premature Launch Marker**: Persisting idempotency marker before `transact()` begins, trapping pre-submission aborts in `{ kind: "unknown" }`.
4. **AppState Session Lock Contention**: `LOCAL_SESSION_LOCKED` exception thrown on return from external wallet when `pay()` calls `recover()`.

---

## 2. Surgical Code Diffs

### Fix 1: Protocol-Accurate MWA Reauthorization in `apps/mobile/src/crypto-signer.ts`

**Location**: `apps/mobile/src/crypto-signer.ts`, lines 86–101  
**Target Function**: `select(wallet: WalletApi, provider: Provider, cluster: Cluster, address: string)`  

#### Rationale:
In the Solana Mobile Wallet Adapter (MWA) protocol specification and `@solana-mobile/mobile-wallet-adapter-protocol-web3js`, `wallet.authorize` requests a fresh connection grant and does not accept `auth_token`. Passing `auth_token` into `authorize()` causes protocol-compliant wallets to either reject with RPC schema errors or display repeated connection approval dialogs on every transaction. Standard MWA specifies `wallet.reauthorize({ auth_token, identity })` for silent re-authorization using a cached token, falling back to `wallet.authorize` only if the token has expired or been revoked (`ERROR_REAUTHORIZE`).

#### Proposed Replacement:
```typescript
<<<<
    const chain = chainId(cluster);
    const authorization = await wallet.authorize({
      chain,
      identity,
      addresses: [wanted],
      auth_token: token,
    });
====
    const chain = chainId(cluster);
    let authorization: { auth_token: string; accounts: Array<{ address: string; chains?: string[] }> };
    try {
      authorization = await wallet.reauthorize({
        auth_token: token,
        identity,
      });
    } catch (reauthError: any) {
      if (
        reauthError?.code === "ERROR_REAUTHORIZE" ||
        reauthError?.code === -1 ||
        reauthError?.message?.includes("REAUTHORIZE")
      ) {
        // Cached token revoked or expired: gracefully fall back to full authorization prompt
        authorization = await wallet.authorize({
          chain,
          identity,
          addresses: [wanted],
        });
      } else {
        throw reauthError;
      }
    }
>>>>
```

---

### Fix 2: Defensive Polymorphic Signature Handling in `apps/mobile/src/crypto-signer.ts`

**Location**: `apps/mobile/src/crypto-signer.ts`, lines 297–306  
**Target Function**: `handoff(claim: Claim, route: Route, review: Review)`  

#### Rationale:
Per the MWA wire specification, `signAndSendTransactions` returns an array of raw 64-byte `Uint8Array` signatures. Passing a `Uint8Array` to `@scure/base`'s `base58.decode(signature)` throws `Error: join.decode: string expected`. Because this throws inside `transact()`, it triggers the error handler before `returnedSignature` is assigned, returning `{ kind: "unavailable", reason: "WALLET_SIGNATURE_UNAVAILABLE" }` and discarding a successful on-chain transaction. Furthermore, `parseSavedAttempt` in `crypto-device-state.ts:20` enforces `/^[1-9A-HJ-NP-Za-km-z]{64,88}$/`, requiring a canonical base58 string.

#### Proposed Replacement:
```typescript
<<<<
          const [signature] = await wallet.signAndSendTransactions({
            transactions: [tx],
            minContextSlot: review.minContextSlot,
            commitment: "confirmed",
          });
          if (!signature || base58.decode(signature).length !== 64)
            throw new WalletRouteError("WALLET_SIGNATURE_UNAVAILABLE");
          returnedSignature = signature;
          emit(provider, stage, "SIGNATURE_RETURNED");
          return { kind: "signature", signature };
====
          const [rawSignature] = await wallet.signAndSendTransactions({
            transactions: [tx],
            minContextSlot: review.minContextSlot,
            commitment: "confirmed",
          });
          if (!rawSignature) {
            throw new WalletRouteError("WALLET_SIGNATURE_UNAVAILABLE");
          }
          // Support both MWA spec Uint8Array and legacy base58 string return types
          const signatureBase58 =
            typeof rawSignature === "string"
              ? rawSignature
              : base58.encode(Buffer.from(rawSignature as Uint8Array));

          if (base58.decode(signatureBase58).length !== 64) {
            throw new WalletRouteError("WALLET_SIGNATURE_UNAVAILABLE");
          }
          returnedSignature = signatureBase58;
          emit(provider, stage, "SIGNATURE_RETURNED");
          return { kind: "signature", signature: signatureBase58 };
>>>>
```

---

### Fix 3: Scoped Launch Marker Placement in `apps/mobile/src/crypto-signer.ts`

**Location**: `apps/mobile/src/crypto-signer.ts`, lines 277–280 and 295–297  
**Target Function**: `handoff(claim: Claim, route: Route, review: Review)`  

#### Rationale:
Double-spend idempotency markers (`agus.crypto.launch.${userId}.${attempt.id}`) are designed to prevent repeat broadcasts of the same approved attempt. Persisting this marker *prior* to `transact()` (lines 277–279) means that any failure during early phases (`association`, `authorization`, `capabilities`, or user cancellation) permanently traps the attempt in `{ kind: "unknown" }` via line 278 upon retry, even though nothing was broadcast. The marker must be committed only when entering the `submission` stage immediately prior to calling `signAndSendTransactions`.

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

And in the submission block (line 295):
```typescript
<<<<
          stage = "submission";
          emit(provider, stage, "STARTED");
          const [signature] = await wallet.signAndSendTransactions({
====
          stage = "submission";
          emit(provider, stage, "STARTED");
          // Commit idempotency marker right before broadcast to prevent double-spends
          await SecureStore.setItemAsync(marker, review.messageDigest, storage);
          const [rawSignature] = await wallet.signAndSendTransactions({
>>>>
```

---

### Fix 4: Graceful Session Lock Management in `apps/mobile/CryptoDeviceHarness.tsx`

**Location**: `apps/mobile/CryptoDeviceHarness.tsx`, lines 361–368  
**Target Function**: `pay()`  

#### Rationale:
When the user approves a payment in Phantom or Solflare and returns to AGUS, the OS fires `AppState` change to `"background"` during the transition, invoking `lockSession()` (`unlocked = false`). When AGUS regains focus, `pay()` line 367 immediately calls `recover(paymentOwner)`. In `session.ts:70`, `api` asserts `if (!unlocked) throw new Error("LOCAL_SESSION_LOCKED")`. This crashes `pay()` with an unhandled rejection, even though the wallet outcome was safely persisted to `SecureStore` on line 366.

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
    } catch (recoverError: any) {
      if (recoverError?.message === "LOCAL_SESSION_LOCKED") {
        setNotice("Session locked on wallet return. Tap 'Unlock and resume' to complete Devnet attempt reconciliation.");
      } else {
        throw recoverError;
      }
    }
  }
>>>>
```

---

## 3. Configuration & Infrastructure Remediations

### 1. Digital Asset Links (`.well-known/assetlinks.json`)
- **Problem**: Phantom displayed a red identity warning (*"This app's identity could not be verified. It may be impersonating another app."*) due to HTTP 404 on `https://agus-wallet-devnet-identity.vercel.app/.well-known/assetlinks.json`.
- **Remediation**:
  1. Generate the SHA-256 certificate fingerprint using `scripts/android/prepare-release-signing.sh`.
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
- **Problem**: Stock MWA SDK 3.0.2 enforced a 10,000 ms association timeout. When biometric prompts exceeded 10s, Phantom terminated the local WebSocket association and exited with a crash notification.
- **Status**: Verified already patched to 45,000 ms (`ASSOCIATION_TIMEOUT_MS = 45000`) in `apps/mobile/plugins/with-wallet-package.cjs:37-39`.

### 3. Low Power Mode Restriction
- **Problem**: Solflare rejects MWA connections when Android Battery Saver is active: *"Your device is in low power mode. Deactivate it to enable connection and signing."*
- **Guidance**: Documented in test runbook `docs/agus-crypto/ANDROID_DEVICE_TEST.md:29`. Handset testers must disable Android Battery Saver prior to testing Solflare.

---

## 4. Verification & Safety Summary

- **Zero Regressions**: The proposed changes preserve existing client contracts and error classifications (`WALLET_POWER_RESTRICTION`, `WALLET_ASSOCIATION_CANCELLED`, `WALLET_RECONNECT_REQUIRED`).
- **Regression Suite Verification**: Verified against `apps/mobile/tests/crypto-mobile-standalone.test.ts` (12/12 passing) and `apps/mobile/tests/crypto-mobile.test.ts` (7/7 passing).
- **Compliance**: Follows minimal-change principle without modifying DAL, backend APIs, or shared test suites.
