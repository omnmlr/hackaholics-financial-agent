# AGUS Crypto Android integration · API contract 1.1.0

Chisom can use the generated TypeScript client and the fixture transport while the staged HTTPS origin is being verified. The existing `/api/v1/crypto` routes and JSON turn body remain compatible. The OpenAPI document adds image uploads, voice transcription, streamed playback, turn recovery and citations. [OpenAPI](../../packages/contracts/openapi.json) · [Generated client](../../packages/api-client/src/generated.ts) · [Android device procedure](ANDROID_DEVICE_TEST.md)

## Session, scope and capabilities

Use the existing Better Auth session transport for every private request. Android sends the `agus://` origin using the same authenticated transport as wallet and portfolio calls. Keep one session and one `CryptoScope` throughout a conversation, including its cluster and selected wallet IDs. When the user changes scope, start a new conversation. Fetch `/api/v1/crypto/capabilities` for the selected cluster. Treat `false` or an absent optional feature as unavailable. Assistant image, research, transcription and playback have separate capability flags. Financial action availability also depends on the approved operations for the selected wallet route. [Mobile session adapter](../../apps/mobile/src/session.ts) · [Runtime schemas](../../packages/contracts/src/crypto.ts)

## One conversation across text, voice and images

| Request | Client behavior |
| --- | --- |
| `POST /assistant/transcriptions` | Capture a short recording after microphone permission and explicit user action. Upload raw audio and let the user confirm or edit the transcript before sending it as text in a conversation turn. |
| `POST /assistant/turns` | Send JSON for a text or transcript turn. Choose multipart to send the question and one attachment together. Keep the `clientTurnId` and `Idempotency-Key` for this submission. |
| `GET /assistant/turns/{clientTurnId}` | Recover the same turn after timeout, disconnect or app resume. Use the returned `conversationId` for follow-ups on the same scope. |
| `GET /assistant/conversations/{id}` | Restore recent assistant turns and any reported processing state. The server response contains answers and input metadata. Keep any local transcript or typed question under the app's existing private session and retention rules. |
| `POST /assistant/conversations/{id}/turns/{turnId}/audio` | Request MP3 for an owned completed turn. The server chooses the assistant text from that turn. The caller sends an empty body. |

All paths in the table are relative to `/api/v1/crypto`. Set `reportingTimeZone` to the user's IANA time zone. Use `inputMode: "voice"` when the question came from the reviewed transcription and `"text"` for typed input. An image turn uses either mode. Ask a visible question such as “What does this screenshot show?” when the user sends an image without accompanying text. A later typed turn sends the same `conversationId` without re-uploading the image.

`processing` means the user can wait or continue through the latest status. Once `completed`, render `answer.text`, then the structured evidence and any citations. `interrupted` allows the user to check the conversation before explicitly starting a fresh turn. For a network retry of the same turn, keep the original input and IDs. A new or changed question needs new IDs. Keep local capture, transcription, assistant processing, audio playback and interruption accessible as distinct states. Use the written answer whenever audio fails or the user mutes playback.

### Media client examples

The examples use `api` from `createApiClient` with the authenticated transport. Use `npm run contracts:generate` to regenerate the client and OpenAPI. Create a separate `AbortController` for each network operation. A media file should have the actual MIME type and contain the selected or captured bytes.

The mobile package also provides `useCryptoVoice(cryptoVoiceTransport)` for the existing Android conversation. Connect its `startRecording`, `stopAndTranscribe`, `playReply`, `stop` and `setMuted` calls to the composer's controls. Use its state and recording duration to display accessible progress. The hook returns the transcript to the composer for review and drains the authenticated MP3 stream into private cache before Expo Audio plays it. Test the playback and cancellation latency on the signed build. [Android voice hook](../../apps/mobile/src/crypto-voice.ts) · [Authenticated voice transport](../../apps/mobile/src/session.ts)

```ts
const transcription = await api.POST("/api/v1/crypto/assistant/transcriptions", {
  headers: { "Content-Type": "audio/aac" },
  body: recordingBlob,
  bodySerializer: (recording) => recording,
  signal: transcriptionController.signal,
});
```

Transcription accepts AAC-LC with ADTS framing (`audio/aac`) or signed 16-bit PCM WAV (`audio/wav`), mono or stereo at up to 48 kHz. Cap capture at 30 seconds and 2 MiB. If the Android recording library supports ADTS directly, use its `aac_adts` output format with the `aac` encoder. Check the actual encoded file and MIME type on a handset before delivery. Allow typed input when permission is declined, transcription is unavailable or the user stops capture.

```ts
const answer = await api.POST("/api/v1/crypto/assistant/turns", {
  params: { header: { "Idempotency-Key": turnKey } },
  body: { turn: JSON.stringify(ask), image: imageBlob },
  bodySerializer: (payload) => {
    if (!("image" in payload)) throw new Error("Expected an image turn");
    const form = new FormData();
    form.append("turn", payload.turn);
    form.append("image", payload.image, "attachment");
    return form;
  },
  signal: turnController.signal,
});
```

For a JSON turn, pass `body: ask` and omit `bodySerializer`. For multipart, let the request implementation create the `Content-Type` boundary. Image formats are PNG, JPEG and WebP, up to 5 MiB, single-frame and within 16 megapixels. Before capture or upload, tell the user that AGUS analyzes the image with Gemini and ask them to remove seed phrases, private keys and recovery credentials. Keep image files ephemeral and out of app logs and analytics. Annotate `answer.image` as an observation of the upload. A visible QR code, amount or signature becomes a candidate for user review or a verified read.

```ts
if (answer.error || !answer.data) throw new Error("Assistant turn unavailable");
const audio = await api.POST(
  "/api/v1/crypto/assistant/conversations/{id}/turns/{turnId}/audio",
  {
    params: { path: { id: answer.data.conversationId, turnId: answer.data.turnId } },
    parseAs: "stream",
    signal: playbackController.signal,
  },
);
```

Feed the `audio/mpeg` stream into a playback adapter that can append data as it arrives. Validate actual chunk playback on Android because some transports buffer responses. For a platform without streaming playback, use the same endpoint with `parseAs: "arrayBuffer"`, play from a temporary local file and delete it. Stop the player and cancel the stream when the user taps Stop, starts speaking or leaves the conversation. Mute should suppress playback until the user re-enables it. Never log response bytes, session cookies or provider credentials.

Tell the user that ElevenLabs processes submitted voice recordings and spoken replies. AGUS discards raw recordings and generated playback bytes. ElevenLabs' free tier applies provider retention. Users should keep passwords, private keys and recovery phrases out of recordings. The transcript remains editable before the user sends it to Gemini.

### Evidence and actions

- Render portfolio, activity, receipts and coverage from their structured response fields. Show the network and source timestamps, and surface partial, stale or unavailable coverage near the affected evidence. Render atom counts using the given decimal scale.
- For public research, display each citation's title and HTTPS URL. Show `publishedAt` when present and `retrievedAt` as the observation date. Keep citations attached to the response that used them. An image observation and a public citation both have different provenance from finalized wallet events.
- A `draft_suggestion` can lead to the existing review flow. The review displays the exact amount, recipient, wallet, network and estimated fees. Call `reviews/{id}/begin` only after the user accepts the immutable review digest and revision. Request `attempts/{id}/handoff` once and require explicit approval in the selected wallet. Keep the same attempt ID across app switching or process restart. Read the receipt after the server reports finalization. The same flow applies to every modality.
- Preserve the financial endpoints for portfolio reads, transfers and receipt recovery when assistant features are unavailable. Respect capability flags for swaps, Pocket and Mainnet execution.

### Failures and fallback

| API response | User-facing handling |
| --- | --- |
| `SESSION_REQUIRED` | Restore the session and re-open the owned conversation. |
| `ATTEMPT_IN_PROGRESS`, `AI_LIMIT` | Recover the pending turn or show a calm rate-limit state. Preserve the current text and attachment while the composer is open. |
| `VOICE_LIMIT`, `VOICE_UNAVAILABLE`, `FEATURE_DISABLED` | Keep text available and offer another explicit recording or playback attempt when the provider is available. |
| `AUDIO_FORMAT_UNSUPPORTED`, `AUDIO_INVALID`, `AUDIO_TOO_LONG`, `BODY_TOO_LARGE`, `TRANSCRIPT_EMPTY`, `TRANSCRIPT_TOO_LONG` | Keep typing available and offer re-recording with the supported format and duration. |
| `INVALID_IMAGE`, `IMAGE_LIMIT`, `IMAGE_SCREENING_UNAVAILABLE` | Let the user keep the question and replace the attachment or continue in text. |
| `SENSITIVE_CONTENT` | Ask the user to remove credentials and try again. Keep the rejected content out of diagnostics. |
| `REQUEST_CANCELLED` | Return to the editor or written answer and stop media playback. |
| `NOT_FOUND` | Recover using the current session, conversation and client turn IDs. |

Display safe explanations for errors and keep the correlation ID available for debugging. A `degraded` answer can include useful wallet evidence. Keep that evidence visible while communicating the unavailable capability.

The native hook can also report `MICROPHONE_PERMISSION_DENIED`, `VOICE_RECORDING_REQUIRED`, `VOICE_RECORDING_UNAVAILABLE` or `VOICE_AUDIO_TOO_LARGE`. Keep typed input and written evidence usable in these states.

## Fixture integration

Use `createCryptoFixtureTransport("multimodal_assistant")` as the second argument to `createApiClient`. The fixture returns a representative transcription, a screenshot observation with fixture activity, typed follow-ups, a fee-documentation citation and a short synthesized playback chime. `cryptoAssistantFixtureIds` provides known `processing` and `interrupted` client turn IDs. Label fixture content as fixture data and exclude this transport from release builds. Continue using the prior wallet fixtures for lost callback, decline, stale coverage and alerts. Actual media decoding, provider authentication and handset execution require the live API and device checks. [Fixture transport](../../packages/api-client/fixtures/crypto.ts) · [Contract regression](../../tests/crypto-contract.test.ts)
