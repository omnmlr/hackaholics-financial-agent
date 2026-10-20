import { expect, it, vi, afterEach } from "vitest";
import { createConfiguredModel } from "../../src/lib/financial-agent/model";
import {
  computeCalculation,
  composeCalculation,
  quotedNumber,
} from "../../src/lib/financial-agent/calculator";
import { setup, scripted, financial, calc } from "./helpers";
import type { ModelTask } from "../../src/lib/financial-agent/protocol";
import type { z } from "zod";
import type { CalculationBindingSchema } from "../../src/lib/financial-agent/protocol";

const binding = (
  field: string,
  quote: string,
  sourceIndex: number | null = 0,
  unit: z.infer<typeof CalculationBindingSchema>["unit"] = "naira",
) => ({ field, quote, sourceIndex, unit });
const goal = {
  kind: "savings_goal" as const,
  monthlySavingsNaira: "10000",
  targetNaira: "1000000",
  startingNaira: "0",
};
const bindings = [
  binding("monthlySavingsNaira", "10,000"),
  binding("targetNaira", "millionaire", 0, "naira"),
  binding("startingNaira", "", null),
];
const question =
  "If i saved 10,000 naira every month, how much until I become a millionaire";
afterEach(() => vi.unstubAllGlobals());

it.each(["gemini", "openai"])(
  "carries the source-linked calculator through the actual %s adapter (mocked HTTP)",
  async (provider) => {
    const outputs = [
      { route: "financial_reasoning" },
      { text: "Let’s calculate.", calculation: goal, bindings },
      {
        text: "At {{calculation.monthlySavings}} monthly, it takes {{calculation.months}} months.",
      },
      { safeGeneralConversation: true },
    ];
    const tasks: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const prompt = JSON.parse(
          provider === "gemini"
            ? body.contents[0].parts[0].text
            : body.messages[1].content,
        );
        tasks.push(prompt.task);
        const output = JSON.stringify(outputs.shift());
        return Response.json(
          provider === "gemini"
            ? {
                candidates: [
                  {
                    finishReason: "STOP",
                    content: { parts: [{ text: output }] },
                  },
                ],
              }
            : {
                choices: [
                  { finish_reason: "stop", message: { content: output } },
                ],
              },
        );
      }),
    );
    const s = setup(
      createConfiguredModel({ AI_PROVIDER: provider, AI_API_KEY: "mock-only" }),
    );
    const result = await s
      .agent()
      .turn({ ...s.input, text: question, accountIds: [] });
    expect(result.text).toContain("100 months");
    expect(tasks).toEqual(["classify", "reason", "compose", "review_general"]);
  },
);

it("treats the assistant name as a form of address, not a product intent trigger", async () => {
  const s = setup(
    scripted(
      { route: "general" },
      { text: "Hey, I’m AGUS. Long day? Tell me wetin happen 😅" },
      { safeGeneralConversation: true },
    ),
  );
  const result = await s.agent().turn({
    ...s.input,
    text: "Hey AGUS, today don tire me 😅",
    accountIds: [],
  });
  expect(result.kind).toBe("general");
  expect(result.text).toContain("wetin");
});

it("answers the reported failure, Pidgin follow-up and a changed figure using source-linked calculations", async () => {
  const model = scripted(
    { route: "financial_reasoning" },
    { text: "Let's work it out.", calculation: goal, bindings },
    {
      text: "Na {{calculation.months}} months — {{calculation.years}} years and {{calculation.remainingMonths}} months. Small small, e go add up 🙂",
    },
    { safeGeneralConversation: true },
    { route: "financial_reasoning" },
    { text: "Use the earlier monthly savings.", calculation: goal, bindings },
    {
      text: "Yes — with {{calculation.monthlySavings}} monthly, na {{calculation.months}} months.",
    },
    { safeGeneralConversation: true },
    { route: "financial_reasoning" },
    {
      text: "Use the corrected savings.",
      calculation: { ...goal, monthlySavingsNaira: "25000" },
      bindings: [
        binding("monthlySavingsNaira", "25k", 2),
        bindings[1],
        bindings[2],
      ],
    },
    {
      text: "At {{calculation.monthlySavings}} monthly, it takes {{calculation.months}} months.",
    },
    { safeGeneralConversation: true },
  );
  const s = setup(model);
  const first = await s
    .agent()
    .turn({ ...s.input, accountIds: [], text: question });
  expect(first.text).toContain("100 months");
  expect(first.text).toContain("8 years and 4 months");
  const next = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "as how naw, just use what you can match",
  });
  expect(next.kind).toBe("general");
  expect(next.text).toContain("100 months");
  const changed = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: "Actually make am 25k every month",
  });
  expect(changed.text).toContain("40 months");
  expect(s.tools.dispatch).not.toHaveBeenCalled();
  expect(JSON.stringify(s.model.generate.mock.calls)).toContain(question);
});

it("persists a rejected calculation so an informal follow-up can recover it", async () => {
  const s = setup(
    scripted(
      { route: "financial_reasoning" },
      { text: "Working it out.", calculation: goal, bindings: [] },
      { route: "general" },
      { text: "I see the monthly savings question. Let’s work from that." },
      { safeGeneralConversation: true },
    ),
  );
  expect(
    (await s.agent().turn({ ...s.input, accountIds: [], text: question })).kind,
  ).toBe("clarify");
  await s.agent().turn({ ...s.input, accountIds: [], text: "as how naw" });
  const data = s.model.generate.mock.calls.findLast(
    ([task]) => task === "general",
  )?.[1];
  expect(JSON.stringify(data)).toContain(question);
  expect(JSON.stringify(data)).toContain("couldn’t verify");
});

it("uses bounded dialogue after expiry without restoring selections or account authority", async () => {
  const s = setup(
    scripted(
      { route: "financial_reasoning" },
      { text: "Which savings goal should the plan cover?" },
      { safeGeneralConversation: true },
    ),
  );
  s.options.dialogue = [
    { role: "user", text: "I want a flexible savings plan, abeg" },
  ];
  const reply = await s
    .agent()
    .turn({ ...s.input, text: "continue from there", accountIds: [] });
  expect(reply.kind).toBe("general");
  expect(JSON.stringify(s.model.generate.mock.calls)).toContain(
    "flexible savings plan",
  );
  expect(s.tools.dispatch).not.toHaveBeenCalled();
});

it.each(["7000", "13750.25", "43000", "375000"])(
  "verifies varied savings amounts with exact arithmetic: %s",
  (amount) => {
    const source = `I fit save ${amount} naira every month till millionaire`;
    const result = computeCalculation(
      { ...goal, monthlySavingsNaira: amount },
      [binding("monthlySavingsNaira", amount), bindings[1], bindings[2]],
      [source],
    );
    const pennies = BigInt(
      amount
        .replace(".", "")
        .padEnd(
          amount.includes(".")
            ? amount.replace(".", "").length
            : amount.length + 2,
          "0",
        ),
    );
    expect(result.slots["{{calculation.months}}"]).toBe(
      String((100000000n + pennies - 1n) / pennies),
    );
  },
);

it.each(["thirty five thousand", "35k", "35,000", "35000 naira"])(
  "normalizes numeric notation independently of sentence phrasing: %s",
  (quote) => {
    expect(quotedNumber(quote)).toBe(3500000n);
  },
);

it("calculates non-recipe arithmetic without eval or floating-point money", () => {
  const result = computeCalculation(
    {
      kind: "arithmetic",
      inputs: [
        { name: "budget", value: "1000.50" },
        { name: "rent", value: "700.25" },
      ],
      steps: [{ id: "left", op: "subtract", left: "budget", right: "rent" }],
      output: "left",
      unit: "naira",
    },
    [binding("budget", "1000.50"), binding("rent", "700.25")],
    ["If budget na 1000.50 naira and rent na 700.25 naira, wetin remain?"],
  );
  expect(result.slots["{{calculation.result}}"]).toBe("₦300.25");
  expect(() => composeCalculation("₦400 remains", result)).toThrow(
    "CALCULATION_PROSE",
  );
});

it.each([
  { ...bindings[0], quote: "9000" },
  { ...bindings[0], sourceIndex: 16 },
  { ...bindings[0], unit: "percent" as const },
  { ...bindings[0], sourceIndex: null, quote: "" },
])("rejects unsourced or incompatible inputs %#", (bad) => {
  expect(() =>
    computeCalculation(goal, [bad, bindings[1], bindings[2]], [question]),
  ).toThrow();
});

it.each(["10000", "10,000", "10.50", "-10", "−₦10"])(
  "does not accept a partial or sign-stripped numeric quote from %s",
  (amount) => {
    const c = { ...goal, monthlySavingsNaira: "10" };
    expect(() =>
      computeCalculation(
        c,
        [binding("monthlySavingsNaira", "10"), bindings[1], bindings[2]],
        [`Save ${amount} naira monthly till millionaire`],
      ),
    ).toThrow();
  },
);

it("uses exact percentage arithmetic and converts a sourced year to months", () => {
  const savings = computeCalculation(
    {
      kind: "savings_total",
      incomeNaira: "250000",
      savingsPercent: "20",
      months: 6,
    },
    [
      binding("incomeNaira", "250,000"),
      binding("savingsPercent", "20%", 0, "percent"),
      binding("months", "six months", 0, "months"),
    ],
    ["I earn ₦250,000 monthly and save 20% for six months"],
  );
  expect(savings.slots["{{calculation.result}}"]).toBe("₦300,000.00");
  const interest = computeCalculation(
    {
      kind: "simple_interest",
      principalNaira: "100000",
      annualRatePercent: "12",
      months: 12,
    },
    [
      binding("principalNaira", "100,000"),
      binding("annualRatePercent", "12%", 0, "percent"),
      binding("months", "one year", 0, "years"),
    ],
    ["₦100,000 at 12% annual simple interest for one year"],
  );
  expect(interest.slots["{{calculation.result}}"]).toBe("₦12,000.00");
});

it("rejects a stale correction even though the old numeric quote is still present", async () => {
  const s = setup(
    scripted(
      { route: "financial_reasoning" },
      { text: "Working it out", calculation: goal, bindings },
      { text: "It takes {{calculation.months}} months." },
      { safeGeneralConversation: false },
    ),
  );
  const reply = await s.agent().turn({
    ...s.input,
    accountIds: [],
    text: question + "; actually save 20,000 monthly instead",
  });
  expect(reply.kind).toBe("unavailable");
  expect(reply.evidence.code).toBe("GENERAL_MODEL_REJECTED");
  const review = s.model.generate.mock.calls.find(
    ([task]) => task === "review_general",
  )?.[1] as { calculation: unknown; userStatements: string[] };
  expect(review.calculation).toEqual(goal);
  expect(review.userStatements[0]).toContain("20,000");
});

it.each([true, false])(
  "allows flexible grounded prose only after independent support review (%s)",
  async (safe) => {
    const s = setup(
      scripted(
        financial,
        calc,
        (_task: ModelTask, input: { results: { resultId: string }[] }) => ({
          kind: "respond",
          resultIds: input.results.map((r) => r.resultId),
        }),
        {
          narration: (
            _task: ModelTask,
            input: { facts: { resultId: string }[] },
          ) => ({
            paragraphs: [
              {
                resultIds: [input.facts[0].resultId],
                text: "For these records, spending na {{r0.expenses}}. Income na {{r0.income}} — make we look at the difference carefully.",
              },
            ],
          }),
        },
        { safeGeneralConversation: safe },
      ),
    );
    const result = await s.agent().turn(s.input);
    expect(result.presentation?.narration).toBe(
      safe ? "ai" : "factual_fallback",
    );
    if (safe)
      expect(result.presentation?.explanation.join(" ")).toContain(
        "Fictional demo records",
      );
    expect(result.presentation?.results[0].metrics).toHaveLength(3);
  },
);

it("allows financial words in ordinary conversation without routing by a vocabulary dictionary", async () => {
  const s = setup(
    scripted(
      { route: "general" },
      { text: "Money wahala can feel tiring 😅 Want to talk about it?" },
      { safeGeneralConversation: true },
    ),
  );
  const reply = await s
    .agent()
    .turn({ ...s.input, accountIds: [], text: "Money wahala don tire me 😂" });
  expect(reply.kind).toBe("general");
  expect(reply.text).toContain("😅");
  expect(s.tools.dispatch).not.toHaveBeenCalled();
});
