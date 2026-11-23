# Existing-wallet delegation experiment

This standalone harness runs Solana Foundation Subscriptions and the SPL token programs in LiteSVM. It creates fresh local wallet signers, a synthetic mint and existing owner-controlled associated token accounts (ATAs). All transactions use the in-process ledger. The harness has no RPC client, private-key input or signing service.

The Subscriptions SBF build uses upstream release [`program-v0.5.0`](https://github.com/solana-foundation/subscriptions/releases/tag/program-v0.5.0) at commit `364a41976c33347d092902443bbec2def9227e75`, with the published [TypeScript client 0.5.0](https://registry.npmjs.org/@solana/subscriptions/0.5.0). See the [test results and AGUS verdict](../../docs/agus-crypto/research/existing-wallet-delegation-poc.md) and [architecture research PR #48](https://github.com/omnmlr/hackaholics-financial-agent/pull/48).

## Reproduce on Linux x86-64

Use Node.js 20.18 or newer, npm, Bash, Git, curl, SHA-256 and tar/bzip2. The first build downloads the approximately 507 MiB compiler archive and the locked Rust and npm dependencies. Reserve roughly 4 GiB for the extracted toolchain, cache and build. Subsequent test runs use local artifacts and can run offline.

From the repository root:

```bash
set -euo pipefail
cd experiments/existing-wallet-delegation
npm ci --ignore-scripts --no-audit

AGUS_DELEGATION_SETUP="$(mktemp -d)"
git clone --depth 1 --branch program-v0.5.0 \
  https://github.com/solana-foundation/subscriptions.git \
  "$AGUS_DELEGATION_SETUP/subscriptions"
mkdir "$AGUS_DELEGATION_SETUP/platform-tools"
curl --fail --location --show-error \
  https://github.com/anza-xyz/platform-tools/releases/download/v1.58/platform-tools-linux-x86_64.tar.bz2 \
  -o "$AGUS_DELEGATION_SETUP/platform-tools.tar.bz2"
(
  cd "$AGUS_DELEGATION_SETUP"
  printf '%s  %s\n' \
    7b82eb420b5aebd1e5590db0ae25c523eca06724d4238ae02139690535636c37 \
    platform-tools.tar.bz2 | sha256sum -c - &&
    tar -xjf platform-tools.tar.bz2 -C platform-tools
)
./build-program.sh "$AGUS_DELEGATION_SETUP/subscriptions" "$AGUS_DELEGATION_SETUP/platform-tools"
npm test
```

The archive digest comes from the [Anza platform-tools v1.58 release](https://github.com/anza-xyz/platform-tools/releases/tag/v1.58). The build script checks the exact upstream commit and compiler, uses Cargo's locked dependencies, strips the SBF binary and puts the resulting ELF and SHA-256 record in the ignored `.artifacts/` directory. The harness checks that digest before loading the binary.

A passing run reports six tests with no failures. Each case also emits JSON containing local wallet public addresses, token-account balance and authority state, expected rejection codes, signer roles, and successful local transaction IDs and compute units. Wallet keys are generated in memory for each run, so public addresses and transaction IDs will differ each time. The runtime clock is set in the fixture to make period and expiry assertions repeatable. The transaction IDs identify in-process transactions with no public explorer entries.
