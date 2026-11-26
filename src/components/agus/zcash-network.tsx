"use client";
import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { productApi } from "./api";
import s from "./workspace.module.css";
type Observation = {
  live: boolean;
  tipHeight: number;
  branchId: string;
  observedAt: string;
};
export function ZcashNetwork({ managed = false }: { managed?: boolean }) {
  const [observation, setObservation] = useState<Observation>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    setError("");
    try {
      const r = await productApi<Observation>("product/zcash-network");
      if (!signal?.aborted) setObservation(r);
    } catch {
      if (!signal?.aborted)
        setError("Network observation unavailable. No receipt is assumed.");
    } finally {
      if (!signal?.aborted) setBusy(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return (
    <div className={s.networkDetails}>
      {managed && <ManagedWalletStatus />}
      <p className={s.fine} role="status">
        {error ||
          (observation?.live
            ? `Live Testnet · block ${observation.tipHeight.toLocaleString()} · ${observation.branchId.toLowerCase() === "77190ad9" ? "NU7" : `branch ${observation.branchId}`}`
            : busy
              ? "Checking public Testnet…"
              : "Testnet connection unavailable")}
      </p>
      {observation?.live && (
        <p className={s.fine}>
          Public network only · checked{" "}
          {new Date(observation.observedAt).toLocaleTimeString("en-NG", {
            timeZone: "Africa/Lagos",
          })}{" "}
          WAT
        </p>
      )}
      <button
        type="button"
        className={s.textButton}
        disabled={busy}
        onClick={() => void load()}
      >
        <RefreshCw size={14} className={busy ? s.spin : ""} /> Check network
      </button>
    </div>
  );
}

function ManagedWalletStatus() {
  const [status, setStatus] = useState<{
    spendableZec: string;
    pendingZec: string;
  }>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const result = await productApi<{
          spendableZec: string;
          pendingZec: string;
        }>("product/zcash-wallet");
        if (active) {
          setStatus(result);
          setError("");
        }
      } catch {
        if (active) setError("Receiving wallet syncing or unavailable");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <div role="status">
      {error ? (
        <p className={s.fine}>{error}</p>
      ) : status ? (
        <>
          <p className={s.muted}>
            {status.spendableZec} ZEC · wallet spendable
          </p>
          <p className={s.fine}>
            {status.pendingZec} ZEC pending · native Testnet receiving wallet
          </p>
        </>
      ) : (
        <p className={s.fine}>Checking receiving wallet…</p>
      )}
    </div>
  );
}
