import type { AgentReply } from "../financial-agent/agent";

/** One bounded event per completed native turn. No prompts, records, labels,
 * account/chat/user IDs, provider messages, keys or draft text are accepted. */
export function turnDiagnostic(reply: AgentReply, elapsedMs: number) {
  const code = reply.evidence.code ?? reply.evidence.narrationCode;
  const category = !code
    ? "completed"
    : /PERMISSION|ACCESS|CONTEXT|STALE|INVALID_RESULT/.test(code)
      ? "authority_rejected"
      : /TIMEOUT|INTERRUPTED|DEADLINE/.test(code)
        ? "timeout_or_interruption"
        : /BUDGET|LOOP_LIMIT|TURN_BYTES|MODEL_BYTES/.test(code)
          ? "budget_exhausted"
          : /MODEL_NOT_CONFIGURED|MODEL_CONFIGURATION/.test(code)
            ? "configuration"
            : /MODEL_HTTP_/.test(code)
              ? "provider_http"
              : /MODEL_NETWORK/.test(code)
                ? "provider_network"
                : /MODEL_OUTPUT|MODEL_COMPLETION|MODEL_REFUSAL/.test(code)
                  ? "provider_completion"
                  : /NARRATION_NOT_REQUESTED/.test(code)
                    ? "factual_without_narration"
                    : /NARRATION|PROSE|CALCULATION_INTERPRETATION|GENERAL_MODEL/.test(
                          code,
                        )
                      ? "validation_rejected"
                      : "unavailable";
  const count = (n: number, max: number) =>
    Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : 0;
  return {
    event: "agus_native_turn",
    version: 1,
    outcome: reply.kind,
    narration: reply.presentation?.narration ?? "none",
    category,
    modelCalls: count(reply.evidence.modelCalls, 6),
    toolCalls: count(reply.evidence.toolCalls, 6),
    resultBytes: count(reply.evidence.resultBytes, 65536),
    elapsedMs: count(elapsedMs, 120000),
    // Validator diagnostics already contain only a closed vocabulary of roles.
    ...(reply.evidence.narrationDiagnostic
      ? {
          validationStage: reply.evidence.narrationDiagnostic.stage,
          validationCategory: reply.evidence.narrationDiagnostic.category,
        }
      : {}),
  };
}
