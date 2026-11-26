# Local AGUS test-USDC escrow

This is an implemented, locally tested Anchor prototype. **It is not deployed,
audited, or accepted on Devnet.** Genuine wallet execution remains pending human
acceptance. The local verifier is simulated and cannot prove Nigerian bank
settlement.

The declared program ID `AYCkNeJSmk99TSDYq7tH7yRmAfv64vw6vA6SvT732yCi` is a
local placeholder; no private key was retained for that address. Deployment needs
an owner-controlled program address, coordinated Rust/TypeScript configuration,
a rebuild, repeated verification, and explicit wallet interaction. The API
reports `transactionPrepared: false`, `feeAndRentReviewed: false`,
`programAddressAccepted: false`, and `genuineExecutionEnabled: false`.

## Implemented invariants

- A per-order PDA binds seller, buyer, opaque digest, exact amount, canonical
  Circle Devnet test-USDC mint, buyer destination, seller refund account, verifier
  and three arbitrators. Authorities are distinct and immutable. PII stays off-chain.
- Seller-signed funding transfers the exact amount into a PDA-controlled classic
  SPL Token vault. Token-2022, other mints, substituted accounts and zero amounts
  are rejected. The Anchor dependency's `token_2022` feature supports its account
  macros; this program still accepts only the classic Token program.
- Cooperative release requires seller and the fixed verifier. Either party can
  dispute; mutual cancellation requires both parties. A disputed release/refund
  needs two distinct fixed arbitrators signing the same decision.
- Settlement checks only the chosen immutable destination and its mint/owner;
  changing or closing an unused destination cannot veto the other outcome.
- Terminal state remains to prevent replay. Settlement transfers the contracted
  amount, not unsolicited vault donations. No clock authorizes a funded refund.

## Reproduce local verification

Native Rust is pinned by `rust-toolchain.toml`; Cargo dependencies are locked.
Anchor is 0.31.1, the local bank is Solana program-test 2.3.13, and SPL Token's
actual processor executes the CPI calls. Anchor 0.32's host CPI shim did not
support native program-test; this prototype uses the compatible pinned version.

```sh
npm run test:escrow
cargo run --manifest-path escrow/Cargo.toml --locked --features bank-tests --example client-vector > /tmp/agus-client-vector.json
cmp escrow/fixtures/client-vector.json /tmp/agus-client-vector.json
```

`fixtures/client-vector.json` is emitted by Rust's Anchor instruction/account
serialization. TypeScript tests independently compare every instruction's bytes,
account metas, PDAs and the 307-byte account layout against it.

Compiled SBF verification requires the official free Anza platform tools v1.58:

```text
https://github.com/anza-xyz/platform-tools/releases/download/v1.58/platform-tools-linux-x86_64.tar.bz2
SHA256 7b82eb420b5aebd1e5590db0ae25c523eca06724d4238ae02139690535636c37
```

Verify the checksum, extract to a scratch directory, and set
`AGUS_SBF_PLATFORM_TOOLS` to its root (containing `rust/` and `llvm/`). Then:

```sh
npm run build:escrow:sbf
npm run test:escrow:sbf
```

The builder invokes the verified official compiler directly, strips the ELF and
writes ignored local build evidence. It does not install another SDK, generate
keys, sign, send, or deploy. This avoids the older Agave SDK postprocessor
installing a second toolchain into the home cache despite `--skip-tools-install`.
Use separate `CARGO_TARGET_DIR` values for native and SBF builds when needed.

The SBF bank test selects the compiled escrow ELF with no native fallback;
SPL Token runs through its native processor. Both modes use a local bank with
fictional accounts. Six native tests and four compiled SBF bank tests passed on
11 November 2026. See [the checkpoint](../docs/agus-2/MARKETPLACE_ESCROW_CHECKPOINT.md)
for the exact artifact hash and evidence. Hosted CI is configured but has not run.

## Backend boundary

`src/server/escrow/` supplies instruction templates, immutable order bindings
requiring verified party-wallet associations, and read-only finalized funding
inspection. The inspector checks signed bytes, fixed terms, canonical Devnet
genesis, finalized slot, token balance deltas, account ownership and vault
authority. It cannot submit transactions or promote the separate fixture ledger.
The marketplace's operational fixture verifier/arbitrators are database identities;
they are not the on-chain signing keys.

Production release still needs authorized fiat evidence, independent program
review, key governance, and an approved regulatory/liability model. No key or
compiled binary belongs in Git.
