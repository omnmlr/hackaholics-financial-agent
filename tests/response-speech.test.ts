import { expect, it } from "vitest";
import {
  responseSpeechText,
  pronounceResponse,
} from "../src/lib/response-speech";
import { setup, scripted, financial, calc } from "./financial-agent/helpers";

it("speaks visible authoritative totals and limitations without the technical evidence dump", async () => {
  const s = setup(
    scripted(
      financial,
      calc,
      (_task: string, input: { results: { resultId: string }[] }) => ({
        kind: "respond",
        resultIds: input.results.map((r) => r.resultId),
      }),
    ),
  );
  const reply = await s.agent().turn(s.input);
  const speech = responseSpeechText(reply);
  expect(speech).toContain("19,751.51");
  expect(speech).toContain("250,000.00");
  expect(speech).toContain("fictional demo records");
  expect(speech).toContain("not an account balance");
  expect(speech).not.toContain(reply.citations[0]);
  expect(pronounceResponse(speech)).toContain("19,751.51 naira");
});

it("does not speak an uncited financial presentation as authoritative", async () => {
  const s = setup(
    scripted(
      financial,
      calc,
      (_task: string, input: { results: { resultId: string }[] }) => ({
        kind: "respond",
        resultIds: input.results.map((r) => r.resultId),
      }),
    ),
  );
  const reply = await s.agent().turn(s.input);
  expect(
    responseSpeechText({
      ...reply,
      citations: [],
      text: "No verified result.",
    }),
  ).toBe("No verified result.");
});
