import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import s from "./public-site.module.css";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.headerInner}>
          <Link href="/" className={s.brandLink} aria-label="AGUS home">
            <Image
              unoptimized
              className={s.brandWordmark}
              src="/brand/agus-wordmark-dark.png"
              width={128}
              height={42}
              alt="agus."
              priority
            />
          </Link>
          <nav className={s.nav} aria-label="Public navigation">
            <Link href="/">Overview</Link>
            <Link href="/support">Support</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/auth" className={s.navCta}>
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className={s.main}>{children}</main>
      <footer className={s.footer}>
        <div className={s.footerInner}>
          <span>agus. · AGUS Crypto (Solana Devnet)</span>
          <div className={s.footerLinks}>
            <a href="mailto:support@mail.grindcity.app">support@mail.grindcity.app</a>
            <Link href="/privacy">Privacy Policy</Link>
            <Link href="/terms">Terms of Service</Link>
            <Link href="/support">Support</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
