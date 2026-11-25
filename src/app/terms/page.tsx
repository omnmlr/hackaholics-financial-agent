import type { Metadata } from "next";
import Link from "next/link";
import { PublicShell } from "@/components/agus/public-shell";
import s from "@/components/agus/public-site.module.css";

export const metadata: Metadata = {
  title: "Terms of Service | agus.",
  description:
    "Terms governing use of AGUS Crypto web and mobile services, non-custodial Solana Devnet wallet execution, and AI assistant outputs.",
};

export default function TermsPage() {
  return (
    <PublicShell>
      <p className={s.eyebrow}>Legal</p>
      <h1 className={s.heroTitle}>Terms of Service</h1>
      <p className={s.lead}>
        Effective November 25, 2026 · Applies to <code>https://agus.grindcity.app</code> and
        the AGUS Crypto application.
      </p>

      <section className={s.section}>
        <h2>1. Devnet Prototype Scope</h2>
        <p>
          AGUS Crypto currently operates on Solana Devnet for evaluation, hackathon judging, and
          technical demonstration. Devnet assets carry no monetary value.
        </p>
      </section>

      <section className={s.section}>
        <h2>2. Non-Custodial Authority</h2>
        <p>
          You retain sole custody and control over your external wallets (Phantom and Solflare).
          AGUS prepares transaction reviews and tracks finality, but cannot initiate or sign
          blockchain transactions on your behalf. Always inspect recipient, token amount, network,
          and fee estimates directly in your wallet prompt before approving.
        </p>
      </section>

      <section className={s.section}>
        <h2>3. Informational AI &amp; Research Outputs</h2>
        <p>
          Responses from the AGUS assistant, including Gemini summaries, voice narration, image
          interpretations, and Firecrawl web citations, are provided for informational convenience
          only and do not constitute financial, investment, tax, or legal advice. Authoritative
          transaction status comes exclusively from finalized on-chain RPC verification.
        </p>
      </section>

      <section className={s.section}>
        <h2>4. Acceptable Use</h2>
        <ul>
          <li>Do not submit another person&apos;s private credentials, seed phrases, or keys.</li>
          <li>
            Do not attempt to bypass authentication, origin checks, rate limits, or per-user
            resource isolation.
          </li>
          <li>Automated scraping or abusive load against API endpoints is prohibited.</li>
        </ul>
      </section>

      <section className={s.section}>
        <h2>5. Contact</h2>
        <p>
          Questions regarding these terms may be directed to{" "}
          <a href="mailto:support@mail.grindcity.app">support@mail.grindcity.app</a> or via{" "}
          <Link href="/support">Support</Link>. See also our{" "}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </section>
    </PublicShell>
  );
}
