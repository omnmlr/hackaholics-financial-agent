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
    if (tool.name === "calculate")
      return say(
        output.unit === "naira"
          ? "Your hypothetical remainder is ₦{{c1}}."
          : "That comes to {{c1}}.",
      );
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
  if (text.startsWith("Prepare 500 to Ada"))
    return call("prepare_payment_draft", {});
  throw new Error("Unexpected native browser fixture request");
};
