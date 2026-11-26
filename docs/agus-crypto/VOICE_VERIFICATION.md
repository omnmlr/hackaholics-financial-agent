# Crypto assistant voice verification

The Crypto assistant uses ElevenLabs Scribe v2 for an editable transcript and Flash v2.5 for spoken replies. Gemini handles the submitted turn with the same conversation, wallet scope, and financial safeguards as typed input. The playback endpoint reads visible reply text from the authenticated owner's conversation and turn before generating MP3. PLAY, mute, and stop have no transaction authority. Recorded audio and generated MP3 are transient in the API.

## Live results on November 24, 2026

The Codex HTTP proxy authenticated the ElevenLabs host-scoped secret. Subscription, model, and voice reads each returned HTTP 200. The subscription reported the Free tier with a 10,000-character allowance, 0 used in the subscription response, and overage disabled. Free use is noncommercial. Include `elevenlabs.io` in the title if publishing audio generated on the Free plan. Confirm any commercial license in the redeemed hackathon benefit before commercial use. [ElevenLabs Terms of Use](https://elevenlabs.io/terms-of-use) · [Free-plan publication terms](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)

Jessica, Sarah, and Laura are premade voices visible to the supplied account. Flash v2.5 streamed the same 184-character Devnet scenario for each audition. The example uses synthetic wallet amounts and contains no user data.

> Two wallets, one clear picture. Phantom holds 0.012 SOL, and Solflare holds 2.35 USDC. The transfer of 0.001 SOL finalized on Devnet. The next one still needs your approval in Phantom.

| Voice   | MP3 length | Time to first 512 bytes in Codex |
| ------- | ---------: | -------------------------------: |
| Jessica |    19.83 s |                           339 ms |
| Sarah   |    17.82 s |                           307 ms |
| Laura   |    14.52 s |                           448 ms |

Jessica is the provisional choice for her warm, youthful conversational delivery. Sarah offers a steadier read and Laura a quicker, more playful one. Set `ELEVENLABS_VOICE_ID` on the backend to change the selection. The three sample files accompany the implementation report. [ElevenLabs voice search API](https://elevenlabs.io/docs/api-reference/voices/search)

Scribe v2 on the original MP3 preserved `0.012 SOL`, `2.35 USDC`, and `0.001 SOL`. A real AAC-ADTS conversion returned the same amounts in words. Leave the transcript editable before submitting the turn, and require the normal amount and recipient review before an action. The integrated live test streams an owner-scoped database reply through the service, converts its MP3 to the Android recording format, then transcribes the result through the application provider adapter.

ElevenLabs returned `403 not_allowed` when the account requested Scribe zero retention. Set `ELEVENLABS_ZERO_RETENTION=true` only for an account entitled to that feature. With the current account, disclose that ElevenLabs processes the recording and tell users to keep recovery phrases, passwords, and private keys out of voice. AGUS discards its audio bytes after use and rejects detectable wallet secrets in transcripts before they reach the model or conversation. [Scribe API](https://elevenlabs.io/docs/api-reference/speech-to-text/convert)

## Operation and verification

- The backend accepts PCM16 WAV or AAC-LC ADTS, with a 2 MiB body limit and a maximum actual duration of 30 seconds. It strips optional WAV metadata before upload.
- The durable voice budget is shared across voice input and output. There are 10 daily requests per account, 30 daily across the deployment, and monthly deployment caps of 600 submitted recording seconds and 4,000 narration characters. Cap reservations survive restarts.
- The Expo SDK 58 adapter uses a foreground `RECORD_AUDIO` permission and caps Android capture at 29 seconds to allow codec padding. It requests an authenticated audio stream and downloads it to a bounded private cache file before native playback. Stop, mute, recording over playback, and a background transition abort active work. Playback and capture on a physical handset remain pending.
- For the core tests, run `npx vitest run tests/crypto-voice.test.ts`. To run the live round-trip in Codex with the host-scoped secret and `ffmpeg` installed, run `AGUS_ELEVENLABS_LIVE_TEST=true NODE_USE_ENV_PROXY=1 npx vitest run tests/crypto-voice.test.ts`. The opt-in test checks the account allowance and disabled overage first.

On November 25, updated narration removed list markers and numbered citations, normalized pauses from decoration and formatted UTC timestamps for speech. The first faster round-trip transcribed a `0.001 SOL` example as `0.01 SOL`. The next revision uses exact place-value words for small SOL and USDC amounts and expands the asset name in those phrases. The live ElevenLabs round-trip passed with “one thousandth of one Solana token,” and the test verified that the written answer remained unchanged. The deployed backend still uses the prior narration until a separate approved release.
