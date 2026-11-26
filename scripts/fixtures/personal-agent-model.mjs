/** TEST ONLY: intercepted Gemini transport. No real model or external requests. */
const originalFetch = globalThis.fetch;
let round = 0;
globalThis.fetch = async (input, init) => {
  const url = new globalThis.URL(
    typeof input === "string"
      ? input
      : input instanceof globalThis.URL
        ? input.href
        : input.url,
  );
  if (url.hostname === "generativelanguage.googleapis.com") {
    const request = JSON.parse(String(init?.body));
    const review =
      request.generationConfig?.responseMimeType === "application/json";
    const outputs = [
      [
        {
          functionCall: {
            id: "plan",
            name: "update_plan",
            args: {
              steps: [
                {
                  id: "estimate",
                  description: "Evaluate user-stated costs",
                  kind: "tool",
                  status: "in_progress",
                },
                {
                  id: "prepare",
                  description: "Prepare the requested preference and reminder",
                  kind: "tool",
                  status: "pending",
                },
              ],
            },
          },
        },
      ],
      [
        {
          functionCall: {
            id: "math",
            name: "calculate",
            args: {
              expression: "2500*4+1500",
              description: "User-stated total",
              unit: "naira",
              assumptions: [
                "User-stated hypothetical costs; no bank balance read",
              ],
            },
          },
        },
      ],
      [
        {
          functionCall: {
            id: "note",
            name: "save_memory_proposal",
            args: {
              text: "Prefer reversible commitments",
              category: "preference",
            },
          },
        },
        {
          functionCall: {
            id: "reminder",
            name: "prepare_responsibility",
            args: {
              title: "Review the supplied estimate",
              objective: "Review terms; do not pay or send a message",
              dueAt: new Date(Date.now() + 86400000).toISOString(),
            },
          },
        },
      ],
      [
        {
          text: "Your supplied costs total ₦11,500. I prepared the preference and reminder for your review. The note is unconfirmed and the reminder awaits activation; nothing was paid or sent.",
        },
      ],
    ];
    const parts = review ? [{ text: '{"grounded":true}' }] : outputs[round++];
    if (!parts) throw new Error("Scripted model responses exhausted");
    return new globalThis.Response(
      JSON.stringify({
        candidates: [
          { content: { role: "model", parts }, finishReason: "STOP" },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error(
      "External networking is disabled in this scripted-model smoke test",
    );
  return originalFetch(input, init);
};
