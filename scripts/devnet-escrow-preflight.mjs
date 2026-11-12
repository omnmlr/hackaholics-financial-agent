import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";

const PLACEHOLDER_PROGRAM_ID = "AYCkNeJSmk99TSDYq7tH7yRmAfv64vw6vA6SvT732yCi";

function checkBinary(cmd, args = ["--version"]) {
  const result = spawnSync(cmd, args, { encoding: "utf8", timeout: 5000 });
  if (result.error || result.status !== 0)
    return { installed: false, version: null };
  return {
    installed: true,
    version: (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] ?? null,
  };
}

function readProgramId(path, pattern) {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8").match(pattern)?.[1] ?? null;
}

function isValidPubkey(value) {
  if (!value) return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

const rustLibId = readProgramId(
  resolve("escrow/programs/agus-devnet-escrow/src/lib.rs"),
  /declare_id!\("([^"]+)"\)/,
);
const anchorTomlId = readProgramId(
  resolve("escrow/Anchor.toml"),
  /agus_devnet_escrow\s*=\s*"([^"]+)"/,
);
const tsModuleId = readProgramId(
  resolve("src/server/escrow/devnet.ts"),
  /new PublicKey\(\s*"([^"]+)"\s*,?\s*\)/,
);
const apiV1Id = readProgramId(
  resolve("src/app/api/v1/[...path]/route.ts"),
  /programId:\s*"([^"]+)"/,
);

const declaredIds = [rustLibId, anchorTomlId, tsModuleId, apiV1Id];
const programIdsAligned =
  declaredIds.every(Boolean) && new Set(declaredIds).size === 1;
const programAddressAccepted =
  programIdsAligned && rustLibId !== PLACEHOLDER_PROGRAM_ID;

const verifier = process.env.AGUS_DEVNET_ESCROW_VERIFIER ?? "";
const arbitrators = (process.env.AGUS_DEVNET_ESCROW_ARBITRATORS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const authoritiesConfigured =
  isValidPubkey(verifier) &&
  arbitrators.length === 3 &&
  arbitrators.every(isValidPubkey) &&
  new Set([verifier, ...arbitrators]).size === 4;

const sbfToolsDir = process.env.AGUS_SBF_PLATFORM_TOOLS ?? null;
const sbfArtifact = resolve(
  process.env.AGUS_SBF_OUTPUT_DIR ?? ".data/agus2-sbf-artifacts",
  "agus_devnet_escrow.so",
);

const report = {
  mode: "read-only",
  platform: process.platform,
  programId: {
    rustLibId,
    anchorTomlId,
    tsModuleId,
    apiV1Id,
    aligned: programIdsAligned,
    isPlaceholder: rustLibId === PLACEHOLDER_PROGRAM_ID,
    programAddressAccepted,
  },
  toolchain: {
    cargo: checkBinary("cargo"),
    rustc: checkBinary("rustc"),
    solanaCli: checkBinary("solana"),
    anchorCli: checkBinary("anchor"),
    sbfPlatformToolsConfigured: Boolean(sbfToolsDir && existsSync(sbfToolsDir)),
    sbfArtifactPresent: existsSync(sbfArtifact),
    clientVectorPresent: existsSync(resolve("escrow/fixtures/client-vector.json")),
    platformToolsPinned: "v1.58 (Rust 1.95.0 / LLVM 22)",
  },
  authorities: {
    verifierConfigured: isValidPubkey(verifier),
    arbitratorCount: arbitrators.length,
    authoritiesConfigured,
  },
  remainingExternalGates: [
    "Owner-controlled Devnet SOL/test-USDC transfer signing & finalized verification (Sprint 1)",
    ...(programAddressAccepted
      ? []
      : ["Owner-controlled escrow program keypair and coordinated ID replacement"]),
    ...(!existsSync(sbfArtifact)
      ? ["Linux/WSL2 SBF build with checksum-verified Anza platform-tools v1.58"]
      : []),
    "Funded Devnet deployer wallet & explicit owner deployment authorization",
    ...(!authoritiesConfigured
      ? ["Four distinct Devnet authority public keys (AGUS_DEVNET_ESCROW_VERIFIER and 3 AGUS_DEVNET_ESCROW_ARBITRATORS)"]
      : []),
    "Independent program security review and key governance before any non-prototype release",
  ],
  readyForOwnerDeployment: false,
};

console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--check") && !report.readyForOwnerDeployment)
  process.exitCode = 2;
