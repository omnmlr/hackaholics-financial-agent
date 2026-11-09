"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { WorkspaceAction } from "@/lib/agent-workspace/artifacts";
import type { Responsibility, MemoryFact } from "@/lib/agent-workspace/store";
import styles from "./personal-action.module.css";

const DevnetWallet = dynamic(
  () => import("./devnet-wallet").then((m) => m.DevnetWallet),
  {
    loading: () => <p role="status">Loading wallet review…</p>,
  },
);
type Snapshot = {
  tasks: Responsibility[];
  memories: MemoryFact[];
  notifications: {
    title?: string;
    text?: string;
    taskId?: string;
    dueAt?: string;
  }[];
};
async function request(body?: object, signal?: AbortSignal) {
  const response = await fetch("/api/agent-workspace", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? "Sign in to AGUS to review your workspace."
        : response.status === 409
          ? "This record changed. Refresh and review it again."
          : response.status === 503
            ? "The development workspace is unavailable."
            : "The request could not be completed. Refresh to check its recorded state before trying again.",
    );
  return response.json();
}

/** Artifacts are identifiers, never authority: records and versions come from the authenticated API. */
export function PersonalAction({ action }: { action: WorkspaceAction }) {
  if (action.kind === "solana")
    return (
      <section className={styles.card}>
        <h3>Devnet transaction review</h3>
        <p>
          Open the saved instructions to inspect the exact amount, recipient,
          fees and chain evidence. Approval and signing remain yours.
        </p>
        <WorkspaceLauncher
          initialDraftId={action.id}
          label="Review devnet transaction"
        />
      </section>
    );
  if (action.kind === "wallet")
    return (
      <section className={styles.card}>
        <h3>Devnet wallet observation</h3>
        <p className={styles.address}>{action.wallet.wallet}</p>
        <p>
          <strong>{action.wallet.sol.amount} test SOL</strong>
        </p>
        {action.wallet.tokens.map((token) => (
          <p key={token.mint}>
            {token.amount} test token units ·{" "}
            <span className={styles.address}>{token.mint}</span>
          </p>
        ))}
        <p>
          Observed {new Date(action.wallet.fetchedAt).toLocaleString()}. Devnet
          assets have no asserted dollar value. Refresh in the wallet for a new
          observation.
        </p>
        <WorkspaceLauncher label="Open devnet wallet" wallet />
      </section>
    );
  return <RecordReview action={action} />;
}
function RecordReview({
  action,
}: {
  action:
    { kind: "responsibility" | "memory"; id: string } | { kind: "overview" };
}) {
  const [opened, setOpened] = useState(false);
  return opened ? (
    <SavedRecords action={action} />
  ) : (
    <section className={styles.card}>
      <h3>
        {action.kind === "memory"
          ? "Saved memory proposal"
          : action.kind === "responsibility"
            ? "Saved responsibility"
            : "Saved workspace"}
      </h3>
      <button type="button" onClick={() => setOpened(true)}>
        {action.kind === "memory"
          ? "Review memory"
          : action.kind === "responsibility"
            ? "Review responsibility"
            : "Review saved workspace"}
      </button>
    </section>
  );
}
function SavedRecords({
  action,
}: {
  action:
    | Extract<WorkspaceAction, { kind: "overview" }>
    | { kind: "memory" | "responsibility"; id: string };
}) {
  const [saved, setSaved] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await request(undefined, signal);
    if (!signal?.aborted) setSaved(result);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal).catch(() => {
      if (!controller.signal.aborted)
        setError(
          "Saved records are unavailable. Sign in or refresh to check them.",
        );
    });
    return () => controller.abort();
  }, [refresh]);
  async function mutate(body: object) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await request(body);
      await refresh();
      setStatus("Saved. Current state is shown below.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Result uncertain. Refresh to check the saved state.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  const tasks =
    saved?.tasks.filter(
      (t) =>
        action.kind === "overview" ||
        (action.kind === "responsibility" && t.id === action.id),
    ) ?? [];
  const memories =
    saved?.memories.filter(
      (m) =>
        action.kind === "overview" ||
        (action.kind === "memory" && m.id === action.id),
    ) ?? [];
  return (
    <section className={styles.card} aria-label="Saved agent records">
      <div className={styles.row}>
        <h3>
          {action.kind === "memory"
            ? "Memory review"
            : action.kind === "responsibility"
              ? "Responsibility review"
              : "Responsibilities & memory"}
        </h3>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError("");
            void refresh().catch(() =>
              setError("Refresh failed. No action was retried."),
            );
          }}
        >
          Refresh records
        </button>
      </div>
      <p>
        Only the displayed scope is authorized here. Reminders are delivered
        when the responsibilities runner is operating; approval does not
        authorize messages, purchases or payments.
      </p>
      {error && <p role="alert">{error}</p>}
      <p role="status">{busy ? "Saving…" : status}</p>
      {!saved && !error && <p role="status">Loading saved records…</p>}
      {saved && !tasks.length && !memories.length && (
        <p>
          No matching saved records. A forgotten note will no longer appear
          here.
        </p>
      )}
      {tasks.map((task) => (
        <article key={task.id} className={styles.record}>
          <h4>{task.title}</h4>
          <p>{task.objective}</p>
          {task.watch && (
            <p>
              Read-only devnet follow-up · stops after 32 checks or{" "}
              {new Date(task.watch.expiresAt).toLocaleString()}. Last
              observation: {task.watch.observedState ?? "none"}
              {task.watch.failureCode
                ? ` · ${task.watch.failureCode}`
                : ""}.{" "}
              {task.watch.confirmation
                ? `Verified ${task.watch.confirmation.commitment} at slot ${task.watch.confirmation.slot}.`
                : "No verified success recorded."}
            </p>
          )}
          <p>
            <strong>{task.state.replaceAll("_", " ")}</strong> · due{" "}
            {new Date(task.dueAt).toLocaleString()}
            {task.intervalSeconds
              ? ` · repeats every ${task.intervalSeconds} seconds`
              : ""}
          </p>
          {task.watch?.signature && (
            <p>
              Observed transaction reference:{" "}
              <code className={styles.address}>{task.watch.signature}</code>
            </p>
          )}
          <div className={styles.row}>
            {[
              ...(task.state === "awaiting_approval" ? ["approve"] : []),
              ...(task.state === "active" ? ["pause"] : []),
              ...(task.state === "paused" ? ["resume"] : []),
              ...(["awaiting_approval", "active", "paused"].includes(task.state)
                ? ["cancel"]
                : []),
            ].map((command) => (
              <button
                type="button"
                key={command}
                disabled={busy}
                onClick={() =>
                  void mutate({
                    action: command,
                    id: task.id,
                    version: task.version,
                    acknowledged: true,
                  })
                }
              >
                {command === "approve"
                  ? task.scope === "solana_devnet_reconciliation_only"
                    ? "Approve read-only devnet follow-up"
                    : "Approve in-app reminder"
                  : command === "pause"
                    ? "Pause responsibility"
                    : command === "resume"
                      ? "Resume responsibility"
                      : "Cancel responsibility"}
              </button>
            ))}
          </div>
        </article>
      ))}
      {memories.map((memory) => (
        <article key={memory.id} className={styles.record}>
          <h4>
            {memory.confirmed
              ? "User-confirmed statement"
              : "Unconfirmed memory proposal"}
          </h4>
          <p>{memory.text}</p>
          <p>
            {memory.category} · attributed personal context, never verified
            financial evidence.
          </p>
          <div className={styles.row}>
            {!memory.confirmed && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void mutate({
                    action: "confirm_memory",
                    id: memory.id,
                    acknowledged: true,
                  })
                }
              >
                Confirm memory
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void mutate({
                  action: "forget_memory",
                  id: memory.id,
                  acknowledged: true,
                })
              }
            >
              Forget memory
            </button>
          </div>
        </article>
      ))}
      {action.kind === "overview" && !!saved?.notifications.length && (
        <div className={styles.record}>
          <h4>Delivered in-app reminders</h4>
          {saved.notifications.map((note, i) => (
            <p key={i}>
              {note.title || "In-app update"}
              {note.text ? `: ${note.text}` : ""}
              {note.dueAt ? ` · ${new Date(note.dueAt).toLocaleString()}` : ""}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

export function WorkspaceLauncher({
  initialDraftId,
  label = "Wallet & responsibilities",
  wallet = false,
}: {
  initialDraftId?: string;
  label?: string;
  wallet?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"wallet" | "workspace">(
    wallet || initialDraftId ? "wallet" : "workspace",
  );
  const title = useId();
  function close() {
    dialog.current?.close();
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={styles.launcher}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={title}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className={styles.row}>
          <h2 id={title}>Your agent workspace</h2>
          <button type="button" onClick={close}>
            Close workspace
          </button>
        </div>
        <nav className={styles.row} aria-label="Agent workspace views">
          <button
            type="button"
            aria-pressed={tab === "workspace"}
            onClick={() => setTab("workspace")}
          >
            Responsibilities & memory
          </button>
          <button
            type="button"
            aria-pressed={tab === "wallet"}
            onClick={() => setTab("wallet")}
          >
            Solana devnet wallet
          </button>
        </nav>
        {open &&
          (tab === "wallet" ? (
            <DevnetWallet
              embedded
              initialDraftId={initialDraftId}
              onFollowupPrepared={() => setTab("workspace")}
            />
          ) : (
            <SavedRecords action={{ kind: "overview" }} />
          ))}
      </dialog>
    </>
  );
}
