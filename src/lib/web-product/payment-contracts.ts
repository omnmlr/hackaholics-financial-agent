import { z } from "zod";
export type PaymentPlanState =
  | "needs_details"
  | "blocked"
  | "ready_for_quote"
  | "review"
  | "approved"
  | "submitting"
  | "pending"
  | "confirmed"
  | "failed"
  | "unknown"
  | "expired"
  | "cancelled";
export type PaymentPlan = {
  id: string;
  owner: string;
  conversationId?: string;
  interpretation: "local-intent-parser" | "agent-prepared";
  originalIntent: string;
  recipientLabel: string;
  recipientAddress: string | null;
  resolution: "unresolved" | "user-entered" | "saved-contact";
  amount: string | null;
  asset: string | null;
  privacy: boolean;
  rail: "pollar-stellar" | "zcash" | null;
  network: "testnet";
  memo: string;
  state: PaymentPlanState;
  blockers: string[];
  invoiceId?: string;
  createdAt: string;
  expiresAt: string;
  walletRequest?: string;
  maxFeeStroops: string;
  quote?: {
    source: "pollar-sdk-built-transaction";
    unsignedXdr: string;
    transactionHash: string;
    sourceAddress: string;
    feeStroops: string;
    expiresAt: string;
    observedAt: string;
  };
  approval?: {
    digest: string;
    nonceHash: string;
    expiresAt: string;
    consumedAt?: string;
  };
  candidateTransactionId?: string;
  lastCheck?: string;
  evidence?: {
    source: "stellar-horizon-testnet";
    transactionId: string;
    confirmedAt: string;
    observedAt: string;
    ledger: number;
    feeStroops: string;
  };
  reviewDigest?: string;
};
export const IntentInput = z.strictObject({
  id: z.uuid(),
  text: z.string().trim().min(1).max(4000),
  privacyMode: z.boolean().default(false),
});
export const PaymentFields = z.strictObject({
  recipientLabel: z.string().trim().min(1).max(100),
  recipientAddress: z.string().trim().max(300),
  amount: z.string().trim().max(30),
  asset: z.string().trim().min(1).max(12),
  privacy: z.boolean(),
  saveContact: z.boolean().default(false),
  invoiceId: z.uuid().optional(),
});
/** Extraction proposes details only. No address is inferred from a person's name. */
export function interpretPaymentIntent(text: string, privacyMode = false) {
  const money = text.match(
    /\b(\d+(?:\.\d+)?)\s*(USDC|ZEC|BTC|ETH|SOL|NGN|USD)\b/i,
  );
  const asset =
    money?.[2].toUpperCase() ??
    text.match(/\b(USDC|ZEC|BTC|ETH|SOL|NGN|USD)\b/i)?.[1].toUpperCase() ??
    null;
  const action = text.match(/\b(?:send|pay|transfer)\s+(.+)/i)?.[1] ?? "";
  let recipientLabel = "";
  if (money) {
    const index = action.indexOf(money[0]);
    if (index > 0)
      recipientLabel = action
        .slice(0, index)
        .replace(/\bto\b/gi, "")
        .trim();
    else
      recipientLabel =
        action
          .slice(Math.max(0, index) + money[0].length)
          .match(
            /\bto\s+(.+?)(?:\s+(?:privately|using|on|with)\b|[.!?]|$)/i,
          )?.[1] ?? "";
  }
  recipientLabel = recipientLabel
    .replace(/\b(?:privately|please)\b/gi, "")
    .trim()
    .slice(0, 100);
  return {
    recipientLabel,
    amount: money?.[1] ?? null,
    asset,
    privacy:
      privacyMode || /\b(?:private|privately|shielded|privacy)\b/i.test(text),
    mainnetRequested: /\bmainnet\b/i.test(text),
  };
}
export const looksLikePaymentIntent = (text: string) =>
  /\b(?:send|pay|transfer)\b/i.test(text) &&
  /\b(?:USDC|ZEC|BTC|ETH|SOL|NGN|USD)\b/i.test(text);
