import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SaxesParser } from "saxes";
import { callbackSchema, RunFailure, type Config, type UiSelector } from "./contracts";

const exec = promisify(execFile);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type UiNode = {
  package: string;
  text: string;
  resourceId: string;
  clickable: boolean;
  bounds: [number, number, number, number];
};

export function parseUi(xml: string, approved: Set<string>): UiNode[] {
  const nodes: UiNode[] = [];
  const parser = new SaxesParser();
  parser.on("doctype", () => { throw new RunFailure("ANDROID_COMMAND"); });
  parser.on("opentag", ({ name, attributes: a }) => {
    if (name !== "node" || !approved.has(a.package)) return;
    const bounds = a.bounds?.match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/)?.slice(1).map(Number);
    if (!bounds || bounds.some((coordinate) => coordinate > 20_000) || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) return;
    nodes.push({
      package: a.package, text: (a.text || a["content-desc"] || "").slice(0, 200),
      resourceId: a["resource-id"] || "", clickable: a.clickable === "true",
      bounds: [bounds[0], bounds[1], bounds[2], bounds[3]],
    });
  });
  parser.write(xml).close();
  return nodes;
}

export class Android {
  constructor(readonly device: Config["device"], private readonly adb = process.env.AGUS_ADB || "adb") {}

  private async command(args: string[], timeout = 20_000) {
    try {
      const { stdout } = await exec(this.adb, ["-H", "127.0.0.1", "-P", "5037", "-s", this.device.serial, ...args], {
        encoding: "buffer", timeout, maxBuffer: 12 * 1024 * 1024,
      });
      return stdout;
    } catch { throw new RunFailure("ANDROID_COMMAND"); }
  }

  private async shell(...args: string[]) {
    return (await this.command(["shell", ...args])).toString("utf8");
  }

  async describe() {
    try {
      const state = (await this.command(["get-state"])).toString().trim();
      const [model, api, qemu] = await Promise.all([
        this.shell("getprop", "ro.product.model"), this.shell("getprop", "ro.build.version.sdk"),
        this.shell("getprop", "ro.kernel.qemu"),
      ]);
      if (state !== "device" || (qemu.trim() === "1") !== (this.device.kind === "emulator")) {
        throw new RunFailure("DEVICE_UNAVAILABLE");
      }
      return { kind: this.device.kind, model: model.trim().slice(0, 100), api: api.trim(), seekerVerified: false as const };
    } catch { throw new RunFailure("DEVICE_UNAVAILABLE"); }
  }

  async install(path: string) {
    const result = (await this.command(["install", "-r", path], 90_000)).toString();
    if (!/^Success\s*$/m.test(result)) throw new RunFailure("ANDROID_COMMAND");
  }

  async launch(packageName: string) {
    const entries = await this.shell("cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", packageName);
    const component = entries.trim().split("\n").at(-1) || "";
    if (!component.startsWith(packageName + "/") || !/^[A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+$/.test(component)) throw new RunFailure("ANDROID_COMMAND");
    const launched = await this.command(["shell", "am", "start", "-S", "-W", "-n", component], 45_000);
    if (!/^Status: ok\s*$/m.test(launched.toString())) throw new RunFailure("START_WINDOW_TIMEOUT");
  }

  async ui(approved: Set<string>) {
    const result = (await this.command(["exec-out", "uiautomator", "dump", "/dev/tty"])).toString();
    const begin = result.indexOf("<?xml");
    const end = result.lastIndexOf("</hierarchy>");
    if (begin === -1 || end === -1) throw new RunFailure("ANDROID_COMMAND");
    return parseUi(result.slice(begin, end + "</hierarchy>".length), approved);
  }

  async select(selector: UiSelector) {
    const until = Date.now() + 45_000;
    do {
      const nodes = await this.ui(new Set([selector.package])).catch(() => []);
      const matches = nodes.filter((item) =>
        (!selector.text || selector.text === item.text) &&
        (!selector.resourceId || selector.resourceId === item.resourceId));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new RunFailure("UI_AMBIGUOUS");
      await wait(650);
    } while (Date.now() < until);
    throw new RunFailure("UI_TIMEOUT");
  }

  async tap(selector: UiSelector) {
    const { bounds: [left, top, right, bottom] } = await this.select(selector);
    await this.shell("input", "tap", String(Math.floor((left + right) / 2)), String(Math.floor((top + bottom) / 2)));
  }

  async capture(approved: Set<string>) {
    const windows = await this.shell("dumpsys", "window");
    const focused = windows.match(/mCurrentFocus=Window\{[^\n]*\s([A-Za-z0-9_.]+)\/[A-Za-z0-9_.$]+/);
    if (!focused || !approved.has(focused[1])) throw new RunFailure("CAPTURE_UNSAFE");
    const image = await this.command(["exec-out", "screencap", "-p"]);
    if (!image.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) throw new RunFailure("ANDROID_COMMAND");
    return image;
  }

  async deviceTime() {
    const seconds = (await this.shell("date", "+%s.%3N")).trim();
    if (!/^\d{10}\.\d{3}$/.test(seconds)) throw new RunFailure("ANDROID_COMMAND");
    return seconds;
  }

  async crashes(approved: Set<string>, since: string) {
    const logs = await this.command(["logcat", "-b", "crash", "-d", "-v", "epoch", "-T", since, "-s", "AndroidRuntime:E"]);
    const crashes = [];
    let current: string | undefined;
    for (const line of logs.toString().split("\n")) {
      const row = line.match(/^(\d+\.\d+)\s+\d+\s+\d+\s+E\s+AndroidRuntime\s*:\s*(.*)$/);
      if (!row || Number(row[1]) <= Number(since)) continue;
      if (row[2].startsWith("FATAL EXCEPTION:")) current = undefined;
      const process = row[2].match(/^Process: ([A-Za-z0-9_.]+), PID: \d+$/)?.[1];
      if (process && approved.has(process)) current = process;
      const exception = row[2].match(/^([A-Za-z0-9_.$]{3,120}(?:Exception|Error))(?::|$)/)?.[1];
      if (current && exception) {
        crashes.push({ package: current, at: new Date(Number(row[1]) * 1000).toISOString(), exception });
        current = undefined;
      }
    }
    return crashes.slice(-5);
  }

  async callback(packageName: string, since: string, timeout: number) {
    const until = Date.now() + timeout;
    let validLogSource = false;
    do {
      const pid = (await this.shell("pidof", packageName).catch(() => "")).trim();
      if (/^\d+$/.test(pid)) {
        const raw = await this.command(["logcat", "-d", "-v", "epoch", "--pid=" + pid, "-T", since, "-s", "AGUS_TEST:I"])
          .then((value) => value.toString()).catch(() => null);
        if (raw !== null) {
          validLogSource = true;
          const events = raw.split("\n").flatMap((line) => {
            const result = line.match(/^(\d+\.\d+)\s+\d+\s+\d+\s+I\s+AGUS_TEST\s*:\s*(\{.*\})\s*$/);
            return result && Number(result[1]) > Number(since) ? [result[2]] : [];
          });
          if (events.length > 1) throw new RunFailure("CALLBACK_INVALID");
          if (events.length === 1) {
            try { return callbackSchema.parse(JSON.parse(events[0])); }
            catch { throw new RunFailure("CALLBACK_INVALID"); }
          }
        }
      }
      await wait(650);
    } while (Date.now() < until);
    throw new RunFailure(validLogSource ? "CALLBACK_MISSING" : "ANDROID_COMMAND");
  }
}
