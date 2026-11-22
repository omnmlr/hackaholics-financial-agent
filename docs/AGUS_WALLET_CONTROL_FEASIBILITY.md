# AGUS Wallet Control Feasibility

**Decision — CONDITIONAL GO for a user-approved, Android-first wallet control layer.**
Solana Mobile Wallet Adapter (MWA) supports wallet-issued grants and short signing
associations. AGUS can maintain independent authorization records and select the
intended Android wallet app for each new association. A release claim that Phantom
and Solflare both work on the same device requires the physical acceptance run.
Wallets retain control of transaction consent and their approval UI. Standing
spend authority over assets in a compatible Swig account is a separate capability.

Reviewed 2026-11-22. The spike starts at `a26880a` on
`implementation/agus-counterpart-20261114`, the repository default and current
Expo foundation. The initial local snapshot `b1862ef` was web-only. The
`android_device_acceptance_apk` and Solana Core branches were also inspected.
The existing harness's original MWA path selected the first account,
reauthorized from scratch, and exposed a single wallet field. Its server-backed
Devnet route already had exact-message integrity, submission claims and acceptance
verification. This spike adds **Solana wallet control** to the same harness and
reuses existing decimal and classic SPL helpers. Expo SDK 58, React Native 0.88.1,
SecureStore and the MWA 3.0.2 web3.js bridge were already installed by the lockfile.

## PROVEN

- Automated tests selected Phantom, Solflare and then Phantom again with two
  distinct test signers, app-specific MWA routing, persisted metadata, and a
  rotated authorization token. Wallet transport and RPC responses were test
  doubles. The fixture signed each reviewed message with the matching local
  test key and produced independent receipts. Account selection checks the
  exact account across the complete authorization result.
- Automated tests exercised watch/signing deduplication, same address linked
  through two providers, cluster isolation, stale or unavailable valuation,
  wrong-account rejection, wallet decline, insufficient SOL and SPL, invalid
  mint and wrong genesis, blockhash expiry, failed execution, message
  mismatch, and lost-response recovery by reference without a repeated send.
  The tests decoded the real SOL and checked classic SPL instruction bytes
  with the exact amounts and required signer.
- A separate local-runtime smoke ran the exact prototype message bytes in
  LiteSVM. Two ephemeral senders each paid 0.001 SOL, and one sent 0.125
  units of a custom classic SPL mint to a newly created recipient ATA.
  Recipient balance changes were asserted. Local signatures, in order,
  were `5eVgyE6JxN14eTSZutaK2oJtbawWdjf6exUviEfhRKYvCyFjfaWkTUW17DXRS6SVAyjcLvj97LJpQu3PmZ1G7cYs`,
  `3V73tDLkbafgWxQ66MLDsERLV85xJxjHMVExi3ojKaEQAw5Ny1qg44HWi8M2sbNYFhQpHrTtSjF3jLG8ZkLz7QCr`,
  and `3dDuwu4P497Woe2HC6Yx1fw2druH9xxRe6HYz2HDRQdAoJEtnfMn1CsvyHtXi49B9rwWpYViT7vntPV8bAuxquEM`.
  This run used in-memory keys and a local Solana runtime.
- Live read-only calls to public Solana Devnet and mainnet succeeded for SOL
  and SPL balances. Devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`
  and mainnet USDC and USDT each returned the classic Token Program and
  six decimals. The CoinGecko
  live query returned SOL, USDC and USDT price timestamps near 05:19 UTC. Spot
  prices are estimates with a 15-minute cutoff. Mainnet labels are mint-keyed,
  with verified USDC, USDT and wrapped SOL identities. Unknown mints
  remain visible in token units. Devnet assets have no USD valuation.
  [Circle mint registry](https://developers.circle.com/stablecoins/usdc-contract-addresses) ·
  [Tether protocols](https://tether.to/en/supported-protocols/) ·
  [CoinGecko Simple Price](https://docs.coingecko.com/reference/simple-price)
- The Android ARM64 release APK assembled, passed release lint, and passed
  Android APK Signature Scheme v2 verification. Inspection of the packaged
  MWA coroutine found the routing scheme and its `Intent.setPackage`
  call. The APK includes the Hermes bundle and can be installed without
  Metro. Details and the checksum are below.
- The isolated Swig experiment executed the program bytes retrieved from
  public Devnet in LiteSVM. A 20-slot session paid 0.05 SOL within a 0.10 SOL
  cumulative cap. A further 0.06 SOL, an SPL spend without a token grant,
  a spend after session expiry, and a spend after owner revocation all failed.
  The test checked that the protected balances changed only for the approved
  payment. Public Devnet was used to read executable bytes. The test signers,
  transactions and balances existed in local memory. See the Swig section
  for the output and policy nuance.

## PARTIALLY PROVEN

- The Android app implements package-scoped launch for Phantom, Solflare and
  Backpack and stores each Devnet bearer token in SecureStore. Public-link
  metadata is keyed by network and address. Android sessions still open
  sequentially and close on return. The physical persistence of grants
  and wallet-specific user prompts are outstanding.
- The mobile flow reviews a single classic SOL or SPL payment and asks the
  selected wallet to sign and broadcast. AGUS saves the reference and exact
  reviewed message before requesting broadcast, then queries Devnet for
  finality, message equality and execution status. Recovery runs while
  foregrounded and via **Check on-chain status**. A lost wallet acknowledgement
  remains an unresolved payment until RPC evidence can settle it. An identical
  unresolved payment is blocked. A finalized transaction from the reviewed
  payer with different bytes is shown as a mismatch and needs investigation.
- The mobile app groups balances by account and mint, displays a known-price
  mainnet subtotal, and excludes stale snapshots from that subtotal.
  A failed refresh leaves the previous wallet snapshot and timestamp visible
  as stale during the current app session. Missing quotes or wallets can make
  the combined value partial. Contribution from Token-2022 extensions,
  interest-bearing tokens, LP positions, NFTs and protocol deposits needs
  separate valuation logic.
- Devnet submission covers ordinary SOL and classic SPL from the sender's
  canonical associated token account. The portfolio can include balances in
  additional token accounts that this spike cannot spend. Recipient ATA
  creation is quoted in the review and issued idempotently if needed.
  Token-2022 transfers, multisig and smart-account transfers require separate
  adapters and semantics.

## BLOCKED

- Physical Android wallet approval and Android secure-store runtime behavior
  could not be exercised here. The environment exposes no Android USB device
  or hardware virtualization. The public Devnet RPC `requestAirdrop` returned
  HTTP 410 and directed users to the official web faucet. No public Devnet
  payment signature was generated by this spike. Historical repository
  signatures are outside this evidence.
- A wallet can reject the specific MWA operation or network, require its
  HTTPS association endpoint, revoke or rotate tokens, switch the active
  account, or require app-domain attestation. The current demo origin's
  `/.well-known/assetlinks.json` returned HTTP 502 in this environment.
  The follow-up phone-test APK uses a dedicated staging origin and a unique test
  signing certificate. Google Digital Asset Links reports that they are linked.
  Wallet-specific enforcement still needs the physical acceptance run.
  [Phone-test build and attestation](AGUS_WALLET_COMPATIBILITY.md#download-and-install-the-phone-test-build)
- Standard native MWA currently covers Android. iOS needs a separately
  implemented vendor or cross-platform transport. Seeker Connect targets
  the certified device wallet and cannot select Phantom, Solflare or Backpack
  on behalf of AGUS. [MWA support table](https://docs.solanamobile.com/developers/mobile-wallet-adapter) ·
  [Seeker Connect](https://github.com/solana-mobile/seeker-connect)
- Existing externally owned Solana accounts authorize individual transactions.
  The Android wallet chooses its approval UI and may require unlock or
  account selection. The spike performs independent payments in sequence and
  does not offer an atomic cross-wallet operation.

## RECOMMENDED APPROACH

Use app/account/chain-scoped wallet grants, a deduplicated holdings registry,
and a narrow chain adapter for address validation, balances, transfer preparation
and independent settlement verification. Add one signer adapter per supported
transport. Use the official SDK for MWA and agree on a maintained native
wallet-targeting API or upstream contribution before broad deployment. Keep
wallet grants and payment attempts on device, with explicit revocation and
short-lived reviews. Use an indexed backend for portfolio enrichment and a
durable settlement ledger when multiple devices need to reconcile the same
payments. Increase availability with RPC failover and explicit freshness and
coverage. Keep user-controlled signing separate from smart-account automation.

In the spike, `WalletControl` owns local registration, authorization storage,
and journal rules. `SolanaControl` owns Devnet genesis validation, unsigned
message construction, fee and rent checks, simulation, reads and exact-message
confirmation. MWA owns wallet association and authorization. The existing
banking and legacy sign-only flows retain their own entry points.

## USER FRICTION

1. Install the supported wallets once. Unlock each wallet, choose a test
   account, select Devnet where required and fund test balances. Start AGUS.
2. In AGUS tap each wallet's **Link** button. A named Android association
   opens that wallet for the connection decision. The wallet may ask which
   account to expose. Watch-only accounts require a pasted address and
   network selection.
3. Reopen AGUS and see previously saved addresses and routes. RPC data
   refresh and wallet signing require connectivity. A saved grant can be
   revoked or stale. The panel prompts to link again when renewal fails.
4. For each payment select a wallet-account pair, enter recipient, mint if
   applicable and amount, then review. Tap **Authorize and send with wallet**.
   Android launches that wallet from AGUS. The wallet may display a sheet or
   switch to its activity, and may ask to unlock or select the account.
   Approve the specific transfer. The exact UI and return behavior require
   the vendor matrix run.
5. AGUS checks finality when it returns to the foreground and polls pending
   payments. A user can also check manually. A lost wallet response can be
   reconciled by reference. A pending or mismatched result should be
   investigated before a replacement payment.

## Swig delegated control

Swig stores authorities and policy actions in a separate program-controlled
account. A user wallet can remain the root authority that creates the account,
grants session authority and removes it. Assets intended for delegated
spending reside at the Swig wallet address. Linking an existing Phantom,
Solflare or Backpack account does not give Swig authority over the account's
ordinary SOL. There is also classic SPL delegation for a particular token
account, with its own on-chain approve/revoke flow and a single active
delegate. AGUS should evaluate these as explicit opt-in products.
[Swig protocol and source](https://github.com/anagrambuild/swig-wallet) ·
[Solana SPL spend permissions](https://solana.com/docs/payments/advanced-payments/spend-permissions)

- The program and SDK model fixed and recurring SOL/token limits,
  program-specific actions, slot-based session expiry, and authority
  management. The local test confirmed a practical cap, no ungranted SPL
  spending, expiry and revocation. The tested cap-only role allowed a
  zero-spend Memo instruction even with the vault listed as signer. A cap
  alone therefore gives no general program invocation allowlist. Before
  production, validate the chosen `programLimit` and adjacent actions
  against the exact CPI, signer, writable accounts and asset balances with
  an allow/deny matrix on the intended deployment.
  [Swig SDK permissions](https://github.com/anagrambuild/swig-ts/blob/main/packages/mcp-server/README.md) ·
  [Program permission checks](https://github.com/anagrambuild/swig-wallet/blob/main/program/src/actions/sign_v2.rs)
- Program `swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB`, ProgramData
  `Bb6gN8CtkMXf7cfXKnWysmdBg5B8EZfP5kus5TsyH5Es`, deployment slot
  `522994140`, ELF SHA-256
  `0418f037fe1c9f6c0cd9d3ee57d684f69aca2ed9b3388f5d0c45020b01cce1d9`.
  The TypeScript SDK has an Apache-2.0 package license. The protocol
  repository states AGPL-3.0 for current code. Use the published SDK and
  review the exact program revision and terms before distributing a fork.
  [Deployed Devnet program](https://explorer.solana.com/address/swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB?cluster=devnet) ·
  [SDK package](https://www.npmjs.com/package/@swig-wallet/classic) ·
  [Protocol license](https://github.com/anagrambuild/swig-wallet#license)

```sh
npm install --prefix experiments/swig-permissions --no-package-lock
npm test --prefix experiments/swig-permissions
```

The test reads Devnet program bytes, prints the executable digest, and runs
locally with LiteSVM 1.6.2 and the Swig Classic SDK 3.0.0. An optional path
to a previously saved matching ELF can be passed after `--`.

```text
within cap 4KGSBmBbdcxexnD5cJbUMYJDcyr5sKBpKqnYvHV92jHiFuAPgivfPPLYdzVAZS7jukEx4SwNnh6yXfaM2PSnm2tB
over remaining cap                         0xbc3
SPL spend without a token grant            0xbbe
expired session                            0xbc6
revoked session                            0xc
PASS: local runtime executed the deployed program with ephemeral signers
```

The signature above is from the local runtime and has no public explorer entry.

## Build and test evidence

```sh
npm ci
npm run mobile:typecheck
npm run typecheck
npm run lint
npx vitest run tests/mobile-wallet-control.test.ts tests/solana-*.test.ts
export EXPO_PUBLIC_API_URL=https://agusweb.up.railway.app
npm run mobile:export:android
```

```text
Targeted wallet and Solana suite    10 files passed, 92 tests passed
Full repository suite              99 files passed, 4 skipped
                                    1,647 tests passed, 47 skipped
Mobile and root TypeScript checks   passed
Repository ESLint                  passed
Expo native Android prebuild        passed
Expo Android Hermes export          passed, 1,099 modules, 5.5 MB bundle
Gradle assembleRelease              BUILD SUCCESSFUL in 10m 13s
Android release lint                 passed
APK signature                       verified, v2, one Android Debug signer
```

The full suite initially hit process-spawn and socket restrictions in the
default sandbox. The rerun with network and subprocess access produced the
full-suite result above. The Gradle build used a complete Temurin JDK and the
system trust store for the environment's download proxy.

Artifact `AGUS-Wallet-Control-arm64.apk`, built from the prototype source at
`5dc5af7`. The package is `app.agus.prototype` version `0.1.0`, ARM64,
minimum Android API 24, target API 36, 25,014,589 bytes.

```text
APK SHA-256
b5eed99eb0bf50f45edab34d9b56b5942cf71295e94ca02d1f1ec63087d03338
Debug signing certificate SHA-256
fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
```

For a standalone, locally signed APK, use JDK 21 and the Android SDK/NDK
requested by the generated project. In this environment those included
platform Android 37.0, build-tools 36.0.0 and 37.0.0, NDK 27.1.12297006
and CMake 3.22.1 and 3.30.5. Set `ANDROID_HOME` and `JAVA_HOME` to those installations.
Build from a clean checkout with an approved HTTPS origin for wallet identity.

```sh
cd apps/mobile
npx expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=2
adb install app/build/outputs/apk/release/app-release.apk
```

The generated release variant uses the template debug key for local
installation. Device acceptance and attestation require the right certificate
and origin. The Expo Go app cannot exercise the native patch. The **Physical-device
acceptance** section of the compatibility report gives the receipt and UX steps.
[AGUS Wallet Compatibility](AGUS_WALLET_COMPATIBILITY.md)

## NEXT STEPS

1. Complete the Phantom → Solflare → Phantom Devnet run on one ARM64 phone
   with both apps present. Require distinct finalized signatures, matching
   messages, account restoration after force-stop and a recorded prompt
   count. Repeat with a classic mint. Record Backpack separately.
2. Test MWA Digital Asset Links for the actual signing certificate and
   choose official package or endpoint targeting per wallet. Validate
   account changes, revocation and no unsafe fallback. Add explicit
   app-managed unlink, better recovery guidance and signer lifecycle controls.
3. Establish RPC and price service uptime and data coverage, token-transfer
   semantics beyond the canonical ATA, durable reconciliation and
   user-reviewed payment policy before enabling mainnet sends. Keep
   production Solana indexing credentials outside the client.
4. Run the funded Devnet Swig experiment with a user-controlled root.
   Provision a scoped session on a separately funded Swig account and
   document exact deployment, fee payer, time limits and revocation
   behavior. Verify allowed and disallowed program invocations, over-cap
   and expired actions, and a signed pre-revocation transaction submitted
   after revocation. Add signer isolation before allowing unattended use.
