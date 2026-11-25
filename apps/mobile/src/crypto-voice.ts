import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import {
  AudioQuality,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from "expo-audio";
import { randomUUID } from "expo-crypto";
import { File, FileMode, Paths } from "expo-file-system";
import type { components } from "@agus/api-client";

export type CryptoVoiceTransport = (
  path: `/api/v1/crypto/assistant/${string}`,
  init: RequestInit,
) => Promise<Response>;

const RECORDING: RecordingOptions = {
  directory: "cache",
  extension: ".aac",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  android: { outputFormat: "aac_adts", audioEncoder: "aac" },
  ios: { audioQuality: AudioQuality.MEDIUM },
  web: {},
};
const MAX_BYTES = 2 * 1024 * 1024;

type VoiceState =
  | "idle"
  | "requesting_permission"
  | "recording"
  | "transcribing"
  | "downloading_audio"
  | "playing";
type VoiceOperation = {
  controller: AbortController;
  state: Exclude<VoiceState, "idle">;
  file?: File;
};

function remove(file?: File) {
  try {
    if (file?.exists) file.delete();
  } catch {
    // Files live only in the private cache and may already have been removed.
  }
}

function errorCode(error: unknown, fallback: string) {
  return new Error(
    error instanceof Error && /^[A-Z_]{1,80}$/.test(error.message)
      ? error.message
      : fallback,
  );
}

async function requireOk(response: Response) {
  if (response.ok) return;
  const result = await response.json().catch(() => null);
  throw errorCode(new Error(result?.error?.code), "VOICE_UNAVAILABLE");
}

async function saveAudio(response: Response, file: File, signal: AbortSignal) {
  const body = response.body;
  if (
    !body ||
    response.headers.get("content-type")?.split(";")[0] !== "audio/mpeg"
  )
    throw new Error("VOICE_UNAVAILABLE");
  file.create();
  const handle = file.open(FileMode.WriteOnly);
  const reader = body.getReader();
  let bytes = 0;
  try {
    while (!signal.aborted) {
      const item = await reader.read();
      if (item.done) break;
      if (signal.aborted) return;
      bytes += item.value.length;
      if (bytes > MAX_BYTES) throw new Error("VOICE_AUDIO_TOO_LARGE");
      await handle.writeBytes(item.value);
    }
    if (bytes === 0 && !signal.aborted) throw new Error("VOICE_UNAVAILABLE");
  } finally {
    handle.close();
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Expo Android audio for the existing assistant conversation. Text submission stays with its composer. */
export function useCryptoVoice(transport: CryptoVoiceTransport) {
  const recorder = useAudioRecorder(RECORDING);
  const recordingStatus = useAudioRecorderState(recorder, 250);
  const player = useAudioPlayer();
  const playbackStatus = useAudioPlayerStatus(player);
  const active = useRef<VoiceOperation | null>(null);
  const nativeRecording = useRef<Promise<void>>(Promise.resolve());
  const mutedRef = useRef(false);
  const mounted = useRef(true);
  const [state, setState] = useState<VoiceState>("idle");
  const [muted, setMutedState] = useState(false);

  const queueRecorder = useCallback((work: () => Promise<void>) => {
    const pending = nativeRecording.current.then(work);
    nativeRecording.current = pending.catch(() => undefined);
    return pending;
  }, []);

  const finish = useCallback((op: VoiceOperation) => {
    remove(op.file);
    if (active.current === op) {
      active.current = null;
      if (mounted.current) setState("idle");
    }
  }, []);

  const stop = useCallback(async () => {
    const op = active.current;
    if (!op || op.controller.signal.aborted) return;
    op.controller.abort();
    try {
      if (op.state === "playing") {
        player.pause();
        player.replace(null);
      } else if (
        op.state === "recording" ||
        op.state === "requesting_permission"
      ) {
        await queueRecorder(async () => {
          if (recorder.isRecording) await recorder.stop();
          await setAudioModeAsync({ allowsRecording: false });
        });
      }
    } catch {
      // An OS interruption or component disposal can release the audio session first.
    } finally {
      finish(op);
    }
  }, [finish, player, queueRecorder, recorder]);

  useEffect(() => {
    mounted.current = true;
    const appState = AppState.addEventListener("change", (next) => {
      if (
        next === "background" &&
        active.current?.state !== "requesting_permission"
      )
        void stop();
    });
    return () => {
      mounted.current = false;
      appState.remove();
      void stop();
    };
  }, [stop]);

  useEffect(() => {
    if (
      (playbackStatus.didJustFinish || playbackStatus.error) &&
      active.current?.state === "playing"
    )
      void stop();
  }, [playbackStatus.didJustFinish, playbackStatus.error, stop]);

  async function startRecording() {
    if (Platform.OS !== "android")
      throw new Error("VOICE_RECORDING_UNAVAILABLE");
    if (
      ["requesting_permission", "recording", "transcribing"].includes(
        active.current?.state ?? "",
      )
    )
      return;
    await stop();
    if (!mounted.current || active.current) return;
    const op = {
      controller: new AbortController(),
      state: "requesting_permission",
    } as VoiceOperation;
    const signal = op.controller.signal;
    active.current = op;
    setState(op.state);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (signal.aborted) return;
      if (!permission.granted) throw new Error("MICROPHONE_PERMISSION_DENIED");
      await queueRecorder(async () => {
        if (signal.aborted) return;
        await setAudioModeAsync({
          allowsRecording: true,
          shouldPlayInBackground: false,
          allowsBackgroundRecording: false,
        });
        if (signal.aborted) return;
        await recorder.prepareToRecordAsync();
        if (recorder.uri) op.file = new File(recorder.uri);
        if (signal.aborted) {
          await recorder.stop().catch(() => undefined);
          return;
        }
        recorder.record({ forDuration: 29 });
        op.state = "recording";
        setState(op.state);
      });
    } catch (error) {
      if (signal.aborted) return;
      finish(op);
      throw errorCode(error, "VOICE_RECORDING_UNAVAILABLE");
    }
  }

  async function stopAndTranscribe(): Promise<
    components["schemas"]["CryptoTranscription"] | null
  > {
    const op = active.current;
    if (!op || op.state !== "recording")
      throw new Error("VOICE_RECORDING_REQUIRED");
    const signal = op.controller.signal;
    op.state = "transcribing";
    setState(op.state);
    const timeout = setTimeout(() => op.controller.abort("timeout"), 35_000);
    try {
      await queueRecorder(async () => {
        if (recorder.isRecording) await recorder.stop();
        if (!op.file && recorder.uri) op.file = new File(recorder.uri);
        await setAudioModeAsync({ allowsRecording: false });
      });
      if (signal.aborted) return null;
      if (!op.file?.exists || !op.file.size)
        throw new Error("TRANSCRIPT_EMPTY");
      if (op.file.size > MAX_BYTES) throw new Error("BODY_TOO_LARGE");
      const body = await op.file.bytes();
      if (signal.aborted) return null;
      const response = await transport(
        "/api/v1/crypto/assistant/transcriptions",
        {
          method: "POST",
          headers: { "content-type": "audio/aac" },
          body,
          signal,
        },
      );
      await requireOk(response);
      const result = await response.json();
      if (
        typeof result?.text !== "string" ||
        !result.text.trim() ||
        typeof result.durationMs !== "number" ||
        (result.languageCode !== null &&
          typeof result.languageCode !== "string")
      )
        throw new Error("VOICE_UNAVAILABLE");
      return signal.aborted ? null : result;
    } catch (error) {
      if (signal.reason === "timeout") throw new Error("VOICE_UNAVAILABLE");
      if (signal.aborted) return null;
      throw errorCode(error, "VOICE_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      finish(op);
    }
  }

  async function playReply(conversationId: string, turnId: string) {
    if (mutedRef.current) return;
    if (
      ["requesting_permission", "recording", "transcribing"].includes(
        active.current?.state ?? "",
      )
    )
      return;
    await stop();
    if (mutedRef.current || !mounted.current || active.current) return;
    const op = {
      controller: new AbortController(),
      state: "downloading_audio",
    } as VoiceOperation;
    const signal = op.controller.signal;
    active.current = op;
    setState(op.state);
    const timeout = setTimeout(() => op.controller.abort("timeout"), 55_000);
    try {
      const response = await transport(
        `/api/v1/crypto/assistant/conversations/${encodeURIComponent(conversationId)}/turns/${encodeURIComponent(turnId)}/audio`,
        { method: "POST", signal },
      );
      await requireOk(response);
      if (signal.aborted) return;
      op.file = new File(Paths.cache, `agus-voice-${randomUUID()}.mp3`);
      // Expo's player accepts GET sources. Stage the bounded authenticated POST in private cache.
      await saveAudio(response, op.file, signal);
      if (signal.aborted) return;
      await setAudioModeAsync({
        allowsRecording: false,
        shouldPlayInBackground: false,
      });
      if (signal.aborted) return;
      player.replace(op.file.uri);
      player.muted = mutedRef.current;
      player.play();
      op.state = "playing";
      setState(op.state);
    } catch (error) {
      if (signal.reason === "timeout") throw new Error("VOICE_UNAVAILABLE");
      if (!signal.aborted) throw errorCode(error, "VOICE_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
      if (op.state !== "playing") {
        op.controller.abort();
        finish(op);
      }
    }
  }

  function setMuted(next: boolean) {
    mutedRef.current = next;
    player.muted = next;
    setMutedState(next);
    if (
      next &&
      (active.current?.state === "playing" ||
        active.current?.state === "downloading_audio")
    )
      void stop();
  }

  return {
    state,
    muted,
    durationMs: recordingStatus.durationMillis,
    isRecording: recordingStatus.isRecording,
    startRecording,
    stopAndTranscribe,
    playReply,
    stop,
    setMuted,
  };
}
