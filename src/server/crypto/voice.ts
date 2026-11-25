import { z } from "zod";
import { pronounceResponse } from "../../lib/response-speech";
import { DomainError } from "../errors";
import { operationalEvent } from "../observability";
import { database, transaction } from "../sql";
import { containsWalletSecret } from "./sensitive";
import { readCryptoVoiceAudio } from "./voice-audio";

const MAX_CHARACTERS = 1000;
const ORIGIN = "https://api.elevenlabs.io";
const Transcription = z.object({
  text: z.string().trim(),
  language_code: z
    .string()
    .regex(/^[a-z]{2,3}$/i)
    .nullish()
    .catch(null),
});

function voiceConfig() {
  const enabled = process.env.AGUS_CRYPTO_VOICE_ENABLED === "true";
  const apiKey = enabled ? process.env.ELEVENLABS_API_KEY : undefined;
  const voiceId = process.env.ELEVENLABS_VOICE_ID?.trim();
  return {
    apiKey,
    voiceId: voiceId && /^[A-Za-z0-9]{10,40}$/.test(voiceId) ? voiceId : null,
    zeroRetention: process.env.ELEVENLABS_ZERO_RETENTION === "true",
  };
}

export function cryptoVoiceCapabilities() {
  const { apiKey, voiceId } = voiceConfig();
  return {
    transcription: Boolean(apiKey),
    playback: Boolean(apiKey && voiceId),
  };
}

async function reserveVoice(owner: string, mode: "stt" | "tts", units: number) {
  await transaction(async (sql) => {
    // The durable account-wide reservations bound repeated playback and failures
    // across restarts. Requests that reached a provider may have used credits.
    for (const [bucket, amount, allowance, monthly] of [
      [`voice:day:user:${owner}`, 1, 10, false],
      ["voice:day:global", 1, 30, false],
      [`voice:${mode}:month:global`, units, mode === "stt" ? 600 : 4000, true],
    ] as const) {
      const result = await sql.query(
        `INSERT INTO agus_crypto_ai_budgets(bucket,utc_day,used)
           VALUES($1,(CASE WHEN $4::boolean THEN date_trunc('month',now() AT TIME ZONE 'UTC')
                           ELSE now() AT TIME ZONE 'UTC' END)::date,$2)
         ON CONFLICT(bucket,utc_day) DO UPDATE
           SET used=agus_crypto_ai_budgets.used+EXCLUDED.used
           WHERE agus_crypto_ai_budgets.used <= $3::int-EXCLUDED.used
         RETURNING used`,
        [bucket, amount, allowance, monthly],
      );
      if (result.rows.length === 0)
        throw new DomainError("VOICE_LIMIT", 429, true);
    }
  });
}

function cancelled(signal: AbortSignal) {
  if (signal.aborted) throw new DomainError("REQUEST_CANCELLED", 499);
}

async function requestVoice(
  url: URL,
  apiKey: string,
  clientSignal: AbortSignal,
  init: RequestInit,
) {
  cancelled(clientSignal);
  const headers = new Headers(init.headers);
  headers.set("xi-api-key", apiKey);
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
      method: "POST",
      redirect: "error",
    });
  } catch {
    cancelled(clientSignal);
    throw new DomainError("VOICE_UNAVAILABLE", 503, true);
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    operationalEvent("crypto.voice_provider_failed", {
      code:
        response.status === 429
          ? "RATE_LIMITED"
          : response.status === 401 || response.status === 403
            ? "AUTH_REJECTED"
            : "UPSTREAM_ERROR",
    });
    throw new DomainError(
      response.status === 429 ? "VOICE_LIMIT" : "VOICE_UNAVAILABLE",
      response.status === 429 ? 429 : 503,
      response.status === 429 || response.status >= 500,
    );
  }
  return response;
}

export async function transcribeCryptoVoice(owner: string, request: Request) {
  const { apiKey, zeroRetention } = voiceConfig();
  if (!apiKey) throw new DomainError("FEATURE_DISABLED", 503);
  const audio = await readCryptoVoiceAudio(request);
  cancelled(request.signal);
  await reserveVoice(owner, "stt", Math.ceil(audio.durationMs / 1000));

  const body = new FormData();
  body.set(
    "file",
    new Blob([new Uint8Array(audio.data)], { type: audio.mime }),
    audio.name,
  );
  body.set("model_id", "scribe_v2");
  body.set("timestamps_granularity", "none");
  body.set("tag_audio_events", "false");
  const url = new URL("/v1/speech-to-text", ORIGIN);
  if (zeroRetention) url.searchParams.set("enable_logging", "false");
  const started = Date.now();
  const response = await requestVoice(url, apiKey, request.signal, {
    body,
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(18_000)]),
  });
  const result = Transcription.safeParse(
    await response.json().catch(() => undefined),
  );
  cancelled(request.signal);
  if (!result.success) throw new DomainError("VOICE_UNAVAILABLE", 503, true);
  if (!result.data.text) throw new DomainError("TRANSCRIPT_EMPTY", 422);
  if (result.data.text.length > MAX_CHARACTERS)
    throw new DomainError("TRANSCRIPT_TOO_LONG", 422);
  if (containsWalletSecret(result.data.text))
    throw new DomainError("SENSITIVE_CONTENT", 422);
  operationalEvent("crypto.voice_transcribed", {
    durationMs: Date.now() - started,
  });
  return {
    text: result.data.text,
    languageCode: result.data.language_code ?? null,
    durationMs: audio.durationMs,
  };
}

function spokenText(answer: string) {
  const text = pronounceResponse(answer)
    .replace(
      /\b[1-9A-HJ-NP-Za-km-z]{32,90}\b/g,
      "see the written address or signature",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_CHARACTERS) return text;
  const suffix = ". The rest is in the written response.";
  const prefix = text
    .slice(0, MAX_CHARACTERS - suffix.length)
    .replace(/\s+\S*$/, "");
  return `${prefix.replace(/[.!?,;:]$/, "")}${suffix}`;
}

export async function streamCryptoVoice(
  owner: string,
  conversationId: string,
  turnId: string,
  clientSignal: AbortSignal,
) {
  const { apiKey, voiceId, zeroRetention } = voiceConfig();
  if (!apiKey || !voiceId) throw new DomainError("FEATURE_DISABLED", 503);
  cancelled(clientSignal);
  const stored = (
    await (
      await database()
    ).query<{ text: string | null }>(
      `SELECT result->>'text' AS text FROM agus_crypto_turns
     WHERE owner=$1 AND conversation_id=$2 AND id=$3 AND result IS NOT NULL`,
      [owner, conversationId, turnId],
    )
  ).rows[0];
  if (!stored?.text) throw new DomainError("NOT_FOUND", 404);
  if (containsWalletSecret(stored.text))
    throw new DomainError("SENSITIVE_CONTENT", 422);
  const text = spokenText(stored.text);
  if (!text) throw new DomainError("NOT_FOUND", 404);
  cancelled(clientSignal);
  await reserveVoice(owner, "tts", text.length);

  const upstream = new AbortController();
  const url = new URL(`/v1/text-to-speech/${voiceId}/stream`, ORIGIN);
  url.searchParams.set("output_format", "mp3_44100_64");
  if (zeroRetention) url.searchParams.set("enable_logging", "false");
  const started = Date.now();
  const response = await requestVoice(url, apiKey, clientSignal, {
    headers: { "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: "eleven_flash_v2_5",
      voice_settings: { stability: 0.52, similarity_boost: 0.75, speed: 0.96 },
    }),
    signal: AbortSignal.any([
      clientSignal,
      upstream.signal,
      AbortSignal.timeout(45_000),
    ]),
  });
  if (
    !response.body ||
    response.headers.get("content-type")?.split(";")[0] !== "audio/mpeg"
  ) {
    upstream.abort();
    throw new DomainError("VOICE_UNAVAILABLE", 503, true);
  }
  const reader = response.body.getReader();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          operationalEvent("crypto.voice_streamed", {
            durationMs: Date.now() - started,
          });
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch {
        operationalEvent("crypto.voice_stream_interrupted", {
          durationMs: Date.now() - started,
        });
        controller.error(new Error("VOICE_STREAM_INTERRUPTED"));
      }
    },
    async cancel() {
      upstream.abort();
      await reader.cancel().catch(() => undefined);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "audio/mpeg",
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      "x-accel-buffering": "no",
      vary: "Cookie, Origin",
    },
  });
}
