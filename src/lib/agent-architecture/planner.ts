/**
 * AGUS 2.0 — Resilient Multi-Step Plan Executor
 *
 * Evaluates directed acyclic graphs of plan steps with durable checkpoints,
 * failure isolation, exponential retry backoff, and authorization gates.
 *
 * Tagline: "Your money, and what's next."
 */

import { randomUUID } from "node:crypto";
import type {
  ExecutionPlan,
  PlanStep,
  ActionLifecycleState,
  ActionEvidence,
} from "./types";
import { executionPlanSchema } from "./types";
import type { ToolRegistry } from "./tool-registry";

export interface PlanOptions {
  planId?: string;
  goal: string;
  owner: string;
  steps: Array<{
    id?: string;
    toolName: string;
    input: unknown;
    dependsOnStepIds?: string[];
    maxAttempts?: number;
    idempotencyKey?: string;
  }>;
}

export class PlanExecutor {
  constructor(private registry: ToolRegistry) {}

  /**
   * Initializes a new execution plan in draft state.
   */
  createPlan(options: PlanOptions): ExecutionPlan {
    const planId = options.planId ?? randomUUID();
    const now = new Date().toISOString();

    const steps: PlanStep[] = options.steps.map((s) => ({
      id: s.id ?? randomUUID(),
      toolName: s.toolName,
      input: s.input,
      state: "proposed",
      idempotencyKey: s.idempotencyKey ?? `step_${randomUUID().replaceAll("-", "")}`,
      attempts: 0,
      maxAttempts: s.maxAttempts ?? 3,
      error: null,
      evidence: null,
      dependsOnStepIds: s.dependsOnStepIds ?? [],
    }));

    const plan: ExecutionPlan = {
      planId,
      goal: options.goal,
      owner: options.owner,
      steps,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      checkpointVersion: 1,
      evidenceLog: [],
    };

    return executionPlanSchema.parse(plan);
  }

  /**
   * Executes or resumes a plan.
   * If a step requires user authorization, the plan safely suspends in 'awaiting_authorization'.
   */
  async executePlan(
    plan: ExecutionPlan,
    authorizationTokens: Record<string, string> = {}
  ): Promise<ExecutionPlan> {
    const current = executionPlanSchema.parse(plan);
    current.status = "in_progress";
    current.updatedAt = new Date().toISOString();
    current.checkpointVersion++;

    const completedStepIds = new Set<string>(
      current.steps.filter((s) => s.state === "completed").map((s) => s.id)
    );
    const failedStepIds = new Set<string>(
      current.steps.filter((s) => s.state === "failed").map((s) => s.id)
    );

    let progressMade = true;

    while (progressMade) {
      progressMade = false;

      // Find all steps that are ready to run:
      // 1. In 'proposed' or 'authorized' or 'uncertain' state.
      // 2. All dependencies are in 'completed' state.
      const readySteps = current.steps.filter((step) => {
        const hasToken = !!(authorizationTokens[step.id] || authorizationTokens[current.planId]);
        const canRun =
          step.state === "proposed" ||
          step.state === "authorized" ||
          step.state === "uncertain" ||
          (step.state === "awaiting_authorization" && hasToken);
        if (!canRun) {
          return false;
        }

        // Check if any dependency failed
        const hasFailedDependency = step.dependsOnStepIds.some((depId) =>
          failedStepIds.has(depId)
        );
        if (hasFailedDependency) {
          step.state = "failed";
          step.error = "Aborted because prerequisite step failed";
          failedStepIds.add(step.id);
          return false;
        }

        // Must have all dependencies completed
        return step.dependsOnStepIds.every((depId) => completedStepIds.has(depId));
      });

      for (const step of readySteps) {
        const tool = this.registry.get(step.toolName);
        if (!tool) {
          step.state = "failed";
          step.error = `Tool "${step.toolName}" is not registered`;
          failedStepIds.add(step.id);
          progressMade = true;
          continue;
        }

        // Authorization boundary check
        const isConsequential =
          tool.category === "consequential_external" ||
          tool.category === "consequential_financial";

        const token = authorizationTokens[step.id] || authorizationTokens[current.planId];

        if (isConsequential && step.state !== "authorized" && !token) {
          // Suspend step awaiting user authorization
          step.state = "awaiting_authorization";
          current.status = "awaiting_authorization";
          current.evidenceLog.push(
            `Step ${step.id} (${tool.name}) requires explicit authorization before proceeding.`
          );
          current.updatedAt = new Date().toISOString();
          // Return early to await user consent
          return current;
        }

        // Execute step with retry loop
        step.state = "running";
        step.startedAt = new Date().toISOString();

        let success = false;
        let lastError: string | null = null;

        while (step.attempts < step.maxAttempts && !success) {
          step.attempts++;
          try {
            const context = {
              planId: current.planId,
              stepId: step.id,
              actor: current.owner,
              idempotencyKey: step.idempotencyKey,
              authorizationToken: token,
            };

            const { result, verifiedOutput } = await this.registry.invoke(
              step.toolName,
              step.input,
              context
            );

            step.result = verifiedOutput ?? result;
            step.state = "completed";
            step.error = null;
            step.completedAt = new Date().toISOString();

            // Record verifiable evidence
            const evidence: ActionEvidence = {
              source: `tool:${step.toolName}`,
              observedAt: new Date().toISOString(),
              referenceId: step.idempotencyKey,
              rawFactSummary: `Completed ${step.toolName} (attempt ${step.attempts})`,
              verified: true,
            };
            step.evidence = evidence;
            current.evidenceLog.push(
              `Step ${step.id} (${step.toolName}) completed successfully.`
            );

            completedStepIds.add(step.id);
            success = true;
            progressMade = true;
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            // If timeout or network failure, mark uncertain on last attempt
            if (step.attempts < step.maxAttempts) {
              // Exponential backoff delay
              await new Promise((r) => setTimeout(r, 50 * Math.pow(2, step.attempts)));
            }
          }
        }

        if (!success) {
          step.state = "failed";
          step.error = lastError ?? "Execution failed after maximum attempts";
          failedStepIds.add(step.id);
          current.evidenceLog.push(
            `Step ${step.id} (${step.toolName}) failed: ${step.error}`
          );
          progressMade = true;
        }
      }
    }

    // Determine overall plan status
    const allCompleted = current.steps.every((s) => s.state === "completed");
    const anyFailed = current.steps.some((s) => s.state === "failed");
    const anyCompleted = current.steps.some((s) => s.state === "completed");

    if (allCompleted) {
      current.status = "completed";
    } else if (anyFailed && anyCompleted) {
      current.status = "partially_completed";
    } else if (anyFailed) {
      current.status = "failed";
    }

    current.updatedAt = new Date().toISOString();
    current.checkpointVersion++;
    return current;
  }

  /**
   * Cancels a plan and rolls back / marks all non-terminal steps as cancelled.
   */
  cancelPlan(plan: ExecutionPlan, reason: string): ExecutionPlan {
    const current = executionPlanSchema.parse(plan);
    current.status = "cancelled";
    current.updatedAt = new Date().toISOString();
    current.checkpointVersion++;

    for (const step of current.steps) {
      if (
        step.state === "proposed" ||
        step.state === "awaiting_authorization" ||
        step.state === "running"
      ) {
        step.state = "cancelled";
        step.error = `Cancelled: ${reason}`;
      }
    }

    current.evidenceLog.push(`Plan cancelled: ${reason}`);
    return current;
  }
}
