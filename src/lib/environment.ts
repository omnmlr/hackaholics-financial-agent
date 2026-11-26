import { AppError } from "./domain";

export type OperationalEnvironment = "fixture" | "sandbox" | "devnet" | "live";
type Environment = Readonly<Record<string, string | undefined>>;

/** Explicit deployment profiles. Legacy configuration remains compatible until
 * AGUS_ENVIRONMENT is selected; new foundation runners must select a profile. */
export function validateEnvironment(env: Environment = process.env) {
  const profile = env.AGUS_ENVIRONMENT;
  if (!profile || !["fixture", "sandbox", "devnet", "live"].includes(profile))
    throw new AppError(
      "Select AGUS_ENVIRONMENT: fixture, sandbox, devnet or live",
      503,
    );
  const mode = env.PAYMENT_MODE ?? "fixture";
  const key = env.PAYSTACK_SECRET_KEY ?? "";
  const devnet = env.AGUS_SOLANA_DEVNET_ENABLED ?? "false";
  const fail = (message: string): never => {
    throw new AppError(`Invalid ${profile} configuration: ${message}`, 503);
  };
  if (!["true", "false"].includes(devnet)) fail("invalid Devnet flag");
  const expectedMode =
    profile === "sandbox" ? "test" : profile === "live" ? "live" : "fixture";
  if (mode !== expectedMode) fail("payment mode does not match profile");
  if (devnet !== (profile === "devnet" ? "true" : "false"))
    fail("Devnet is a separate explicit profile");
  if (profile === "fixture" || profile === "devnet") {
    if (key) fail("financial provider credentials forbidden");
  } else if (!key.startsWith(profile === "sandbox" ? "sk_test_" : "sk_live_")) {
    fail("matching provider credential required");
  }
  if (profile !== "live") {
    for (const name of [
      "LIVE_TRANSFERS_ENABLED",
      "LIVE_OWNER_AUTHORIZED",
      "PAYSTACK_TRANSFERS_ENABLED",
      "LIVE_WEBHOOK_VALIDATED",
      "LIVE_RECONCILIATION_VALIDATED",
    ])
      if (env[name] === "true") fail("live execution flag forbidden");
  } else {
    if (!env.DATABASE_URL?.match(/^postgres(?:ql)?:\/\//))
      fail("PostgreSQL required");
    let origin: URL;
    try {
      origin = new URL(env.APP_ORIGIN ?? "");
    } catch {
      return fail("HTTPS origin required");
    }
    if (origin.protocol !== "https:" || origin.username || origin.password)
      fail("HTTPS origin required");
    if (!env.OPERATOR_PASSWORD_HASH) fail("operator authentication required");
  }
  return {
    profile: profile as OperationalEnvironment,
    banking:
      profile === "fixture" || profile === "devnet"
        ? ("simulated" as const)
        : profile === "sandbox"
          ? ("provider-sandbox" as const)
          : ("merchant-payout" as const),
    solana:
      profile === "devnet" ? ("public-devnet" as const) : ("disabled" as const),
    // A payout credential never establishes personal-bank connectivity.
    acceptedSourceInstitutions: 0 as const,
  };
}

export function validateDeclaredEnvironment() {
  if (process.env.AGUS_ENVIRONMENT !== undefined) validateEnvironment();
}
