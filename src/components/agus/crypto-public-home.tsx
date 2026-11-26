import Image from "next/image";
import Link from "next/link";
import { PublicShell } from "./public-shell";
import s from "./public-site.module.css";

export function CryptoPublicHome() {
  return (
    <PublicShell>
      <section>
        <Image
          unoptimized
          className={s.heroLockup}
          src="/brand/agus-lockup-dark.png"
          width={642}
          height={263}
          alt="AGUS Crypto"
          priority
        />
        <p className={s.eyebrow}>AGUS Crypto · Solana Devnet Companion</p>
        <h1 className={s.heroTitle}>
          Understand your crypto clearly. Approve every transaction in your own wallet.
        </h1>
        <p className={s.lead}>
          AGUS pairs deterministic multi-RPC Solana reads with voice, visual review, grounded
          citations, and non-custodial Mobile Wallet Adapter execution in Phantom and Solflare.
          AGUS never holds your seed phrases or private signing keys.
        </p>
        <div className={s.actions}>
          <Link href="/auth" className={s.buttonPrimary}>
            Sign in / Account portal
          </Link>
          <Link href="/support" className={s.buttonSecondary}>
            Support &amp; Android setup
          </Link>
          <a href="/api/v1/ready" className={s.buttonSecondary}>
            API health
          </a>
          <a href="/api/v1/openapi" className={s.buttonSecondary}>
            OpenAPI 3.1.0
          </a>
        </div>
      </section>

      <div className={s.grid}>
        <article className={s.card}>
          <h2 className={s.cardTitle}>Non-custodial by construction</h2>
          <p className={s.cardBody}>
            Connect Phantom or Solflare on Solana Devnet with signed ownership challenges. Every
            transfer builds an immutable server review that only your wallet signs and submits.
          </p>
        </article>
        <article className={s.card}>
          <h2 className={s.cardTitle}>Multimodal assistant</h2>
          <p className={s.cardBody}>
            Ask about balances, activity, fees, or screenshots by text or voice. Server checks
            prevent seed phrases or private keys from reaching external AI providers.
          </p>
        </article>
        <article className={s.card}>
          <h2 className={s.cardTitle}>Finalized receipt &amp; alerts</h2>
          <p className={s.cardBody}>
            Background reconciliation corroborates transaction finality across independent Devnet
            RPC endpoints, recovering safely if Android switches apps or drops a callback.
          </p>
        </article>
      </div>

      <section className={s.section}>
        <h2>Identity &amp; Google sign-in disclosures</h2>
        <p>
          AGUS uses Google OAuth (<code>openid</code>, <code>email</code>, <code>profile</code>)
          and verified email authentication to associate your wallets, alerts, and conversation
          history with your account. Read our{" "}
          <Link href="/privacy">Privacy Policy</Link>,{" "}
          <Link href="/terms">Terms of Service</Link>, and{" "}
          <Link href="/support">Support page</Link> for complete data handling and wallet
          guidance.
        </p>
      </section>
    </PublicShell>
  );
}
