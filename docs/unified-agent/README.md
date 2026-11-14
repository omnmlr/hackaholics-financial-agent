# Unified Counterpart agent

Current acceptance: https://agusweb.up.railway.app

This document preserves the earlier integration evidence. See [final release pass](../release-pass/README.md) for current Pollar origin success, Unified receiving support and deployed acceptance results.

Implementation commit: `cfdc464a02f00fb40ba8bde5fa894fab6ddd2528` on `implementation/agus-counterpart-20261114`. Earlier working checkpoint: `8b04abb70983c1ea6b32cbb4b08b56649888096d`. Only the isolated Counterpart acceptance service is updated; the older Railway services and databases are unchanged. Authentication and preview credentials are unchanged.

## Integrated behavior

Counterpart now retains the complete typed agent reply for live and saved turns. It renders the existing financial presentation components and authenticated responsibility/memory review components inline. Supported action review no longer links to the legacy `/conversation` interface. Payment plans continue to use exact review, owner re-authentication, single-use signing and independent settlement verification.

The existing `use-voice-input.ts` and `use-response-speech.ts` hooks are connected to the Counterpart composer. Microphone permission, real recording, metering, native recognition/fallback transcription, transcript editing, explicit Send, optional speech playback and cleanup are retained. Recording/transcription locks Send and programmatic submission; privacy changes, unmount and cancellation release capture. Voice never grants financial approval.

The floating AGUS control opens the same conversation implementation over the current screen; expanding it opens the full workspace with its saved conversation. No second persistent chat engine or conversation store was introduced.

## Verified real preview journeys

[Live results](live/results.json) record a genuine Gemini `prepare_responsibility` call for “abeg you fit remind me say ada dey owe me 5 usdc tomorrow”. The proposal preserved Ada, 5 USDC and 15 November in Africa/Lagos. Its exact persisted due instant is `2026-11-15T09:00:00Z`, displayed as 10:00 WAT. It was explicitly activated through the inline review and appeared in Obligations, without legacy navigation. Historical narration remains a saved proposal response; the inline card fetches the current authoritative status.

Voice used a synthetic spoken test sentence supplied through Chromium's virtual microphone, **real MediaRecorder**, the actual deployed `/api/voice` endpoint, genuine Gemini transcription (HTTP 200), transcript review and explicit Send to the actual conversation endpoint. No provider response was mocked. This verifies the fallback path in a browser without working native speech recognition; physical microphone quality and audio playback on a user's device remain device checks. The test intentionally forces that fallback rather than pretending a headless browser's speech service works.

Desktop and mobile screenshots were inspected. Saved messages and current action state restored at 390 and 320 pixels. The contextual panel left Money in place. Automated regression passed at 1440, 820, 390 and 320 pixels, with no browser errors or overflow. Existing SDK acceptance remains explicitly mocked transport; no real sponsor settlement is claimed by that test.

## Cancellation and the two Ada reminders

Obligations exposes **Cancel reminder** for `awaiting_approval`, `active` and `paused` only. A confirmation dialog identifies the objective, exact Lagos due time and short record ID. Keep/close makes no mutation. Confirm uses the existing owner-authenticated, version-checked `agent-workspace` cancellation action. The returned authoritative record updates the row immediately; errors remain visible in the dialog. Completed/cancelled records cannot be cancelled again.

The browser regression creates isolated synthetic pending, active and paused reminders, verifies Keep leaves each state unchanged, and confirms cancellation updates each individually. No Ada record is used for destructive testing.

[Origin audit](ada-origin-audit.json) found two separate saved conversations and tool executions:

- Founder request: `0c757498-e722-479a-8288-5a42f767e534`, created 05:12:49 UTC; paused at audit time.
- Integration acceptance request: `63972655-2652-4296-848c-fea789ccf4ab`, created 05:28:35 UTC; active at audit time.

The second was created by this implementation's explicit acceptance test, not by a replayed database row. Both are preserved. Rows expose creation date and short ID to make independent management clear.

Accidental retries retain their request ID for the same uncertain submission. Repeating the same normalized reminder request in the same saved conversation on the same Lagos day is blocked before a model request, with guidance to review the existing record. This guard survives history restoration. An identical request in a new chat is checked against matching saved conversations and restores its existing reminder instead of creating another. A deliberately different request for another reminder can proceed; no semantic merging or deletion was introduced.

## Pollar

Inspected latest published feature commit `b4ef35686c8c285d786b503e8ebd65d21d99975d`. Ported dual resolution of `NEXT_PUBLIC_POLLAR_API_KEY` / `NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY` (including blank fallback), dashboard `pub_testnet_` compatibility and the canonical Circle testnet issuer. Secret/mainnet key shapes remain rejected. Key shape alone never proves network or signing authority.

One ephemeral SDK client/session is reused between Money and conversation payment review; sign-out destroys it. Each view unsubscribes on unmount. Signing has an exclusive owning review, unsolicited confirmations are rejected, and each exact approval/XDR check is preserved. The SDK browser regression verifies one authentication session across views, password rejection, nonce replay rejection, one signing call and settlement remaining pending until independent network evidence. These payment results use mocked transport, not the founder's funds.

The founder supplied the publishable key securely in Railway. Runtime now reports configured on Stellar testnet with Circle issuer `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`. A real request to Pollar returned **HTTP 403 `ORIGIN_NOT_ALLOWED`** for `https://agus-counterpart-acceptance-production.up.railway.app`; see [provider evidence](pollar-real/application-contract.json). The API key value is not recorded. Add that exact HTTPS origin to Pollux's allowed origins, then perform owner email/OTP or wallet authentication in the preview. No OTP, seed or spending key should be put in chat.

Until origin authorization and owner authentication succeed, the funded wallet's identity, reported 20.05 USDC / 10,001 XLM, genuine signing and independent settlement are **not verified** here. No such balances are populated by the application. A real transfer also needs the owner's exact recipient/amount/fee review and signing; no transfer was sent by this task.

## Zcash

See [audit](zcash/AUDIT.md) and [preserved published handoff](zcash/PUBLISHED-HANDOFF.md). The published demo reports a genuine external Rust/Orchard transfer; the TypeScript service execution boundary still manufactures a transaction ID without a supplied real result. Its evidence command prints hard-coded observations. That sender was not promoted into Counterpart. An authenticated operational trusted-wallet boundary, durable exact approval and receiver evidence are still needed. Sapling testnet receiving requests remain supported; unsupported sending remains disabled. Spending/viewing keys never enter the browser or model.

## Checks and captures

Production build and TypeScript checks passed. Lint passed. Focused tests cover workspace ownership/state transitions, voice, payment contracts, Pollar environment resolution and duplicate-request behavior. Regression includes the new three-state cancellation journey.

- [Inline approved responsibility](live/1440-approved-responsibility.png)
- [Voice transcript review](live/1440-voice-review.png)
- [Contextual AGUS over Money](live/1440-contextual-agent.png)
- [Mobile restored action](live/390-restored-agent.png)
- [320px restored action](live/320-restored-agent.png)
- [Cancel confirmation](live/320-cancel-confirmation.png)
- [Independent reminder controls](live/320-independent-reminders.png)
- [Synthetic spoken input](voice-input-synthetic.flac)
- [Browser regression](regression/results.json), [accessibility](regression/accessibility.json)
- [SDK regression, mocked transport](pollar/pollar-sdk-browser.json)

The acceptance preview is single-operator authenticated. In-app reminders require the existing reminder runner for delivery; activation does not create an external notification service. Do not confuse a scheduled obligation, wallet request, provider success or published demo record with verified settlement.

For the live voice fallback script, decode the synthetic input first with `mkdir -p /tmp/agus-speech` and `ffmpeg -i docs/unified-agent/voice-input-synthetic.flac -ar 48000 -ac 1 /tmp/agus-speech/summary-48.wav`. The script reads the private ignored preview credential file and never prints it. Set `UNIFIED_RESUME=true` to reuse the existing acceptance responsibility; this avoids creating another Ada reminder. `UNIFIED_SKIP_VOICE=true` reuses prior voice evidence while checking the remaining controls without another provider request.
