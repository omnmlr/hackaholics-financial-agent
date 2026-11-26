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
  initialError,
}: {
  googleEnabled: boolean;
  publicRegistration: boolean;
  emailConfigured: boolean;
  initialError?: string;
}) {
  const [session, setSession] = useState<SessionPayload>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [step, setStep] = useState<"email" | "otp" | "totp">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

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
        setError(
          String(payload.message ?? payload.code ?? `HTTP ${res.status}`),
        );
        return;
      }
      if (
        typeof payload.url === "string" &&
        payload.url.startsWith("https://")
      ) {
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

  async function sendCode() {
    await runAuth(async () => {
      const { res } = await postJson("email-otp/send-verification-otp", {
        email,
        type: "sign-in",
      });
      if (!res.ok)
        throw new Error(
          res.status === 429
            ? "Wait a minute before requesting another code."
            : "The code could not be sent. Please retry shortly.",
        );
      setStep("otp");
      setCode("");
      setMessage("Check your inbox for a six-digit code.");
    });
  }

  async function runAuth(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Sign-in failed. Please retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (step === "email") return sendCode();
    await runAuth(async () => {
      const { res, payload } =
        step === "otp"
          ? await postJson("sign-in/email-otp", { email, otp: code })
          : await postJson("two-factor/verify-totp", { code });
      if (!res.ok)
        throw new Error(
          step === "totp"
            ? "Authenticator code rejected."
            : payload.code === "TOO_MANY_ATTEMPTS"
              ? "Too many attempts. Request a new code."
              : "Code rejected. Check the code or request a new one.",
        );
      setCode("");
      if (payload.twoFactorRedirect === true) {
        setStep("totp");
        return;
      }
      setStep("email");
      await loadSession();
    });
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
            {session.user.name ? ` (${session.user.name})` : ""} · Email
            verified:{" "}
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
          {!publicRegistration && (
            <p className={s.eyebrow}>Invite-only Devnet access</p>
          )}
          <h2>Sign in to AGUS</h2>
          {googleEnabled && (
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
          )}
          {emailConfigured ? (
            <form onSubmit={handleSubmit}>
              {step === "email" ? (
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
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              ) : (
                <div className={s.formGroup}>
                  <label className={s.label} htmlFor="auth-code">
                    {step === "totp"
                      ? "Authenticator code"
                      : "Six-digit email code"}
                  </label>
                  <input
                    id="auth-code"
                    className={s.input}
                    required
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </div>
              )}
              <div className={s.actions}>
                <button
                  type="submit"
                  className={s.buttonPrimary}
                  disabled={busy}
                >
                  {step === "email"
                    ? "Send sign-in code"
                    : "Verify and sign in"}
                </button>
                {step === "otp" && (
                  <button
                    type="button"
                    className={s.buttonSecondary}
                    disabled={busy}
                    onClick={sendCode}
                  >
                    Resend code
                  </button>
                )}
                {step !== "email" && (
                  <button
                    type="button"
                    className={s.buttonSecondary}
                    disabled={busy}
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setMessage(null);
                      setError(null);
                    }}
                  >
                    Change email
                  </button>
                )}
              </div>
            </form>
          ) : (
            <p>Email sign-in is unavailable.</p>
          )}

          <p style={{ marginTop: 18 }}>
            By signing in, you agree to our{" "}
            <Link href="/terms">Terms of Service</Link> and{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      )}
    </div>
  );
}
