import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/agus/public-shell";
import s from "@/components/agus/public-site.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy | agus.",
  description:
    "How AGUS handles Google OAuth identity, email verification, public Solana Devnet reads, multimodal assistant requests, and non-custodial wallet privacy.",
};

export default function PrivacyPage() {
  return (
    <PublicShell>
      <p className={s.eyebrow}>Legal &amp; Data Handling</p>
      <h1 className={s.heroTitle}>Privacy Policy</h1>
      <p className={s.lead}>
        Effective November 25, 2026 · Applies to <code>https://agus.grindcity.app</code> and
        connected AGUS Crypto mobile clients.
      </p>

      <section className={s.section}>
        <h2>1. Identity &amp; Google OAuth Data</h2>
        <p>
          When you sign in with Google or register with email, AGUS collects only the minimum
          identity attributes needed to maintain your account and isolate your workspace:
        </p>
        <ul>
          <li>
            <strong>Google OAuth scopes:</strong> <code>openid</code>, <code>email</code>, and{" "}
            <code>profile</code> (your verified email address, display name, and optional avatar
            URL).
          </li>
          <li>
            <strong>Email &amp; session records:</strong> Email address, hashed credentials (if
            using password login), Better Auth session tokens stored in encrypted/HTTP-only
            cookies, and verification or password-reset timestamps.
          </li>
          <li>
            <strong>Use limitation:</strong> AGUS never sells Google user data, uses it for
            advertising, or grants third-party data brokers access.
          </li>
        </ul>
      </section>

      <section className={s.section}>
        <h2>2. Transactional Email</h2>
        <p>
          Verification links and password-reset emails are transmitted via Resend from{" "}
          <code>mail.grindcity.app</code> strictly to complete account security flows you initiate.
        </p>
      </section>

      <section className={s.section}>
        <h2>3. Non-Custodial Wallet &amp; Solana Data</h2>
        <p>
          AGUS is non-custodial. AGUS never requests, accesses, transmits, or stores seed phrases,
          recovery mnemonics, or private signing keys. Wallet connections store only public Solana
          addresses, signed ownership challenge proofs, and Devnet balances/activity read from
          public Solana RPC nodes. Transactions are signed exclusively inside Phantom or Solflare via
          Mobile Wallet Adapter.
        </p>
      </section>

      <section className={s.section}>
        <h2>4. AI, Voice &amp; Image Processing</h2>
        <ul>
          <li>
            <strong>Text &amp; vision:</strong> Questions and screenshots you submit in the
            assistant are screened locally for accidental seed phrases or keys before being sent to
            Google Gemini for interpretation.
          </li>
          <li>
            <strong>Voice:</strong> Audio recordings you record and reply audio synthesis use
            ElevenLabs only when triggered by your action.
          </li>
          <li>
            <strong>Web citations:</strong> Public topic lookups use Firecrawl on public web pages
            only and never include wallet identifiers or account records.
          </li>
        </ul>
      </section>

      <section className={s.section}>
        <h2>5. Retention &amp; Deletion</h2>
        <p>
          Account records, wallet associations, and alerts persist in isolated PostgreSQL storage
          only as long as your account remains active. To request deletion or ask privacy questions,
          contact{" "}
          <a href="mailto:support@mail.grindcity.app">support@mail.grindcity.app</a> or visit our{" "}
          <Link href="/support">Support page</Link>.
        </p>
      </section>
    </PublicShell>
  );
}
