import { z } from "zod";
import type { Report } from "./runner";

export const outcome = z.enum(["finalized", "declined", "unresolved", "ui-passed", "failed"]);
export type Outcome = z.infer<typeof outcome>;

export function scoreDecision(report: Report, claim: Outcome) {
  if (report.state === "running" || !report.finishedAt) throw new Error("Wait for the terminal run report");
  let expected: Outcome = "failed";
  if (report.receipt) {
    expected = "finalized";
  } else if (report.callback?.outcome === "submitted") {
    const observedChainFailure = report.failure && ["CHAIN_FAILED", "CHAIN_MISMATCH", "CHAIN_STALE"].includes(report.failure.code);
    expected = observedChainFailure ? "failed" : "unresolved";
  } else if (report.callback?.outcome === "failed" && report.callback.code === "DECLINED") {
    expected = "declined";
  } else if (report.state === "passed") {
    expected = "ui-passed";
  }
  return {
    benchmark: "wallet-evidence-interpretation/v1",
    runId: report.runId,
    scenarioSha256: report.scenarioSha256,
    claim,
    expected,
    correct: claim === expected,
    taskCompleted: report.state === "passed",
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
