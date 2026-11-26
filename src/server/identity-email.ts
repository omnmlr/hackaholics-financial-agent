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

  async function send(email: string, code: string) {
    invariant(key && from, "IDENTITY_EMAIL_CONFIGURATION_REQUIRED", 503);
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
        subject: "Your AGUS sign-in code",
        text: `Your AGUS sign-in code is ${code}. It expires in 5 minutes. If you did not request it, you can ignore this message.`,
      }),
    });
    await response.body?.cancel();
    invariant(response.ok, "IDENTITY_EMAIL_UNAVAILABLE", 503);
  }

  return { configured: !!(key && from), publicRegistration, send };
}
