import { z } from "zod";
import { NarrationSchema } from "./narration";
import { instructionsFor } from "./instructions";
import { diagnoseProviderFailure } from "../provider-diagnostics";
import {
  RouteSchema,
  GeneralSchema,
  ReasoningSchema,
  ReviewSchema,
  ProductTopicSchema,
  DecisionSchema,
  AgentError,
  type AgentModel,
  type ModelTask,
} from "./protocol";

const schemas = {
  classify: RouteSchema,
  general: GeneralSchema,
  reason: ReasoningSchema,
  review_general: ReviewSchema,
  product: z.strictObject({ topic: ProductTopicSchema }),
  plan: DecisionSchema,
  narrate: NarrationSchema,
  compose: GeneralSchema,
  review_narration: ReviewSchema,
};

export function createConfiguredModel(
  env: Record<string, string | undefined> = process.env,
): AgentModel {
  const provider = env.AI_PROVIDER ?? "none";
  const model =
    env.AI_MODEL ||
    (provider === "openai" ? "gpt-4.1-mini" : "gemini-2.5-flash");
  const key = env.AI_API_KEY;
  return {
    provider,
    model,
    async generate(task: ModelTask, input, signal) {
      if (!key || !["openai", "gemini"].includes(provider))
        throw new AgentError("MODEL_NOT_CONFIGURED");
      if (!/^[A-Za-z0-9._-]{1,100}$/.test(model))
        throw new AgentError("MODEL_CONFIGURATION");
      const prompt = JSON.stringify({
        task,
        schema: z.toJSONSchema(schemas[task]),
        data: input,
      });
      const openai = provider === "openai";
      const instructions = instructionsFor(task);
      const response = await fetch(
        openai
          ? "https://api.openai.com/v1/chat/completions"
          : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/json",
            ...(openai
              ? { Authorization: `Bearer ${key}` }
              : { "x-goog-api-key": key }),
          },
          body: JSON.stringify(
            openai
              ? {
                  model,
                  messages: [
                    { role: "system", content: instructions },
                    { role: "user", content: prompt },
                  ],
                  response_format: { type: "json_object" },
                }
              : {
                  systemInstruction: { parts: [{ text: instructions }] },
                  contents: [{ role: "user", parts: [{ text: prompt }] }],
                  generationConfig: {
                    responseMimeType: "application/json",
                    responseJsonSchema: z.toJSONSchema(schemas[task]),
                  },
                },
          ),
        },
      ).catch(() => {
        throw new AgentError(
          signal.aborted ? "MODEL_INTERRUPTED" : "MODEL_NETWORK",
        );
      });
      if (!response.ok) {
        await diagnoseProviderFailure(
          response,
          openai ? "openai-rest" : "gemini-rest",
        );
        throw new AgentError(`MODEL_HTTP_${response.status}`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new AgentError("MODEL_ENVELOPE");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          if (length > 64 * 1024) throw new AgentError("MODEL_BYTES");
          chunks.push(part.value);
        }
      } catch (error) {
        if (error instanceof AgentError) throw error;
        throw new AgentError(
          signal.aborted ? "MODEL_INTERRUPTED" : "MODEL_NETWORK",
        );
      } finally {
        await reader.cancel().catch(() => {});
      }
      let raw;
      try {
        raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
          throw new Error();
      } catch {
        throw new AgentError("MODEL_ENVELOPE");
      }
      let output: string;
      if (openai) {
        const candidate = raw.choices?.[0];
        if (
          candidate?.message?.refusal ||
          candidate?.finish_reason === "content_filter"
        )
          throw new AgentError("MODEL_REFUSAL");
        if (
          candidate?.finish_reason !== "stop" ||
          typeof candidate.message?.content !== "string" ||
          candidate.message?.tool_calls ||
          candidate.message?.refusal
        )
          throw new AgentError("MODEL_COMPLETION");
        output = candidate.message.content;
      } else {
        const candidate = raw.candidates?.[0];
        if (
          raw.promptFeedback?.blockReason ||
          [
            "SAFETY",
            "RECITATION",
            "BLOCKLIST",
            "PROHIBITED_CONTENT",
            "SPII",
          ].includes(candidate?.finishReason)
        )
          throw new AgentError("MODEL_REFUSAL");
        if (
          candidate?.finishReason !== "STOP" ||
          !Array.isArray(candidate.content?.parts) ||
          candidate.content.parts.some(
            (p: { functionCall?: unknown }) => p.functionCall,
          )
        )
          throw new AgentError("MODEL_COMPLETION");
        output = candidate.content.parts
          .filter(
            (p: { thought?: boolean; text?: unknown }) =>
              p.thought !== true && typeof p.text === "string",
          )
          .map((p: { text: string }) => p.text)
          .join("");
      }
      let value: unknown;
      try {
        value = JSON.parse(output);
      } catch {
        throw new AgentError("MODEL_JSON");
      }
      const parsed = schemas[task].safeParse(value);
      if (!parsed.success) throw new AgentError("MODEL_SCHEMA");
      return parsed.data;
    },
  };
}
