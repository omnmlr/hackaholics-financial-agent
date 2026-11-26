"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import s from "./public-site.module.css";

export function ResetPasswordForm({
  token,
  initialError,
}: {
  token?: string;
  initialError?: string;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!token) {
      setError("Reset token is missing from the link.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword }),
      });
      const text = await res.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        payload = {};
      }
      if (!res.ok) {
        setError(String(payload.message ?? payload.code ?? `Reset failed (${res.status})`));
        return;
      }
      setDone(true);
    } catch {
      setError("Network error while resetting password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={s.section}>
      <h2>Choose a new password</h2>
      {error && (
        <div className={`${s.notice} ${s.noticeError}`} role="alert">
          {error}
        </div>
      )}
      {done ? (
        <div className={`${s.notice} ${s.noticeSuccess}`} role="status">
          Password updated cleanly. You can now <Link href="/auth">sign in with your new password</Link>.
        </div>
      ) : !token ? (
        <p>
          Open the password reset link sent to your email, or{" "}
          <Link href="/auth">request a new reset link</Link>.
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className={s.formGroup}>
            <label className={s.label} htmlFor="reset-new-password">
              New password (minimum 12 characters)
            </label>
            <input
              id="reset-new-password"
              className={s.input}
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <button type="submit" className={s.buttonPrimary} disabled={busy}>
            Update password
          </button>
        </form>
      )}
    </section>
  );
}
