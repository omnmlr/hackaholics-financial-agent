import { invariant } from "./errors";

export function identityEmail(origin: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AGUS_AUTH_EMAIL_FROM;
  const publicRegistration = process.env.AGUS_AUTH_PUBLIC === "true";
  invariant(
    !publicRegistration ||
      (key && from && new URL(origin).protocol === "https:"),
    "IDENTITY_EMAIL_CONFIGURATION_REQUIRED",
    503,
  );

  async function send(email: string, link: string, action: "verify" | "reset") {
    invariant(key && from, "IDENTITY_EMAIL_CONFIGURATION_REQUIRED", 503);
    const url = new URL(link);
    invariant(
      url.origin === new URL(origin).origin,
      "IDENTITY_EMAIL_LINK_REJECTED",
      503,
    );
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        from,
        to: [email],
        subject:
          action === "verify"
            ? "Verify your AGUS email"
            : "Reset your AGUS password",
        text:
          action === "verify"
            ? `Verify your email for AGUS: ${url}\n\nIf you did not register, you can ignore this message.`
            : `Reset your AGUS password: ${url}\n\nIf you did not request a reset, you can ignore this message.`,
      }),
    });
    await response.body?.cancel();
    invariant(response.ok, "IDENTITY_EMAIL_UNAVAILABLE", 503);
  }

  return { configured: !!(key && from), publicRegistration, send };
}
