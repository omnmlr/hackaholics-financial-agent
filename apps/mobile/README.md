# AGUS internal Android foundation

This is a functional engineering harness, not a redesign of the existing web UI.
Bank data/payments are simulated. Solana uses the existing Devnet preparation,
simulation, review, approval and durable submission service. Genuine signing and
physical-device acceptance remain pending.

From the repository root:

```sh
npm ci --ignore-scripts
npm run mobile:typecheck
EXPO_PUBLIC_API_URL=https://agus.grindcity.app npm run start --workspace @agus/mobile
EXPO_PUBLIC_API_URL=https://agus.grindcity.app npm run mobile:export:android
```

Use an Expo development build with Android MWA support; Expo Go is not the wallet
acceptance environment. `npx expo prebuild --platform android --no-install` in
this directory generates native projects. Build using a complete JDK, SDK/NDK
and sufficient disk, or use the internal development profile in `eas.json` after
the owner approves/configures an EAS account. Never embed backend/provider keys.

Invite an account with `identity:invite`, sign in, configure TOTP privately, link
the explicit fixture provider, retrieve accounts/balances/history and inspect
notifications. Connect a supported Android Devnet wallet separately. Review the
full instruction, source/destination, amount, fee/rent and digest. Approve using
password/TOTP, sign in the wallet, unlock locally on return, and explicitly
submit the saved signed instruction. Recover saved state before considering a
replacement after any lost response. Network recovery and resume never submit.

Only opaque `agus://open/{resource}/{uuid}` notification links are recognized.
Supported resources include owned requests and participant P2P orders. Opening
one retrieves its state; it does not approve, sign, submit or refund anything.
Approval links, token query strings and arbitrary origins do not authenticate or
submit. Remote revocation is checked at the server; local biometric success is
not server authorization. Push denial/invalid tokens and absent EAS project
configuration remain visible, and real push delivery is separately unverified.

Development loopback URLs are allowed only in development builds. For a physical
device, configure a reachable approved HTTPS backend and Metro connection (or
an explicitly configured USB development setup). The bundle validation used a
non-routable placeholder URL and did not establish physical connectivity.

The current environment passed typecheck, Android bundle export and native
prebuild. A debug APK build exceeded available build storage; no installable APK
or device acceptance is included. See the platform checkpoint for evidence and
the remaining external gates.

Run `npm run mobile:build:storage` for a read-only storage/SDK report or
`npm run mobile:build:preflight` for a failing exit code when a build cannot be
attempted. The default 8 GiB free-space budget per volume is conservative, not an
exact prediction. The current environment has insufficient space and its temporary
SDK disappeared on restart. No paid EAS build was invoked. See the
[current checkpoint](../../docs/agus-2/MARKETPLACE_ESCROW_CHECKPOINT.md).
