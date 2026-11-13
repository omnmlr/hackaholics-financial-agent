import { z } from "zod";

export const Rail = z.enum(["pollar-stellar", "zcash"]);
export type Rail = z.infer<typeof Rail>;
export const InvoiceInput = z.strictObject({
  id: z.uuid(),
  title: z.string().trim().min(1).max(120),
  counterparty: z.string().trim().min(1).max(100),
  direction: z.enum(["receivable", "payable"]),
  currency: z.enum(["NGN", "USDC", "ZEC"]),
  amount: z.string().regex(/^(?:0|[1-9]\d{0,8})(?:\.\d{1,8})?$/),
  dueAt: z.iso.datetime(),
  note: z.string().trim().max(500).default(""),
});
export type InvoiceInput = z.infer<typeof InvoiceInput>;
export type Invoice = InvoiceInput & {
  owner: string;
  createdAt: string;
  state: "open" | "settled" | "cancelled";
  responsibilityId: string;
  settledAt?: string;
  settlementRequestId?: string;
};
export type VerificationEvidence = {
  source: "stellar-horizon-testnet" | "zcash-receiving-wallet";
  network: "testnet";
  transactionId: string;
  recipient: string;
  amount: string;
  asset: string;
  observedAt: string;
  confirmedAt: string;
  confirmations?: number;
  ledger?: number;
  memo: string;
};
export type PaymentRequest = {
  id: string;
  owner: string;
  invoiceId: string;
  rail: Rail;
  network: "testnet";
  asset: "USDC" | "ZEC";
  issuer?: string;
  amount: string;
  recipient: string;
  memo: string;
  uri: string;
  createdAt: string;
  expiresAt: string;
  state: "pending" | "confirmed" | "expired" | "cancelled";
  candidateTransactionId?: string;
  lastCheckedAt?: string;
  lastCheck?: string;
  submissionStartedAt?: string;
  reviewDigest?: string;
  evidence?: VerificationEvidence;
};
export type ProductEvent = {
  id: string;
  at: string;
  kind: string;
  text: string;
  invoiceId?: string;
  requestId?: string;
  paymentPlanId?: string;
};
export const RequestInput = z.strictObject({
  id: z.uuid(),
  invoiceId: z.uuid(),
  rail: Rail,
  recipient: z.string().trim().min(20).max(300),
});

export const moneyScale = { NGN: 2, USDC: 7, ZEC: 8 } as const;
export function atomic(value: string, scale: number): bigint {
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d+)?$/.test(value))
    throw new Error("Invalid amount");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale)
    throw new Error(`Use at most ${scale} decimal places`);
  return (
    BigInt(whole) * 10n ** BigInt(scale) +
    BigInt(fraction.padEnd(scale, "0") || "0")
  );
}

export type ProductSnapshot = {
  owner: string;
  asOf: string;
  invoices: Invoice[];
  requests: PaymentRequest[];
  events: ProductEvent[];
  accounts: {
    id: string;
    label: string;
    institution: string;
    maskedNumber: string;
    currency: string;
    amount: string | null;
    asOf: string | null;
    stale: boolean;
    confidence: string;
    source: "statement import";
  }[];
  transactions: {
    id: string;
    description: string;
    amount: string;
    currency: string;
    postedAt: string;
    category: string;
    internal: boolean;
  }[];
  intelligence: {
    naira: string | null;
    importedAccountCount: number;
    income: string;
    spending: string;
    excludedTransfers: number;
    warnings: string[];
    nextAction: string;
  };
  capabilities: {
    pollar: {
      configured: boolean;
      publicKey: string | null;
      issuer: string | null;
      sdkVersion: string;
      network: "testnet";
    };
    zcash: {
      verificationConfigured: boolean;
      receivingAddress: string | null;
      network: "testnet";
    };
    ai: { configured: boolean; provider: string };
    bank: "coming-soon";
    session: "single-operator";
  };
};
