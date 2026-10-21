import {
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
} from "@google/genai";
import { AgentError } from "../financial-agent/protocol";

export type ToolModel = {
  provider: string;
  model: string;
  generate(input: {
    system: string;
    contents: Content[];
    declarations: FunctionDeclaration[];
    responseJsonSchema?: Record<string, unknown>;
    signal: AbortSignal;
  }): Promise<{
    content: Content;
    text: string;
    calls: { name: string; args: unknown; id?: string }[];
    usage?: { inputTokens: number; outputTokens: number };
  }>;
};

/** Official SDK, no automatic tool execution and no implicit provider retries. */
export function createGeminiToolModel(
  env: Record<string, string | undefined> = process.env,
): ToolModel {
  const model = env.AI_MODEL || "gemini-3.5-flash-lite";
  const key = env.AI_API_KEY;
  // Lazy construction permits startup without provider credentials. Configuration
  // fails at the conversational boundary, never in application module loading.
  let client: GoogleGenAI | undefined;
  return {
    provider: "gemini",
    model,
    async generate({
      system,
      contents,
      declarations,
      responseJsonSchema,
      signal,
    }) {
      if (!key || env.AI_PROVIDER !== "gemini")
        throw new AgentError("MODEL_NOT_CONFIGURED");
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(model))
        throw new AgentError("MODEL_CONFIGURATION");
      client ??= new GoogleGenAI({
        apiKey: key,
        httpOptions: {
          retryOptions: { attempts: 1 },
          timeout: 20000,
          // Resolve dynamically so isolated evaluations can count every request.
          fetch: (url, init) => globalThis.fetch(url, init),
        },
      });
      try {
        const response = await client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: system,
            ...(declarations.length
              ? { tools: [{ functionDeclarations: declarations }] }
              : {}),
            abortSignal: signal,
            maxOutputTokens: 2048,
            temperature: 0.2,
            ...(responseJsonSchema
              ? { responseMimeType: "application/json", responseJsonSchema }
              : {}),
          },
        });
        const candidate = response.candidates?.[0];
        if (response.promptFeedback?.blockReason)
          throw new AgentError("MODEL_REFUSAL");
        if (candidate?.finishReason === "MAX_TOKENS")
          throw new AgentError("MODEL_OUTPUT_BUDGET");
        if (candidate?.finishReason !== "STOP" || !candidate.content?.parts)
          throw new AgentError("MODEL_COMPLETION");
        const content = candidate.content;
        // Preserve the COMPLETE returned content, including thought signatures,
        // IDs and part order, for the next native function-calling round trip.
        if (Buffer.byteLength(JSON.stringify(content)) > 65536)
          throw new AgentError("MODEL_BYTES");
        const calls = content.parts!.flatMap((part) =>
          part.functionCall
            ? [
                {
                  name: part.functionCall.name ?? "",
                  args: part.functionCall.args ?? {},
                  ...(part.functionCall.id ? { id: part.functionCall.id } : {}),
                },
              ]
            : [],
        );
        return {
          content,
          calls,
          text: content
            .parts!.filter(
              (part) => !part.thought && typeof part.text === "string",
            )
            .map((part) => part.text)
            .join(""),
          usage: {
            inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
            outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          },
        };
      } catch (error) {
        if (error instanceof AgentError) throw error;
        // Provider exception messages can contain request details. Fixed codes
        // only cross the application boundary.
        const status = (error as { status?: number }).status;
        const name = (error as { name?: string }).name;
        throw new AgentError(
          signal.aborted
            ? "MODEL_INTERRUPTED"
            : name === "TimeoutError" || name === "AbortError"
              ? "MODEL_TIMEOUT"
              : status && Number.isInteger(status)
                ? `MODEL_HTTP_${status}`
                : "MODEL_NETWORK",
        );
      }
    },
  };
}
