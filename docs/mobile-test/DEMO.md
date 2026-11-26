# Reproduce the demonstration

Use a dedicated Android AVD or disposable handset with a stock test profile. Android Studio should provide API 35 SDK/build tools and platform-tools. Node 24, JDK 21, curl, zip, unzip, sha256sum and jq are used below. Android API 33+ can run the fixture. The stock AGUS Crypto signed release requires ARM64 support. This flow needs no model credential, authenticated account or real funds.

## Local commands

Install locked dependencies and obtain the fixture assets. On Linux x86-64, use Agave v4.4.1 as below. On macOS or ARM Linux use the corresponding v4.4.1 archive and put its `solana-test-validator` on PATH.

```bash
npm ci --no-audit --no-fund
export AGUS_LAB="$(mktemp -d)"
bash packages/mobile-test/lab/build-android.sh "$AGUS_LAB"
curl -fsSL 'https://github.com/solana-mobile/mobile-wallet-adapter/releases/download/%40solana-mobile/wallet-adapter-mobile%403.0.1/fakewallet-v1-debug.apk' -o "$AGUS_LAB/wallet.apk"
curl -fsSL 'https://github.com/anza-xyz/agave/releases/download/v4.4.1/solana-release-x86_64-unknown-linux-gnu.tar.bz2' -o "$AGUS_LAB/agave.tar.bz2"
(cd "$AGUS_LAB" && printf '5b0f0fc7e4eedace05f6455de00aa1f2f3d1642068f1e8d50760ba49112c3941  agave.tar.bz2\n' | sha256sum --check)
tar -xjf "$AGUS_LAB/agave.tar.bz2" -C "$AGUS_LAB"
"$AGUS_LAB/solana-release/bin/solana-test-validator" --ledger "$AGUS_LAB/ledger" --bind-address 127.0.0.1 --rpc-port 8899 --faucet-per-request-sol-cap 1 --quiet > "$AGUS_LAB/validator.log" 2>&1 &
```

When the validator is ready, export its genesis and start the fixture helper. Launch the dedicated AVD in Android Studio or attach a dedicated USB test handset. Replace the sample serial with the one shown by `adb devices -l`. A hardware-accelerated emulator is the expected local and CI path.

```bash
export AGUS_TEST_LOCAL_GENESIS="$(curl -fsS http://127.0.0.1:8899 -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}' | jq -er .result)"
node --import tsx packages/mobile-test/lab/prepare.ts > "$AGUS_LAB/fixture.log" 2>&1 &
adb devices -l
export AGUS_SERIAL=emulator-5554
adb -s "$AGUS_SERIAL" reverse tcp:8898 tcp:8898
adb -s "$AGUS_SERIAL" reverse tcp:8899 tcp:8899
export AGUS_TEST_CONFIG="$AGUS_LAB/config.json" AGUS_TEST_EVIDENCE="$AGUS_LAB/evidence"
node --import tsx packages/mobile-test/lab/configure.ts "$AGUS_TEST_CONFIG" "$AGUS_SERIAL" "$AGUS_LAB/agus-mwa-lab.apk" "$AGUS_LAB/wallet.apk"
node --import tsx packages/mobile-test/src/cli.ts devices
node --import tsx packages/mobile-test/src/cli.ts run wallet-false-success
node --import tsx packages/mobile-test/src/cli.ts run wallet-transfer | tee "$AGUS_LAB/success.json"
node --import tsx packages/mobile-test/src/cli.ts run wallet-transfer | tee "$AGUS_LAB/rerun.json"
node --import tsx packages/mobile-test/lab/settlement.ts "$AGUS_LAB/job" "$(jq -er .runId "$AGUS_LAB/rerun.json")"
node --import tsx packages/mobile-test/lab/settlement.ts "$AGUS_LAB/job" "$(jq -er .runId "$AGUS_LAB/rerun.json")"
```

Check the first command gives exit 1 with `FINALITY_TIMEOUT` and a returned signature. In that scenario the Fake Wallet explicitly takes its “Simulate submitted” path. The transfer scenario must produce receipt and screenshot artifacts on each attempt. The second settlement invocation must return the same signature. For the rejection path, run `wallet-decline` to check for the `DECLINED` diagnosis. Avoid a shell configured to exit on the expected non-zero result without first capturing it.

For the original application, download its pinned `1b56459d1875` release or provide an agreed candidate APK. Verify the release checksum and certificate before use. Append the absolute APK path to the `configure.ts` command and run `agus-crypto-launch`. The target’s real wallet journey additionally requires the Devnet host, funded disposable Phantom/Solflare accounts and a tester email or Google identity. [AGUS signed release](https://github.com/omnmlr/hackaholics-financial-agent/releases/tag/agus-crypto-devnet-1b56459d1875) · [Existing handset procedure](../agus-crypto/ANDROID_DEVICE_TEST.md)

## MCP registration

Use Node 24 and the working tree's locked dependencies. Set the same absolute configuration and evidence paths in the client. The server connects through local stdio. Register it in Codex from the repository root.

```bash
codex mcp add agus-mobile-test --env "AGUS_TEST_CONFIG=$AGUS_TEST_CONFIG" --env "AGUS_TEST_EVIDENCE=$AGUS_TEST_EVIDENCE" -- \
  node --import "$PWD/node_modules/tsx/dist/loader.mjs" "$PWD/packages/mobile-test/src/cli.ts" mcp
```

Equivalent stdio settings for Claude Code, Gemini CLI, OpenClaw deployments with an MCP bridge, or other clients use the same `command`, `args` and `env`. The tools list approved scenarios, start one, and poll its report. Ask the client to report a callback and a chain receipt separately. The client can help diagnose failures, while pass/fail is set by the runner.

If the runner stops unexpectedly while holding a device, stop all related client processes, check the local lock owner PID and read the last report. Independently look up any recorded signature. Remove the stale `agus-test-<uid>-<serial-hash>.lock` directory under the host temp directory only after confirming the owner is gone and preserving its `owner.json`. Stop and inspect instead of rerunning an unresolved payment.

## Demo

1. Open the historical AGUS diagnostic target where its APK and Android mode match. Show the evidence label and the wallet scenario selected by the agent.
2. Show a Fake Wallet “submitted” callback with no finalized chain effect. Point to the failure code and the responsible boundary.
3. Rerun with Localnet broadcast. Show the APK/run digest, callback signature, fee and finalized recipient delta in the same report.
4. Show the local provider job quote and saved finalized receipt. Reopen the job to show it reconciles a single payment.
5. Describe which cases still need an attended Seeker. A generic emulator run, mock signing and separate Devnet reads have their own evidence labels.

## Evidence available

- [Historical Devnet transaction recheck](evidence/devnet-recheck.json) returned exit 0. The public RPC confirmed the pre-existing 0.001 SOL transfer, exact payer and recipient, 5,000-lamport fee, and finalized slot 525464932. No new Devnet transfer was broadcast for this recheck. [Public explorer](https://explorer.solana.com/tx/2ztFGAyjsrKmPLG84fY1jXYbZuEsaRBnVFVT9DmF4QJuBAd1GbHXaqWszd469fJSL98mBgQ78MsuJxFZo8bLidds?cluster=devnet)
- [Local settlement](evidence/local-settlement.json) returned exit 0 on reconciliation with the original saved signature. It finalized 2.5 units of a six-decimal fixture SPL token on Agave v4.4.1 at slot 717. The first attempt failed before a payment was prepared due to a commitment mismatch. The second payment was submitted once and eventually finalized after the software emulator shared the host’s CPU. The journal kept its signature through timeout and verified it on the next invocation.
- The signed AGUS APK matched its published SHA-256, has package `app.agus.prototype` and ARM64 native libraries, and its signing certificate matched the public Android Asset Links declaration. Android SDK packaging tools compiled and verified the separate lab fixture. [Signed release](https://github.com/omnmlr/hackaholics-financial-agent/releases/tag/agus-crypto-devnet-1b56459d1875) · [Asset Links](https://agus-wallet-devnet-identity.vercel.app/.well-known/assetlinks.json)
- [Circle test-USDC mint recheck](evidence/devnet-mint.json) returned exit 0. Finalized Devnet account data validated the initialized SPL token mint and its six decimals. The settlement demonstration uses its separately identified Localnet mint.
- The local cloud has two CPU units and no KVM. Google's documented TCG flag started both API 35 guests and the official Solana Mobile CLI 0.6.0 found them. The initial early AOSP install failed before Android completed startup. Phone Harness 0.3.3 found ADB but its doctor timed out on the paused Google guest. The free GitHub-hosted KVM job is the reproducible accelerated option.
