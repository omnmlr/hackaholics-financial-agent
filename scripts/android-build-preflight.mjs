import { existsSync, statSync, statfsSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
const minimumGiB = Number(process.env.AGUS_ANDROID_MIN_FREE_GIB ?? 8);
if (!Number.isFinite(minimumGiB) || minimumGiB < 1)
  throw new Error("INVALID_BUILD_SPACE_THRESHOLD");
const paths = [resolve("apps/mobile"), tmpdir()];
const volumes = paths.map((path) => {
  const f = statfsSync(path, { bigint: true });
  return {
    path,
    device: statSync(path).dev,
    freeBytes: (f.bavail * f.bsize).toString(),
    totalBytes: (f.blocks * f.bsize).toString(),
    freeGiB: Number(f.bavail * f.bsize) / 1024 ** 3,
  };
});
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
const enoughSpace = volumes.every((v) => v.freeGiB >= minimumGiB);
const report = {
  mode: "read-only",
  minimumFreeGiBPerBuildVolume: minimumGiB,
  threshold:
    "conservative preflight budget, not an exact build-size prediction",
  volumes,
  sdkConfigured: !!sdk,
  sdkExists: !!sdk && existsSync(sdk),
  javaHomeConfigured: !!process.env.JAVA_HOME,
  enoughSpace,
  canAttemptBuild: enoughSpace && !!sdk && existsSync(sdk),
  cleanupPerformed: false,
  physicalAcceptance: "pending-human-device",
  guidance:
    "Use sufficient local storage, a single intended ABI and bounded Gradle workers. Do not delete source, signing material, databases, acceptance evidence or unrelated caches. No paid build service is invoked.",
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--check") && !report.canAttemptBuild)
  process.exitCode = 2;
