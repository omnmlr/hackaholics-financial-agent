# AGUS Crypto Devnet handset test

The Android test build opens a diagnostic screen backed by the Crypto API. It uses the existing test package `app.agus.prototype`, Devnet only, and the published test origin. The release job checks the installed package metadata, ARM64 ABI, APK v2 signature, certificate fingerprint, Digital Asset Links, and Devnet API before publishing. Each release includes the APK, `SHA256SUMS.txt` and `BUILD-IDENTITY.txt`. [Digital Asset Links statement](https://agus-wallet-devnet-identity-2o66ayctk-youngfrankcreator-7012.vercel.app/.well-known/assetlinks.json)

## Prepare the signed build

Configure the original APK test keystore in GitHub Actions secrets `AGUS_ANDROID_KEYSTORE_BASE64`, `AGUS_ANDROID_KEYSTORE_PASSWORD`, `AGUS_ANDROID_KEY_ALIAS` and `AGUS_ANDROID_KEY_PASSWORD`. Configure the repository variable `AGUS_CRYPTO_DEVICE_API_URL` with the private HTTPS origin for the Crypto deployment. The API and persistent worker use a disposable Postgres database and Devnet RPC. Set `AGUS_SOLANA_DEVNET_ENABLED=true`, `AGUS_CRYPTO_DEVNET_ROUTES=phantom,solflare`, and `AGUS_CRYPTO_MONITORING=true`. For handset acceptance set `AGUS_DEVNET_VERIFY_RPC` to a separately operated provider, such as `https://devnet.rpcpool.com` when using Solana's public Devnet RPC as primary. Invite an email test account through the existing Better Auth invitation flow. Staging access stays limited to acceptance users. Re-run the Android Devnet APK workflow on the PR branch after configuration.

The public test certificate SHA-256 is `85AD785DFF4A95D38DFA0E5799335E60D7A19266284BB0FFE062058FE7D8B7CF`. The signing job verifies this certificate and refuses to deliver an APK with a different identity.

## Install and verify on Android

1. Download `AGUS-Crypto-Devnet-arm64.apk` from the GitHub prerelease for the tested commit. Compare its SHA-256 with the published `SHA256SUMS.txt`. Open the APK in Downloads and allow installation from that app if Android prompts. An existing build signed by the same test certificate can update in place. If Android reports a conflicting package signature, stop and record the existing build identity so its local state can be preserved.
2. Record the Android version, device model and installed Phantom and Solflare versions. Disable Android Battery Saver for the Solflare test. In both wallets select Devnet and select separate, funded, disposable accounts. Leave enough test SOL for three transfers and fees.
3. Open **AGUS Android signing diagnostics**, sign in with the invited test account, and connect Phantom and Solflare separately. For each wallet, select the exact disposable address and tap **Prove ownership**. Review and confirm the ownership message in the wallet. If Android locks the AGUS session on app switch, tap **Unlock and resume** after returning. AGUS retains the proof for the same authenticated owner and submits it within its challenge lifetime.
4. Select **Use phantom**, enter the Solflare Devnet address and `0.001` SOL, then tap **Prepare Devnet review**. Compare the sender, recipient, 1,000,000 lamports, fee estimate, and Devnet label. Tap **Approve in phantom** once. If Phantom displays an identity warning, capture its text and stop before approving. Otherwise approve the exact transfer in the wallet, return to AGUS and unlock if prompted.
5. Wait for **finalized** or tap **Check existing attempt** to reconcile. Review the finalized amount, addresses, slot and fee in the AGUS receipt and open the transaction in Solana Explorer. Record the attempt ID, signature, and observed sender/recipient balance changes and fee. The sender should decrease by 1,000,000 lamports plus the verified fee. The recipient should increase by 1,000,000 lamports.
6. Repeat once from Solflare to Phantom. After those two transactions finalize, force-stop and reopen AGUS. Verify it restores the previous attempt and receipt, then explicitly prepare and approve the third transfer from Phantom to Solflare. Save the three distinct finalized signatures.

For a rejection test, decline in the external wallet and save the displayed attempt state. For a lost callback or crash, record the current attempt ID, reopen AGUS, unlock and tap **Check existing attempt**. The screen restores and reconciles that attempt. Avoid creating a new review while the current attempt is pending or unknown. The eligibility and review endpoint remain authoritative for a new transfer.

## Capture a failure

Capture the AGUS diagnostic lines, timestamp, selected wallet and the last visible wallet prompt. The lines identify association, authorization, capabilities, ownership proof and submission with a stable reason. A missing callback after submission is recoverable evidence rather than permission to send again. The device-side wallet UI and its own logs determine whether a warning came from wallet attestation, app identity or wallet behavior. MWA acceptance is determined by the actual protocol and receipt, independently of any Connected Apps list.

For a crash, use the Android bug report option in Developer options if available, or capture these commands from a computer with ADB:

```bash
adb shell pm get-app-links app.agus.prototype
adb logcat -d -t 1500 -s ReactNativeJS SolanaMobileWalletAdapterModule AndroidRuntime
```

Share the failure-time excerpt and wallet version, excluding session state, wallet payloads and payment credentials. A screenshot of the exact warning, approval screen or Android crash notice is sufficient to start triage if ADB is unavailable.

## Current evidence

- PR #46 supplied a previously signed diagnostic APK on a different commit. Its downloaded checksum matched `c09bac72fbec54840e098cd01c55dc7de3d15d6a8c722d37fcccae7101c3ac03`. [Prior diagnostic APK release](https://github.com/omnmlr/hackaholics-financial-agent/releases/tag/agus-wallet-control-phone-test-20261122)
- The first physical Solflare result explicitly identified Battery Saver. The prior Phantom result included an identity warning and force-close. Their wallet-side causes and the current binary’s handset behavior still require the device run above. [Prior handset evidence](https://github.com/omnmlr/hackaholics-financial-agent/pull/47)
- The server has independently finalized, receipted and monitored a Devnet SOL transfer sent with a disposable software signer. [Verified Devnet transaction](https://explorer.solana.com/tx/2ztFGAyjsrKmPLG84fY1jXYbZuEsaRBnVFVT9DmF4QJuBAd1GbHXaqWszd469fJSL98mBgQ78MsuJxFZo8bLidds?cluster=devnet)
- MWA 3.0.2 awaits native teardown after the wallet callback. A teardown exception can hide an already returned result. AGUS now retains a validated signature or ownership proof across that exception. A regression test exercises the signature path with one wallet submission.
