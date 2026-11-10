import { afterEach, expect, it, vi } from "vitest";
import { validateEnvironment } from "../src/lib/environment";
import { config } from "../src/lib/config";
import { requireDevnet } from "../src/lib/solana/contracts";
afterEach(() => vi.unstubAllEnvs());
it.each([
  [{ AGUS_ENVIRONMENT: "fixture" }, "simulated", "disabled"],
  [
    {
      AGUS_ENVIRONMENT: "sandbox",
      PAYMENT_MODE: "test",
      PAYSTACK_SECRET_KEY: "sk_test_fixture",
    },
    "provider-sandbox",
    "disabled",
  ],
  [
    { AGUS_ENVIRONMENT: "devnet", AGUS_SOLANA_DEVNET_ENABLED: "true" },
    "simulated",
    "public-devnet",
  ],
  [
    {
      AGUS_ENVIRONMENT: "live",
      PAYMENT_MODE: "live",
      PAYSTACK_SECRET_KEY: "sk_live_fixture",
      DATABASE_URL: "postgresql://fixture.invalid/db",
      APP_ORIGIN: "https://fixture.invalid",
      OPERATOR_PASSWORD_HASH: "fixture-only",
    },
    "merchant-payout",
    "disabled",
  ],
])(
  "validates a distinct profile without enabling personal-bank access: %j",
  (env, banking, solana) => {
    expect(validateEnvironment(env)).toMatchObject({
      banking,
      solana,
      acceptedSourceInstitutions: 0,
    });
  },
);
it.each([
  {},
  { AGUS_ENVIRONMENT: "unknown" },
  { AGUS_ENVIRONMENT: "fixture", PAYSTACK_SECRET_KEY: "sk_live_fixture" },
  { AGUS_ENVIRONMENT: "fixture", AGUS_SOLANA_DEVNET_ENABLED: "true" },
  { AGUS_ENVIRONMENT: "fixture", LIVE_TRANSFERS_ENABLED: "true" },
  {
    AGUS_ENVIRONMENT: "sandbox",
    PAYMENT_MODE: "test",
    PAYSTACK_SECRET_KEY: "sk_live_fixture",
  },
  { AGUS_ENVIRONMENT: "devnet", AGUS_SOLANA_DEVNET_ENABLED: "false" },
  {
    AGUS_ENVIRONMENT: "devnet",
    PAYMENT_MODE: "live",
    AGUS_SOLANA_DEVNET_ENABLED: "true",
  },
  {
    AGUS_ENVIRONMENT: "live",
    PAYMENT_MODE: "live",
    PAYSTACK_SECRET_KEY: "sk_live_fixture",
    DATABASE_URL: "pglite://fixture",
  },
])("rejects mixed or incomplete environments: %j", (env) => {
  expect(() => validateEnvironment(env)).toThrow();
});
it("enforces an explicitly selected profile at both payment and Solana runtime gates", () => {
  vi.stubEnv("AGUS_ENVIRONMENT", "devnet");
  vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
  vi.stubEnv("PAYMENT_MODE", "test");
  expect(() => config()).toThrow(/payment mode/);
  expect(() => requireDevnet()).toThrow(/payment mode/);
});
