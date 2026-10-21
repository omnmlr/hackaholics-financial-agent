/** Scripted protocol acceptance and deterministic math; never real Gemini evidence. */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createModelLedAgent } from "../src/lib/model-led-agent/agent";
import {
  calculate,
  composeVerified,
  planSavings,
  calculationFallback,
  normalizeAnswerFormatting,
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

describe("ordinary conversation stays conversational (scripted protocol)", () => {
  it.each([
    ["How are you doing?", "I’m here and ready to chat. How’s your day going?"],
    [
      "I'm bored. Tell me something interesting.",
      "Octopuses have three hearts, and their blue blood helps carry oxygen in cold water.",
    ],
    [
      "Who are you and what can you do?",
      "I’m AGUS. We can chat, work through financial questions, read fictional account records you authorize, or prepare an editable payment draft for you to review.",
    ],
    [
      "Explain inflation like I'm 12.",
      "Inflation means prices generally rise over time, so the same pocket money buys fewer things. It is about prices across the economy, rather than a single shop raising its price.",
    ],
    [
      "Omo, this economy no funny again 😭",
      "E tough. When everyday things keep costing more, the pressure can really add up.",
    ],
  ])(
    "does not force account selection or tools for %s",
    async (question, response) => {
      const modelInputs: Parameters<ToolModel["generate"]>[0][] = [];
      const s = fixture(async (input) => {
        modelInputs.push(input);
        return input.system.startsWith("Independently check")
          ? say('{"safeGeneralConversation":true}')
          : say(response);
      });
      const r = await s.agent.turn({ ...s.input, text: question });
      expect(r.kind).toBe("general");
      expect(r.text).toBe(response);
      expect(r.accountAction).toBeUndefined();
      expect(r.handoff).toBeUndefined();
      expect(s.tools.dispatch).not.toHaveBeenCalled();
      expect(modelInputs[0].contents.at(-1)!.parts![0].text).toBe(question);
      expect(
        modelInputs[0].declarations.some(
          (d) => d.name === "search_transactions",
        ),
      ).toBe(false);
    },
  );
});

describe("savings semantics and verified calendar narration", () => {
  it("renders recorded genuine math explanation formatting as readable verified plain text", () => {
    const c = planSavings(
      {
        target: 1000000,
        startingAmount: 0,
        contribution: 10000,
        cadence: "weeks",
      },
      "c1",
    );
    const text = normalizeAnswerFormatting(
      "Mathematically, $\\frac{₦1,000,000}{₦10,000\\text{ per week}} = {{c1}}$ weeks.\n\n*Assumptions: no interest.*",
    );
    expect(composeVerified(text, [c])).toBe(
      "Mathematically, ₦1,000,000 ÷ ₦10,000 per week = 100 weeks.\n\nAssumptions: no interest.",
    );
    expect(normalizeAnswerFormatting("A $5 fee and a $6 deposit.")).toBe(
      "A $5 fee and a $6 deposit.",
    );
  });
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
  it("keeps fractional hypothetical money readable without grouping fractional digits", () => {
    const c = planSavings(
      {
        target: 1234.5678,
        startingAmount: 0,
        contribution: 100.1234,
        cadence: "weeks",
      },
      "c1",
    );
    expect(calculationFallback([c])).toContain("₦1,234.5678");
    expect(calculationFallback([c])).toContain("₦100.1234");
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
  it("proves the recorded genuine candidate list without depending on its false-positive reviewer", async () => {
    const recorded = JSON.parse(
      readFileSync(
        new URL(
          "../docs/intelligence-motion/genuine-review.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const original =
      recorded.responses[1][0].functionCall.args.paragraphs[0].text;
    let step = 0;
    const generate = vi.fn(
      async (input: Parameters<ToolModel["generate"]>[0]) => {
        if (step++ === 0)
          return call(
            "search_transactions",
            recorded.responses[0][0].functionCall.args,
          );
        if (step > 2)
          throw new Error("A fully proved list must not require model review");
        const output = input.contents.at(-1)!.parts![0].functionResponse!
          .response!.output as { result: { resultId: string } };
        return call("present_financial", {
          paragraphs: [{ resultIds: [output.result.resultId], text: original }],
        });
      },
    );
    const s = fixture(generate);
    const r = await s.agent.turn({
      ...s.input,
      text: "Find payments to Ada in October 2026",
      accountIds: ["amina-current"],
    });
    expect(r.kind).toBe("clarify");
    expect(r.presentation?.narration).toBe("ai");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(r.presentation?.explanation.join(" ")).toContain(
      "Which one would you like to inspect?",
    );
    expect(r.presentation?.explanation.join(" ")).toContain(
      "Coverage is partial",
    );
    expect(r.presentation?.explanation.join(" ")).toContain("does not confirm");
  });
  it.each([
    "I found 2 possible matches for Ada in October 2026: Ada Obi for ₦5,000.00 on 7 October 2026, and Ada Okafor for ₦7,500.00 on 5 October 2026. Which one would you like to inspect?",
    "I found 2 possible matches for Ada in October 2026: Ada Obi for ₦7,500.00 on 7 October 2026, and Ada Okafor for ₦5,000.00 on 5 October 2026. Both recipients were credited.",
    "I found 2 possible matches for Ada in November 2026: Ada Obi for ₦7,500.00 on 7 October 2026, and Ada Okafor for ₦5,000.00 on 5 October 2026. Which one would you like to inspect?",
  ])("does not prove mutated source claims: %s", async (text) => {
    const s = fixture(async () => say("unused"));
    const reads = createSecureReads({
      ...s.options,
      ctx: s.input.ctx,
      accountIds: ["amina-current"],
      selection: null,
      reviewNarration: async () => false,
    });
    await reads.execute("search_transactions", search);
    const r = await reads.finish({
      paragraphs: [{ resultIds: [reads.narrationResults[0].resultId], text }],
    });
    expect(r!.presentation?.narration).toBe("factual_fallback");
    expect(r!.presentation?.explanation.join(" ")).not.toContain(
      "Both recipients were credited",
    );
  });
  it.each([false, true])(
    "rejects an explicit recipient-credit review reason even when approval is %s",
    async (grounded) => {
      let step = 0;
      const s = fixture(async (input) => {
        if (input.system.startsWith("Independently review source-backed"))
          return say(JSON.stringify({ grounded, reason: "recipient_credit" }));
        if (step++ === 0) return call("search_transactions", search);
        const output = input.contents.at(-1)!.parts![0].functionResponse!
          .response!.output as { result: { resultId: string } };
        return call("present_financial", {
          paragraphs: [
            {
              resultIds: [output.result.resultId],
              text: "{{r0.name0}} received {{r0.amount0}} and the bank credited it.",
            },
          ],
        });
      });
      const r = await s.agent.turn({
        ...s.input,
        accountIds: ["amina-current"],
      });
      expect(r.presentation?.narration).toBe("factual_fallback");
      expect(r.evidence.narrationCode).toBe(
        "NARRATION_REVIEW_RECIPIENT_CREDIT",
      );
      expect(r.presentation?.explanation.join(" ")).not.toContain(
        "bank credited it",
      );
    },
  );
  it("allows a source narration review to use its 20-second model budget", async () => {
    vi.useFakeTimers();
    try {
      let step = 0;
      const s = fixture(async (input) => {
        if (input.system.startsWith("Independently review source-backed")) {
          await new Promise((resolve) => setTimeout(resolve, 12000));
          return say('{"grounded":true}');
        }
        if (step++ === 0) return call("search_transactions", search);
        const output = input.contents.at(-1)!.parts![0].functionResponse!
          .response!.output as { result: { resultId: string } };
        return call("present_financial", {
          paragraphs: [
            {
              resultIds: [output.result.resultId],
              text: "Here are {{r0.count}} possible matches. Which one would you like to inspect?",
            },
          ],
        });
      });
      const pending = s.agent.turn({
        ...s.input,
        accountIds: ["amina-current"],
      });
      await vi.advanceTimersByTimeAsync(12000);
      const r = await pending;
      expect(r.presentation?.narration).toBe("ai");
      expect(r.evidence.modelCalls).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
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
    expect(review).not.toHaveBeenCalled();
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
  it("binds source-backed month labels and dates without a year while still rejecting unknown dates", async () => {
    const s = fixture(async () => say("unused"));
    const review = vi.fn(async () => true);
    const reads = createSecureReads({
      ...s.options,
      ctx: s.input.ctx,
      accountIds: ["amina-current"],
      selection: null,
      reviewNarration: review,
    });
    await reads.execute("search_transactions", search);
    const resultIds = [reads.narrationResults[0].resultId];
    const r = await reads.finish({
      paragraphs: [
        {
          resultIds,
          text: "In October 2026, I found Ada Obi: ₦7,500 on October 7, and Ada Okafor: ₦5,000 on October 5. Which one would you like to inspect?",
        },
      ],
    });
    expect(r!.presentation?.narration).toBe("ai");
    expect(r!.presentation?.explanation.join(" ")).toContain("7 October 2026");
    const bad = await reads.finish({
      paragraphs: [{ resultIds, text: "Ada Obi: ₦7,500 on October 8." }],
    });
    expect(bad!.presentation?.narration).toBe("factual_fallback");
    expect(review).toHaveBeenCalledOnce();
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
