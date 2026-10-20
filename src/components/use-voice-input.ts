"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
type SpeechRecognitionResult = {
  isFinal: boolean;
  0: { transcript: string };
};
type SpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResult>;
};
type SpeechRecognitionErrorEvent = { error: string };
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
// Shared with the retired dashboard; capture only ever edits the caller's draft.
export function useVoiceInput(options: {
  text: string;
  onText: (text: string) => void;
  aiEnabled: boolean;
  disabled: boolean;
  language?: string;
  focus: () => void;
}) {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });
  const [voiceStatus, setVoiceStatus] = useState("");
  const [listening, setListening] = useState(false);
  const [requestingVoice, setRequestingVoice] = useState(false);
  const [transcribingVoice, setTranscribingVoice] = useState(false);
  const [audioLevel, setAudioLevel] = useState<number | null>(null);
  const [waveform, setWaveform] = useState<number[] | null>(null);
  const [liveTranscript, setLiveTranscript] = useState("");
  // Completion/error guidance is transient; active capture retains its status.
  useEffect(() => {
    if (!voiceStatus || listening || requestingVoice || transcribingVoice)
      return;
    const timer = setTimeout(() => setVoiceStatus(""), 5000);
    return () => clearTimeout(timer);
  }, [voiceStatus, listening, requestingVoice, transcribingVoice]);
  const speechRecognition = useRef<SpeechRecognitionLike | null>(null);
  const voiceRecorder = useRef<MediaRecorder | null>(null);
  const voiceStream = useRef<MediaStream | null>(null);
  const voiceAudioContext = useRef<AudioContext | null>(null);
  const voiceChunks = useRef<Blob[]>([]);
  const voiceMonitor = useRef<number | null>(null);
  const voiceSession = useRef(0);
  const voiceEpoch = useRef(0);
  const transcriptionRequest = useRef<AbortController | null>(null);
  const captureTimeout = useRef<number | null>(null);
  const nativeFinishTimeout = useRef<number | null>(null);
  const recordingText = useRef("");
  const pendingMicrophone = useRef(false);
  const nativeFinishing = useRef(false);
  function releaseVoiceCapture() {
    if (nativeFinishTimeout.current !== null)
      window.clearTimeout(nativeFinishTimeout.current);
    nativeFinishTimeout.current = null;
    if (captureTimeout.current !== null)
      window.clearTimeout(captureTimeout.current);
    captureTimeout.current = null;
    if (voiceMonitor.current !== null) {
      window.clearInterval(voiceMonitor.current);
      voiceMonitor.current = null;
    }
    voiceStream.current?.getTracks().forEach((track) => track.stop());
    voiceStream.current = null;
    setAudioLevel(null);
    setWaveform(null);
    const context = voiceAudioContext.current;
    voiceAudioContext.current = null;
    if (context && context.state !== "closed")
      void context.close().catch(() => {});
  }
  // Both recognition paths use genuine time-domain microphone samples. Native
  // Web Speech does not expose its internal stream, so it needs a separately
  // permissioned local stream for metering only. It is never uploaded or played.
  async function monitorStream(stream: MediaStream, epoch: number) {
    let context: AudioContext | undefined;
    try {
      if (typeof AudioContext === "undefined") return;
      context = new AudioContext();
      const audio = context;
      voiceAudioContext.current = audio;
      await audio.resume();
      if (epoch !== voiceEpoch.current || voiceStream.current !== stream) {
        if (audio.state !== "closed") await audio.close();
        return;
      }
      const analyser = audio.createAnalyser();
      analyser.fftSize = 512;
      audio.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      voiceMonitor.current = window.setInterval(() => {
        if (epoch !== voiceEpoch.current || voiceStream.current !== stream)
          return;
        try {
          analyser.getByteTimeDomainData(samples);
        } catch {
          if (voiceMonitor.current !== null)
            window.clearInterval(voiceMonitor.current);
          voiceMonitor.current = null;
          setAudioLevel(null);
          setWaveform(null);
          if (audio.state !== "closed") void audio.close().catch(() => {});
          return;
        }
        const bars = Array.from({ length: 24 }, (_, index) => {
          const from = Math.floor((index * samples.length) / 24),
            to = Math.floor(((index + 1) * samples.length) / 24);
          let energy = 0;
          for (let i = from; i < to; i++)
            energy += ((samples[i] - 128) / 128) ** 2;
          return Math.min(1, Math.sqrt(energy / (to - from)) * 5);
        });
        setWaveform(bars);
        setAudioLevel(
          bars.reduce((sum, value) => sum + value, 0) / bars.length,
        );
      }, 80);
    } catch {
      if (voiceAudioContext.current === context)
        voiceAudioContext.current = null;
      if (context && context.state !== "closed")
        void context.close().catch(() => {});
      // Transcription can still work when this optional visualization fails.
      if (epoch === voiceEpoch.current) {
        setAudioLevel(null);
        setWaveform(null);
      }
    }
  }
  function appendTranscript(transcript: string) {
    const current = recordingText.current;
    const separator = current && !/\s$/.test(current) ? " " : "";
    const combined = `${current}${separator}${transcript}`;
    latest.current.onText(combined.slice(0, 4000));
    latest.current.focus();
  }
  async function transcribeVoice(recording: Blob, epoch: number) {
    if (epoch !== voiceEpoch.current) return;
    const controller = new AbortController();
    transcriptionRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 45000);
    setTranscribingVoice(true);
    setVoiceStatus("Transcribing your recording…");
    try {
      const form = new FormData();
      form.append("audio", recording, "voice-recording");
      const response = await fetch("/api/voice", {
        method: "POST",
        body: form,
        cache: "no-store",
        signal: controller.signal,
      });
      const result: unknown = await response.json().catch(() => null);
      if (epoch !== voiceEpoch.current) return;
      if (
        !response.ok ||
        !result ||
        typeof result !== "object" ||
        !("transcript" in result) ||
        typeof result.transcript !== "string"
      )
        throw new Error(
          result &&
            typeof result === "object" &&
            "error" in result &&
            typeof result.error === "string"
            ? result.error
            : "Voice transcription failed. Try again or type your request.",
        );
      const transcript = result.transcript.trim();
      if (!transcript)
        throw new Error(
          "No clear speech was detected. Try recording again in a quieter place.",
        );
      appendTranscript(transcript);
      setVoiceStatus("Transcript ready. Review it before sending.");
    } catch (e) {
      if (epoch !== voiceEpoch.current) return;
      setVoiceStatus(
        e instanceof Error
          ? e.message
          : "Voice transcription failed. Try again or type your request.",
      );
    } finally {
      clearTimeout(timeout);
      if (transcriptionRequest.current === controller)
        transcriptionRequest.current = null;
      if (epoch === voiceEpoch.current) setTranscribingVoice(false);
    }
  }
  // Discard callbacks when leaving an authenticated payment workspace. A normal
  // Stop still accepts the final transcript for explicit review before Send.
  const discardVoiceCapture = useCallback(() => {
    voiceEpoch.current += 1;
    nativeFinishing.current = true;
    pendingMicrophone.current = false;
    transcriptionRequest.current?.abort();
    transcriptionRequest.current = null;
    voiceChunks.current = [];
    voiceSession.current += 1;
    const recognition = speechRecognition.current;
    speechRecognition.current = null;
    if (recognition) {
      nativeFinishing.current = true;
      recognition.onstart = recognition.onend = null;
      recognition.onresult = recognition.onerror = null;
      try {
        recognition.stop();
      } catch {
        /* Already ended or not started. */
      }
    }
    const recorder = voiceRecorder.current;
    voiceRecorder.current = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = recorder.onstop = recorder.onerror = null;
      try {
        recorder.stop();
      } catch {
        /* The browser already released it. */
      }
    }
    releaseVoiceCapture();
    setListening(false);
    setRequestingVoice(false);
    setTranscribingVoice(false);
    setLiveTranscript("");
    setVoiceStatus("");
  }, []);
  function stopVoiceCapture() {
    voiceSession.current += 1;
    const recognition = speechRecognition.current;
    if (recognition) {
      releaseVoiceCapture();
      setListening(false);
      setTranscribingVoice(true);
      setVoiceStatus("Finishing your transcript…");
      // Some implementations omit onend after stop. Finish from the latest
      // preview, then detach the recognizer so late events cannot edit a draft.
      nativeFinishTimeout.current = window.setTimeout(
        () => recognition.onend?.(),
        1500,
      );
      try {
        recognition.stop();
      } catch {
        discardVoiceCapture();
        setVoiceStatus(
          "Recording stopped. Your original message is preserved.",
        );
      }
      return;
    }
    const recorder = voiceRecorder.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        discardVoiceCapture();
        setVoiceStatus(
          "Recording stopped. Your original message is preserved.",
        );
      }
    }
  }
  async function toggleVoiceInput() {
    if (latest.current.disabled) return;
    if (listening) {
      stopVoiceCapture();
      return;
    }
    // API refs close the interval before React commits a disabled button.
    if (
      speechRecognition.current ||
      voiceRecorder.current ||
      transcriptionRequest.current ||
      requestingVoice ||
      transcribingVoice
    )
      return;
    if (!window.isSecureContext) {
      setVoiceStatus(
        "Voice recording requires HTTPS or localhost. Open the secure app URL and try again.",
      );
      return;
    }
    const speechWindow = window as Window & {
      SpeechRecognition?: SpeechRecognitionConstructor;
      webkitSpeechRecognition?: SpeechRecognitionConstructor;
    };
    const SpeechRecognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    const epoch = ++voiceEpoch.current;
    nativeFinishing.current = false;
    recordingText.current = latest.current.text;
    setLiveTranscript("");
    setAudioLevel(null);
    if (SpeechRecognition) {
      try {
        const recognition = new SpeechRecognition();
        speechRecognition.current = recognition;
        setVoiceStatus("Starting voice input…");
        setRequestingVoice(true);
        recognition.lang = latest.current.language || "en-NG";
        recognition.continuous = true;
        recognition.interimResults = true;
        let recognitionFailed = false;
        let hasTranscript = false;
        let finalTranscript = "";
        recognition.onstart = () => {
          if (
            epoch !== voiceEpoch.current ||
            speechRecognition.current !== recognition
          )
            return;
          setRequestingVoice(false);
          setListening(true);
          captureTimeout.current = window.setTimeout(stopVoiceCapture, 60000);
          setVoiceStatus(
            "Listening… stop to review your words, or cancel to discard.",
          );
        };
        recognition.onresult = (event) => {
          if (
            epoch !== voiceEpoch.current ||
            speechRecognition.current !== recognition ||
            recognitionFailed ||
            latest.current.disabled
          )
            return;
          const transcript = Array.from(event.results)
            .map((result) => result[0].transcript.trim())
            .filter(Boolean)
            .join(" ");
          if (!transcript) return;
          hasTranscript = true;
          finalTranscript = transcript;
          setLiveTranscript(transcript);
        };
        recognition.onerror = (event) => {
          if (
            epoch !== voiceEpoch.current ||
            speechRecognition.current !== recognition
          )
            return;
          recognitionFailed = true;
          speechRecognition.current = null;
          releaseVoiceCapture();
          setLiveTranscript("");
          try {
            recognition.stop();
          } catch {
            /* Browser already stopped. */
          }
          setListening(false);
          setRequestingVoice(false);
          setTranscribingVoice(false);
          const messages: Record<string, string> = {
            "not-allowed":
              "Microphone access was denied. Allow microphone access and try again.",
            "service-not-allowed":
              "The browser speech service is unavailable. Try Chrome, Edge or Safari.",
            "audio-capture":
              "No microphone was found. Connect one or type your request.",
            "no-speech":
              "No speech was detected. Try again or type your request.",
            network:
              "The browser speech service could not be reached. Check your connection and try again.",
            aborted: "Voice input was stopped.",
          };
          setVoiceStatus(
            messages[event.error] ??
              "Voice input failed. Try again or type your request.",
          );
        };
        recognition.onend = () => {
          if (
            epoch !== voiceEpoch.current ||
            speechRecognition.current !== recognition
          )
            return;
          speechRecognition.current = null;
          releaseVoiceCapture();
          if (!recognitionFailed && finalTranscript)
            appendTranscript(finalTranscript);
          setListening(false);
          setRequestingVoice(false);
          setTranscribingVoice(false);
          setLiveTranscript("");
          if (!recognitionFailed)
            setVoiceStatus(
              hasTranscript
                ? "Transcript ready in the message. Review it before sending."
                : "No speech was detected. Try again or type your request.",
            );
        };
        recognition.start();
        if (
          navigator.mediaDevices?.getUserMedia &&
          typeof AudioContext !== "undefined"
        ) {
          void navigator.mediaDevices
            .getUserMedia({
              audio: {
                autoGainControl: true,
                echoCancellation: true,
                noiseSuppression: true,
              },
            })
            .then(async (stream) => {
              if (
                epoch !== voiceEpoch.current ||
                speechRecognition.current !== recognition ||
                nativeFinishing.current ||
                latest.current.disabled
              ) {
                stream.getTracks().forEach((track) => track.stop());
                return;
              }
              voiceStream.current = stream;
              await monitorStream(stream, epoch);
            })
            .catch(() => {
              // Web Speech manages its own permission/errors independently.
              // Do not fabricate a waveform when metering access is unavailable.
              if (
                epoch === voiceEpoch.current &&
                speechRecognition.current === recognition &&
                !nativeFinishing.current
              )
                setVoiceStatus(
                  "Listening… microphone level unavailable. Stop to review or cancel.",
                );
            });
        }
        return;
      } catch {
        speechRecognition.current = null;
        releaseVoiceCapture();
        setListening(false);
        setRequestingVoice(false);
        setVoiceStatus(
          "Could not start voice input. Check microphone permission and try again.",
        );
        return;
      }
    }
    if (!latest.current.aiEnabled) {
      setVoiceStatus(
        "Live voice input is not supported in this browser. Try Chrome, Edge or Safari, or type your request.",
      );
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceStatus(
        "Voice recording is not supported in this browser. Try a recent version of Chrome, Edge, Firefox, or Safari.",
      );
      return;
    }
    pendingMicrophone.current = true;
    setVoiceStatus("Requesting microphone access…");
    setRequestingVoice(true);
    const session = ++voiceSession.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (
        session !== voiceSession.current ||
        epoch !== voiceEpoch.current ||
        latest.current.disabled
      ) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      voiceStream.current = stream;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      voiceRecorder.current = recorder;
      voiceChunks.current = [];
      let recordingFailed = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size) voiceChunks.current.push(event.data);
      };
      recorder.onerror = () => {
        if (epoch !== voiceEpoch.current) return;
        recordingFailed = true;
        voiceRecorder.current = null;
        releaseVoiceCapture();
        setListening(false);
        setVoiceStatus(
          "The recording stopped unexpectedly. Try again or type your request.",
        );
      };
      recorder.onstop = () => {
        if (epoch !== voiceEpoch.current) return;
        voiceRecorder.current = null;
        releaseVoiceCapture();
        setListening(false);
        const chunks = voiceChunks.current;
        voiceChunks.current = [];
        if (recordingFailed || epoch !== voiceEpoch.current) return;
        const recording = new Blob(chunks, {
          type: recorder.mimeType || chunks[0]?.type || "audio/webm",
        });
        if (!recording.size) {
          setVoiceStatus(
            "No audio was captured. Check your microphone and try again.",
          );
          return;
        }
        void transcribeVoice(recording, epoch);
      };
      recorder.start(250);
      setListening(true);
      setRequestingVoice(false);
      captureTimeout.current = window.setTimeout(stopVoiceCapture, 60000);
      setVoiceStatus(
        "Recording… stop to transcribe and review. Maximum one minute.",
      );
      await monitorStream(stream, epoch);
    } catch (e) {
      if (epoch !== voiceEpoch.current) return;
      voiceRecorder.current = null;
      releaseVoiceCapture();
      setListening(false);
      const name = e instanceof Error ? e.name : "";
      setVoiceStatus(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access was denied. Allow microphone access or type your request."
          : name === "NotFoundError"
            ? "No microphone was found. Connect one or type your request."
            : "Could not start voice recording. Check your microphone and try again.",
      );
    } finally {
      if (epoch === voiceEpoch.current) {
        pendingMicrophone.current = false;
        setRequestingVoice(false);
      }
    }
  }
  useEffect(() => {
    const leave = () => discardVoiceCapture();
    const hide = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hide);
      discardVoiceCapture();
    };
  }, [discardVoiceCapture]);
  // Synchronous API refs protect programmatic composer edits before a React
  // state render can disable controls (including permission/transcription).
  function isVoiceLocked() {
    return !!(
      speechRecognition.current ||
      voiceRecorder.current ||
      transcriptionRequest.current ||
      pendingMicrophone.current ||
      requestingVoice ||
      listening ||
      transcribingVoice
    );
  }
  return {
    isVoiceLocked,
    setVoiceStatus,
    setRequestingVoice,
    voiceStatus,
    audioLevel,
    waveform,
    liveTranscript,
    listening,
    requestingVoice,
    transcribingVoice,
    toggleVoiceInput,
    stopVoiceCapture,
    discardVoiceCapture,
  };
}
