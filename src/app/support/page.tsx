import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/agus/public-shell";
import s from "@/components/agus/public-site.module.css";

export const metadata: Metadata = {
  title: "Support | agus.",
  description:
    "Support contact, account verification troubleshooting, and Solana Devnet wallet guidance for AGUS Crypto.",
};

export default function SupportPage() {
  return (
    <PublicShell>
      <p className={s.eyebrow}>Help &amp; Operations</p>
      <h1 className={s.heroTitle}>Support</h1>
      <p className={s.lead}>
        Need help signing in, verifying your email, or testing Solana Devnet
        wallet transfers on Android? Use the resources below or reach out
        directly.
      </p>

      <section className={s.section}>
        <h2>Contact</h2>
        <p>
          Support email:{" "}
          <a href="mailto:support@mail.grindcity.app">
            support@mail.grindcity.app
          </a>
        </p>
        <p style={{ marginTop: 8 }}>
          Review our <Link href="/privacy">Privacy Policy</Link> or{" "}
          <Link href="/terms">Terms of Service</Link>, or manage your web
          session in the <Link href="/auth">Account portal</Link>.
        </p>
      </section>

      <section className={s.section}>
        <h2>Account &amp; Email Verification</h2>
        <ul>
          <li>
            Enter your email at the <Link href="/auth">Account portal</Link>.
            Use the six-digit code delivered from{" "}
            <code>mail.grindcity.app</code> to sign in.
          </li>
          <li>
            Google OAuth grants access using standard <code>openid</code>,{" "}
            <code>email</code>, and <code>profile</code> scopes.
          </li>
        </ul>
      </section>

      <section className={s.section}>
        <h2>Android Devnet Wallet Troubleshooting</h2>
        <ul>
          <li>
            <strong>Cluster mismatch:</strong> Switch both Phantom and Solflare
            to <strong>Devnet</strong> before associating wallets or approving a
            review.
          </li>
          <li>
            <strong>Solflare backgrounding on Android:</strong> Disable Android
            Battery Saver for Solflare so wallet handoffs return cleanly to
            AGUS.
          </li>
          <li>
            <strong>Interrupted return:</strong> Unlock AGUS with biometrics and
            tap <em>Check existing attempt</em> before creating another review.
          </li>
        </ul>
      </section>
    </PublicShell>
  );
}
