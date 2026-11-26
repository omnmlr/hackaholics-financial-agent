import type { AgentReply } from "./financial-agent";
import { FinancialPresentationSchema } from "./financial-agent/presentation";

/** Speak the visible answer, not the hidden technical evidence transcript. */
export function responseSpeechText(reply: AgentReply) {
  const parsed = FinancialPresentationSchema.safeParse(reply.presentation);
  if (
    !parsed.success ||
    !parsed.data.results.every((r) => reply.citations.includes(r.resultId))
  )
    return reply.text;
  const p = parsed.data;
  return [
    ...(p.results.some((r) => r.sources.some((s) => s.mode === "fixture"))
      ? ["These are fictional demo records."]
      : []),
    ...p.explanation,
    ...p.results.flatMap((r) => [
      ...r.metrics.map((m) => `${m.label}: ${m.value}.`),
      ...r.records.map(
        (record) =>
          `${record.name}: ${record.amount}, ${record.direction}, source status ${record.status}.`,
      ),
      ...r.limits,
    ]),
  ].join(" ");
}

export function pronounceResponse(text: string) {
  return text
    .replace(/₦\s*([\d,]+(?:\.\d{1,2})?)/g, "$1 naira")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/https?:\/\/\S+/g, "link in the written response")
    .replace(/[*_#`]/g, "");
}
