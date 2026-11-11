import { spawnSync } from "node:child_process";
if (!process.env.AGUS_TEST_DATABASE_URL?.match(/^postgres(?:ql)?:\/\//))
  throw new Error(
    "AGUS_TEST_DATABASE_URL_REQUIRED_FOR_REAL_POSTGRES_ACCEPTANCE",
  );
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/marketplace-usd.test.ts",
    "tests/payment-requests-platform.test.ts",
    "tests/escrow-client.test.ts",
    "tests/request-discovery.test.ts",
    "tests/migrations.test.ts",
    "tests/mobile-policy.test.ts",
  ],
  {
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "test",
      AGUS_TEST_DATABASE_URL: process.env.AGUS_TEST_DATABASE_URL,
      PAYMENT_MODE: "fixture",
      AI_PROVIDER: "none",
      AI_API_KEY: "",
      PAYSTACK_SECRET_KEY: "",
    },
  },
);
process.exitCode = result.status ?? 1;
