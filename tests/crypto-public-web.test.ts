import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CryptoPublicHome } from "@/components/agus/crypto-public-home";
import PrivacyPage from "@/app/privacy/page";
import TermsPage from "@/app/terms/page";
import SupportPage from "@/app/support/page";
import AuthPage from "@/app/auth/page";
import ResetPasswordPage from "@/app/reset-password/page";
import HomePage from "@/app/page";

describe("AGUS Crypto public launch website & auth pages", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the AGUS Crypto public homepage on /, /privacy, /terms, /support in devnet profile", async () => {
    vi.stubEnv("AGUS_ENVIRONMENT", "devnet");
    vi.stubEnv("PAYMENT_MODE", "fixture");
    vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");

    const homeHtml = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({}) }),
    );
    expect(homeHtml).toContain("agus.");
    expect(homeHtml).toContain("/brand/agus-lockup-dark.png");
    expect(homeHtml).toContain("/privacy");
    expect(homeHtml).toContain("/terms");
    expect(homeHtml).toContain("/support");
    expect(homeHtml).toContain("/auth");

    const privacyHtml = renderToStaticMarkup(createElement(PrivacyPage));
    expect(privacyHtml).toContain("Privacy Policy");
    expect(privacyHtml).toContain("mail.grindcity.app");
    expect(privacyHtml).toContain("Google OAuth");

    const termsHtml = renderToStaticMarkup(createElement(TermsPage));
    expect(termsHtml).toContain("Terms of Service");
    expect(termsHtml).toContain("Solana Devnet");

    const supportHtml = renderToStaticMarkup(createElement(SupportPage));
    expect(supportHtml).toContain("support@mail.grindcity.app");
  });

  it("keeps fixture mode home rendering intact when AGUS_ENVIRONMENT is not devnet", async () => {
    vi.stubEnv("AGUS_ENVIRONMENT", "fixture");
    vi.stubEnv("PAYMENT_MODE", "fixture");
    vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "false");

    const html = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({}) }),
    );
    expect(html).not.toContain("Sign in / Account portal");
    expect(html).toContain("Opening your workspace");
  });

  it("renders passwordless copy and redirects the former reset page", async () => {
    vi.stubEnv("AGUS_AUTH_PUBLIC", "true");
    vi.stubEnv("GOOGLE_CLIENT_ID", "fixture-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "fixture-client-secret");
    vi.stubEnv("RESEND_API_KEY", "re_fixture");
    vi.stubEnv("AGUS_AUTH_EMAIL_FROM", "AGUS <noreply@mail.grindcity.app>");

    const authHtml = renderToStaticMarkup(
      await AuthPage({ searchParams: Promise.resolve({}) }),
    );
    expect(authHtml).toContain("Account Portal");
    expect(authHtml).toContain("Continue with Google or enter a one-time code");
    expect(authHtml).toContain("Checking session status...");

    expect(() => ResetPasswordPage()).toThrow("NEXT_REDIRECT");
  });

  it("exposes standalone CryptoPublicHome markup", () => {
    const html = renderToStaticMarkup(createElement(CryptoPublicHome));
    expect(html).toContain("Non-custodial by construction");
  });
});
