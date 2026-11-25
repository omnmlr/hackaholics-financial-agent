import type { Metadata } from "next";
import { PublicShell } from "@/components/agus/public-shell";
import { PublicAuthPanel } from "@/components/agus/public-auth-panel";
import s from "@/components/agus/public-site.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in | agus.",
  description:
    "Sign in to AGUS Crypto using Google or verified email authentication.",
};

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const googleEnabled = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
  const publicRegistration = process.env.AGUS_AUTH_PUBLIC === "true";
  const emailConfigured = Boolean(
    process.env.RESEND_API_KEY && process.env.AGUS_AUTH_EMAIL_FROM,
  );
  const initialVerified = params.verified === "1" || params.verified === "true";
  const initialError =
    typeof params.error === "string" && params.error.length > 0
      ? params.error
      : undefined;

  return (
    <PublicShell>
      <p className={s.eyebrow}>AGUS Identity</p>
      <h1 className={s.heroTitle}>Account Portal</h1>
      <p className={s.lead}>
        Sign in with Google or register a verified email account for AGUS Crypto.
      </p>
      <PublicAuthPanel
        googleEnabled={googleEnabled}
        publicRegistration={publicRegistration}
        emailConfigured={emailConfigured}
        initialVerified={initialVerified}
        initialError={initialError}
      />
    </PublicShell>
  );
}
