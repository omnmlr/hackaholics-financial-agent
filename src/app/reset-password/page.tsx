import type { Metadata } from "next";
import { PublicShell } from "@/components/agus/public-shell";
import { ResetPasswordForm } from "@/components/agus/reset-password-form";
import s from "@/components/agus/public-site.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Reset Password | agus.",
  description: "Complete your AGUS password reset securely.",
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token =
    typeof params.token === "string" && params.token.length > 0
      ? params.token
      : undefined;
  const error =
    typeof params.error === "string" && params.error.length > 0
      ? params.error
      : undefined;

  return (
    <PublicShell>
      <p className={s.eyebrow}>AGUS Account Security</p>
      <h1 className={s.heroTitle}>Reset Password</h1>
      <p className={s.lead}>
        Updating your password revokes existing active sessions across devices.
      </p>
      <ResetPasswordForm token={token} initialError={error} />
    </PublicShell>
  );
}
