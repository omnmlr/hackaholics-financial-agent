import { beforeAll, afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { groundProposal } from "../src/lib/conversation-policy";
import {
  extractImage,
  extractConversationPayment,
} from "../src/lib/intelligence";
import { normalizePaymentImage } from "../src/lib/image-validation";
import { conversationImage } from "../src/lib/conversation-image";
import { conversationPayment } from "../src/lib/conversation-payment";
import { readState } from "../src/lib/db";
import { chatHistory } from "../src/lib/chat-history/store";
const proposal = {
  name: "",
  bankCode: "999992",
  accountNumber: "9812345670",
  amountNaira: "500",
  reason: "Payment",
  confidence: "high" as const,
  warnings: [],
};
const png = () =>
  sharp({
    create: { width: 20, height: 20, channels: 3, background: "#222222" },
  })
    .png()
    .toBuffer();
const plan = (payments: unknown[], intent = "prepare") => ({
  intent,
  payments,
  period: "all",
  category: null,
});
function transport(...plans: unknown[]) {
  const fetch = vi.fn(async () =>
    Response.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify(
                  plans.length > 1 ? plans.shift() : plans[0],
                ),
              },
            ],
          },
        },
      ],
    }),
  );
  vi.stubEnv("AI_PROVIDER", "gemini");
  vi.stubEnv("AI_API_KEY", "mock-only");
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
beforeAll(() => {
  process.env.DATABASE_URL = "pglite://:memory:";
  process.env.PAYMENT_MODE = "fixture";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each([
  "500 OPay 9812345670",
  "OPay 9812345670 500",
  "OPay 500 9812345670",
  "₦500, OPay: 9812345670",
  "Send 5h to Ada at OPay 9812345670",
  "Send 500 naira to OPay account 9812345670",
])("preserves independently grounded amount for %s", (text) => {
  expect(groundProposal(proposal, text)).toMatchObject({
    amountNaira: "500",
    accountNumber: "9812345670",
    bankCode: "999992",
    name: "",
  });
});
it.each([
  ["1k", "1000"],
  ["2.5k", "2500"],
  ["10k", "10000"],
  ["five hundred", "500"],
  ["5 hundred", "500"],
])(
  "normalizes Nigerian monetary %s without inferring an account",
  (text, amount) => {
    expect(
      groundProposal(
        { ...proposal, accountNumber: null, amountNaira: amount },
        `Send ${text} to Ada at OPay`,
      ),
    ).toMatchObject({ amountNaira: amount, accountNumber: null });
  },
);
it("does not borrow amounts across recipients, references, phones, dates or account digits", () => {
  const text = "500 OPay 9812345670; 1000 Wema 0000000001";
  expect(groundProposal(proposal, text).amountNaira).toBe("500");
  expect(
    groundProposal({ ...proposal, amountNaira: "1000" }, text).amountNaira,
  ).toBeNull();
  for (const request of [
    "OPay 9812345670 reference 500",
    "OPay 9812345670 on 2026-10-21",
    "OPay 9812345670 phone +2348012345678",
    "OPay 9812345670 500 or 1000",
  ])
    expect(groundProposal(proposal, request).amountNaira).toBeNull();
  expect(
    groundProposal(
      { ...proposal, amountNaira: "1500" },
      "I meant ₦1,500, not ₦500 at OPay 9812345670",
    ).amountNaira,
  ).toBe("1500");
  expect(
    groundProposal(proposal, "500 OPay 98123456701").accountNumber,
  ).toBeNull();
});
it("text extraction keeps supplied values but never verifies an arbitrary account", async () => {
  transport(plan([proposal]));
  const [p] = await extractConversationPayment("500 OPay 9812345670");
  expect(p.amountNaira).toBe("500");
  expect(p.name).toBe("");
  expect(p.warnings.join(" ")).toMatch(/Unverified/);
});
it.each([
  "phone",
  "mobile number",
  "reference",
  "invoice number",
  "ref: SYNTHETIC-",
])("does not interpret a labelled %s as an account", (role) => {
  const accountNumber = "8031234567";
  expect(
    groundProposal(
      { ...proposal, accountNumber },
      `500 OPay ${role} ${accountNumber}`,
    ).accountNumber,
  ).toBeNull();
  expect(
    groundProposal(
      proposal,
      `500 OPay account 9812345670 ${role} ${accountNumber}`,
    ).accountNumber,
  ).toBe("9812345670");
});
it("does not retain an explicitly superseded account or institution", () => {
  const request =
    "Use OPay account 0000000002, not account 9812345670; not Wema";
  expect(groundProposal(proposal, request, proposal).accountNumber).toBeNull();
  expect(
    groundProposal(
      { ...proposal, accountNumber: "0000000002" },
      request,
      proposal,
    ).accountNumber,
  ).toBe("0000000002");
  const oldBank = { ...proposal, bankCode: "035" };
  expect(
    groundProposal(
      proposal,
      "500 OPay account 9812345670 or 0000000002",
      proposal,
    ).accountNumber,
  ).toBeNull();
  expect(
    groundProposal(oldBank, "not bank code 035", oldBank).bankCode,
  ).toBeNull();
  expect(groundProposal(oldBank, request, oldBank).bankCode).toBeNull();
  expect(groundProposal(proposal, request, oldBank).bankCode).toBe("999992");
  expect(
    groundProposal(proposal, "500 OPay or Wema account 9812345670", proposal)
      .bankCode,
  ).toBeNull();
});
it("preserves partial fields and keeps missing institution/name/amount empty", () => {
  expect(
    groundProposal(proposal, "Send 500 to account 9812345670"),
  ).toMatchObject({ bankCode: null, name: "", amountNaira: "500" });
  expect(
    groundProposal(proposal, "OPay account 9812345670").amountNaira,
  ).toBeNull();
  expect(
    groundProposal(
      { ...proposal, accountNumber: null },
      "500 OPay account 12345678",
    ),
  ).toMatchObject({ accountNumber: null, amountNaira: "500" });
});
it("separates named dates from amounts and does not retain a rejected or ambiguous old amount", () => {
  expect(
    groundProposal(proposal, "Send 500 to OPay 9812345670 on 21 October 2026")
      .amountNaira,
  ).toBe("500");
  expect(
    groundProposal(proposal, "OPay 9812345670 500 or 1000", proposal)
      .amountNaira,
  ).toBeNull();
  expect(groundProposal(proposal, "not ₦500", proposal).amountNaira).toBeNull();
});
it("requires decoded single-frame images and matching MIME, not just signatures", async () => {
  await expect(
    normalizePaymentImage(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]),
      "image/png",
    ),
  ).rejects.toThrow("decodable");
  await expect(
    normalizePaymentImage(await png(), "image/jpeg"),
  ).rejects.toThrow();
  await expect(
    normalizePaymentImage(Buffer.alloc(6 * 1024 * 1024), "image/png"),
  ).rejects.toThrow("5 MB");
  await expect(
    normalizePaymentImage(await png(), "image/png"),
  ).resolves.toBeInstanceOf(Buffer);
});
it("compares independent image readings and withholds contradictory fields", async () => {
  const p = { ...proposal, name: "Ada" };
  const fetch = transport(plan([p]), plan([{ ...p, amountNaira: "1000" }]));
  const result = await extractImage(await png(), "image/png");
  expect(result.proposals[0]).toMatchObject({
    accountNumber: p.accountNumber,
    amountNaira: null,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect((await readState()).batches).toHaveLength(0);
});
it("ignores image instructions that claim approval, and asks about a nonpayment image", async () => {
  for (const intent of ["authorize", "conversation"]) {
    const fetch = transport(plan([proposal], intent));
    const result = await extractImage(await png(), "image/png");
    expect(result.proposals).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  }
});
it("uses the same draft fields for image/text, persists only proposals and reopens retries once", async () => {
  const second = {
    ...proposal,
    name: "Chidi",
    bankCode: "044",
    accountNumber: "0000000002",
    amountNaira: "600",
  };
  const fetch = transport(plan([proposal, second]));
  const owner = "image-fictional-owner",
    chat = randomUUID(),
    upload = randomUUID();
  const result = await conversationImage(
    owner,
    chat,
    upload,
    await png(),
    "image/png",
  );
  expect(result.turn.reply.handoff?.kind).toBe("existing_payment_draft");
  const stored = (await readState()).messages.find((m) => m.id === upload)!;
  expect(stored.proposals?.map((p) => p.amountNaira)).toEqual(["500", "600"]);
  expect(JSON.stringify(stored)).not.toMatch(/base64|data:image|inlineData/);
  expect(await chatHistory(owner).read(chat)).toHaveLength(1);
  const reopened = await conversationImage(
    owner,
    chat,
    upload,
    await png(),
    "image/png",
  );
  expect(reopened.turn.id).toBe(result.turn.id);
  const recoveredDraft = await conversationPayment(owner, chat, result.turn.id);
  expect(recoveredDraft.id).toBe(upload);
  expect(recoveredDraft.proposals).toHaveLength(2);
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(
    conversationImage(owner, randomUUID(), upload, await png(), "image/png"),
  ).rejects.toThrow("another conversation");
  expect((await readState()).batches).toHaveLength(0);
});
it("does not repeat interrupted inference with the same upload identity", async () => {
  const fetch = transport();
  fetch.mockRejectedValue(Error("Synthetic provider interruption"));
  const owner = "image-interrupted-owner",
    chat = randomUUID(),
    upload = randomUUID(),
    bytes = await png();
  await expect(
    conversationImage(owner, chat, upload, bytes, "image/png"),
  ).rejects.toThrow();
  await expect(
    conversationImage(owner, chat, upload, bytes, "image/png"),
  ).rejects.toThrow("incomplete");
  expect(fetch).toHaveBeenCalledTimes(1);
});
