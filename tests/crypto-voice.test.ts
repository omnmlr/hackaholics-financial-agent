import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest";
import {
  cryptoVoiceCapabilities,
  streamCryptoVoice,
  transcribeCryptoVoice,
} from "../src/server/crypto/voice";
import { readCryptoVoiceAudio } from "../src/server/crypto/voice-audio";

const sql = vi.hoisted(() => ({ fixture: null as PGlite | null }));
vi.mock("../src/server/sql", () => ({
  database: async () => sql.fixture!,
  transaction: async (fn: Parameters<PGlite["transaction"]>[0]) =>
    sql.fixture!.transaction(fn),
}));

const owner = "first-test-owner";
const conversation = randomUUID();
const turn = randomUUID();
const spoken =
  "Transfer of 0.001 SOL finalized. Details at https://example.com/receipt";
const proxySecret = process.env.ELEVENLABS_API_KEY;

function wav(seconds = 1) {
  const dataBytes = seconds * 8000 * 2;
  const audio = Buffer.alloc(44 + dataBytes);
  audio.write("RIFF", 0);
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(8000, 24);
  audio.writeUInt32LE(16000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(dataBytes, 40);
  return audio;
}

function recording(data = wav(), mime = "audio/wav", signal?: AbortSignal) {
  return new Request(
    "http://localhost/api/v1/crypto/assistant/transcriptions",
    {
      method: "POST",
      headers: { "content-type": mime },
      body: new Uint8Array(data),
      signal,
    },
  );
}

beforeAll(async () => {
  sql.fixture = new PGlite();
  await sql.fixture.exec("CREATE TABLE agus_users (id text PRIMARY KEY)");
  await sql.fixture.exec(
    await readFile(
      new URL("../migrations/0024_crypto_assistant.sql", import.meta.url),
      "utf8",
    ),
  );
  await sql.fixture.query("INSERT INTO agus_users VALUES ($1)", [owner]);
  await sql.fixture.query(
    "INSERT INTO agus_crypto_conversations VALUES ($1,$2,$3)",
    [owner, conversation, "{}"],
  );
  await sql.fixture.query(
    "INSERT INTO agus_crypto_turns VALUES ($1,$2,$3,$4,'test',now(),$5)",
    [owner, conversation, turn, randomUUID(), JSON.stringify({ text: spoken })],
  );
}, 15000);

beforeEach(async () => {
  await sql.fixture!.query("DELETE FROM agus_crypto_ai_budgets");
  vi.stubEnv("AGUS_CRYPTO_VOICE_ENABLED", "true");
  vi.stubEnv("ELEVENLABS_API_KEY", "fixture-placeholder");
  vi.stubEnv("ELEVENLABS_VOICE_ID", "FixtureVoiceId123456");
  vi.stubEnv("ELEVENLABS_ZERO_RETENTION", "false");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
afterAll(async () => sql.fixture?.close());

it("validates bytes and sample duration before paying a provider", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    transcribeCryptoVoice(owner, recording(Buffer.from("not audio"))),
  ).rejects.toMatchObject({ code: "AUDIO_INVALID" });
  await expect(
    transcribeCryptoVoice(owner, recording(wav(31))),
  ).rejects.toMatchObject({ code: "AUDIO_TOO_LONG" });
  await expect(
    transcribeCryptoVoice(owner, recording(Buffer.alloc(2 * 1024 * 1024 + 1))),
  ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  await expect(
    transcribeCryptoVoice(owner, recording(wav(), "audio/mp4")),
  ).rejects.toMatchObject({ code: "AUDIO_FORMAT_UNSUPPORTED" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("measures AAC duration from ADTS frames and rejects truncated frames", async () => {
  const frame = Buffer.from([0xff, 0xf1, 0x60, 0x40, 0x01, 0x1f, 0xfc, 0x00]);
  await expect(
    readCryptoVoiceAudio(recording(Buffer.concat([frame, frame]), "audio/aac")),
  ).resolves.toMatchObject({ durationMs: 128, mime: "audio/aac" });
  await expect(
    readCryptoVoiceAudio(recording(frame.subarray(0, -1), "audio/aac")),
  ).rejects.toMatchObject({ code: "AUDIO_INVALID" });
});

it("sends only the validated recording and returns an editable transcript", async () => {
  const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
    expect(new Headers(init.headers).get("xi-api-key")).toBe(
      "fixture-placeholder",
    );
    expect(init.redirect).toBe("error");
    const form = init.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("file")).toBeInstanceOf(File);
    expect(Array.from(form.keys())).toEqual([
      "file",
      "model_id",
      "timestamps_granularity",
      "tag_audio_events",
    ]);
    return Response.json({
      text: "Can I send 0.001 SOL?",
      language_code: "eng",
    });
  });
  vi.stubGlobal("fetch", fetcher);
  const annotated = Buffer.concat([
    wav(),
    Buffer.from("LIST\x04\x00\x00\x00abcd"),
  ]);
  annotated.writeUInt32LE(annotated.length - 8, 4);
  await expect(
    transcribeCryptoVoice(owner, recording(annotated)),
  ).resolves.toEqual({
    text: "Can I send 0.001 SOL?",
    languageCode: "eng",
    durationMs: 1000,
  });
  const file = (fetcher.mock.calls[0][1].body as FormData).get("file") as File;
  expect(file.size).toBe(wav().length);
  expect(fetcher.mock.calls[0][0].href).toBe(
    "https://api.elevenlabs.io/v1/speech-to-text",
  );
});

it("returns discrete failures for sensitive transcripts, upstream authentication and rate limits", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ text: "-----BEGIN PRIVATE KEY-----" }),
    )
    .mockResolvedValueOnce(
      Response.json({ detail: "private provider data" }, { status: 401 }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 429 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(transcribeCryptoVoice(owner, recording())).rejects.toMatchObject(
    { code: "SENSITIVE_CONTENT", status: 422 },
  );
  await expect(transcribeCryptoVoice(owner, recording())).rejects.toMatchObject(
    { code: "VOICE_UNAVAILABLE", status: 503, retryable: false },
  );
  await expect(transcribeCryptoVoice(owner, recording())).rejects.toMatchObject(
    { code: "VOICE_LIMIT", status: 429, retryable: true },
  );
});

it("gates access, attaches quota to the caller, and rolls back failed monthly reservations", async () => {
  const fetcher = vi.fn(async () => Response.json({ text: "Morning, Agus" }));
  vi.stubGlobal("fetch", fetcher);
  vi.stubEnv("AGUS_CRYPTO_VOICE_ENABLED", "false");
  expect(cryptoVoiceCapabilities()).toEqual({
    transcription: false,
    playback: false,
  });
  await expect(transcribeCryptoVoice(owner, recording())).rejects.toMatchObject(
    { code: "FEATURE_DISABLED" },
  );
  vi.stubEnv("AGUS_CRYPTO_VOICE_ENABLED", "true");
  await sql.fixture!.query(
    "INSERT INTO agus_crypto_ai_budgets VALUES ('voice:stt:month:global',date_trunc('month',now() AT TIME ZONE 'UTC')::date,599)",
  );
  await expect(
    transcribeCryptoVoice(owner, recording(wav(2))),
  ).rejects.toMatchObject({ code: "VOICE_LIMIT" });
  expect(
    (
      await sql.fixture!.query(
        "SELECT bucket FROM agus_crypto_ai_budgets ORDER BY bucket",
      )
    ).rows,
  ).toEqual([{ bucket: "voice:stt:month:global" }]);
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    transcribeCryptoVoice(owner, recording()),
  ).resolves.toMatchObject({ text: "Morning, Agus" });
});

it("streams only the matching owner's saved reply and aborts upstream when playback stops", async () => {
  const cancel = vi.fn();
  const audio = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.of(0xff));
    },
    cancel,
  });
  const fetcher = vi.fn(async (_url: URL, opts: RequestInit) => {
    expect(JSON.parse(String(opts.body)).text).toBe(
      "Transfer of one thousandth of one Solana token finalized. Details at link in the written response",
    );
    return new Response(audio, { headers: { "content-type": "audio/mpeg" } });
  });
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  await expect(
    streamCryptoVoice("other-user", conversation, turn, signal),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    streamCryptoVoice(owner, randomUUID(), turn, signal),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(fetcher).not.toHaveBeenCalled();

  const response = await streamCryptoVoice(owner, conversation, turn, signal);
  expect(response.headers.get("content-type")).toBe("audio/mpeg");
  expect(response.headers.get("cache-control")).toBe("no-store, private");
  const reader = response.body!.getReader();
  await expect(reader.read()).resolves.toEqual({
    done: false,
    value: Uint8Array.of(0xff),
  });
  await reader.cancel();
  expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
  expect(cancel).toHaveBeenCalledOnce();
});

it("propagates a midstream provider disconnect without exposing provider details", async () => {
  const audio = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error("provider connection details"));
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(audio, { headers: { "content-type": "audio/mpeg" } }),
    ),
  );
  const response = await streamCryptoVoice(
    owner,
    conversation,
    turn,
    new AbortController().signal,
  );
  await expect(response.arrayBuffer()).rejects.toThrow(
    /^VOICE_STREAM_INTERRUPTED$/,
  );
});

it("smooths structured narration without changing amounts or the written reply", async () => {
  const formattedTurn = randomUUID();
  const written =
    "- **Transfer** — 0.001 SOL finalized at 2026-11-25T15:04:07.000Z [1].\n" +
    "- Fees · 0.000005 SOL… [2]";
  await sql.fixture!.query(
    "INSERT INTO agus_crypto_turns VALUES ($1,$2,$3,$4,'test',now(),$5)",
    [
      owner,
      conversation,
      formattedTurn,
      randomUUID(),
      JSON.stringify({ text: written }),
    ],
  );
  const provider = vi.fn(async (_url: URL, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    expect(request.model_id).toBe("eleven_flash_v2_5");
    expect(request.voice_settings.speed).toBe(1);
    expect(request.text).toBe(
      "Transfer, one thousandth of one Solana token finalized at November 25, 2026 at 3:04:07 PM UTC. Fees, five millionths of one Solana token.",
    );
    return new Response(Uint8Array.of(0xff), {
      headers: { "content-type": "audio/mpeg" },
    });
  });
  vi.stubGlobal("fetch", provider);
  const response = await streamCryptoVoice(
    owner,
    conversation,
    formattedTurn,
    new AbortController().signal,
  );
  await response.arrayBuffer();
  expect(provider).toHaveBeenCalledOnce();
  expect(
    (
      await sql.fixture!.query<{ text: string }>(
        "SELECT result->>'text' AS text FROM agus_crypto_turns WHERE id=$1",
        [formattedTurn],
      )
    ).rows[0].text,
  ).toBe(written);
});

it("cancels a microphone upload before it can reach ElevenLabs", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  controller.abort();
  await expect(
    transcribeCryptoVoice(
      owner,
      recording(wav(), "audio/wav", controller.signal),
    ),
  ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
  expect(fetcher).not.toHaveBeenCalled();
});

it.skipIf(process.env.AGUS_ELEVENLABS_LIVE_TEST !== "true")(
  "round-trips real streamed ElevenLabs speech and Android-format transcription",
  async () => {
    if (!proxySecret) throw new Error("ELEVENLABS_API_KEY_REQUIRED");
    vi.stubEnv("ELEVENLABS_API_KEY", proxySecret);
    vi.stubEnv("ELEVENLABS_VOICE_ID", "cgSgspJ2msm6clMCkdW9");
    const subscription = await fetch(
      "https://api.elevenlabs.io/v1/user/subscription",
      {
        headers: { "xi-api-key": proxySecret },
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      },
    );
    expect(subscription.status).toBe(200);
    const plan = await subscription.json();
    expect(plan.allowed_to_extend_character_limit).toBe(false);
    expect(plan.character_limit - plan.character_count).toBeGreaterThan(1000);

    const playback = await streamCryptoVoice(
      owner,
      conversation,
      turn,
      new AbortController().signal,
    );
    expect(playback.headers.get("content-type")).toBe("audio/mpeg");
    const audio = Buffer.from(await playback.arrayBuffer());
    expect(audio.length).toBeGreaterThan(4000);
    const encoded = spawnSync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "mp3",
        "-i",
        "pipe:0",
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "aac",
        "-b:a",
        "32k",
        "-f",
        "adts",
        "pipe:1",
      ],
      { input: audio, maxBuffer: 1024 * 1024, timeout: 10000 },
    );
    if (encoded.error || encoded.status !== 0)
      throw new Error("FFMPEG_AAC_REQUIRED");
    const result = await transcribeCryptoVoice(
      owner,
      recording(encoded.stdout, "audio/aac"),
    );
    expect(result.text).toMatch(
      /0\.001\b|zero point zero zero one|(?:one|1)[ -]thousandth/i,
    );
    expect(result.text).toMatch(/\bSOL(?:ana)?\b|s\. ?o\. ?l\./i);
    expect(result.text).toMatch(/finali[sz]ed/i);
    expect(result.durationMs).toBeLessThanOrEqual(30_000);
  },
  60_000,
);
