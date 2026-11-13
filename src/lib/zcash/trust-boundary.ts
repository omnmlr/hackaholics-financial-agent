import { z } from "zod";

/**
 * AGUS 2.0 Zcash Privacy Trust Boundary.
 *
 * Implements strict separation of roles:
 * - AI_MODEL: Natural language understanding & conversation; receives strictly sanitized data.
 * - DOMAIN_ENGINE: Business rules, terms digest, idempotency, lifecycle.
 * - TRUSTED_WALLET_SERVICE: Patterned after zec-agent-wallet (`zaw`). Controls keys, signs & submits.
 * - OWNER_APPROVAL_INTERFACE: Presents unredacted details to authorized human owner.
 * - SETTLEMENT_VERIFIER: Independently audits chain confirmations via lightwalletd.
 */

export const ActorRole = z.enum([
  "AI_MODEL",
  "DOMAIN_ENGINE",
  "TRUSTED_WALLET_SERVICE",
  "OWNER_APPROVAL_INTERFACE",
  "SETTLEMENT_VERIFIER",
]);
export type ActorRole = z.infer<typeof ActorRole>;

export const ZcashCoarseStatus = z.enum([
  "draft",
  "pending_approval",
  "approved",
  "submitting",
  "chain_finalized",
  "failed",
  "rejected",
]);
export type ZcashCoarseStatus = z.infer<typeof ZcashCoarseStatus>;

export const ZcashPrivacyLevel = z.enum([
  "shielded_orchard",
  "shielded_sapling",
  "transparent_warning",
]);
export type ZcashPrivacyLevel = z.infer<typeof ZcashPrivacyLevel>;

/**
 * Sanitized Model-Facing View.
 * The AI model receives ONLY coarse, safe properties necessary for conversation.
 * It NEVER receives spending keys, viewing keys, raw transaction hex, full shielded addresses,
 * or unscrubbed private memos.
 */
export interface ZcashSanitizedModelOutput {
  intentId: string;
  reference: string;
  recipientAlias: string;
  amountZec: string;
  currency: "ZEC";
  status: ZcashCoarseStatus;
  privacyLevel: ZcashPrivacyLevel;
  displaySummary: string;
  feeZec?: string;
  requiresOwnerApproval: boolean;
  errorCode?: string;
  network: "testnet" | "mainnet";
}

/**
 * Full Owner-Facing Review View.
 * The human owner MUST verify unredacted transaction details before authorization.
 */
export interface ZcashOwnerReviewDetails {
  intentId: string;
  reference: string;
  recipientAddress: string;
  recipientPool: "orchard" | "sapling" | "transparent" | "unified";
  amountZec: string;
  amountAtoms: string;
  feeAtoms: string;
  feeZec: string;
  totalAtoms: string;
  memoText?: string;
  termsDigest: string;
  network: "testnet" | "mainnet";
  expiresAt: string;
  status: ZcashCoarseStatus;
  isShielded: boolean;
  privacyNotice: string;
}

/**
 * Known prompt-injection signatures in memos or counterparty messages.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /system\s*:/i,
  /you\s+are\s+now\s+in\s+developer\s+mode/i,
  /reveal\s+(all\s+)?(keys|passwords|secrets|viewing\s+keys)/i,
  /send\s+all\s+(funds|zec|money)/i,
  /execute\s+command/i,
  /<script\b/i,
  /javascript:/i,
];

/**
 * Sanitizes memo strings before any model exposure to protect against prompt injection.
 */
export function sanitizeMemoForModel(rawMemo: string | undefined): string | undefined {
  if (!rawMemo) return undefined;

  let sanitized = rawMemo.trim();
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      // Replace malicious payload with safe redacting indicator
      sanitized = sanitized.replace(pattern, "[UNTRUSTED_INSTRUCTION_REDACTED]");
    }
  }

  // Cap length to prevent context flooding
  if (sanitized.length > 200) {
    sanitized = sanitized.slice(0, 197) + "...";
  }

  return sanitized;
}

/**
 * Checks whether a text contains potential prompt-injection instructions.
 */
export function detectPromptInjection(text: string): boolean {
  if (!text) return false;
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Redacts sensitive full addresses for model consumption, showing only prefix and suffix.
 * e.g., "utest1z9...a78e" instead of the full 140+ character address.
 */
export function maskAddressForModel(address: string): string {
  if (!address || address.length < 16) return address;
  const prefix = address.slice(0, 8);
  const suffix = address.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Regression assertor: ensures no canary tokens (private keys, viewing keys, raw memos)
 * leak into model-facing outputs or conversation history.
 */
export function assertNoCanaryLeak(target: unknown, canaries: string[]): void {
  const serialized = typeof target === "string" ? target : JSON.stringify(target);
  for (const canary of canaries) {
    if (canary && canary.length >= 8 && serialized.includes(canary)) {
      throw new Error(`CRITICAL_DATA_LEAK_DETECTED: Canary token found in model/public boundary.`);
    }
  }
}
