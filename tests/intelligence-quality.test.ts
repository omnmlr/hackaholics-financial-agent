/** Scripted protocol acceptance and deterministic math; never real Gemini evidence. */
import { describe, expect, it, vi } from "vitest";
import { createModelLedAgent } from "../src/lib/model-led-agent/agent";
import {
  calculate,
  composeVerified,
  planSavings,
  calculationFallback,
} from "../src/lib/model-led-agent/calculate";
import type { ToolModel } from "../src/lib/model-led-agent/model";
import { createSecureReads } from "../src/lib/model-led-agent/reads";
import { turnDiagnostic } from "../src/lib/model-led-agent/diagnostics";
import {
  createFixtureRepository,
  createFixtureDataSource,
  createReadTools,
  fixturePrincipal,
  FIXTURE_NOW,
} from "../src/lib/financial-data";
import {
  createRepositoryAccess,
  MemoryContextStore,
  AgentError,
} from "../src/lib/financial-agent";

function fixture(generate: ToolModel["generate"]) {
  const repository = createFixtureRepository(),
    clock = () => FIXTURE_NOW;
  const real = createReadTools({
    repository,
    sources: [createFixtureDataSource({ repository, clock })],
    clock,
  });
  const tools = { ...real, dispatch: vi.fn(real.dispatch) };
  const options = {
    tools,
    access: createRepositoryAccess(repository, clock),
    store: new MemoryContextStore(),
    clock,
    model: { provider: "scripted-test-only", model: "not-gemini", generate },
  };
  const input = {
    ctx: fixturePrincipal,
    conversationId: "quality",
    text: "Hello",
    accountIds: [] as string[],
  };
  return {
    options,
    input,
    repository,
    tools,
    agent: createModelLedAgent(options),
  };
}
const say = (text: string) => ({
  content: { role: "model", parts: [{ text }] },
  text,
  calls: [],
});
const call = (name: string, args: unknown) => ({
  content: {
    role: "model",
    parts: [{ functionCall: { name, args: args as Record<string, unknown> } }],
  },
  text: "",
  calls: [{ name, args }],
});
const search = {
  accountIds: ["amina-current"],
  from: "2026-10-01",
  toExclusive: "2026-11-01",
  query: "Ada",
  limit: 10,
  cursor: null,
};

describe("savings semantics and verified calendar narration", () => {
  it.each([
    [0, 10000, "100", "1 year and 11 months"],
    [200000, 10000, "80", "1 year and 6 months"],
    [200000, 15000, "54", "1 year"],
  ])(
    "rounds up weekly deposits from %s with contribution %s",
    (startingAmount, contribution, value, duration) => {
      const c = planSavings(
        { target: 1000000, startingAmount, contribution, cadence: "weeks" },
        "c1",
      );
      expect(c.value).toBe(value);
      expect(c.unit).toBe("weeks");
      expect(c.duration?.text).toContain(duration);
      const text = calculationFallback([c]);
      expect(text).toContain(`${value} weeks`);
      expect(text).toContain("no interest");
      expect(text).not.toMatch(/ceil\(|Hypothetical result|c1/);
    },
  );
  it("keeps a natural answer and both verified time units in the same paragraph", () => {
    const c = planSavings(
      {
        target: 1000000,
        startingAmount: 0,
        contribution: 10000,
        cadence: "weeks",
      },
      "c1",
    );
    expect(
      composeVerified(
        "You’ll reach ₦1,000,000 in {{c1}} weeks, roughly 1 year and 11 months.\n\nThat assumes consistent deposits and no interest.",
        [c],
      ),
    ).toBe(
      "You’ll reach ₦1,000,000 in 100 weeks, roughly 1 year and 11 months.\n\nThat assumes consistent deposits and no interest.",
    );
  });
  it("handles an already reached goal, fractional deposits and monthly schedules", () => {
    expect(
      planSavings(
        { target: 100, startingAmount: 200, contribution: 10, cadence: "days" },
        "c1",
      ).value,
    ).toBe("0");
    const c = planSavings(
      {
        target: 1000000,
        startingAmount: 200000,
        contribution: 15000,
        cadence: "months",
      },
      "c1",
    );
    expect(c.value).toBe("54");
    expect(c.duration?.text).toBe("roughly 4 years and 6 months");
    expect(
      planSavings(
        {
          target: 100,
          startingAmount: 0,
          contribution: 33.33,
          cadence: "weeks",
        },
        "c1",
      ).value,
    ).toBe("4");
  });
  it.each([0, -1, Infinity, NaN])(
    "rejects invalid savings contribution %s",
    (contribution) => {
      expect(() =>
        planSavings(
          {
            target: 1000000,
            startingAmount: 0,
            contribution,
            cadence: "weeks",
          },
          "c1",
        ),
      ).toThrow();
    },
  );
  it("preserves corrections and explanations in dialogue without reading actual account records", async () => {
    const figures = [
      {
        target: 1000000,
        startingAmount: 0,
        contribution: 10000,
        cadence: "weeks",
      },
      {
        target: 1000000,
        startingAmount: 200000,
        contribution: 10000,
        cadence: "weeks",
      },
      {
        target: 1000000,
        startingAmount: 200000,
        contribution: 15000,
        cadence: "weeks",
      },
    ];
    const seen: string[] = [];
    let current = 0;
    const s = fixture(async (input) => {
      if (input.system.startsWith("Independently check"))
        return say(
          '{"safeGeneralConversation":true,"calculationMatchesQuestion":true}',
        );
      seen.push(JSON.stringify(input.contents));
      if (input.contents.at(-1)?.parts?.some((p) => p.functionResponse))
        return say(
          `That takes {{c1}} weeks. ${current === 2 ? "We subtract the amount already saved, divide by each weekly contribution and round up to a whole deposit." : "This assumes consistent deposits and no interest."}`,
        );
      return call("plan_savings", figures[current++]);
    });
    const questions = [
      "if i saved 10k every week, how long until i become a millionaire 👀🥲",
      "What if I already have ₦200k?",
      "Actually make it ₦15k weekly.",
    ];
    for (let i = 0; i < questions.length; i++) {
      const r = await s.agent.turn({ ...s.input, text: questions[i] });
      expect(r.kind).toBe("general");
      expect(r.text).toContain(["100", "80", "54"][i] + " weeks");
    }
    expect(seen.at(-2)).toContain(questions[0]);
    expect(seen.at(-2)).toContain(questions[1]);
    expect(s.tools.dispatch).not.toHaveBeenCalled();
  });
  it("rejects a numerically correct computation of the wrong formula", async () => {
    let step = 0;
    const s = fixture(
      async () =>
        [
          call("calculate", {
            expression: "1000000/10000",
            description: "Incorrectly ignores existing savings",
            unit: "weeks",
            assumptions: [],
          }),
          say("You need {{c1}} weeks."),
          say(
            '{"safeGeneralConversation":true,"calculationMatchesQuestion":false}',
          ),
        ][step++],
    );
    const r = await s.agent.turn({
      ...s.input,
      text: "I already have ₦200k; saving ₦10k weekly, how long to ₦1 million?",
    });
    expect(r.kind).toBe("clarify");
    expect(r.evidence.code).toBe("CALCULATION_INTERPRETATION_UNCERTAIN");
    expect(r.text).not.toContain("1000000/10000");
  });
  it("does not assert a savings plan as confirmed if review is unavailable", async () => {
    let step = 0;
    const s = fixture(async () => {
      if (step++ === 0)
        return call("plan_savings", {
          target: 1000000,
          startingAmount: 0,
          contribution: 10000,
          cadence: "weeks",
        });
      throw new AgentError("MODEL_HTTP_429");
    });
    const r = await s.agent.turn(s.input);
    expect(r.kind).toBe("clarify");
    expect(r.text).toContain("couldn’t confirm");
    expect(r.text).not.toMatch(/you’ll reach|ceil\(/);
  });
  it("does not permit an unsupported conversion or changed result", () => {
    const c = calculate(
      {
        expression: "10*20",
        unit: "number",
        description: "Multiplication",
        assumptions: [],
      },
      "c1",
    );
    expect(composeVerified("That’s {{c1}}, or 999 years.", [c])).toBe(
      "That comes to 200.",
    );
  });
});

describe("native financial narration grounding and follow-ups", () => {
  it("compiles exact source values into slots before semantic review without authorizing invented values", async () => {
    const s = fixture(async () => say("unused"));
    const review = vi.fn(async (_raw: unknown) => true);
    const reads = createSecureReads({
      ...s.options,
      ctx: s.input.ctx,
      accountIds: ["amina-current"],
      selection: null,
      reviewNarration: review,
    });
    await reads.execute("search_transactions", search);
    const r = await reads.finish({
      paragraphs: [
        {
          resultIds: [reads.authoring!.examples[0].resultId],
          text: "I found 2 possible matches. Ada Obi: ₦7,500 on 7 October 2026. Ada Okafor: ₦5,000 on 5 October 2026. Which one would you like to inspect?",
        },
      ],
    });
    expect(r!.presentation?.narration).toBe("ai");
    expect(review.mock.calls[0][0]).toMatchObject({
      paragraphs: [
        {
          text: "I found {{r0.count}} possible matches. {{r0.name0}}: {{r0.amount0}} on {{r0.date0}}. {{r0.name1}}: {{r0.amount1}} on {{r0.date1}}. Which one would you like to inspect?",
        },
      ],
    });
    expect(r!.presentation?.explanation.join(" ")).toContain(
      "Ada Obi (fictional): ₦7,500.00",
    );
  });
  it("does not treat slot compilation as proof that a recipient was credited", async () => {
    const s = fixture(async () => say("unused"));
    const review = vi.fn(async () => false);
    const reads = createSecureReads({
      ...s.options,
      ctx: s.input.ctx,
      accountIds: ["amina-current"],
      selection: null,
      reviewNarration: review,
    });
    await reads.execute("search_transactions", search);
    const r = await reads.finish({
      paragraphs: [
        {
          resultIds: [reads.authoring!.examples[0].resultId],
          text: "Ada Obi received ₦7,500 and her bank confirmed credit.",
        },
      ],
    });
    expect(review).toHaveBeenCalledOnce();
    expect(r!.presentation?.narration).toBe("factual_fallback");
    expect(r!.presentation?.explanation.join(" ")).not.toContain(
      "bank confirmed",
    );
  });
  it("uses reviewed natural source narration for the exact ambiguous Ada query", async () => {
    let step = 0;
    const s = fixture(async (input) => {
      if (input.system.startsWith("Independently review source-backed"))
        return say('{"grounded":true}');
      if (step++ === 0) return call("search_transactions", search);
      const output = input.contents.at(-1)!.parts![0].functionResponse!
        .response!.output as { result: { resultId: string } };
      return call("present_financial", {
        paragraphs: [
          {
            resultIds: [output.result.resultId],
            text: "I found {{r0.count}} possible matches for Ada in the selected records. {{r0.name0}}: {{r0.amount0}} on {{r0.date0}}. {{r0.name1}}: {{r0.amount1}} on {{r0.date1}}. Which one would you like to inspect?",
          },
        ],
      });
    });
    const r = await s.agent.turn({
      ...s.input,
      text: "Find payments to Ada in October 2026",
      accountIds: ["amina-current"],
    });
    expect(r.presentation?.narration).toBe("ai");
    expect(r.presentation?.explanation.join(" ")).toContain(
      "Ada Obi (fictional): ₦7,500.00 on 7 October 2026",
    );
    expect(r.presentation?.explanation.join(" ")).toContain(
      "Ada Okafor (fictional): ₦5,000.00 on 5 October 2026",
    );
    expect(r.kind).toBe("clarify");
    expect(r.evidence.modelCalls).toBe(3);
    expect(r.presentation?.results[0].records).toHaveLength(2);
  });
  it.each([false, true])(
    "releases flexible prose only after review (approved %s)",
    async (approved) => {
      const s = fixture(async () => say("unused"));
      const review = vi.fn(async () => approved);
      const reads = createSecureReads({
        ...s.options,
        ctx: s.input.ctx,
        accountIds: ["amina-current"],
        selection: null,
        reviewNarration: review,
      });
      await reads.execute("search_transactions", search);
      const resultId = Object.values(reads.authoring!.examples)[0].resultId;
      const r = await reads.finish({
        paragraphs: [
          {
            resultIds: [resultId],
            text: "Here are {{r0.count}} possible matches. Which one would you like to inspect?",
          },
        ],
      });
      expect(review).toHaveBeenCalledOnce();
      expect(r!.presentation?.narration).toBe(
        approved ? "ai" : "factual_fallback",
      );
      if (!approved)
        expect(r!.evidence.narrationCode).toBe("NARRATION_REVIEW_REJECTED");
    },
  );
  it("rejects literal invented amounts before spending a review call", async () => {
    const s = fixture(async () => say("unused")),
      review = vi.fn(async () => true);
    const reads = createSecureReads({
      ...s.options,
      ctx: s.input.ctx,
      accountIds: ["amina-current"],
      selection: null,
      reviewNarration: review,
    });
    await reads.execute("search_transactions", search);
    const r = await reads.finish({
      paragraphs: [
        {
          resultIds: [reads.authoring!.examples[0].resultId],
          text: "Ada received ₦999,999 and her bank confirmed it.",
        },
      ],
    });
    expect(review).not.toHaveBeenCalled();
    expect(r!.presentation?.narration).toBe("factual_fallback");
    expect(r!.presentation?.explanation.join(" ")).not.toContain("999,999");
  });
  it("revocation during independent review discards all financial facts", async () => {
    const s = fixture(async () => say("unused"));
    const reads = createSecureReads({
      ...s.options,
      ctx: s.input.ctx,
      accountIds: ["amina-current"],
      selection: null,
      reviewNarration: async () => {
        await s.repository.revokeConsent(
          s.input.ctx,
          "consent-amina",
          FIXTURE_NOW,
        );
        return true;
      },
    });
    await reads.execute("search_transactions", search);
    await expect(
      reads.finish({
        paragraphs: [
          {
            resultIds: [reads.authoring!.examples[0].resultId],
            text: "Here are {{r0.count}} possible matches.",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });
  it("gives a readable source fallback and rereads the chosen first candidate", async () => {
    const s = fixture(async () => say("unused"));
    const first = createSecureReads({
      ...s.options,
      ctx: s.input.ctx,
      accountIds: ["amina-current"],
      selection: null,
    });
    await first.execute("search_transactions", search);
    const matches = await first.finish();
    expect(matches?.presentation?.explanation[0]).toContain(
      "Which one would you like to inspect?",
    );
    const second = createSecureReads({
      ...s.options,
      ctx: s.input.ctx,
      accountIds: ["amina-current"],
      selection: first.selection,
    });
    await second.execute("get_transaction", {
      accountId: "amina-current",
      transactionId: first.selection!.candidates[0].transactionId,
    });
    const detail = await second.finish();
    expect(detail?.presentation?.explanation[0]).toContain("Ada Obi");
    expect(detail?.presentation?.explanation[0]).toContain(
      "does not confirm recipient bank credit",
    );
    expect(s.tools.dispatch).toHaveBeenCalledTimes(2);
  });
});

describe("privacy-conscious operational diagnostics", () => {
  it.each([
    ["MODEL_HTTP_429", "provider_http"],
    ["MODEL_NETWORK", "provider_network"],
    ["NARRATION_VALUE", "validation_rejected"],
    ["NARRATION_REVIEW_REJECTED", "validation_rejected"],
    ["TIMEOUT", "timeout_or_interruption"],
    ["MODEL_OUTPUT_BUDGET", "budget_exhausted"],
    ["MODEL_NOT_CONFIGURED", "configuration"],
    ["NARRATION_NOT_REQUESTED", "factual_without_narration"],
  ])("distinguishes %s without copying records", (code, category) => {
    const r = {
      kind: "general" as const,
      text: "private raw record and key",
      citations: ["private-id"],
      evidence: { code, modelCalls: 2000, toolCalls: 2, resultBytes: 100 },
    };
    const event = turnDiagnostic(r, 1234);
    expect(event.category).toBe(category);
    expect(event.modelCalls).toBe(6);
    expect(JSON.stringify(event)).not.toMatch(
      /private|key|raw record|MODEL_HTTP/,
    );
  });
});
