# AGUS model-led agent: architecture investigation

Research date: 20 October 2026. This document records the engineering rationale,
not a claim that the candidate has won the comparative evaluation. Real-provider
results and residual failures belong in the evaluation report.

## Decision

Use Gemini's native function calling through the official `@google/genai` SDK,
with a small, explicitly bounded server-side loop. Retain AGUS's existing
authentication, owner-scoped conversation persistence, financial read dispatcher,
provenance contracts, permission checks, and payment review workflow. Expose only
the tools appropriate to a conversational turn. Do not expose an approve, submit,
retry-payment, or execute-transfer function.

This is a hybrid: established provider orchestration for understanding and tool
selection, existing AGUS code for financial authority. It replaces neither the
banking backend nor the useful PR #36 UI and voice work.

The choice is practical for the finals because AGUS currently targets Gemini,
already owns durable chat storage and payment controls, and needs a bounded
request/response agent rather than a second workflow engine. A framework does not
enforce account permissions or verify a ledger result by itself. Those guarantees
must remain in the backend regardless of orchestration library.

## Approaches examined

| Approach | What it provides | Fit and tradeoff for AGUS |
| --- | --- | --- |
| Native Gemini function calling | Model decides whether to answer or request named functions with structured arguments; application supplies results for another generation. | Recommended. Smallest integration surface, direct model access using the existing secret, and explicit control over the provider transcript and limits. The application must implement the bounded loop and tool policy correctly. |
| Vercel AI SDK `ToolLoopAgent` | A reusable tool loop, schema-based tools, configurable stop conditions, streaming and provider abstraction. | Strong alternative if provider portability or streaming becomes a priority. Direct `@ai-sdk/google` access needs no Vercel Gateway subscription. It adds an abstraction and package migration without removing the AGUS safety work. |
| LangChain `createAgent` / LangGraph | Model/tool loop, middleware, state graphs, checkpoints, resumable human intervention. | Valuable for long-running resumable workflows. AGUS already has persistence and a separate payment state machine, so adopting graph persistence now would duplicate state and increase integration risk. Reconsider for genuinely durable cross-request tasks. |
| Hand-written text/JSON routing | Precise custom routes and application-specific schemas. | Existing baseline to measure. Useful backend contracts survive, but mandatory classify/reason/review/compose stages can multiply calls and turn ordinary follow-ups into schema failures. Avoid extending phrase recognizers as the main language interface. |

Google documents function calling as model-selected structured tool requests,
including independent parallel calls and compositional calls. Its current guide
also covers the newer Interactions API. The candidate should use one API's
documented transcript contract consistently; copying Interactions examples into a
GenerateContent adapter is incorrect. Preserve complete model content, call IDs,
and thought signatures through each tool exchange. The SDK supports these
provider details; do not reconstruct calls by retaining only names and arguments.
([Google function calling](https://ai.google.dev/gemini-api/docs/function-calling),
[Google JavaScript SDK](https://github.com/googleapis/js-genai))

Vercel's current documentation describes `ToolLoopAgent` with automatic tool
execution followed by another generation, and configurable `stopWhen` limits.
Its default is 20 steps, which is too generous for this campaign; AGUS would need
a much lower explicit limit. Version-specific names matter: the live v7 guide
uses `isStepCount`, while older v6 examples often use `stepCountIs`. Use the API
exported by the pinned dependency. Google's direct provider is available through
`@ai-sdk/google`; a string model identifier can select the Gateway instead, so
explicit provider construction is necessary when reusing the Gemini secret.
([ToolLoopAgent](https://ai-sdk.dev/docs/agents/building-agents),
[Direct Google provider](https://ai-sdk.dev/providers/ai-sdk-providers/google))

LangChain's current entrypoint is `createAgent`. Middleware supports model/tool
limits, failure handling and human intervention. Its tool retry middleware can
return a failed tool result to the model, allowing recovery. AGUS should adopt
that pattern selectively: malformed arguments can be corrected within the turn,
permission denials cannot be converted into access, and non-idempotent mutations
must never be broadly retried. LangGraph interrupts require persistence and can
re-run code preceding the interrupt; this is a concrete reason to keep payment
execution in AGUS's existing transaction/idempotency workflow.
([LangChain agents](https://docs.langchain.com/oss/javascript/langchain/agents),
[Middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in),
[LangGraph interrupts](https://docs.langchain.com/oss/javascript/langgraph/interrupts))

## Package compatibility checked

The repository inspected at PR #36 uses ESM, TypeScript 5.9, Next.js 16.4.1,
React 19 and Zod 4. No agent framework was installed in the baseline. Registry
metadata was fetched with `npm view` on the research date, rather than assuming
versions from older examples:

| Package | Registry version observed | Runtime / peer requirements observed |
| --- | --- | --- |
| `@google/genai` | `2.30.0` | Node `>=20.0.0`; optional MCP SDK peer; no Zod peer requirement |
| `ai` | `7.0.146` | Node `>=22`; Zod `^3.25.76 || ^4.1.8` |
| `@ai-sdk/google` | `4.0.101` | Node `>=22`; Zod `^3.25.76 || ^4.1.8` |
| `langchain` | `1.5.18` | Node `>=20`; peer `@langchain/core ^1.2.18` |
| `@langchain/langgraph` | `1.5.1` | Node `>=18`; peers `@langchain/core ^1.1.48`, Zod `^3.25.32 || ^4.2.0` |

The local runtime is Node 24.19.0. The lockfile and installed package, rather than
the table, determine the implemented candidate's exact dependency version. A
deployment must satisfy the selected package's engine requirement. In particular,
the repository's permissive Zod declaration does not prove compatibility with
every LangGraph version. Verify actual resolution and typecheck. Use the current
Google GenAI SDK, not the legacy `@google/generative-ai` package.

The SDK's `HttpRetryOptions.attempts` includes the original request and defaults
to five attempts. Set it to one for explicitly counted campaign calls, or count
every network attempt in a separate bounded retry policy. Otherwise a nominal
250-call harness can exceed its intended spending bound. This also prevents
automatic quota retries from defeating the stop-on-quota rule.
([SDK retry options](https://googleapis.github.io/js-genai/release_docs/interfaces/types.HttpRetryOptions.html))

## Proposed turn contract

1. The server authenticates the actor and loads only that actor's conversation.
   The request body and model cannot choose a different principal or restore
   expired access.
2. Gemini receives concise product/safety instructions, bounded conversation,
   the current time, and tool schemas. Ordinary conversation can finish in one
   model generation, without a preliminary classifier or mandatory reviewer.
3. A requested tool is looked up in a fixed allowlist. Its schema is validated;
   backend checks derive the actor, selected accounts, scopes and current access.
   Model arguments are a request, never proof of authorization.
4. A validated read or calculation result returns as data, with provenance and a
   typed error when necessary. Untrusted counterparty labels and imported content
   remain data. They cannot change instructions or add tools.
5. Gemini may correct a recoverable argument error, use another tool, ask a
   genuinely necessary question, or produce a final answer. Loop, elapsed-time,
   tool-result-size and model-call limits apply to every path, including recovery.
6. Private financial results must pass current permission/provenance checks at
   release. Existing deterministic factual presentations remain a reliable
   fallback. Natural AI narration must not invent records, outcomes or authority.
7. Persist dialogue for continuity without treating remembered prose as fresh
   account evidence. Financial facts require fresh authorized reads after expiry.

Payment preparation hands off to an editable draft. Beneficiary verification,
password approval, OTP handling, submission, reconciliation and emergency controls
stay in the established backend/UI flow. A chat request such as “I approve” does
not confer authority to the model or a draft tool.

## Mathematics and communication

The model interprets the problem and chooses a method. A generic safe calculator
supports precise numeric work without a catalog of recognized English/Pidgin
phrases. Its evaluator must accept only a bounded arithmetic grammar or structured
operations: never execute JavaScript, SQL, shell commands or arbitrary code from
the model. Decimal money semantics and output rounding must be explicit.

Verification has two separate questions: did the numeric computation evaluate
correctly, and did the model choose the right expression for the user's problem?
A calculator proves the former; scenario evaluation and appropriate clarification
are still needed for the latter. Neither an exact calculator nor another model
review constitutes universal mathematical correctness.

Once a computation is verified, a failed prose-format check should leave a clear
factual answer available. It should not erase the result and demand that the user
restate a complete problem. The numeric result must not be advertised as an actual
balance unless it came from an authorized account tool.

Gemini also authors ordinary responses and adapts tone to the conversation.
Instructions should permit English, Nigerian Pidgin, restrained humor and emojis
without requiring them. Do not force every answer through a banking greeting or
through a template intended for financial records.

## Research implications for reliability

[ReAct](https://arxiv.org/abs/2210.03629) studies interleaving reasoning with actions
and observations. The useful engineering pattern is an iterative feedback loop:
read tool results and change the next action when needed. AGUS need not expose or
log private model reasoning to implement that pattern; observable tool calls,
validated outputs and concise final explanations are sufficient for auditing.

[τ-bench](https://arxiv.org/abs/2406.12045) evaluates multi-turn conversations with
tools and domain policies, checking final database state and repeated-run
consistency. Its results warn against treating one passing transcript as reliable
service behavior. AGUS should compare identical scenarios across direct Gemini,
the preserved baseline and the candidate, then repeat critical scenarios within
the fixed budget. Correct final words alone are insufficient if an unauthorized
tool was attempted or a forbidden state changed.

These papers motivate the evaluation design; they do not establish AGUS's measured
success rate. Record actual model IDs discovered from the authorized provider,
request counts including retries, token usage when returned, tool counts,
clarifications, failures and median/tail latency. Stop on quota/permission/cost
limits. Direct Gemini has no private tools, so record-access tasks must be marked
unavailable for it rather than crediting invented balances.

## What evidence must decide

The native loop is the recommended implementation candidate, not an automatic
winner. Require comparable genuine-model observations before claiming better
reliability or efficiency. Baseline errors should be traced to their contracts and
data flow, not patched by adding the exact failed sentences to prompts or regular
expressions. Retain the baseline if the candidate cannot preserve its safety
properties or demonstrate a practical advantage.

Residual risks include wrong tool selection, semantically wrong calculation
inputs, unnecessary clarification, prompt injection inside tool data, stale
memory, provider failures, and fluent but unsupported narration. Backend authority
checks make forbidden operations fail closed; they do not make all generated
language infallible. Document both tested protections and remaining failures.
