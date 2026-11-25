import { DomainError } from "../errors";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DURATION_MS = 30_000;
const AAC_SAMPLE_RATES = [
  96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000,
  12_000, 11_025, 8_000, 7_350,
];

function invalidAudio(): never {
  throw new DomainError("AUDIO_INVALID", 422);
}

function validateDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) invalidAudio();
  if (durationMs > MAX_DURATION_MS)
    throw new DomainError("AUDIO_TOO_LONG", 413);
  return Math.ceil(durationMs);
}

function pcmWav(data: Buffer) {
  if (
    data.length < 44 ||
    data.toString("ascii", 0, 4) !== "RIFF" ||
    data.toString("ascii", 8, 12) !== "WAVE" ||
    data.readUInt32LE(4) !== data.length - 8
  )
    return invalidAudio();
  let format: Buffer | undefined;
  let samples: Buffer | undefined;
  for (let offset = 12; offset < data.length;) {
    if (offset + 8 > data.length) return invalidAudio();
    const type = data.toString("ascii", offset, offset + 4);
    const size = data.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    offset = end + (size & 1);
    if (offset > data.length) return invalidAudio();
    if (type === "fmt ") {
      if (format || size < 16) return invalidAudio();
      format = data.subarray(start, start + 16);
    }
    if (type === "data") {
      if (!format || samples) return invalidAudio();
      samples = data.subarray(start, end);
    }
  }
  if (!format || !samples) return invalidAudio();
  const channels = format.readUInt16LE(2);
  const rate = format.readUInt32LE(4);
  const bytesPerFrame = channels * 2;
  if (
    format.readUInt16LE(0) !== 1 ||
    format.readUInt16LE(14) !== 16 ||
    channels < 1 ||
    channels > 2 ||
    rate < 8_000 ||
    rate > 48_000 ||
    format.readUInt16LE(12) !== bytesPerFrame ||
    format.readUInt32LE(8) !== rate * bytesPerFrame ||
    samples.length % bytesPerFrame !== 0
  )
    return invalidAudio();
  const durationMs = validateDuration(
    (samples.length * 1000) / (rate * bytesPerFrame),
  );

  // Rewrite the container so optional metadata never leaves AGUS.
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  format.copy(header, 20);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return { data: Buffer.concat([header, samples]), durationMs };
}

function adtsAac(data: Buffer) {
  let frames = 0;
  let sampleRate = 0;
  let channels = 0;
  for (let offset = 0; offset < data.length;) {
    if (offset + 7 > data.length) return invalidAudio();
    const [
      sync,
      options,
      profileAndRate,
      channelAndSize,
      sizeMiddle,
      sizeEnd,
      fullness,
    ] = data.subarray(offset, offset + 7);
    const rate = AAC_SAMPLE_RATES[(profileAndRate >> 2) & 15];
    const frameChannels = ((profileAndRate & 1) << 2) | (channelAndSize >> 6);
    const frameLength =
      ((channelAndSize & 3) << 11) | (sizeMiddle << 3) | (sizeEnd >> 5);
    const headerLength = options & 1 ? 7 : 9;
    if (
      sync !== 255 ||
      (options & 246) !== 240 ||
      profileAndRate >> 6 !== 1 || // AAC-LC
      (fullness & 3) !== 0 || // one 1024-sample block per ADTS frame
      !rate ||
      rate < 8_000 ||
      rate > 48_000 ||
      frameChannels < 1 ||
      frameChannels > 2 ||
      frameLength <= headerLength ||
      offset + frameLength > data.length ||
      (sampleRate !== 0 && (rate !== sampleRate || frameChannels !== channels))
    )
      return invalidAudio();
    sampleRate = rate;
    channels = frameChannels;
    frames++;
    offset += frameLength;
  }
  const durationMs = validateDuration((frames * 1024 * 1000) / sampleRate);
  return { data, durationMs };
}

export async function readCryptoVoiceAudio(request: Request) {
  const mime = request.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (mime !== "audio/wav" && mime !== "audio/aac")
    throw new DomainError("AUDIO_FORMAT_UNSUPPORTED", 415);
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > MAX_BYTES) throw new DomainError("BODY_TOO_LARGE", 413);
  if (!request.body) return invalidAudio();

  const reader = request.body.getReader();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(12_000)]);
  const stopReading = () => void reader.cancel().catch(() => undefined);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (signal.aborted) stopReading();
  signal.addEventListener("abort", stopReading, { once: true });
  try {
    for (;;) {
      const next = await reader.read();
      if (request.signal.aborted)
        throw new DomainError("REQUEST_CANCELLED", 499);
      if (signal.aborted) throw new DomainError("VOICE_UNAVAILABLE", 503, true);
      if (next.done) break;
      bytes += next.value.length;
      if (bytes > MAX_BYTES) {
        stopReading();
        throw new DomainError("BODY_TOO_LARGE", 413);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (request.signal.aborted) throw new DomainError("REQUEST_CANCELLED", 499);
    return invalidAudio();
  } finally {
    signal.removeEventListener("abort", stopReading);
    reader.releaseLock();
  }
  const data = Buffer.concat(chunks, bytes);
  return mime === "audio/wav"
    ? { ...pcmWav(data), mime, name: "recording.wav" }
    : { ...adtsAac(data), mime, name: "recording.aac" };
}
