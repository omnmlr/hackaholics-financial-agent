/* global Response: readonly */
// Explicitly mocked native function-call transport. No real provider requests.
// The established fixture supplies only the existing payment-draft extractor.
import "./gemini-chat-payments.mjs";
const previous = globalThis.fetch;
let calls = 0;
const response = (parts) =>
  Response.json({
    candidates: [{ finishReason: "STOP", content: { role: "model", parts } }],
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 20 },
  });
const say = (text) => response([{ text }]);
const call = (name, args) =>
  response([
    {
      thoughtSignature: "native-fixture-signature",
      functionCall: { name, args, id: `native-fixture-${calls}` },
    },
  ]);

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : (input.url ?? String(input));
  if (!url.startsWith("https://generativelanguage.googleapis.com/"))
    return previous(input, init);
  if (process.env.AI_API_KEY !== "browser-mock-inference-only")
    throw new Error("Explicit test credential required");
  const body = JSON.parse(init.body);
  const system =
    body.systemInstruction?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (system.startsWith("Independently review source-backed AGUS narration."))
    return say('{"grounded":true}');
  if (system.startsWith("Independently check a proposed AGUS answer."))
    return say(
      JSON.stringify({
        safeGeneralConversation: true,
        calculationMatchesQuestion: true,
      }),
    );
  if (
    !system.startsWith(
      "You are AGUS, an intelligent conversational financial assistant.",
    )
  )
    return previous(input, init);
  if (++calls > 100) throw new Error("Native fixture budget exceeded");
  const contents = body.contents;
  const last = contents.at(-1);
  const currentQuestion =
    contents
      .findLast(
        (content) =>
          content.role === "user" &&
          content.parts.some((p) => typeof p.text === "string"),
      )
      ?.parts.map((p) => p.text ?? "")
      .join("") ?? "";
  const toolResponses = last.parts.filter((p) => p.functionResponse);
  if (toolResponses.length) {
    if (
      !contents.some(
        (content) =>
          content.role === "model" &&
          content.parts.some(
            (p) => p.thoughtSignature === "native-fixture-signature",
          ),
      )
    )
      throw new Error("Native model content/signature was not preserved");
    const tool = toolResponses.at(-1).functionResponse;
    const output = tool.response.output;
    if (tool.name === "plan_savings")
      return say(
        `Saving ₦${output.savings.contribution.toLocaleString("en-NG")} weekly, you’ll reach ₦1,000,000 in {{c1}} weeks${output.duration ? `, ${output.duration.text}` : ""}. That assumes consistent end-of-week deposits, no interest, fees or withdrawals.`,
      );
    if (tool.name === "calculate")
      return say(
        output.unit === "naira"
          ? "Your hypothetical remainder is ₦{{c1}}."
          : "That comes to {{c1}}.",
      );
    if (tool.name === "search_transactions") {
      const authoring = output.authoring;
      const resultId = output.result.resultId;
      return call("present_financial", {
        paragraphs: [
          {
            resultIds: [resultId],
            text: authoring.slots["{{r0.count}}"]
              ? "I found {{r0.count}} possible matches for Ada in the selected records. {{r0.name0}}: {{r0.amount0}} on {{r0.date0}}. {{r0.name1}}: {{r0.amount1}} on {{r0.date1}}. Which one would you like to inspect?"
              : [
                  "No matching records were found in the available data.",
                  ...authoring.required,
                ].join(" "),
          },
        ],
      });
    }
    if (
      tool.name === "get_transaction" ||
      tool.name === "find_payment_evidence"
    ) {
      const authoring = output.authoring;
      const ids = [...new Set(authoring.examples.map((e) => e.resultId))];
      return call("present_financial", {
        paragraphs: ids.map((id, i) => ({
          resultIds: [id],
          text: authoring.slots[`{{r${i}.name0}}`]
            ? `This record is for {{r${i}.name0}}: {{r${i}.amount0}} on {{r${i}.date0}}. Its source status is {{r${i}.status0}}.`
            : "The available evidence cannot confirm recipient bank credit.",
        })),
      });
    }
    if (tool.name === "calculate_spending") {
      if (
        currentQuestion ===
        "Show my spending even if the explanation service fails"
      )
        return Response.json(
          {
            error: {
              code: 429,
              status: "RESOURCE_EXHAUSTED",
              message: "FIXTURE_PRIVATE_ERROR_MUST_STAY_HIDDEN",
            },
          },
          { status: 429 },
        );
      const authoring = output.authoring;
      const resultId = output.result.resultId;
      const example = authoring.examples.find(
        (e) => e.resultId === resultId && /total spending was/.test(e.text),
      );
      return call("present_financial", {
        paragraphs: [
          {
            resultIds: [resultId],
            text: [example.text, ...authoring.required].join(" "),
          },
        ],
      });
    }
    throw new Error(`Unexpected native fixture tool: ${tool.name}`);
  }
  const text = last.parts.map((p) => p.text ?? "").join("");
  if (text === "10 times 20 is what??")
    return call("calculate", {
      expression: "10*20",
      description: "Multiplication",
      unit: "number",
      assumptions: [],
    });
  if (
    [
      "if i saved 10k every week, how long until i become a millionaire 👀🥲",
      "What if I already have ₦200k?",
      "Actually make it ₦15k weekly.",
    ].includes(text)
  )
    return call("plan_savings", {
      target: 1000000,
      startingAmount: text.startsWith("if i saved") ? 0 : 200000,
      contribution: text.startsWith("Actually") ? 15000 : 10000,
      cadence: "weeks",
    });
  if (
    text === "Show details for the first candidate" ||
    text === "Was the recipient actually credited?"
  ) {
    const hint = contents
      .flatMap((c) => c.parts ?? [])
      .find((p) => p.text?.includes('"untrustedSelectionHints"'));
    const selected = JSON.parse(hint.text).untrustedSelectionHints
      .candidates[0];
    return call(
      text.startsWith("Was") ? "find_payment_evidence" : "get_transaction",
      { accountId: selected.accountId, transactionId: selected.transactionId },
    );
  }
  if (text === "Simulate an unavailable provider while discussing lizards")
    return Response.json(
      {
        error: {
          code: 429,
          status: "RESOURCE_EXHAUSTED",
          message: "FIXTURE_PRIVATE_ERROR_MUST_STAY_HIDDEN",
        },
      },
      { status: 429 },
    );
  if (text === "Try the last question again") {
    if (
      !contents.some(
        (content) =>
          content.role === "user" &&
          content.parts.some(
            (p) =>
              p.text ===
              "Simulate an unavailable provider while discussing lizards",
          ),
      )
    )
      throw new Error("Failed-provider question was not restored");
    return say(
      "Lizards warm themselves in sunlight to regulate their body temperature.",
    );
  }
  if (text === "Tell me a short joke about robots")
    return say(
      "Why did the robot bring a ladder? It wanted to reach a higher level.",
    );
  if (text === "What is (47 plus 13) times 9?")
    return call("calculate", {
      expression: "(47+13)*9",
      description: "Combined total",
      unit: "number",
      assumptions: [],
    });
  if (text === "Use 18 instead of 9 and keep the rest") {
    if (
      !contents.some(
        (content) =>
          content.role === "user" &&
          content.parts.some((p) => p.text === "What is (47 plus 13) times 9?"),
      )
    )
      throw new Error("Reload lost the source conversation");
    return call("calculate", {
      expression: "(47+13)*18",
      description: "Corrected combined total",
      unit: "number",
      assumptions: [],
    });
  }
  if (
    text ===
    "If my budget is ₦150,000 and rent is ₦80,000 and food is ₦25,000, what remains?"
  )
    return call("calculate", {
      expression: "150000-80000-25000",
      description: "Hypothetical budget remainder",
      unit: "naira",
      assumptions: ["Only the two stated expenses are deducted."],
    });
  if (
    text === "Show my spending for October 2026" ||
    text === "Show my spending from 2026-10-01 to 2026-11-01" ||
    text === "Show my spending even if the explanation service fails"
  ) {
    const selected = JSON.parse(
      system.match(/Server selected accounts: (\[[^\n]*?\])\./)[1],
    );
    return selected.length
      ? call("calculate_spending", {
          accountIds: selected,
          from: "2026-10-01",
          toExclusive: "2026-11-01",
          groupBy: "none",
        })
      : call("request_account", {});
  }
  if (text === "Find payments to Ada in October 2026") {
    const selected = JSON.parse(
      system.match(/Server selected accounts: (\[[^\n]*?\])\./)[1],
    );
    return selected.length
      ? call("search_transactions", {
          accountIds: selected,
          from: "2026-10-01",
          toExclusive: "2026-11-01",
          query: "Ada",
          limit: 10,
          cursor: null,
        })
      : call("request_account", {});
  }
  if (
    text.startsWith("Prepare 500 to Ada") ||
    text === "Help me prepare a payment draft"
  )
    return call("prepare_payment_draft", {});
  throw new Error("Unexpected native browser fixture request");
};
