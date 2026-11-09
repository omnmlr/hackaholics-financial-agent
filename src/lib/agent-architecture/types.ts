/**
 * AGUS 2.0 — Resilient Agent Execution Architecture Types
 *
 * Provides typed, discoverable tool contracts, composable multi-step execution plans,
 * durable checkpoints, secure authorization boundaries, and verifiable evidence.
 *
 * Tagline: "Your money, and what's next."
 */

import { z } from "zod";

// ─── Tool Classification & Security Boundaries ───────────────────────

export type ToolCategory =
  | "read_only" // Safe query: balances, histories, read-only web/workspace reads
  | "preparation" // Safe draft: creating proposals, simulations, calculating options
  | "consequential_external" // Requires explicit authorization: sending external communication, placing order
  | "consequential_financial"; // Requires reauthenticated authorization: payments, transfers, signing

export const actionLifecycleStateSchema = z.enum([
  "proposed",
  "awaiting_authorization",
  "authorized",
  "running",
  "completed",
  "failed",
  "uncertain",
  "cancelled",
]);

export type ActionLifecycleState = z.infer<typeof actionLifecycleStateSchema>;

export interface ActionEvidence {
  source: string;
  observedAt: string;
  referenceId?: string;
  digest?: string;
  rawFactSummary: string;
  verified: boolean;
}

// ─── Typed Discoverable Tool Contract ────────────────────────────────

export interface ExecutionContext {
  planId: string;
  stepId: string;
  actor: string;
  signal?: AbortSignal;
  idempotencyKey?: string;
  authorizationToken?: string;
}

export interface ToolContract<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  category: ToolCategory;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  isIdempotent: boolean;
  timeoutMs: number;
  maxRetries: number;
  execute: (input: TInput, context: ExecutionContext) => Promise<TOutput>;
}

// ─── Composable Execution Plan & Durable State ───────────────────────

export const planStepSchema = z.object({
  id: z.string().min(1).max(100),
  toolName: z.string().min(1).max(100),
  input: z.unknown(),
  state: actionLifecycleStateSchema,
  idempotencyKey: z.string(),
  attempts: z.number().int().nonnegative().default(0),
  maxAttempts: z.number().int().positive().default(3),
  result: z.unknown().optional(),
  error: z.string().nullable().default(null),
  evidence: z
    .object({
      source: z.string(),
      observedAt: z.string(),
      referenceId: z.string().optional(),
      digest: z.string().optional(),
      rawFactSummary: z.string(),
      verified: z.boolean(),
    })
    .nullable()
    .default(null),
  dependsOnStepIds: z.array(z.string().min(1).max(100)).default([]),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export type PlanStep = z.infer<typeof planStepSchema>;

export const executionPlanSchema = z.object({
  planId: z.string().min(1).max(100),
  goal: z.string().min(1).max(1000),
  owner: z.string(),
  steps: z.array(planStepSchema),
  status: z.enum([
    "draft",
    "awaiting_authorization",
    "in_progress",
    "completed",
    "partially_completed",
    "failed",
    "cancelled",
  ]),
  createdAt: z.string(),
  updatedAt: z.string(),
  checkpointVersion: z.number().int().positive().default(1),
  evidenceLog: z.array(z.string()).default([]),
});

export type ExecutionPlan = z.infer<typeof executionPlanSchema>;
