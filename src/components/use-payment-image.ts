"use client";
import { useEffect, useRef, useState } from "react";
import type { SavedTurn } from "@/lib/chat-history/store";

export function usePaymentImage(scope: string, authenticated: boolean | null) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null),
    version = useRef(0);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    ++version.current;
    controller.current?.abort();
    controller.current = null;
    setFile(null);
    setError("");
    setBusy(false);
  }, [scope, authenticated]);
  useEffect(() => () => controller.current?.abort(), []);
  function select(next: File | undefined) {
    if (controller.current) return;
    if (!next) return;
    if (
      !["image/png", "image/jpeg", "image/webp"].includes(next.type) ||
      next.size > 5 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG or WebP image smaller than 5 MB.");
      return;
    }
    setError("");
    setFile(next);
  }
  async function upload(
    chatId: string,
    onDone: (data: { conversationId: string; turn: SavedTurn }) => void,
    onUncertain: () => void,
  ) {
    if (!file || controller.current) return;
    const generation = version.current,
      current = new AbortController();
    controller.current = current;
    setBusy(true);
    setError("");
    const timeout = setTimeout(() => current.abort(), 100000);
    const data = new FormData();
    data.set("image", file);
    data.set("conversationId", chatId);
    data.set("uploadId", crypto.randomUUID());
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        body: data,
        signal: current.signal,
      });
      const body = await response.json();
      if (generation !== version.current) return;
      if (!response.ok) {
        setError(
          typeof body.error === "string"
            ? body.error
            : "Image could not be read. Review the file and try again.",
        );
        if (response.status >= 500 || response.status === 409) onUncertain();
        return;
      }
      setFile(null);
      onDone(body);
    } catch {
      if (generation === version.current) {
        setFile(null);
        setError(
          "Image response unconfirmed. Check the saved conversation before selecting it again.",
        );
        onUncertain();
      }
    } finally {
      clearTimeout(timeout);
      if (generation === version.current) {
        controller.current = null;
        setBusy(false);
      }
    }
  }
  return {
    file,
    preview,
    error,
    busy,
    input,
    select,
    upload,
    clear: () => {
      if (!controller.current) setFile(null);
    },
    cancel: () => controller.current?.abort(),
  };
}
