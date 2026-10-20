import {
  InstantSchema,
  PermissionContextSchema,
  ReadFilterSchema,
  ToolCallSchema,
  type PermissionContext,
  type ReadToolDispatcher,
  type Scope,
  type ToolCall,
  type ToolData,
} from "../financial-data/contracts";
import type { AgentReply } from "../financial-agent/agent";
import type { AccessResolver, AccessSnapshot } from "../financial-agent/access";
import {
  SelectionSchema,
  type ConversationContext,
} from "../financial-agent/context";
import { canonical, makeFact, type Fact } from "../financial-agent/facts";
import {
  acceptNarration,
  factualPresentation,
  narrationContract,
} from "../financial-agent/narration";
import { AgentError, bytes, scrub } from "../financial-agent/protocol";

type Options = {
  tools: ReadToolDispatcher;
  access: AccessResolver;
  clock: () => string;
  ctx: PermissionContext;
  accountIds: string[];
  selection: ConversationContext["selection"];
};

/** Native function calls request reads; they never supply authority. Results use
 * the same strict contracts, source checks and factual renderer as PR #36. */
export function createSecureReads(options: Options) {
  const principal = PermissionContextSchema.parse(options.ctx);
  const allowedIds = [...options.accountIds];
  let selection = options.selection
    ? SelectionSchema.parse(options.selection)
    : null;
  const priorCandidates = selection?.candidates ?? [];
  const used = new Map<
    string,
    { ids: string[]; scopes: Scope[]; version: string }
  >();
  const facts = new Map<string, Fact>();
  const successIds = new Set<string>();
  const calls = new Set<string>();
  const details = new Map<string, { revision: number; amountKobo: number }>();
  let toolCalls = 0;
  let resultBytes = 0;
  let attempts = 0;
  let checkedSelection = false;
  let ambiguous = false;
  let failure: string | undefined;
  let lastToolError: string | undefined;
  let snapshot: AccessSnapshot | null = null;
  let pendingRead = Promise.resolve();

  function fail(code: string): never {
    failure = code;
    throw new AgentError(code);
  }
  function ctx(): PermissionContext {
    return { ...principal, now: InstantSchema.parse(options.clock()) };
  }
  async function check(ids: string[], scopes: Scope[]) {
    if (failure) throw new AgentError(failure);
    if (!allowedIds.length) throw new AgentError("ACCOUNT_REQUIRED");
    if (!ids.length || ids.some((id) => !allowedIds.includes(id)))
      fail("PERMISSION_DENIED");
    let result: AccessSnapshot;
    try {
      result = await options.access.check(ctx(), ids, scopes);
    } catch {
      fail("PERMISSION_DENIED");
    }
    if (
      canonical(result.accountIds) !== canonical(ids) ||
      !result.version ||
      result.version.length > 256 ||
      !InstantSchema.safeParse(result.expiresAt).success ||
      Date.parse(result.expiresAt) <= Date.parse(options.clock())
    )
      fail("PERMISSION_DENIED");
    const key = canonical([ids, scopes]);
    if (used.has(key) && used.get(key)!.version !== result.version)
      fail("ACCESS_CHANGED");
    used.set(key, {
      ids: [...ids],
      scopes: [...scopes],
      version: result.version,
    });
    return result;
  }
  async function recheck() {
    if (failure) throw new AgentError(failure);
    for (const value of [...used.values()])
      await check(value.ids, value.scopes);
  }
  async function ensureSelection() {
    if (checkedSelection) return;
    // Check the entire server-selected scope before revealing even its labels.
    snapshot = await check(allowedIds, []);
    checkedSelection = true;
    if (
      selection &&
      (selection.accessVersion !== snapshot.version ||
        Date.parse(selection.expiresAt) <= Date.parse(options.clock()) ||
        selection.accountIds.some((id) => !allowedIds.includes(id)))
    ) {
      selection = null;
      fail("SELECTION_STALE");
    }
  }
  async function runRead(name: string, args: unknown): Promise<unknown> {
    if (failure) throw new AgentError(failure);
    if (++attempts > 8) throw new AgentError("TOOL_BUDGET");
    const parsed = ToolCallSchema.safeParse({
      protocolVersion: 1,
      callId: `native-read-${attempts}`,
      name,
      args,
    });
    if (!parsed.success) throw new AgentError("INVALID_TOOL_ARGUMENT");
    const call: ToolCall = parsed.data;
    await ensureSelection();
    if (toolCalls >= 5) throw new AgentError("TOOL_BUDGET");
    const signature = canonical([call.name, call.args]);
    if (calls.has(signature)) throw new AgentError("REPEATED_CALL");
    if (
      ambiguous &&
      (call.name === "get_transaction" || call.name === "find_payment_evidence")
    )
      throw new AgentError("USER_SELECTION_REQUIRED");
    const ids =
      "accountIds" in call.args ? call.args.accountIds : [call.args.accountId];
    const scopes: Scope[] =
      call.name === "get_account_summary"
        ? ["accounts:read"]
        : call.name === "find_payment_evidence"
          ? ["transactions:read", "evidence:read"]
          : ["transactions:read"];
    await check(ids, scopes);
    if (call.name === "search_transactions" && call.args.cursor !== null)
      throw new AgentError("CURSOR_NOT_EXPOSED");
    if (
      call.name === "get_transaction" &&
      priorCandidates.length &&
      !priorCandidates.some(
        (candidate) =>
          candidate.accountId === call.args.accountId &&
          candidate.transactionId === call.args.transactionId,
      )
    )
      throw new AgentError("SELECTION_INVALID");
    if (call.name === "find_payment_evidence") {
      const key = `${call.args.accountId}:${call.args.transactionId}`;
      if (!details.has(key)) {
        const candidate = priorCandidates.find(
          (c) =>
            c.accountId === call.args.accountId &&
            c.transactionId === call.args.transactionId,
        );
        if (candidate) {
          if (toolCalls + 2 > 5) throw new AgentError("TOOL_BUDGET");
          await runRead("get_transaction", {
            accountId: candidate.accountId,
            transactionId: candidate.transactionId,
          });
        }
        if (!details.has(key)) throw new AgentError("DETAIL_REQUIRED");
      }
    }
    calls.add(signature);
    toolCalls++;
    let raw: unknown;
    try {
      raw = await options.tools.dispatch(ctx(), call);
    } catch {
      await recheck();
      // A transport failure conveys no records. Permit a different safe read.
      lastToolError = "TOOL_UNAVAILABLE";
      return { error: "TOOL_UNAVAILABLE", retryable: false };
    }
    await recheck();
    try {
      resultBytes += bytes(raw);
    } catch {
      fail("INVALID_RESULT");
    }
    if (resultBytes > 49152) fail("TURN_BYTES");
    let parsedResult: ReturnType<typeof makeFact>;
    try {
      parsedResult = makeFact(call, raw);
    } catch {
      fail("INVALID_RESULT");
    }
    const { fact, result } = parsedResult;
    if (facts.has(fact.resultId)) fail("RESULT_REPLAY");
    if (call.name === "get_transaction" && result.data) {
      const data = result.data as ToolData["get_transaction"];
      const prior = priorCandidates.find(
        (c) => c.accountId === data.accountId && c.transactionId === data.id,
      );
      if (prior && prior.revision !== data.revision) fail("SELECTION_STALE");
      details.set(`${data.accountId}:${data.id}`, data);
    }
    facts.set(fact.resultId, fact);
    if (result.error) {
      lastToolError = result.error.code;
    } else {
      successIds.add(fact.resultId);
      if (call.name === "search_transactions" && result.data) {
        const data = result.data as ToolData["search_transactions"];
        ambiguous = data.selection === "ambiguous";
        selection = data.matches.length
          ? {
              resultId: fact.resultId,
              accountIds: [...allowedIds],
              candidates: data.matches.map((t) => ({
                accountId: t.accountId,
                transactionId: t.id,
                untrustedCounterpartyLabel: t.counterparty.displayName
                  ? scrub(t.counterparty.displayName).slice(0, 100)
                  : null,
                revision: t.revision,
                amountKobo: t.amountKobo,
              })),
              filter: ReadFilterSchema.parse(
                Object.fromEntries(
                  Object.entries(call.args).filter(
                    ([key]) => !["query", "limit", "cursor"].includes(key),
                  ),
                ),
              ),
              accessVersion: snapshot!.version,
              expiresAt: new Date(
                Math.min(
                  Date.parse(options.clock()) + 15 * 60000,
                  Date.parse(snapshot!.expiresAt),
                ),
              ).toISOString(),
            }
          : null;
      }
    }
    return { resultId: fact.resultId, ...(fact.modelData as object) };
  }
  function execute(name: string, args: unknown): Promise<unknown> {
    // Native responses may contain parallel calls. Serialize the backend reads
    // so budgets, duplicate detection and source snapshots remain atomic.
    const operation = pendingRead.then(() => runRead(name, args));
    pendingRead = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  async function finish(narration?: unknown): Promise<AgentReply | null> {
    await pendingRead;
    await recheck();
    if (!facts.size)
      return lastToolError
        ? {
            kind: "unavailable",
            text: "The financial data source is unavailable. Please try again shortly.",
            citations: [],
            evidence: {
              modelCalls: 0,
              toolCalls,
              resultBytes,
              code: lastToolError,
            },
          }
        : null;
    const selected = [...facts.values()];
    const successful = selected.filter((fact) => successIds.has(fact.resultId));
    for (const fact of successful) {
      for (const [id, label] of Object.entries(snapshot?.labels ?? {})) {
        fact.presentation.scope = fact.presentation.scope.replace(
          id,
          scrub(label),
        );
        fact.presentation.records = fact.presentation.records.map((record) =>
          record.account === id ? { ...record, account: scrub(label) } : record,
        );
      }
    }
    const presentation = successful.length
      ? factualPresentation(successful)
      : undefined;
    let narrationCode: string | undefined;
    if (presentation && narration !== undefined) {
      try {
        presentation.explanation = acceptNarration(narration, successful);
        presentation.narration = "ai";
      } catch {
        narrationCode = "NARRATION_FALLBACK";
      }
    }
    const canonicalText = selected.map((fact) => fact.text).join("\n\n");
    const reply: AgentReply = {
      kind: successful.length
        ? ambiguous
          ? "clarify"
          : "financial"
        : "unavailable",
      text:
        presentation?.narration === "ai"
          ? `${presentation.explanation.join("\n\n")}\n\n${canonicalText}`
          : canonicalText,
      citations: selected.map((fact) => fact.resultId),
      evidence: {
        modelCalls: 0,
        toolCalls,
        resultBytes,
        ...(lastToolError ? { code: lastToolError } : {}),
        ...(narrationCode ? { narrationCode } : {}),
      },
      ...(presentation ? { presentation } : {}),
    };
    await recheck();
    return reply;
  }
  return {
    execute,
    finish,
    recheck,
    get authoring() {
      const successful = [...facts.values()].filter((fact) =>
        successIds.has(fact.resultId),
      );
      return successful.length ? narrationContract(successful) : null;
    },
    get selection() {
      return selection;
    },
    get toolCalls() {
      return toolCalls;
    },
    get resultBytes() {
      return resultBytes;
    },
  };
}
