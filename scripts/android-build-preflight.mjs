import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  statfsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

function listDirs(path) {
  if (!path || !existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readRequiredVersions() {
  const tomlPath = resolve(
    "node_modules/react-native/gradle/libs.versions.toml",
  );
  if (!existsSync(tomlPath)) return null;
  const text = readFileSync(tomlPath, "utf8");
  const pick = (name) =>
    text.match(new RegExp(`^${name}\\s*=\\s*"([^"]+)"`, "m"))?.[1] ?? null;
  return {
    compileSdk: pick("compileSdk"),
    targetSdk: pick("targetSdk"),
    buildTools: pick("buildTools"),
    ndkVersion: pick("ndkVersion"),
    agp: pick("agp"),
    kotlin: pick("kotlin"),
  };
}

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
const candidateSdks = [
  sdk,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Android", "Sdk"),
  join(homedir(), "Android", "Sdk"),
  join(homedir(), "Library", "Android", "sdk"),
].filter(Boolean);
const detectedSdkPath = candidateSdks.find((p) => existsSync(p)) ?? null;
const inspectedSdk = sdk && existsSync(sdk) ? sdk : detectedSdkPath;

const candidateJavas = [
  process.env.JAVA_HOME,
  "C:\\Program Files\\Android\\Android Studio\\jbr",
].filter(Boolean);
const detectedJavaHome = candidateJavas.find((p) => existsSync(p)) ?? null;

const requiredVersions = readRequiredVersions();
const installedPlatforms = inspectedSdk
  ? listDirs(join(inspectedSdk, "platforms"))
  : [];
const installedBuildTools = inspectedSdk
  ? listDirs(join(inspectedSdk, "build-tools"))
  : [];
const installedNdk = inspectedSdk ? listDirs(join(inspectedSdk, "ndk")) : [];
const installedCmake = inspectedSdk
  ? listDirs(join(inspectedSdk, "cmake"))
  : [];
const hasPlatformTools = Boolean(
  inspectedSdk &&
    (existsSync(join(inspectedSdk, "platform-tools", "adb")) ||
      existsSync(join(inspectedSdk, "platform-tools", "adb.exe"))),
);
const hasLicenses = Boolean(
  inspectedSdk &&
    existsSync(join(inspectedSdk, "licenses")) &&
    readdirSync(join(inspectedSdk, "licenses")).length > 0,
);

const missingRequiredComponents = [];
if (!inspectedSdk) {
  missingRequiredComponents.push("android-sdk");
} else {
  if (!hasPlatformTools) missingRequiredComponents.push("platform-tools");
  if (!hasLicenses) missingRequiredComponents.push("licenses");
  if (
    requiredVersions?.compileSdk &&
    !installedPlatforms.some((p) =>
      p.startsWith(`android-${requiredVersions.compileSdk}`),
    )
  )
    missingRequiredComponents.push(`platforms;android-${requiredVersions.compileSdk}`);
  if (
    requiredVersions?.buildTools &&
    !installedBuildTools.includes(requiredVersions.buildTools)
  )
    missingRequiredComponents.push(`build-tools;${requiredVersions.buildTools}`);
  if (requiredVersions?.ndkVersion && !installedNdk.includes(requiredVersions.ndkVersion))
    missingRequiredComponents.push(`ndk;${requiredVersions.ndkVersion}`);
  if (installedCmake.length === 0) missingRequiredComponents.push("cmake");
}

const enoughSpace = volumes.every((v) => v.freeGiB >= minimumGiB);
const sdkToolchainReady = missingRequiredComponents.length === 0;
const canAttemptBuild =
  enoughSpace &&
  !!sdk &&
  existsSync(sdk) &&
  !!process.env.JAVA_HOME &&
  existsSync(process.env.JAVA_HOME) &&
  sdkToolchainReady;

const report = {
  mode: "read-only",
  minimumFreeGiBPerBuildVolume: minimumGiB,
  threshold:
    "conservative preflight budget, not an exact build-size prediction",
  volumes,
  sdkConfigured: !!sdk,
  sdkExists: !!sdk && existsSync(sdk),
  detectedSdkPath,
  javaHomeConfigured: !!process.env.JAVA_HOME,
  detectedJavaHome,
  requiredVersions,
  sdkDetails: {
    installedPlatforms,
    installedBuildTools,
    installedNdk,
    installedCmake,
    hasPlatformTools,
    hasLicenses,
  },
  missingRequiredComponents,
  sdkToolchainReady,
  enoughSpace,
  canAttemptBuild,
  cleanupPerformed: false,
  physicalAcceptance: "pending-human-device",
  guidance:
    "Use sufficient local storage, a single intended ABI and bounded Gradle workers. On Windows with OpenJDK 25, pass -Dkotlin.compiler.execution.strategy=in-process. Do not delete source, signing material, databases, acceptance evidence or unrelated caches. No paid build service is invoked.",
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--check") && !report.canAttemptBuild)
  process.exitCode = 2;
