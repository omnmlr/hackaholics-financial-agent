// Scripted model protocol tests. These execute real reads, persistence and math;
// they do not establish genuine Gemini interpretation acceptance.
import { expect, it, vi } from "vitest";
import { createModelLedAgent } from "../src/lib/model-led-agent/agent";
import {
  checkedSavings,
  moneyQuantities,
} from "../src/lib/model-led-agent/savings";
import {
  createFixtureDataset,
  createFixtureDataSource,
  fixturePrincipal,
} from "../src/lib/financial-data/fixture";
import { createReadTools } from "../src/lib/financial-data/tools";
import { MemoryFinancialRepository } from "../src/lib/financial-data/repository";
import {
  captureOpenings,
  projectDataset,
} from "../src/lib/financial-integration/simulation";
import { seedState } from "../src/lib/domain";
import {
  MemoryContextStore,
  createRepositoryAccess,
} from "../src/lib/financial-agent";
import type { ToolModel } from "../src/lib/model-led-agent/model";

const now = "2026-10-21T10:00:00.000Z";
const params = {
  target: 1000000,
  contribution: 10000,
  startingAmount: 0,
  cadence: "weeks",
};
function setup() {
  const data = createFixtureDataset(),
    state = seedState();
  captureOpenings(state, data);
  const repository = new MemoryFinancialRepository(projectDataset(data, state));
  const clock = () => now;
  const tools = createReadTools({
    repository,
    sources: [createFixtureDataSource({ repository, clock })],
    clock,
  });
  const store = new MemoryContextStore();
  let next: { name: string; args: unknown };
  const generate = vi.fn(async () => ({
    text: "",
    calls: [next],
    content: { role: "model", parts: [{ functionCall: next }] },
  }));
  const model = {
    provider: "scripted-only",
    model: "scripted-only",
    generate,
  } as ToolModel;
  const agent = createModelLedAgent({
    tools,
    access: createRepositoryAccess(repository, clock),
    clock,
    store,
    model,
  });
  const key = {
    tenantId: fixturePrincipal.tenantId,
    actorId: fixturePrincipal.actorId,
    conversationId: "savings-continuity",
  };
  return {
    repository,
    store,
    key,
    generate,
    async turn(
      text: string,
      args: unknown = params,
      ids = ["amina-current"],
      name = "plan_savings",
    ) {
      next = { name, args };
      return agent.turn({
        ctx: { ...fixturePrincipal, now },
        conversationId: key.conversationId,
        text,
        accountIds: ids,
      });
    },
  };
}

it.each([
  [
    "Nicee soo if I saved 5h every day how long until I become a millionaire?",
    500,
    "days",
    2000,
    "5 years and 6 months",
  ],
  ["If I save 1k daily to 1m", 1000, "days", 1000, "2 years and 9 months"],
  [
    "If I save 10k weekly to 1 million",
    10000,
    "weeks",
    100,
    "1 year and 11 months",
  ],
  [
    "I dey save five hundred every day till I get one million",
    500,
    "days",
    2000,
    "5 years and 6 months",
  ],
] as const)(
  "checks Nigerian quantities before arithmetic: %s",
  async (text, contribution, cadence, periods, duration) => {
    const s = setup();
    const reply = await s.turn(text, { ...params, contribution, cadence });
    expect(reply.savings).toMatchObject({ contribution, periods, cadence });
    expect(reply.text).toContain(duration);
    expect(s.generate).toHaveBeenCalledTimes(1);
  },
);

it("continues zero → specified start → fictional available balance → contribution correction → current balance", async () => {
  const s = setup();
  const first = await s.turn(
    "If I save ₦10,000 every week how long until I have ₦1 million?",
  );
  expect(first.savings?.periods).toBe(100);
  const specified = await s.turn("Start from ₦200,000", {
    ...params,
    startingAmount: 200000,
  });
  expect(specified.savings?.periods).toBe(80);
  const available = await s.turn(
    "Okay but what if my current balance is my starting point?",
    { ...params, startingBalance: "available" },
  );
  expect(available.savings).toMatchObject({
    periods: 88,
    startingAmount: 123456.78,
    source: { field: "available", simulated: true },
  });
  expect(available.citations.length).toBe(1);
  const correction = await s.turn("Okay make it ₦20k weekly instead", {
    ...params,
    contribution: 20000,
  });
  expect(correction.savings).toMatchObject({
    periods: 44,
    startingAmount: 123456.78,
  });
  const current = await s.turn("Switch to current balance instead", {
    ...params,
    contribution: 20000,
    startingBalance: "current",
  });
  expect(current.savings).toMatchObject({
    startingAmount: 124456.78,
    source: { field: "current" },
  });
  const stored = await s.store.load(s.key);
  expect(stored?.savings?.starting).toEqual({
    kind: "balance",
    accountId: "amina-current",
    field: "current",
  });
  expect(stored?.savings).not.toHaveProperty("startingAmount");
});

it("rereads a source on corrections, asks for unknown balances, and never replaces unknown with zero", async () => {
  const s = setup();
  await s.turn("Save 10k weekly to 1m");
  await s.turn("Use my fictional balance", {
    ...params,
    startingBalance: "available",
  });
  const get = vi.spyOn(s.repository, "getAccountSummary");
  get.mockResolvedValue({
    accountId: "amina-current",
    currency: "NGN",
    availableKobo: null,
    currentKobo: null,
    asOf: "2026-10-17T10:00:00.000Z",
    simulated: true,
    unavailableReason: "stale",
  });
  const reply = await s.turn("Make it 20k weekly instead", {
    ...params,
    contribution: 20000,
  });
  expect(get).toHaveBeenCalled();
  expect(reply.kind).toBe("clarify");
  expect(reply.savings).toBeUndefined();
  expect(reply.text).toContain("starting amount");
});

it("requires a selected account and rejects foreign selection without a model authority grant", async () => {
  const s = setup();
  await s.turn("Save 10k weekly to 1m");
  const none = await s.turn("Use my fictional balance", params, []);
  expect(none.accountAction).toBe("choose_demo_account");
  const multiple = await s.turn("Use my fictional balance", params, [
    "amina-current",
    "amina-savings",
  ]);
  expect(multiple.kind).toBe("clarify");
  expect(multiple.savings).toBeUndefined();
  const foreign = await s.turn("Use my fictional balance", params, [
    "tunde-current",
  ]);
  expect(foreign.savings).toBeUndefined();
  expect(foreign.kind).toBe("unavailable");
});

it("rejects valid arithmetic based on a wrong model amount or cadence before execution", async () => {
  const s = setup();
  const wrong = await s.turn("Save 5h every day until I become a millionaire", {
    ...params,
    contribution: 500000,
    cadence: "days",
  });
  expect(wrong.savings).toBeUndefined();
  expect(wrong.text).not.toContain("2 days");
  expect(wrong.kind).toBe("clarify");
  const wrongCadence = await s.turn("Save 10k weekly to 1m", {
    ...params,
    cadence: "days",
  });
  expect(wrongCadence.kind).toBe("clarify");
  const bypass = await s.turn(
    "Save 5h every day until I become a millionaire",
    {
      expression: "1000000/500000",
      description: "Savings duration",
      unit: "days",
      assumptions: [],
    },
    [],
    "calculate",
  );
  expect(bypass.evidence.code).toBe("CALCULATION_QUANTITY_MISMATCH");
  expect(bypass.text).not.toContain("2 days");
});

it("asks about ambiguous time units rather than interpreting them as money", async () => {
  const s = setup();
  const reply = await s.turn(
    "I save 5 hours every day until I become a millionaire",
    { ...params, contribution: 500, cadence: "days" },
  );
  expect(reply.kind).toBe("clarify");
  expect(reply.savings).toBeUndefined();
});

it("parses scales and words as quantities, without replacing nonmonetary text", () => {
  expect(
    moneyQuantities("5h 1k 2.5k 10k 1m 100 naira 5 hundred five hundred").map(
      (v) => v.amount,
    ),
  ).toEqual([500, 1000, 2500, 10000, 1000000, 100, 500, 500]);
  expect(
    checkedSavings(params, "save 10k weekly to 1m", undefined, []),
  ).toHaveProperty("memory");
});
