import { z } from "zod";

export const SavingsPresentationSchema = z.object({
  target: z.number().positive().max(1e12),
  startingAmount: z.number().nonnegative().max(1e12),
  contribution: z.number().positive().max(1e12),
  cadence: z.enum(["days", "weeks", "months", "years"]),
  periods: z.number().int().nonnegative().safe(),
  duration: z.string().max(100).optional(),
  source: z
    .object({
      accountId: z.string().max(128),
      field: z.enum(["available", "current"]),
      asOf: z.iso.datetime(),
      simulated: z.boolean(),
    })
    .optional(),
});
export type SavingsPresentation = z.infer<typeof SavingsPresentationSchema>;

export const PaymentPresentationSchema = z.object({
  asOf: z.iso.datetime(),
  scope: z.string().max(120),
  totalSuccessfulKobo: z.number().int().nonnegative().safe(),
  records: z
    .array(
      z.object({
        batchId: z.uuid(),
        paymentId: z.uuid(),
        reference: z.string().max(100),
        label: z.string().max(100),
        verifiedName: z.string().max(100).nullable(),
        institution: z.string().max(150),
        amountKobo: z.number().int().positive().safe(),
        feeKobo: z.number().int().nonnegative().safe().nullable(),
        status: z.string().max(50),
        mode: z.enum(["fixture", "test", "live"]),
        recordedAt: z.iso.datetime(),
        canConfirm: z.boolean(),
      }),
    )
    .max(100),
});
export type PaymentPresentation = z.infer<typeof PaymentPresentationSchema>;

const Metric = z.object({
  label: z.string().min(1),
  value: z.string().regex(/^(?:-?₦[\d,]+\.\d{2}|Unavailable)$/),
});
const Record = z.object({
  name: z.string(),
  amount: z.string(),
  direction: z.enum(["debit", "credit"]),
  date: z.string().datetime().nullable(),
  status: z.string(),
  account: z.string(),
  choice: z.string().optional(),
});
export const FinancialPresentationSchema = z.object({
  version: z.literal(1),
  narration: z.enum(["ai", "factual_fallback"]),
  explanation: z.array(z.string()).min(1),
  results: z
    .array(
      z
        .object({
          resultId: z.string(),
          type: z.enum([
            "calculate_spending",
            "search_transactions",
            "get_transaction",
            "find_payment_evidence",
            "get_account_summary",
          ]),
          metrics: z.array(Metric),
          records: z.array(Record),
          scope: z.string(),
          limits: z.array(z.string()),
          sources: z.array(
            z.object({ provider: z.string(), mode: z.string() }),
          ),
          asOf: z.string().datetime(),
          coverage: z.string(),
          balanceUnavailable: z.enum(["stale", "not_provided"]).optional(),
          originalText: z.string(),
        })
        .refine(
          (r) => r.type !== "calculate_spending" || r.metrics.length === 3,
          "Incomplete spending presentation",
        ),
    )
    .min(1)
    .max(5),
});
export type FinancialPresentation = z.infer<typeof FinancialPresentationSchema>;
export type PresentedResult = FinancialPresentation["results"][number];
