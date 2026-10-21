import { expect, it } from "vitest";
import { randomUUID, scryptSync } from "node:crypto";
import { mutate } from "../src/lib/db";
import { login } from "../src/lib/auth";
import { GET } from "../src/app/api/[...path]/route";
import {
  paymentStatusReply,
  simulatedConfirmation,
} from "../src/lib/payment-status";
import { seedState, type Batch, type Status } from "../src/lib/domain";
import { createModelLedAgent } from "../src/lib/model-led-agent/agent";
import {
  MemoryContextStore,
  createRepositoryAccess,
} from "../src/lib/financial-agent";
import {
  createFixtureRepository,
  createFixtureDataSource,
  fixturePrincipal,
  createReadTools,
} from "../src/lib/financial-data";
import type { ToolModel } from "../src/lib/model-led-agent/model";
import { currentPaymentReply } from "../src/components/payment-outcome";
const now = "2026-10-21T12:00:00.000Z",
  owner = "fictional-status-owner",
  chat = "status-chat";
const banks = [{ name: "Wema (fictional demo)", code: "035" }];
function setup(statuses: Status[] = ["successful"]) {
  const s = seedState();
  const b: Batch = {
    id: randomUUID(),
    owner,
    mode: "fixture",
    createdAt: now,
    updatedAt: now,
    version: 1,
    feeReserveKobo: 5000,
    status: statuses[0],
    approval: {
      actor: owner,
      at: now,
      expiresAt: "2026-10-21T12:10:00.000Z",
      consumedAt: now,
      digest: "fictional",
      nonce: randomUUID(),
    },
    payments: statuses.map((status, i) => ({
      id: randomUUID(),
      reference: `SYNTHETIC-${randomUUID()}`,
      name: `Label ${i + 1}`,
      verifiedName: `FICTIONAL NAME ${i + 1}`,
      bankCode: "035",
      accountNumber: "0000000001",
      amountKobo: (i + 1) * 100000,
      providerFeeKobo: status === "successful" ? 1000 : undefined,
      reason: "Demo",
      status,
      responses: [{ at: now, operation: "verify", data: {} }],
    })),
  };
  s.batches.push(b, {
    ...b,
    id: randomUUID(),
    owner: "another-owner",
    payments: b.payments.map((p) => ({
      ...p,
      reference: "PRIVATE-FOREIGN-REFERENCE",
    })),
  });
  s.messages.push({
    id: randomUUID(),
    owner,
    conversationId: chat,
    role: "assistant",
    at: now,
    content: "Draft",
    batchId: b.id,
  });
  return { s, b };
}
it.each([
  "successful",
  "failed",
  "reversed",
  "processing",
  "submitted",
  "unknown",
  "awaiting_otp",
  "approved",
] as Status[])(
  "reports only recorded %s and never asserts real recipient credit",
  (status) => {
    const { s } = setup([status]);
    const reply = paymentStatusReply(
      s,
      owner,
      chat,
      { scope: "conversation", receipt: true },
      banks,
      now,
    );
    expect(reply.payments?.records).toHaveLength(1);
    expect(reply.payments?.records[0].status).toBe(status);
    expect(reply.payments?.records[0].canConfirm).toBe(status === "successful");
    expect(reply.text).toContain("No real money moved");
    expect(reply.text).not.toContain("PRIVATE-FOREIGN");
    expect(reply.text).not.toMatch(/recipient (?:was|has been) credited/i);
    if (["processing", "unknown", "submitted"].includes(status))
      expect(reply.text).toContain("do not submit");
  },
);
it("keeps mixed outcomes distinct and supports an explicitly selected batch recipient", () => {
  const { s } = setup(["successful", "failed", "processing", "reversed"]);
  const all = paymentStatusReply(
    s,
    owner,
    chat,
    { scope: "today" },
    banks,
    now,
  );
  expect(all.payments?.totalSuccessfulKobo).toBe(100000);
  expect(all.payments?.records.map((p) => p.status)).toEqual([
    "successful",
    "failed",
    "processing",
    "reversed",
  ]);
  const selected = paymentStatusReply(
    s,
    owner,
    chat,
    { scope: "conversation", paymentIndex: 2 },
    banks,
    now,
  );
  expect(selected.payments?.records).toHaveLength(1);
  expect(selected.payments?.records[0].status).toBe("failed");
  expect(
    paymentStatusReply(
      s,
      owner,
      "different-chat",
      { scope: "conversation" },
      banks,
      now,
    ).payments?.records,
  ).toEqual([]);
});
it("does not infer an unknown fee or an amount for an unsaved draft", () => {
  const { s } = setup(["unknown"]);
  const reply = paymentStatusReply(
    s,
    owner,
    chat,
    { scope: "latest" },
    banks,
    now,
  );
  expect(reply.text).toContain("Confirmed fee unavailable");
  expect(
    paymentStatusReply(
      s,
      "missing-owner",
      chat,
      { scope: "latest" },
      banks,
      now,
    ).kind,
  ).toBe("clarify");
});
it("generates a plainly fictional successful confirmation and rejects every non-success/live state", () => {
  const { b } = setup();
  const text = simulatedConfirmation(b, b.payments[0], banks);
  expect(text).toContain("DEMO ONLY — NO REAL FUNDS MOVED");
  expect(text).toContain("NOT VALID AS PROOF OF REAL PAYMENT");
  expect(text).toContain(b.payments[0].reference);
  for (const status of [
    "processing",
    "unknown",
    "failed",
    "reversed",
    "approved",
  ] as Status[]) {
    const copy = { ...b, payments: b.payments.map((p) => ({ ...p, status })) };
    expect(() =>
      simulatedConfirmation(copy, copy.payments[0], banks),
    ).toThrow();
  }
  expect(() =>
    simulatedConfirmation({ ...b, mode: "live" }, b.payments[0], banks),
  ).toThrow();
});
it("rereads a reversal instead of retaining a previous success or downloadable success claim", () => {
  const { s, b } = setup();
  expect(
    paymentStatusReply(s, owner, chat, { scope: "conversation" }, banks, now)
      .payments?.records[0].canConfirm,
  ).toBe(true);
  b.payments[0].status = "reversed";
  const after = paymentStatusReply(
    s,
    owner,
    chat,
    { scope: "conversation" },
    banks,
    now,
  );
  expect(after.payments?.records[0]).toMatchObject({
    status: "reversed",
    canConfirm: false,
  });
  expect(() => simulatedConfirmation(b, b.payments[0], banks)).toThrow();
});
it("updates displayed and spoken draft wording from current state instead of claiming nothing was sent", () => {
  const { b } = setup();
  const initial = {
    kind: "handoff" as const,
    text: "Nothing has been sent",
    citations: [],
    evidence: { modelCalls: 0, toolCalls: 0, resultBytes: 0 },
  };
  expect(currentPaymentReply(initial, b).text).toMatch(/Successful/);
  expect(currentPaymentReply(initial, b).text).not.toContain(
    "Nothing has been sent",
  );
  b.payments[0].status = "reversed";
  expect(currentPaymentReply(initial, b).text).toContain("Reversed");
  expect(currentPaymentReply(initial, b).text).not.toContain("Successful");
});
it("authenticates downloads, isolates owners and rechecks status after a reversal", async () => {
  process.env.DATABASE_URL = "pglite://:memory:";
  process.env.PAYMENT_MODE = "fixture";
  process.env.OPERATOR_ID = owner;
  const password = "synthetic-status-operator-password",
    salt = "synthetic-status-salt";
  process.env.OPERATOR_PASSWORD_HASH = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const { s, b } = setup();
  await mutate((state) => Object.assign(state, s));
  const token = await login(password),
    url = `http://localhost:3000/api/batches/${b.id}/confirmation?payment=${b.payments[0].id}`;
  const request = (target = url, session = token) =>
    new Request(target, { headers: { cookie: `ha_session=${session}` } });
  expect((await GET(request(url, ""))).status).toBe(401);
  const download = await GET(request());
  expect(download.status).toBe(200);
  expect(download.headers.get("cache-control")).toContain("no-store");
  expect(await download.text()).toContain("DEMO ONLY");
  const foreign = s.batches[1];
  expect(
    (
      await GET(
        request(
          `http://localhost:3000/api/batches/${foreign.id}/confirmation?payment=${foreign.payments[0].id}`,
        ),
      )
    ).status,
  ).toBe(404);
  await mutate((state) => {
    state.batches.find((x) => x.id === b.id)!.payments[0].status = "reversed";
  });
  expect((await GET(request())).status).toBe(409);
});
it.each([
  "Did it send?",
  "Who did I just pay?",
  "Show me the last transfer.",
  "Was the recipient credited?",
  "How much was charged?",
  "Show me the receipt.",
  "What happened to the second person?",
])("native status enquiry uses a backend-authorized read: %s", async (text) => {
  const { s } = setup(["successful", "unknown"]),
    repository = createFixtureRepository(),
    clock = () => now;
  const model: ToolModel = {
    provider: "scripted-only",
    model: "scripted-only",
    generate: async () => ({
      text: "",
      calls: [
        {
          name: "get_payment_status",
          args: {
            scope: "conversation",
            ...(text.includes("second") ? { paymentIndex: 2 } : {}),
            receipt: text.includes("receipt"),
          },
        },
      ],
      content: { role: "model", parts: [] },
    }),
  };
  const agent = createModelLedAgent({
    model,
    store: new MemoryContextStore(),
    clock,
    access: createRepositoryAccess(repository, clock),
    tools: createReadTools({
      repository,
      sources: [createFixtureDataSource({ repository, clock })],
      clock,
    }),
    paymentStatus: async (args) =>
      paymentStatusReply(s, owner, chat, args, banks, now),
  });
  const reply = await agent.turn({
    ctx: { ...fixturePrincipal, now },
    conversationId: randomUUID(),
    text,
    accountIds: [],
  });
  expect(reply.kind).toBe("financial");
  expect(reply.payments?.records.length).toBe(text.includes("second") ? 1 : 2);
  expect(reply.evidence.modelCalls).toBe(1);
});
