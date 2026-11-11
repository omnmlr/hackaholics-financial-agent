import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const tools = process.env.AGUS_SBF_PLATFORM_TOOLS;
if (!tools) throw new Error("VERIFIED_PLATFORM_TOOLS_DIRECTORY_REQUIRED");
const cargo = resolve(tools, "rust/bin/cargo"),
  rustc = resolve(tools, "rust/bin/rustc");
const output = resolve(
  process.env.AGUS_SBF_OUTPUT_DIR ?? ".data/agus2-sbf-artifacts",
);
const target = resolve(
  process.env.CARGO_TARGET_DIR ?? ".data/agus2-sbf-target",
);
process.umask(0o077);
mkdirSync(output, { recursive: true });
const env = {
  ...process.env,
  RUSTC: rustc,
  CC: resolve(tools, "llvm/bin/clang"),
  AR: resolve(tools, "llvm/bin/llvm-ar"),
  CARGO_TARGET_DIR: target,
  RUSTFLAGS: "-Zremap-cwd-prefix=",
};
delete env.AI_API_KEY;
delete env.NETLIFY_AUTH_TOKEN;
delete env.PAYSTACK_SECRET_KEY;
const version = spawnSync(rustc, ["--version"], { encoding: "utf8", env });
if (version.status !== 0 || !version.stdout.includes("1.95.0"))
  throw new Error("PINNED_SBF_COMPILER_1_95_REQUIRED");
// Invoke the checksum-verified official fork directly. The older CLI SDK's
// post-processing shell script installs a second, incompatible default toolchain
// into the home cache even with --skip-tools-install. No SDK installer runs here.
const built = spawnSync(
  cargo,
  [
    "build",
    "--manifest-path",
    "escrow/programs/agus-devnet-escrow/Cargo.toml",
    "--target",
    "sbpf-solana-solana",
    "--release",
    "--locked",
    "--jobs",
    "2",
  ],
  { stdio: "inherit", env },
);
if (built.status !== 0) process.exit(built.status ?? 1);
const source = resolve(
  target,
  "sbpf-solana-solana/release/agus_devnet_escrow.so",
);
const artifact = resolve(output, "agus_devnet_escrow.so");
const stripped = spawnSync(
  resolve(tools, "llvm/bin/llvm-objcopy"),
  ["--strip-all", source, artifact],
  { stdio: "inherit", env },
);
if (stripped.status !== 0) process.exit(stripped.status ?? 1);
const bytes = readFileSync(artifact);
if (
  bytes.length < 128 ||
  bytes.subarray(0, 4).toString("hex") !== "7f454c46" ||
  bytes.readUInt32LE(48) !== 0
)
  throw new Error("VALID_SBF_ELF_REQUIRED");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  artifact,
  sha256,
  compiler: version.stdout.trim(),
  platformTools: "v1.58 (Rust 1.95.0 / LLVM 22)",
  architecture: "v0",
  builtAt: new Date().toISOString(),
  deployed: false,
  programAddressAccepted: false,
  genuineWalletExecutionAccepted: false,
  notice:
    "Local compiled prototype only. Devnet deployment awaits an owner-controlled program address and wallet. Production release separately requires independent review and key governance. No network transaction is signed or sent by this build.",
};
writeFileSync(
  resolve(output, "build-evidence.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(JSON.stringify({ artifact, sha256, deployed: false }));
