import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Android } from "./android";
import { assertSolTransfer, connection, finalizedTransaction, startWindow } from "./chain";
import { configSchema, diagnosis, id, RunFailure, type Config, type FailureCode, type Step } from "./contracts";

export type Report = {
  version: 1;
  runId: string;
  scenario: string;
  title: string;
  scenarioSha256: string;
  cluster: Config["network"]["cluster"];
  state: "running" | "passed" | "failed";
  startedAt: string;
  finishedAt?: string;
  device?: Awaited<ReturnType<Android["describe"]>>;
  deviceProfile?: Awaited<ReturnType<Android["profile"]>>;
  lease?: { deviceId: string; acquiredAt: string; releasedAt?: string };
  builds?: { apk: string; package: string; sha256: string }[];
  artifactDigests?: Record<string, string>;
  chainWindow?: Awaited<ReturnType<typeof startWindow>>;
  callback?: Awaited<ReturnType<Android["callback"]>>;
  receipt?: ReturnType<typeof assertSolTransfer> & { payerSource: "scenario" | "wallet-callback" };
  artifacts: string[];
  steps: { action: Step["action"]; state: "running" | "passed" | "failed"; at: string }[];
  failure?: { code: FailureCode; remedy: string };
};

export async function fileSha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function openRunner(configPath: string, evidenceRoot: string) {
  const config = configSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
  return new Runner(config, dirname(resolve(configPath)), resolve(evidenceRoot));
}

type RegisteredDevice = { id: string; config: Config["device"]; lock: string };

export class Runner {
  private readonly devices: RegisteredDevice[];

  constructor(readonly config: Config, private readonly configDir: string, private readonly evidenceRoot: string) {
    this.devices = [config.device, ...config.additionalDevices].map((device, index) => {
      const key = createHash("sha256").update(device.serial).digest("hex").slice(0, 20);
      return { id: device.id ?? `runner-device-${index + 1}`, config: device,
        lock: join(tmpdir(), `agus-test-${process.getuid?.() ?? "user"}-${key}.lock`) };
    });
    if (new Set(this.devices.map((device) => device.id)).size !== this.devices.length ||
        new Set(this.devices.map((device) => device.config.serial)).size !== this.devices.length) {
      throw new Error("Device aliases and serials must be unique");
    }
    for (const scenario of Object.values(config.scenarios)) {
      if (scenario.steps.filter((step) => step.action === "sol-transfer").length > 1) throw new Error("A scenario supports one transaction assertion");
      const captures = new Set<string>();
      for (const step of scenario.steps) {
        if (step.action === "capture") {
          if (captures.has(step.name) || step.name === "failure-screen") throw new Error("Capture names must be unique and avoid reserved names");
          captures.add(step.name);
        }
        const packageName = step.action === "install" ? (Object.hasOwn(config.apks, step.apk) ? config.apks[step.apk].package : undefined)
          : "selector" in step ? step.selector.package
            : "package" in step ? step.package : null;
        if (packageName !== null && (!packageName || !scenario.packages.includes(packageName))) {
          throw new Error("Scenario references an unapproved package or APK");
        }
      }
    }
  }

  async describe() {
    const devices = await Promise.all(this.devices.map(async (device) => {
      const [observed, leased] = await Promise.all([
        new Android(device.config).describe().catch(() => null),
        access(device.lock).then(() => true).catch(() => false),
      ]);
      return {
        id: device.id, kind: device.config.kind, label: device.config.label ?? null,
        state: leased ? "leased" : observed ? "online" : "offline",
        evidence: { declared: true, runnerObserved: Boolean(observed), hardwareAttested: false },
        observed,
      };
    }));
    return {
      devices,
      device: { kind: this.config.device.kind, isolated: true, seekerVerified: false },
      cluster: this.config.network.cluster,
      scenarios: Object.entries(this.config.scenarios).map(([scenario, { title }]) => ({ scenario, title })),
    };
  }

  async get(runId: string): Promise<Report> {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(runId)) throw new Error("Invalid run ID");
    return JSON.parse(await readFile(join(this.evidenceRoot, runId, "report.json"), "utf8"));
  }

  start(scenarioId: string, deviceId?: string) {
    return new Promise<string>((resolve, reject) => {
      void this.run(scenarioId, deviceId, resolve).catch(reject);
    });
  }

  async run(scenarioId: string, deviceId?: string, onStart?: (runId: string) => void): Promise<Report> {
    const name = id.parse(scenarioId);
    if (!Object.hasOwn(this.config.scenarios, name)) throw new Error("Unknown operator-approved scenario");
    const scenario = this.config.scenarios[name];
    const matching = this.devices.filter(({ id, config }) =>
      (!deviceId || id === deviceId) && (!scenario.deviceKind || scenario.deviceKind === config.kind));
    if (!matching.length) throw new RunFailure("DEVICE_UNAVAILABLE");
    await mkdir(this.evidenceRoot, { recursive: true, mode: 0o700 });
    const candidates = await Promise.all(matching.map(async (device) => {
      const android = new Android(device.config);
      const details = await android.describe().catch(() => null);
      return { device, android, details };
    }));
    const online = candidates.filter(({ details }) => details !== null);
    const candidate = await this.allocate(online.length ? online : candidates.slice(0, 1));
    const { android, details, device: { lock, id: selectedDeviceId } } = candidate;
    const rpc = connection(this.config.network);
    const packages = new Set(scenario.packages);
    const runId = randomUUID();
    const directory = join(this.evidenceRoot, runId);
    const reportPath = join(directory, "report.json");
    const builds = scenario.steps.flatMap((step) => {
      if (step.action !== "install") return [];
      const approved = this.config.apks[step.apk];
      return [{ apk: step.apk, package: approved.package, sha256: approved.sha256 }];
    });
    const startedAt = new Date().toISOString();
    const report: Report = {
      lease: { deviceId: selectedDeviceId, acquiredAt: startedAt },
      builds, artifactDigests: {},
      version: 1, runId, scenario: scenarioId, title: scenario.title,
      scenarioSha256: createHash("sha256").update(JSON.stringify({
        scenario, network: this.config.network,
        apks: builds.map(({ sha256 }) => sha256),
      })).digest("hex"),
      cluster: this.config.network.cluster,
      state: "running", startedAt, artifacts: [], steps: [],
    };
    const save = async () => {
      await writeFile(reportPath + ".tmp", JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
      await rename(reportPath + ".tmp", reportPath);
    };
    const artifact = async (name: string, data: Buffer | string) => {
      await writeFile(join(directory, name), data, { flag: "wx", mode: 0o600 });
      report.artifacts.push(name);
      report.artifactDigests![name] = createHash("sha256").update(data).digest("hex");
    };
    const capture = async (name: string) => {
      const screenshot = await android.capture(packages);
      await artifact(name + ".png", screenshot);
      await artifact(name + ".ui.json", JSON.stringify(await android.ui(packages), null, 2) + "\n");
    };
    let since: string | undefined;
    try {
      await writeFile(join(lock, "owner.json"), JSON.stringify({ pid: process.pid, runId }), { mode: 0o600 });
      await mkdir(directory, { mode: 0o700 });
      await save();
      onStart?.(runId);
      if (!details) throw new RunFailure("DEVICE_UNAVAILABLE");
      report.device = details;
      report.deviceProfile = await android.profile();
      if (scenario.steps.some((step) => step.action === "sol-transfer")) {
        report.chainWindow = await startWindow(rpc, this.config.network);
      }
      since = await android.deviceTime();
      for (const step of scenario.steps) {
        const entry: Report["steps"][number] = { action: step.action, state: "running", at: new Date().toISOString() };
        report.steps.push(entry);
        await save();
        try {
          switch (step.action) {
            case "install": {
              const apk = this.config.apks[step.apk];
              const temporary = await mkdtemp(join(directory, "stage-"));
              try {
                const path = join(temporary, "target.apk");
                await copyFile(resolve(this.configDir, apk.path), path).catch(() => { throw new RunFailure("APK_MISMATCH"); });
                if (await fileSha256(path) !== apk.sha256) throw new RunFailure("APK_MISMATCH");
                await android.install(path);
              } finally {
                await rm(temporary, { recursive: true, force: true });
              }
              break;
            }
            case "launch": await android.launch(step.package); break;
            case "wait": await android.select(step.selector); break;
            case "tap": await android.tap(step.selector); break;
            case "capture": await capture(step.name); break;
            case "sol-transfer": {
              report.callback = await android.callback(step.package, since, step.timeoutSeconds * 1000);
              await artifact("wallet-callback.json", JSON.stringify(report.callback, null, 2) + "\n");
              await save();
              if (report.callback.outcome === "failed") throw new RunFailure(report.callback.code);
              if (step.payer && step.payer !== report.callback.payer) throw new RunFailure("CHAIN_MISMATCH");
              const chainTx = await finalizedTransaction(rpc, report.callback.signature, step.timeoutSeconds * 1000);
              report.receipt = {
                ...assertSolTransfer(chainTx, report.callback.signature, report.chainWindow!.slot, {
                  payer: report.callback.payer, recipient: step.recipient, lamports: step.lamports,
                }),
                payerSource: step.payer ? "scenario" : "wallet-callback",
              };
              break;
            }
          }
          entry.state = "passed";
        } catch (error) {
          entry.state = "failed";
          throw error;
        }
      }
      report.state = "passed";
    } catch (error) {
      let code = error instanceof RunFailure ? error.code : "INTERNAL";
      if (since && ["UI_TIMEOUT", "CALLBACK_MISSING", "START_WINDOW_TIMEOUT", "ANDROID_COMMAND"].includes(code)) {
        const crashes = await android.crashes(packages, since).catch(() => []);
        if (crashes.length) {
          await artifact("android-crash.json", JSON.stringify(crashes, null, 2) + "\n");
          code = "APP_CRASH";
        }
      }
      report.state = "failed";
      report.failure = { code, remedy: diagnosis[code] };
      await capture("failure-screen").catch(() => undefined);
    } finally {
      try {
        report.finishedAt = new Date().toISOString();
        report.lease!.releasedAt = report.finishedAt;
        await save();
      } finally {
        await rm(join(lock, "owner.json"), { force: true });
        await rmdir(lock);
      }
    }
    return report;
  }

  private async allocate<T extends { device: RegisteredDevice }>(candidates: T[]) {
    for (const candidate of candidates) {
      try {
        await mkdir(candidate.device.lock, { mode: 0o700 });
        return candidate;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new RunFailure("DEVICE_BUSY");
  }
}
