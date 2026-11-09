/**
 * AGUS 2.0 — Typed Discoverable Tool Registry
 *
 * Central registry for agent tools with input/output validation,
 * execution timeout bounds, and model schema generation.
 *
 * Tagline: "Your money, and what's next."
 */

import { z } from "zod";
import type { FunctionDeclaration } from "@google/genai";
import type { ToolContract, ExecutionContext } from "./types";

export class ToolRegistry {
  private tools: Map<string, ToolContract<any, any>> = new Map();

  register<TIn, TOut>(tool: ToolContract<TIn, TOut>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolContract<any, any> | undefined {
    return this.tools.get(name);
  }

  list(): ToolContract<any, any>[] {
    return Array.from(this.tools.values());
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Generates Gemini-compatible FunctionDeclaration objects for all registered tools.
   */
  toFunctionDeclarations(): FunctionDeclaration[] {
    return Array.from(this.tools.values()).map((tool) => {
      const { $schema, ...parametersJsonSchema } = z.toJSONSchema(tool.inputSchema);
      void $schema;
      return {
        name: tool.name,
        description: `[${tool.category.toUpperCase()}] ${tool.description}`,
        parametersJsonSchema,
      };
    });
  }

  /**
   * Executes a tool with strict input validation, authorization boundary checks,
   * timeout signals, and output validation.
   */
  async invoke(
    name: string,
    rawInput: unknown,
    context: ExecutionContext
  ): Promise<{ result: unknown; verifiedOutput: unknown }> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Tool "${name}" not found in registry`);
    }

    // Security check: Consequential tools must have authorization token
    if (
      (tool.category === "consequential_external" ||
        tool.category === "consequential_financial") &&
      !context.authorizationToken
    ) {
      throw new Error(
        `Tool "${name}" is classified as ${tool.category} and requires explicit authorization.`
      );
    }

    // Parse input against schema
    const validatedInput = tool.inputSchema.parse(rawInput);

    // Timeout signal
    const timeoutSignal = AbortSignal.timeout(tool.timeoutMs);
    const combinedSignal = context.signal
      ? AbortSignal.any([context.signal, timeoutSignal])
      : timeoutSignal;

    const enrichedContext: ExecutionContext = {
      ...context,
      signal: combinedSignal,
    };

    const rawOutput = await tool.execute(validatedInput, enrichedContext);
    const verifiedOutput = tool.outputSchema.parse(rawOutput);

    return {
      result: rawOutput,
      verifiedOutput,
    };
  }
}
