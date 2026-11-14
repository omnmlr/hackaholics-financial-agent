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

## Live acceptance on the release build

Application source tested: `1502d4c684648409c0d430f7b926593a30885c31`. Subsequent release commits add only repeatable acceptance scripts and evidence.

- [Security and real network observation](live/security-network.json): new operator password accepted, previous password rejected, unauthenticated financial API 401, hostile-origin mutation 403; Secure/HttpOnly/SameSite=Strict session. Every prior conversation/responsibility/invoice/account ID remains present. Mainnet execution is disabled; legacy Paystack remains fixture mode. No credentials were found in the inspected authenticated API responses.
- [Real SDK onboarding](pollar/results.json): canonical origin, same key fingerprint as runtime configuration, Pollux testnet HTTP 200. The historical 403 evidence under `docs/unified-agent/` describes the retired domain and is not the current status. No origin forging or product-level provider proxy was introduced.
- [Real Gemini/voice and reminder restoration](live/results.json): fresh `read_digital_payment_capabilities` succeeded; existing responsibility approval/state cards restored. Synthetic microphone input traversed real MediaRecorder and genuine Gemini transcription, displayed an editable transcript, and required explicit Send. This run transcribed “Abeg” as “abank”, so perfect Pidgin transcription accuracy is not claimed. Real Pidgin text understanding and the earlier genuine `prepare_responsibility` call are retained as prior acceptance evidence in the same report. No new Ada record was created. SpeechSynthesis exists but headless Chromium exposes zero playback voices; physical speaker/microphone acceptance remains unverified.
- [Live desktop/mobile navigation](live/screens.json): 1440, 390 and 320 pixels; Home, Money, AGUS, Obligations, Activity; no overflow or JavaScript errors. Settings reopens onboarding, skip persists after reload, Add account shows separate truthful choices. Receive ZEC from AGUS selects the ZEC receiving form and privacy mode without saving a fabricated live obligation.
- [Desktop Money](live/1440-money.png), [mobile Money](live/390-money.png), [mobile privacy receiving entry](live/320-zcash-receive.png), [live voice transcript](live/1440-voice-review.png).

The two existing Ada reminders were created by separate conversation/tool executions: the founder's earlier record and an earlier acceptance-test proposal. Both remain independently manageable; neither was deleted, merged or cancelled. Three-state cancellation and successful immediate UI refresh are tested with isolated pending, active and paused fixtures. Live acceptance selects **Keep reminder**, preserving founder data. Repeating the same Ada request restores the saved reminder without another model request or new record.

The older `agus2-web-preview` still reports successful deployment `e7a9a01b-b71e-45d6-93fa-1a9248e0ce47` from 13 November, unchanged by this release.

## Truthful judge demonstration

Demonstrate the black Counterpart UI, skippable onboarding, persistent Pidgin conversations, Gemini tool selection, inline human-reviewed reminders and cancellation, imported financial records distinct from live wallets, official Pollar Pollux testnet onboarding, and genuine NU7 network observations plus validated shielded ZIP 321 receiving requests/QRs. Use a receiving address actually controlled by the person demonstrating; the release does not provision one. Fixture payment confirmations are explicitly not settlement proof.

For a genuine Pollar transfer: Money → Connect with Pollar → owner email/OTP (or supported wallet authentication) → retrieve the existing wallet and genuine balances → prepare exact terms in AGUS → owner password/explicit review → official SDK signing → independent Horizon result. No owner OTP or exact recipient approval was supplied during autonomous acceptance, so this last transfer flow is not claimed as completed.

For genuine Zcash balance/receipt/send: provision a compatible authenticated Testnet wallet/viewing service and isolated native signer with current NU7 support. No safe operational wallet boundary was available; the published synthetic TypeScript sender remains disabled. Unified requests currently stop short of wallet-based receipt verification. Public block observations cannot prove hidden amounts, recipient ownership or private settlement.
