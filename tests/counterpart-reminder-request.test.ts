import { expect, it } from "vitest";
import { existingReminderRequest } from "../src/components/agus/reminder-request";
import type { AgentReply } from "../src/lib/financial-agent/agent";
const now = Date.parse("2026-11-14T23:30:00Z");
const reply: AgentReply = {
  kind: "general",
  text: "Prepared",
  citations: [],
  evidence: { modelCalls: 0, toolCalls: 0, resultBytes: 0 },
  workspace: { kind: "responsibility", id: "example" },
};
it("blocks a repeated normalized request for a persisted responsibility on the same Lagos day", () => {
  const messages = [
    {
      role: "user",
      text: "Abeg remind me about Ada",
      createdAt: "2026-11-14T23:01:00Z",
    },
    { role: "assistant", text: reply.text, reply },
  ];
  expect(
    existingReminderRequest(messages, "  abeg  remind me about ADA ", now),
  ).toBe(true);
  expect(
    existingReminderRequest(messages, "Create another reminder about Ada", now),
  ).toBe(false);
});
it("does not mistake a previous Lagos day or an unanswered question for an existing proposal", () => {
  const messages = [
    { role: "user", text: "tomorrow", createdAt: "2026-11-14T22:30:00Z" },
    { role: "assistant", text: reply.text, reply },
  ];
  expect(existingReminderRequest(messages, "tomorrow", now)).toBe(false);
  expect(
    existingReminderRequest(
      messages.slice(0, 1),
      "tomorrow",
      Date.parse("2026-11-14T22:40:00Z"),
    ),
  ).toBe(false);
});
it("ignores ordinary financial replies and malformed historical timestamps", () => {
  expect(
    existingReminderRequest(
      [
        { role: "user", text: "summary", createdAt: "bad date" },
        { role: "assistant", text: "summary", reply },
      ],
      "summary",
      now,
    ),
  ).toBe(false);
  expect(
    existingReminderRequest(
      [
        {
          role: "user",
          text: "summary",
          createdAt: new Date(now).toISOString(),
        },
        {
          role: "assistant",
          text: "summary",
          reply: { ...reply, workspace: undefined },
        },
      ],
      "summary",
      now,
    ),
  ).toBe(false);
});
