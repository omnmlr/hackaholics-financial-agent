import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(process.cwd());

describe("AGUS preflight scripts", () => {
  it("reports structured Android build toolchain readiness and exits 2 when SDK/NDK components are missing in check mode", () => {
    const script = path.join(ROOT, "scripts", "android-build-preflight.mjs");
    const result = spawnSync(process.execPath, [script, "--check"], {
      cwd: ROOT,
      env: {
        ...process.env,
        ANDROID_HOME: path.join(ROOT, ".nonexistent-android-sdk"),
        ANDROID_SDK_ROOT: path.join(ROOT, ".nonexistent-android-sdk"),
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({
      mode: "read-only",
      sdkConfigured: true,
      sdkExists: false,
      sdkToolchainReady: expect.any(Boolean),
      enoughSpace: expect.any(Boolean),
      canAttemptBuild: false,
    });
    expect(parsed.requiredVersions).toMatchObject({
      buildTools: expect.any(String),
      ndkVersion: expect.any(String),
    });
    expect(Array.isArray(parsed.missingRequiredComponents)).toBe(true);
    expect(parsed.missingRequiredComponents.length === 0).toBe(
      parsed.sdkToolchainReady,
    );
  });

  it("reports aligned placeholder escrow program ID and blocks deployment while unconfigured", () => {
    const script = path.join(ROOT, "scripts", "devnet-escrow-preflight.mjs");
    const stdout = execFileSync(process.execPath, [script], {
      cwd: ROOT,
      env: {
        ...process.env,
        AGUS_DEVNET_ESCROW_VERIFIER: "",
        AGUS_DEVNET_ESCROW_ARBITRATORS: "",
      },
      encoding: "utf8",
    });

    const parsed = JSON.parse(stdout);
    expect(parsed).toMatchObject({
      mode: "read-only",
      programId: {
        aligned: true,
        isPlaceholder: true,
        programAddressAccepted: false,
      },
      authorities: {
        verifierConfigured: false,
        arbitratorCount: 0,
        authoritiesConfigured: false,
      },
      readyForOwnerDeployment: false,
    });
    expect(parsed.remainingExternalGates.length).toBeGreaterThanOrEqual(4);
    const checked = spawnSync(process.execPath, [script, "--check"], {
      cwd: ROOT,
      env: { ...process.env, AGUS_DEVNET_ESCROW_VERIFIER: "" },
      encoding: "utf8",
    });
    expect(checked.status).toBe(2);
  });
});
