"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import s from "./public-site.module.css";

type SessionPayload = {
  user?: {
    id: string;
    email: string;
    name?: string | null;
    emailVerified?: boolean;
  };
} | null;

export function PublicAuthPanel({
  googleEnabled,
  publicRegistration,
  emailConfigured,
  initialVerified,
  initialError,
}: {
  googleEnabled: boolean;
  publicRegistration: boolean;
  emailConfigured: boolean;
  initialVerified: boolean;
  initialError?: string;
}) {
  const [session, setSession] = useState<SessionPayload>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(
    initialVerified ? "Email verified. You can now sign in with your account." : null,
  );
  const [error, setError] = useState<string | null>(initialError ?? null);

  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const loadSession = useCallback(async () => {
    setLoadingSession(true);
    try {
      const res = await fetch("/api/auth/get-session", {
        credentials: "include",
      });
      if (res.ok) {
        const data = (await res.json()) as SessionPayload;
        setSession(data?.user ? data : null);
      } else {
        setSession(null);
      }
    } catch {
      setSession(null);
    } finally {
      setLoadingSession(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function postJson(path: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/auth/${path}`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      payload = {};
    }
    return { res, payload };
  }

  async function handleGoogleSignIn() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { res, payload } = await postJson("sign-in/social", {
        provider: "google",
        callbackURL: `${window.location.origin}/auth`,
      });
      if (!res.ok) {
        setError(String(payload.message ?? payload.code ?? `HTTP ${res.status}`));
        return;
      }
      if (typeof payload.url === "string" && payload.url.startsWith("https://")) {
        window.location.assign(payload.url);
        return;
      }
      await loadSession();
    } catch {
      setError("Could not start Google sign-in. Please retry.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === "signin") {
        const { res, payload } = await postJson("sign-in/email", {
          email,
          password,
        });
        if (!res.ok) {
          setError(String(payload.message ?? payload.code ?? `Sign-in failed (${res.status})`));
          return;
        }
        setMessage("Signed in successfully.");
        await loadSession();
      } else if (mode === "signup") {
        const { res, payload } = await postJson("sign-up/email", {
          name: name.trim() || "AGUS User",
          email,
          password,
          callbackURL: `${window.location.origin}/auth?verified=1`,
        });
        if (!res.ok) {
          setError(String(payload.message ?? payload.code ?? `Registration failed (${res.status})`));
          return;
        }
        setMessage(
          emailConfigured
            ? "Account created. Check your inbox for the AGUS verification link before signing in."
            : "Account created.",
        );
      } else {
        const { res, payload } = await postJson("request-password-reset", {
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (!res.ok) {
          setError(String(payload.message ?? payload.code ?? `Reset request failed (${res.status})`));
          return;
        }
        setMessage("If that email is registered, a password reset link has been sent.");
      }
    } catch {
      setError("Network error while communicating with AGUS authentication.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await postJson("sign-out", {});
      setSession(null);
      setMessage("Signed out.");
    } catch {
      setError("Sign-out failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {error && (
        <div className={`${s.notice} ${s.noticeError}`} role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className={`${s.notice} ${s.noticeSuccess}`} role="status">
          {message}
        </div>
      )}

      {loadingSession ? (
        <section className={s.section}>
          <p>Checking session status...</p>
        </section>
      ) : session?.user ? (
        <section className={s.section}>
          <h2>Active session</h2>
          <p>
            Signed in as <strong>{session.user.email}</strong>
            {session.user.name ? ` (${session.user.name})` : ""} · Email verified:{" "}
            <strong>{session.user.emailVerified ? "yes" : "no"}</strong>.
          </p>
          <div className={s.actions} style={{ marginTop: 16, marginBottom: 0 }}>
            <button
              type="button"
              className={s.buttonSecondary}
              disabled={busy}
              onClick={handleSignOut}
            >
              Sign out
            </button>
          </div>
        </section>
      ) : (
        <section className={s.section}>
          <p className={s.eyebrow}>
            {publicRegistration ? "Open registration & judge sign-in" : "Invite-only Devnet access"}
          </p>
          <h2>Sign in or create an AGUS account</h2>

          {googleEnabled ? (
            <div style={{ margin: "16px 0 22px" }}>
              <button
                type="button"
                className={s.buttonPrimary}
                disabled={busy}
                onClick={handleGoogleSignIn}
              >
                Continue with Google
              </button>
            </div>
          ) : (
            <div className={s.notice}>
              Google sign-in is pending server credential activation. Email authentication status:{" "}
              {emailConfigured ? "active" : "email delivery pending"}.
            </div>
          )}

          <div className={s.actions} style={{ marginBottom: 18 }}>
            <button
              type="button"
              className={mode === "signin" ? s.buttonPrimary : s.buttonSecondary}
              onClick={() => setMode("signin")}
            >
              Email sign in
            </button>
            <button
              type="button"
              className={mode === "signup" ? s.buttonPrimary : s.buttonSecondary}
              onClick={() => setMode("signup")}
            >
              Create account
            </button>
            <button
              type="button"
              className={mode === "reset" ? s.buttonPrimary : s.buttonSecondary}
              onClick={() => setMode("reset")}
            >
              Reset password
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {mode === "signup" && (
              <div className={s.formGroup}>
                <label className={s.label} htmlFor="auth-name">
                  Display name
                </label>
                <input
                  id="auth-name"
                  className={s.input}
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Mercer"
                />
              </div>
            )}

            <div className={s.formGroup}>
              <label className={s.label} htmlFor="auth-email">
                Email address
              </label>
              <input
                id="auth-email"
                className={s.input}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>

            {mode !== "reset" && (
              <div className={s.formGroup}>
                <label className={s.label} htmlFor="auth-password">
                  Password (minimum 12 characters)
                </label>
                <input
                  id="auth-password"
                  className={s.input}
                  type="password"
                  required
                  minLength={12}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            )}

            <button type="submit" className={s.buttonPrimary} disabled={busy}>
              {mode === "signin"
                ? "Sign in"
                : mode === "signup"
                  ? "Create account"
                  : "Send reset link"}
            </button>
          </form>

          <p style={{ marginTop: 18 }}>
            By signing in, you agree to our <Link href="/terms">Terms of Service</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      )}
    </div>
  );
}
