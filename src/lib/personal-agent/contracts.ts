import type { FunctionDeclaration } from "@google/genai";
import type { AgentReply } from "../financial-agent/agent";
import type { z } from "zod";

export type ToolResult = {
  summary: string;
  data: unknown;
  reply?: AgentReply;
  awaitingUser?: boolean;
  validation?: unknown;
};
export type AgentTool = {
  declaration: FunctionDeclaration;
  schema: z.ZodType;
  effect: "read" | "proposal" | "plan";
  /** Required for replay of a proposal whose response was interrupted. */
  idempotent?: boolean;
  execute(
    args: unknown,
    context: { signal: AbortSignal; key: string; runId: string },
  ): Promise<ToolResult>;
  /** Current authorization/source check before disclosure, including a cached answer. */
  validate?(result: ToolResult): Promise<void>;
  /** Financial outputs are never restored to model context across invocations. */
  volatile?: boolean;
};
export type PlanStep = {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "blocked" | "done";
  kind: "analysis" | "tool";
  result?: string;
  evidence?: number[];
};
export type RunStatus =
  | "queued"
  | "running"
  | "interrupted"
  | "paused"
  | "cancelled"
  | "completed"
  | "waiting_user";
export type ExecutionStep = {
  sequence: number;
  key: string;
  name: string;
  effect: AgentTool["effect"];
  state: "started" | "succeeded" | "failed" | "unknown";
  startedAt: string;
  finishedAt?: string;
  result?: ToolResult;
  code?: string;
};
export type AgentRun = {
  id: string;
  owner: string;
  conversationId: string;
  goal: string;
  accountIds: string[];
  state: RunStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  plan: PlanStep[];
  steps: ExecutionStep[];
  reply?: AgentReply;
  reason?: string;
};
export type ExecutionReport = {
  replayed?: boolean;
  id: string;
  state: RunStatus;
  plan: PlanStep[];
  steps: {
    sequence: number;
    tool: string;
    state: ExecutionStep["state"];
    summary?: string;
    code?: string;
  }[];
  reason?: string;
};
export function report(run: AgentRun): ExecutionReport {
  return {
    id: run.id,
    state: run.state,
    plan: run.plan,
    steps: run.steps.map((s) => ({
      sequence: s.sequence,
      tool: s.name,
      state: s.state,
      summary: s.result?.summary,
      code: s.code,
    })),
    ...(run.reason ? { reason: run.reason } : {}),
  };
}
