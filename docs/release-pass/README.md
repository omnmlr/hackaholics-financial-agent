# Final hackathon release pass — 14 November 2026

Acceptance service only: `agus-counterpart-acceptance`, https://agusweb.up.railway.app. Existing Counterpart composition retained; no old service or stored financial record replaced.

## Evidence classification

- **REAL**: official Pollar SDK application-config request from the canonical browser origin returns HTTP 200, application Pollux, Testnet, Stellar. `pollar/results.json` records sanitized request evidence and a publishable-key fingerprint. The browser sends no cross-origin Referer under the existing same-origin policy. Owner email/OTP and exact approval remain necessary to retrieve the existing funded wallet and submit a transaction. No balance or transaction success is fabricated.
- **REAL**: live public Zcash Testnet observation; modern ZIP 316 revision-0 Unified address validation and ZIP 321 receiving requests/QRs. Unified/Orchard receiving requests do not imply wallet ownership, a balance, receipt verification or settlement. No authenticated wallet/viewing/signing service is provisioned. Outgoing sender stays disabled; original simulated sender is not activated. The existing Sapling-only receiving verifier rejects Unified receipt claims.
- **TESTED WITH MOCKS**: `regression/` is an ephemeral database with explicitly fictional fixtures, including the Unified request QR. `pollar-mocked/` tests SDK signing, approval, nonce replay rejection and independent settlement guards using mocked provider/Horizon transport. Screenshots of confirmations in these directories are not transaction proof.

## Validation

Production build, typecheck and lint pass. Full suite: 1,630 passed, 47 skipped. Production HTTP smoke passes. Browser regression passes at 1440, 820, 390 and 320 pixels without horizontal overflow or JavaScript errors. Official SDK mocked regression passes. A discovered navigation bug that replayed a Home launch intent on returning to AGUS was corrected and retested.

## Zcash reference provenance

The decoder follows ZIP 316 and F4Jumble. Public reference receiver/address vectors originate from `zcash/zcash-test-vectors` commit `78321beacb0e0477e33cd002b56585a107c2708c`; Testnet re-encoding uses the unmodified upstream Python reference. No test seeds or private keys are included. Checks cover corrupt padding, receiver lengths, ordering, duplicate transparent receivers, noncanonical CompactSize and unsupported MUST-understand metadata.

`librustzcash` consensus source commit `b0e6e347eb529a0acb4f9a0912051f8c6da7cf4d` maps branch `77190ad9` to NU7, Testnet activation height 4,465,026. Public lightwalletd was observed on that branch above activation height. This proves network observation, not compatibility of an unavailable signing wallet.

Previously reported native Orchard transaction `ab7f8db0323414980c8389977587bf43c42e13765616c090dbd1e1d3cf461323` was made with separate tooling. It is not an AGUS web transaction or new release settlement proof.

Physical microphone, owner OTP, real Pollar signing, authenticated Zcash wallet-derived address/balance and web ZEC sending are not autonomously accepted. No credentials belong in release evidence.
