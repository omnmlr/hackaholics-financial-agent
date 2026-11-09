/**
 * AGUS 2.0 — Agent Architecture & Flexible Tool Execution Tests
 *
 * Verifies:
 * - Typed discoverable tool contracts
 * - Gemini FunctionDeclaration generation
 * - Authorization boundary enforcement
 * - Multi-step plan execution with dependency DAG
 * - Partial failure isolation & safe continuation
 * - Checkpoint serialization & resumption
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  ToolRegistry,
  PlanExecutor,
  type ToolContract,
  type ExecutionContext,
} from "@/lib/agent-architecture";

// ─── Test Tool Definitions ──────────────────────────────────────────

const searchTool: ToolContract<{ query: string }, { items: string[]; count: number }> = {
  name: "search_products",
  description: "Search for available products across marketplaces",
  category: "read_only",
  inputSchema: z.object({ query: z.string().min(1) }),
  outputSchema: z.object({ items: z.array(z.string()), count: z.number().int() }),
  isIdempotent: true,
  timeoutMs: 5000,
  maxRetries: 2,
  execute: async (input) => {
    return {
      items: [`${input.query} Option A`, `${input.query} Option B`],
      count: 2,
    };
  },
};

const compareTool: ToolContract<{ items: string[] }, { bestOption: string; savings: number }> = {
  name: "compare_prices",
  description: "Compare prices and identify best value",
  category: "preparation",
  inputSchema: z.object({ items: z.array(z.string()).min(1) }),
  outputSchema: z.object({ bestOption: z.string(), savings: z.number() }),
  isIdempotent: true,
  timeoutMs: 5000,
  maxRetries: 2,
  execute: async (input) => {
    return {
      bestOption: input.items[0],
      savings: 15000,
    };
  },
};

const orderTool: ToolContract<{ option: string; address: string }, { orderId: string; status: string }> = {
  name: "dispatch_merchant_order",
  description: "Place consequential order with merchant",
  category: "consequential_external",
  inputSchema: z.object({ option: z.string(), address: z.string() }),
  outputSchema: z.object({ orderId: z.string(), status: z.string() }),
  isIdempotent: false,
  timeoutMs: 10000,
  maxRetries: 1,
  execute: async (input, ctx) => {
    if (!ctx.authorizationToken) {
      throw new Error("Missing authorization token for merchant order");
    }
    return {
      orderId: "ord_demo_12345",
      status: "submitted",
    };
  },
};

const independentNotificationTool: ToolContract<{ message: string }, { notified: boolean }> = {
  name: "log_user_notification",
  description: "Log an informational message in workspace",
  category: "read_only",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ notified: z.boolean() }),
  isIdempotent: true,
  timeoutMs: 5000,
  maxRetries: 1,
  execute: async () => ({ notified: true }),
};

const flakyTool: ToolContract<{ shouldFail: boolean }, { success: boolean }> = {
  name: "flaky_external_service",
  description: "Simulate a failing external service",
  category: "read_only",
  inputSchema: z.object({ shouldFail: z.boolean() }),
  outputSchema: z.object({ success: z.boolean() }),
  isIdempotent: true,
  timeoutMs: 1000,
  maxRetries: 2,
  execute: async (input) => {
    if (input.shouldFail) {
      throw new Error("Upstream provider unavailable");
    }
    return { success: true };
  },
};

// ─── Test Suite ─────────────────────────────────────────────────────

describe("Agent Architecture: Tool Registry", () => {
  it("registers and retrieves tools", () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);
    registry.register(compareTool);

    expect(registry.has("search_products")).toBe(true);
    expect(registry.has("compare_prices")).toBe(true);
    expect(registry.has("non_existent")).toBe(false);

    expect(registry.get("search_products")?.name).toBe("search_products");
  });

  it("prevents duplicate tool registration", () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);
    expect(() => registry.register(searchTool)).toThrow("already registered");
  });

  it("exports Gemini FunctionDeclaration objects", () => {
    const registry = new ToolRegistry();
    registry.register(searchTool);
    registry.register(orderTool);

    const declarations = registry.toFunctionDeclarations();
    expect(declarations.length).toBe(2);
    expect(declarations[0].name).toBe("search_products");
    expect(declarations[0].description).toContain("[READ_ONLY]");
    expect(declarations[1].description).toContain("[CONSEQUENTIAL_EXTERNAL]");
    expect(declarations[0].parametersJsonSchema).toBeDefined();
  });

  it("blocks consequential actions without authorization token", async () => {
    const registry = new ToolRegistry();
    registry.register(orderTool);

    const context: ExecutionContext = {
      planId: "p1",
      stepId: "s1",
      actor: "user_1",
      // No authorizationToken
    };

    await expect(
      registry.invoke("dispatch_merchant_order", { option: "A", address: "Lagos" }, context)
    ).rejects.toThrow("requires explicit authorization");
  });

  it("allows consequential actions with valid authorization token", async () => {
    const registry = new ToolRegistry();
    registry.register(orderTool);

    const context: ExecutionContext = {
      planId: "p1",
      stepId: "s1",
      actor: "user_1",
      authorizationToken: "auth_token_sample_123",
    };

    const { verifiedOutput } = await registry.invoke(
      "dispatch_merchant_order",
      { option: "A", address: "Lagos" },
      context
    );

    expect((verifiedOutput as any).status).toBe("submitted");
    expect((verifiedOutput as any).orderId).toBe("ord_demo_12345");
  });
});

describe("Agent Architecture: Plan Executor", () => {
  function setup() {
    const registry = new ToolRegistry();
    registry.register(searchTool);
    registry.register(compareTool);
    registry.register(orderTool);
    registry.register(independentNotificationTool);
    registry.register(flakyTool);
    const executor = new PlanExecutor(registry);
    return { registry, executor };
  }

  it("creates a well-formed execution plan with durable steps", () => {
    const { executor } = setup();
    const plan = executor.createPlan({
      goal: "Find and compare phones",
      owner: "operator_test",
      steps: [
        { id: "11111111-1111-1111-1111-111111111111", toolName: "search_products", input: { query: "Pixel 9" } },
        {
          id: "22222222-2222-2222-2222-222222222222",
          toolName: "compare_prices",
          input: { items: ["Pixel 9"] },
          dependsOnStepIds: ["11111111-1111-1111-1111-111111111111"],
        },
      ],
    });

    expect(plan.status).toBe("draft");
    expect(plan.steps.length).toBe(2);
    expect(plan.steps[0].state).toBe("proposed");
    expect(plan.checkpointVersion).toBe(1);
  });

  it("executes multi-step read/prepare plans to completion", async () => {
    const { executor } = setup();
    const plan = executor.createPlan({
      goal: "Search and compare",
      owner: "operator_test",
      steps: [
        { id: "11111111-1111-1111-1111-111111111111", toolName: "search_products", input: { query: "Galaxy S24" } },
        {
          id: "22222222-2222-2222-2222-222222222222",
          toolName: "compare_prices",
          input: { items: ["Galaxy S24"] },
          dependsOnStepIds: ["11111111-1111-1111-1111-111111111111"],
        },
      ],
    });

    const completed = await executor.executePlan(plan);
    expect(completed.status).toBe("completed");
    expect(completed.steps[0].state).toBe("completed");
    expect(completed.steps[1].state).toBe("completed");
    expect((completed.steps[1].result as any).savings).toBe(15000);
    expect(completed.evidenceLog.length).toBeGreaterThanOrEqual(2);
  });

  it("gracefully suspends on consequential steps awaiting authorization", async () => {
    const { executor } = setup();
    const s1Id = "11111111-1111-1111-1111-111111111111";
    const s2Id = "22222222-2222-2222-2222-222222222222";

    const plan = executor.createPlan({
      goal: "Search and order",
      owner: "operator_test",
      steps: [
        { id: s1Id, toolName: "search_products", input: { query: "Keyboard" } },
        {
          id: s2Id,
          toolName: "dispatch_merchant_order",
          input: { option: "Keyboard A", address: "Lagos, Nigeria" },
          dependsOnStepIds: [s1Id],
        },
      ],
    });

    // Step 1 should complete, Step 2 should pause awaiting authorization
    const suspended = await executor.executePlan(plan);
    expect(suspended.status).toBe("awaiting_authorization");
    expect(suspended.steps[0].state).toBe("completed");
    expect(suspended.steps[1].state).toBe("awaiting_authorization");

    // Now user grants authorization token and resumes
    const resumed = await executor.executePlan(suspended, {
      [s2Id]: "user_approved_pin_1234",
    });

    expect(resumed.status).toBe("completed");
    expect(resumed.steps[1].state).toBe("completed");
    expect((resumed.steps[1].result as any).orderId).toBe("ord_demo_12345");
  });

  it("isolates failures: dependent steps abort but independent steps proceed", async () => {
    const { executor } = setup();
    const failStepId = "11111111-1111-1111-1111-111111111111";
    const dependentStepId = "22222222-2222-2222-2222-222222222222";
    const independentStepId = "33333333-3333-3333-3333-333333333333";

    const plan = executor.createPlan({
      goal: "Resilience test",
      owner: "operator_test",
      steps: [
        {
          id: failStepId,
          toolName: "flaky_external_service",
          input: { shouldFail: true },
          maxAttempts: 2,
        },
        {
          id: dependentStepId,
          toolName: "compare_prices",
          input: { items: ["dummy"] },
          dependsOnStepIds: [failStepId],
        },
        {
          id: independentStepId,
          toolName: "log_user_notification",
          input: { message: "Task started" },
          dependsOnStepIds: [], // Independent!
        },
      ],
    });

    const result = await executor.executePlan(plan);

    // Fail step failed
    expect(result.steps.find((s) => s.id === failStepId)?.state).toBe("failed");
    // Dependent step was aborted
    expect(result.steps.find((s) => s.id === dependentStepId)?.state).toBe("failed");
    expect(result.steps.find((s) => s.id === dependentStepId)?.error).toContain("prerequisite step failed");
    // Independent step completed successfully!
    expect(result.steps.find((s) => s.id === independentStepId)?.state).toBe("completed");

    // Overall plan is partially_completed
    expect(result.status).toBe("partially_completed");
    expect(result.checkpointVersion).toBeGreaterThan(1);
  });
});
