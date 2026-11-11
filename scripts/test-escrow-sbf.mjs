import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
const output = resolve(
  process.env.AGUS_SBF_OUTPUT_DIR ?? ".data/agus2-sbf-artifacts",
);
if (!existsSync(resolve(output, "agus_devnet_escrow.so")))
  throw new Error("COMPILED_SBF_ARTIFACT_REQUIRED");
const env = { ...process.env, AGUS_ESCROW_SBF_TEST: "1", SBF_OUT_DIR: output };
delete env.AI_API_KEY;
delete env.NETLIFY_AUTH_TOKEN;
delete env.PAYSTACK_SECRET_KEY;
const result = spawnSync(
  "cargo",
  [
    "test",
    "--manifest-path",
    "escrow/Cargo.toml",
    "--locked",
    "--features",
    "bank-tests",
    "--test",
    "bank",
  ],
  { stdio: "inherit", env },
);
process.exitCode = result.status ?? 1;
