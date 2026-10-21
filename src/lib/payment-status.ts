import { z } from "zod";
import { readState } from "./db";
import {
  AppError,
  money,
  type Batch,
  type Payment,
  type State,
} from "./domain";
import type { AgentReply } from "./financial-agent/agent";
import { PaymentPresentationSchema } from "./financial-agent/presentation";
import { describePaymentStatus } from "./conversation-policy";
import type { Bank } from "./paystack";

export const PaymentStatusArgs = z.strictObject({
  scope: z.enum(["conversation", "latest", "today"]),
  paymentIndex: z.number().int().min(1).max(10).optional(),
  receipt: z.boolean().optional(),
});
const day = (value: string) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
export function paymentStatusReply(
  state: State,
  owner: string,
  chatId: string,
  raw: unknown,
  banks: Bank[],
  now = new Date().toISOString(),
): AgentReply {
  const args = PaymentStatusArgs.parse(raw);
  const linked = new Set(
    state.messages
      .filter((m) => m.owner === owner && m.conversationId === chatId)
      .map((m) => m.batchId),
  );
  const batches = state.batches
    .filter((b) => b.owner === owner)
    .filter((b) =>
      args.scope === "conversation"
        ? linked.has(b.id)
        : args.scope === "today"
          ? day(b.approval?.consumedAt ?? b.createdAt) === day(now)
          : true,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, args.scope === "latest" ? 1 : 10);
  const selected = args.paymentIndex
    ? batches
        .slice(0, 1)
        .flatMap((b) =>
          b.payments[args.paymentIndex! - 1]
            ? [{ b, p: b.payments[args.paymentIndex! - 1] }]
            : [],
        )
    : batches.flatMap((b) => b.payments.map((p) => ({ b, p })));
  const records = selected.map(({ b, p }) => ({
    batchId: b.id,
    paymentId: p.id,
    reference: p.reference,
    label: p.name,
    verifiedName: p.verifiedName ?? null,
    institution:
      banks.find((x) => x.code === p.bankCode)?.name ??
      "Institution unavailable",
    amountKobo: p.amountKobo,
    feeKobo: p.providerFeeKobo ?? null,
    status: p.status,
    mode: b.mode,
    recordedAt: p.responses.at(-1)?.at ?? b.updatedAt,
    canConfirm:
      b.mode === "fixture" &&
      p.status === "successful" &&
      !!b.approval?.consumedAt,
  }));
  const totalSuccessfulKobo = records
    .filter((p) => p.status === "successful")
    .reduce((sum, p) => sum + p.amountKobo, 0);
  const presentation = PaymentPresentationSchema.parse({
    asOf: now,
    scope:
      args.scope === "today"
        ? "Payments recorded today (Lagos time)"
        : args.scope === "latest"
          ? "Your latest saved payment batch"
          : "Payments linked to this conversation",
    records,
    totalSuccessfulKobo,
  });
  const text = records.length
    ? [
        args.scope === "today"
          ? `Successful recorded payment amounts total ${money(totalSuccessfulKobo)} today, excluding fees and unresolved/failed/reversed records.`
          : "Here is the current recorded payment status:",
        ...records.map(
          (p) =>
            `${p.verifiedName ?? p.label} · ${money(p.amountKobo)} · ${describePaymentStatus(p.status, p.mode)}.${p.feeKobo === null ? " Confirmed fee unavailable." : ` Confirmed fee ${money(p.feeKobo)}.`}`,
        ),
        records.some((p) =>
          ["processing", "submitted", "unknown", "awaiting_otp"].includes(
            p.status,
          ),
        )
          ? "Some outcomes remain unresolved. Use Check provider on the payment card; do not submit the same instructions again."
          : "",
        args.receipt
          ? records.some((p) => p.canConfirm)
            ? "A clearly labelled simulated confirmation is available below for each successful fictional record."
            : "A successful simulated confirmation is not available for these recorded outcomes."
          : "",
        records.some((p) => p.mode === "fixture")
          ? "These are fictional simulations. No real money moved. Source status does not prove recipient bank credit."
          : "Provider-reported status does not establish recipient bank credit.",
      ]
        .filter(Boolean)
        .join("\n\n")
    : "No matching payment records are available in this scope. A draft may still need to be saved; nothing has been inferred as sent.";
  return {
    kind: records.length ? "financial" : "clarify",
    text,
    citations: [],
    payments: presentation,
    evidence: {
      modelCalls: 0,
      toolCalls: 1,
      resultBytes: Buffer.byteLength(JSON.stringify(presentation)),
    },
  };
}
export async function currentPaymentStatus(
  owner: string,
  chatId: string,
  args: unknown,
  banks: Bank[],
) {
  return paymentStatusReply(await readState(), owner, chatId, args, banks);
}

/** Deliberately plain AGUS text, never bank-branded or proof of real credit. */
export function simulatedConfirmation(
  batch: Batch,
  payment: Payment,
  banks: Bank[],
) {
  if (
    batch.mode !== "fixture" ||
    payment.status !== "successful" ||
    !batch.approval?.consumedAt ||
    !batch.payments.some((p) => p.id === payment.id)
  )
    throw new AppError(
      "A simulated confirmation is available only for a completed fictional payment",
      409,
    );
  return [
    "AGUS — SIMULATED PAYMENT CONFIRMATION",
    "DEMO ONLY — NO REAL FUNDS MOVED",
    "This is not a bank receipt or evidence of recipient-bank credit.",
    "",
    `Recorded status: ${describePaymentStatus(payment.status, batch.mode)}`,
    `Recipient label: ${JSON.stringify(payment.name)}`,
    `Verified fictional name: ${JSON.stringify(payment.verifiedName ?? "Unavailable")}`,
    `Fictional institution: ${JSON.stringify(banks.find((b) => b.code === payment.bankCode)?.name ?? "Unavailable")}`,
    `Amount: ${money(payment.amountKobo)}`,
    `Confirmed fee: ${payment.providerFeeKobo === undefined ? "Unavailable" : money(payment.providerFeeKobo)}`,
    `Recorded at: ${payment.responses.at(-1)?.at ?? batch.updatedAt}`,
    `Simulation reference: ${payment.reference}`,
    "",
    "Status reflects the recorded simulation at the timestamp above. Check AGUS for later reversals or updates.",
    "SIMULATED — NOT VALID AS PROOF OF REAL PAYMENT",
  ].join("\n");
}
