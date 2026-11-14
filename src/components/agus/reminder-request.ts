import type { AgentReply } from "@/lib/financial-agent/agent";
type TurnMessage = {
  role: string;
  text: string;
  createdAt?: string;
  reply?: AgentReply;
};
const normalized = (text: string) =>
  text.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-NG");
const day = (date: string | number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
/** UX duplicate protection only; never supplies execution authority or changes records. */
export function existingReminderRequest(
  messages: TurnMessage[],
  text: string,
  now = Date.now(),
): boolean {
  return messages.some(
    (m, i) =>
      m.role === "user" &&
      normalized(m.text) === normalized(text) &&
      !!m.createdAt &&
      Number.isFinite(Date.parse(m.createdAt)) &&
      day(m.createdAt) === day(now) &&
      (
        messages[i + 1]?.reply?.workspaceActions ??
        (messages[i + 1]?.reply?.workspace
          ? [messages[i + 1].reply!.workspace!]
          : [])
      ).some((a) => a.kind === "responsibility"),
  );
}
