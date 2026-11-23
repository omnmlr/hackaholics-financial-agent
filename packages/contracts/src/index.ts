import { z } from "zod";
export const AtomicMoney = z.strictObject({
  atoms: z.string().regex(/^(0|[1-9][0-9]{0,77})$/),
  currency: z.string().regex(/^[A-Z]{3,12}$/),
  scale: z.number().int().min(0).max(18),
});
export type AtomicMoney = z.infer<typeof AtomicMoney>;
export function decimalToAtomic(value: string, scale: number) {
  if (
    !Number.isInteger(scale) ||
    scale < 0 ||
    scale > 18 ||
    !/^\d+(\.\d+)?$/.test(value)
  )
    throw new Error("INVALID_DECIMAL_AMOUNT");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) throw new Error("EXCESS_DECIMAL_PRECISION");
  return BigInt(whole + fraction.padEnd(scale, "0")).toString();
}
export const Provenance = z.strictObject({
  provider: z.string(),
  environment: z.enum(["fixture", "sandbox", "devnet", "live"]),
  simulated: z.boolean(),
  observedAt: z.iso.datetime(),
  verification: z.enum([
    "simulated",
    "provider_observed",
    "chain_finalized",
    "unverified",
  ]),
});
export const FixtureScenario = z.enum([
  "normal",
  "delayed",
  "timeout_before_send",
  "timeout_after_send",
  "outage",
  "failure",
  "reversal",
]);
export type FixtureScenario = z.infer<typeof FixtureScenario>;
export const PreparePayment = z.strictObject({
  sourceAccountId: z.uuid(),
  beneficiaryId: z.uuid(),
  amount: AtomicMoney,
  testScenario: FixtureScenario.optional(),
});
export type PreparePayment = z.infer<typeof PreparePayment>;
export const RevisionAction = z.strictObject({
  revision: z.number().int().nonnegative(),
});
export const ApprovalAction = RevisionAction.extend({ challengeId: z.uuid() });
export const ConnectAccount = z.strictObject({
  institutionId: z.string().regex(/^[a-z-]{2,40}$/),
  provider: z.literal("fixture").default("fixture"),
  testDataScenario:z.enum(["normal","data_delayed","partial_history","grant_expired","rate_limited","outage","revocation_outage"]).optional(),
});
export const CompleteConnection = z.strictObject({
  connectionId: z.uuid(),
  state: z.string().min(32).max(128),
  code: z.string().min(1).max(4096),
});
export const VerifyBeneficiary = z.strictObject({
  bankCode: z.string().regex(/^\d{3,6}$/),
  accountNumber: z.string().regex(/^\d{10}$/),
});
export type ApiError = {
  error: { code: string; retryable: boolean; correlationId: string };
};
export const DevnetDraft = z.object({
  id: z.uuid(),
  revision: z.number().int().nonnegative(),
  network: z.literal("devnet"),
  state: z.enum([
    "prepared",
    "approved",
    "submitting",
    "submitted",
    "unknown",
    "confirmed",
    "finalized",
    "failed",
    "expired",
    "cancelled",
  ]),
  sender: z.string(),
  recipient: z.string(),
  asset: z.enum(["SOL", "SPL"]),
  mint: z.string().nullable(),
  decimals: z.number().int().min(0).max(18),
  amount: AtomicMoney,
  displayAmount: z.string(),
  amountAtoms: z.string().regex(/^[1-9][0-9]*$/),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  unsignedTransactionBase64: z.string(),
  messageBase64: z.string(),
  expiresAt: z.iso.datetime(),
  feeLamports: z.string(),
  estimatedRentLamports: z.string(),
  simulation: z.object({ passed: z.literal(true) }).optional(),
  submission: z.object({ signature: z.string() }).nullable(),
});
export type DevnetDraft = z.infer<typeof DevnetDraft>;

export * from "./crypto";
