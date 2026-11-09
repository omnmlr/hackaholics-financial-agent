/**
 * AGUS Agent Evaluation Harness — Types & Interfaces
 *
 * Defines benchmark scenario structures, evaluation metrics, scoring rules,
 * and deterministic report formats for multi-step agent behaviors.
 *
 * Tagline: "Your money, and what's next."
 */

import { z } from "zod";

export type ScenarioCategory =
  | "shopping"
  | "financial_safety"
  | "failure_recovery"
  | "prompt_injection"
  | "requirement_shift"
  | "cancellation";

export interface UserTurn {
  turnIndex: number;
  userInput: string;
  metadata?: Record<string, unknown>;
}

export interface ExpectedOutcomes {
  requiredToolCalls?: string[];
  forbiddenToolCalls?: string[];
  mustRequireAuthorization?: boolean;
  mustNotExecuteUnauthorized?: boolean;
  maxAllowedSteps?: number;
  factChecks?: Array<{
    factName: string;
    expectedValue: string | number | boolean;
    actualValueExtractor: (state: unknown) => unknown;
  }>;
  customValidation?: (result: ScenarioRunContext) => { valid: boolean; reason?: string };
}

export interface EvaluationScenario {
  id: string;
  title: string;
  category: ScenarioCategory;
  description: string;
  userTurns: UserTurn[];
  expectedOutcomes: ExpectedOutcomes;
}

export interface MetricScores {
  taskCompletion: number; // 0 to 100
  safetyCompliance: number; // 0 to 100 (instant 0 on unauthorized action)
  factPreservation: number; // 0 to 100
  recoveryEffectiveness: number; // 0 to 100
  overall: number; // 0 to 100 weighted average
}

export interface ExecutionLogEntry {
  turn: number;
  timestamp: string;
  action: string;
  details: string;
  status: "success" | "warning" | "error" | "info";
}

export interface ScenarioRunContext {
  scenarioId: string;
  turnsCompleted: number;
  toolsInvoked: string[];
  unauthorizedActionsAttempted: string[];
  authorizationRequestsTriggered: string[];
  finalState: unknown;
  errors: string[];
  logs: ExecutionLogEntry[];
}

export interface ScenarioRunResult {
  scenarioId: string;
  title: string;
  category: ScenarioCategory;
  passed: boolean;
  scores: MetricScores;
  violations: string[];
  durationMs: number;
  logs: ExecutionLogEntry[];
}

export interface EvaluationSuiteReport {
  suiteId: string;
  timestamp: string;
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  passRate: number;
  averageScores: MetricScores;
  scenarioResults: ScenarioRunResult[];
}
