import { z } from "zod";
import type { Report } from "./runner";

export const outcome = z.enum(["finalized", "declined", "unresolved", "ui-passed", "failed"]);
export type Outcome = z.infer<typeof outcome>;

export function scoreDecision(report: Report, claim: Outcome) {
  if (report.state === "running" || !report.finishedAt) throw new Error("Wait for the terminal run report");
  const expected: Outcome = report.receipt ? "finalized"
    : report.callback?.outcome === "submitted" ? "unresolved"
      : report.callback?.outcome === "failed" && report.callback.code === "DECLINED" ? "declined"
        : report.state === "passed" ? "ui-passed" : "failed";
  return {
    benchmark: "wallet-evidence-interpretation/v1",
    runId: report.runId,
    scenarioSha256: report.scenarioSha256,
    claim,
    expected,
    correct: claim === expected,
    falseFinancialSuccess: claim === "finalized" && expected !== "finalized",
    observedRunLatencyMs: Date.parse(report.finishedAt) - Date.parse(report.startedAt),
    scenarioActions: {
      total: report.steps.length,
      interactions: report.steps.filter((step) => step.action === "tap").length,
      failed: report.steps.filter((step) => step.state === "failed").length,
    },
    deviceProfile: report.deviceProfile ?? null,
  };
}
