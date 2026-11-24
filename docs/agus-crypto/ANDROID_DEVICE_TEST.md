# AGUS Crypto Devnet handset test

The Android test build opens a diagnostic screen backed by the Crypto API. It uses `app.agus.prototype`, Solana Devnet and the stable Vercel project alias from the Android manifest. The release job checks the package, ARM64 ABI, APK v2 signature, certificate fingerprint, Digital Asset Links and Devnet API before publishing. Each release includes the APK, `SHA256SUMS.txt` and `BUILD-IDENTITY.txt`. [Digital Asset Links statement](https://agus-wallet-devnet-identity.vercel.app/.well-known/assetlinks.json)

## Prepare the signed build

The November 22 key is retired. Generate its replacement on a trusted workstation with GnuPG, an existing recoverable encryption key, and a durable backup directory outside the repository. With GitHub CLI authenticated as a repository administrator, run:

```bash
bash scripts/android/prepare-release-signing.sh /durable/path/agus-signing.tar.gpg GPG_RECIPIENT_FINGERPRINT
```

The script creates a 4096-bit RSA PKCS#12 signer, verifies an encrypted backup by restoring it, and installs the four repository secrets and the public `AGUS_ANDROID_CERT_SHA256` variable. A retry with the same backup reuses the same key. Retain a separate recoverable encrypted copy and the decryption key in the owner’s approved storage. Share the public fingerprint for updating the Vercel statement. [Repository Actions settings](https://github.com/omnmlr/hackaholics-financial-agent/settings/secrets/actions)

| Repository secret | Value from the replacement signing backup |
| --- | --- |
| `AGUS_ANDROID_KEYSTORE_BASE64` | Base64 encoding of the replacement PKCS#12 file |
| `AGUS_ANDROID_KEYSTORE_PASSWORD` | Password that opens that keystore |
| `AGUS_ANDROID_KEY_ALIAS` | Alias of the private key with the published certificate |
| `AGUS_ANDROID_KEY_PASSWORD` | Password used to access that private key entry |

Under **Variables**, choose **New repository variable** and set `AGUS_CRYPTO_DEVICE_API_URL` to the HTTPS origin of the private Devnet Crypto API. The service must pass `/api/v1/ready` and serve the Crypto handoff contract at `/api/v1/openapi`. The earlier APK’s API host and the Digital Asset Links site both returned HTTP 404 on those endpoints. [Repository Actions variables](https://github.com/omnmlr/hackaholics-financial-agent/settings/variables/actions)

The stable Vercel alias must serve the new fingerprint for `app.agus.prototype` in `/.well-known/assetlinks.json`. The current statement can retain the old public fingerprint while the old binary is still in use. Re-run all jobs in the Android workflow after the new statement and API are available. The run summary reports which input names are available. [Devnet API deployment](DEVNET_DEPLOYMENT.md)

## Install and verify on Android

1. Download `AGUS-Crypto-Devnet-arm64.apk` from the tested GitHub prerelease and compare its SHA-256 with `SHA256SUMS.txt`. Before replacing the November 22 AGUS APK, save any attempt IDs, receipts, signatures and screenshots you need. The new signer requires a clean AGUS install when Android rejects the update. Uninstall only AGUS, then open the new APK from Downloads and allow installation if prompted. Keep Phantom and Solflare installed with their existing accounts.
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

- PR #46 supplied a previously signed local diagnostic APK on a different commit. The delivery workflow checked and uploaded the signed file from its artifact branch. Its downloaded checksum matched `c09bac72fbec54840e098cd01c55dc7de3d15d6a8c722d37fcccae7101c3ac03`. The accessible local debug stores have a different certificate. [November 22 delivery job](https://github.com/omnmlr/hackaholics-financial-agent/actions/runs/45001336325) · [Prior diagnostic APK release](https://github.com/omnmlr/hackaholics-financial-agent/releases/tag/agus-wallet-control-phone-test-20261122)
- The first physical Solflare result explicitly identified Battery Saver. The prior Phantom result included an identity warning and force-close. Their wallet-side causes and the current binary’s handset behavior still require the device run above. [Prior handset evidence](https://github.com/omnmlr/hackaholics-financial-agent/pull/47)
- The server has independently finalized, receipted and monitored a Devnet SOL transfer sent with a disposable software signer. [Verified Devnet transaction](https://explorer.solana.com/tx/2ztFGAyjsrKmPLG84fY1jXYbZuEsaRBnVFVT9DmF4QJuBAd1GbHXaqWszd469fJSL98mBgQ78MsuJxFZo8bLidds?cluster=devnet)
- MWA 3.0.2 awaits native teardown after the wallet callback. A teardown exception can hide an already returned result. AGUS now retains a validated signature or ownership proof across that exception. A regression test exercises the signature path with one wallet submission.
