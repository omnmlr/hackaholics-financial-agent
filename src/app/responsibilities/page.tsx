"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Responsibility, MemoryFact } from "@/lib/agent-workspace/store";

type Snapshot = {
  tasks: Responsibility[];
  memories: MemoryFact[];
  notifications: { id: string; title: string; text: string }[];
};
export default function ResponsibilitiesPage() {
  const [data, setData] = useState<Snapshot>();
  const [status, setStatus] = useState("Loading saved responsibilities…");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch("/api/agent-workspace", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Workspace unavailable");
    setData(body);
    setStatus("Saved workspace loaded.");
  }, []);
  useEffect(() => {
    let alive = true;
    refresh().catch((e) => {
      if (alive) setStatus(e.message);
    });
    return () => {
      alive = false;
    };
  }, [refresh]);
  async function action(input: object) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/agent-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Action unavailable");
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Action unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main style={{ maxWidth: 820, margin: "auto", padding: 24 }}>
      <nav>
        <Link href="/">AGUS conversation / sign in</Link> ·{" "}
        <Link href="/devnet">Solana devnet</Link>
      </nav>
      <h1>Responsibilities and memory</h1>
      <p>Your money, and what&apos;s next.</p>
      <p>
        Saved reminders require your approval. They create in-app updates only;
        they never send messages, initiate payments or verify financial
        outcomes. Automatic follow-ups require the local responsibility runner
        to be running.
      </p>
      <p role="status" aria-live="polite">
        {status}
      </p>
      <button
        disabled={busy}
        onClick={() => refresh().catch((e) => setStatus(e.message))}
      >
        Refresh
      </button>{" "}
      <button
        disabled={busy}
        onClick={() => action({ action: "run_due", acknowledged: true })}
      >
        Check due reminders now
      </button>
      <h2>Prepare a responsibility</h2>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const date = new Date(String(form.get("due")));
          if (!Number.isFinite(date.getTime())) {
            setStatus("Choose a valid due time");
            return;
          }
          void action({
            action: "create_task",
            input: {
              title: form.get("title"),
              objective: form.get("objective"),
              dueAt: date.toISOString(),
            },
          });
        }}
      >
        <label>
          Title <input name="title" required maxLength={120} />
        </label>
        <br />
        <label>
          What should AGUS remind you about?{" "}
          <textarea name="objective" required maxLength={2000} />
        </label>
        <br />
        <label>
          Due time (your device timezone){" "}
          <input name="due" type="datetime-local" required />
        </label>
        <br />
        <button disabled={busy}>Prepare for review</button>
      </form>
      <h2>Saved responsibilities</h2>
      {data?.tasks.length === 0 && <p>No saved responsibilities.</p>}
      {data?.tasks.map((task) => (
        <article
          key={task.id}
          style={{ padding: 16, borderBottom: "1px solid #555" }}
        >
          <h3>{task.title}</h3>
          <p>{task.objective}</p>
          <p>
            {task.state} · {new Date(task.dueAt).toLocaleString()} ·{" "}
            {task.scope}
          </p>
          {(
            [
              ...(task.state === "awaiting_approval" ? ["approve"] : []),
              ...(task.state === "active" ? ["pause"] : []),
              ...(task.state === "paused" ? ["resume"] : []),
              ...(["active", "paused", "awaiting_approval"].includes(task.state)
                ? ["cancel"]
                : []),
            ] as const
          ).map((command) => (
            <button
              key={command}
              disabled={busy}
              onClick={() =>
                action({
                  action: command,
                  id: task.id,
                  version: task.version,
                  acknowledged: true,
                })
              }
            >
              {command === "approve" ? "Approve in-app reminder" : command}
            </button>
          ))}
        </article>
      ))}
      <h2>Memory</h2>
      <p>
        Remembered statements are context, not verified balances, agreements or
        payment authority. Unconfirmed proposals are explicitly marked.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void action({
            action: "propose_memory",
            input: { text: form.get("text"), category: "note" },
          });
        }}
      >
        <label>
          New note <textarea name="text" required maxLength={1000} />
        </label>
        <button disabled={busy}>Propose memory</button>
      </form>
      {data?.memories.map((memory) => (
        <article key={memory.id}>
          <p>{memory.text}</p>
          <p>
            {memory.category} ·{" "}
            {memory.confirmed
              ? "User-confirmed statement"
              : "Unconfirmed proposal"}
          </p>
          {!memory.confirmed && (
            <button
              disabled={busy}
              onClick={() =>
                action({
                  action: "confirm_memory",
                  id: memory.id,
                  acknowledged: true,
                })
              }
            >
              Confirm statement
            </button>
          )}
          <button
            disabled={busy}
            onClick={() =>
              action({
                action: "forget_memory",
                id: memory.id,
                acknowledged: true,
              })
            }
          >
            Forget
          </button>
        </article>
      ))}
      <h2>In-app updates</h2>
      {data?.notifications.map((note) => (
        <article key={note.id}>
          <h3>{note.title}</h3>
          <p>{note.text}</p>
          <small>Scheduled reminder, not a verified external outcome.</small>
        </article>
      ))}
    </main>
  );
}
