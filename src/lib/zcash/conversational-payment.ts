import { z } from "zod";
import {
  type ZcashWalletService,
  type ZcashPaymentIntent,
} from "./wallet-service";
import {
  type ZcashOwnerReviewDetails,
  type ZcashSanitizedModelOutput,
  maskAddressForModel,
  sanitizeMemoForModel,
} from "./trust-boundary";
import { validateZcashAddress } from "./zip321";

/**
 * Standard known testnet demo contacts for BlockchainUNN demo.
 * In a full deployment, this is loaded from the encrypted local address book.
 */
export const DEMO_ZCASH_CONTACTS: Record<
  string,
  { name: string; address: string; pool: "unified" | "sapling" }
> = {
  daniel: {
    name: "Daniel",
    address:
      "utest1z9e4jkvw9quh68n49y5wqvvdg4d6qcf568q4g89z4v5348q79tve470m7e5w5886576p8r857w7sq68y2qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq9y4a02",
    pool: "unified",
  },
  ada: {
    name: "Ada",
    address:
      "utest1z6gq2h5z4u2x7l9q3y2c8v1b5n4m0k9j8h7g6f5d4s3a2z1x0c9v8b7n6m5l4k3j2h1g0f9e8d7c6b5a4z3y2x1w0v9u8t7s6r5q4p3o2n1m0l9k8j7h6g5f4e3d2c1b0a9z8y7x6",
    pool: "unified",
  },
  chidi: {
    name: "Chidi",
    address:
      "utest1z0m9n8b7v6c5x4z3a2s1d0f9g8h7j6k5l4m3n2b1v0c9x8z7a6s5d4f3g2h1j0k9l8m7n6b5v4c3x2z1a0s9d8f7g6h5j4k3l2m1n0b9v8c7x6z5a4s3d2f1g0h9j8k7l6m5n4",
    pool: "unified",
  },
};

export interface ExtractedZcashPaymentIntent {
  recipientRaw: string;
  recipientAlias?: string;
  recipientAddress?: string;
  amountZec?: string;
  isPrivate: boolean;
  memoHint?: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Deterministic Natural Language Parser for Shielded Payments.
 * Extracts intent from utterances such as:
 * - "AGUS, send Daniel 0.2 ZEC privately."
 * - "Pay 0.5 ZEC to Ada shielded"
 * - "Send 0.05 ZEC to utest1z9... for audit milestone"
 */
export function extractZcashConversationalIntent(
  userText: string,
): ExtractedZcashPaymentIntent | null {
  const text = userText.trim();
  const lower = text.toLowerCase();

  // Must mention ZEC or Zcash or private payment
  const hasZec = /\b(zec|zcash)\b/i.test(text);
  const isPrivate = /\b(privately|private|shielded|zk|zero-knowledge)\b/i.test(text);

  if (!hasZec && !isPrivate) {
    return null;
  }

  // Extract amount in ZEC (e.g. 0.2, 5, 0.005)
  const amountMatch = text.match(/(\d+(\.\d{1,8})?)\s*(zec|zcash)?/i);
  let amountZec: string | undefined;
  if (amountMatch) {
    amountZec = amountMatch[1];
  }

  // Check for raw Zcash address in the text
  const rawAddrMatch = text.match(/\b(utest1[a-z0-9]{40,}|u1[a-z0-9]{40,}|ztestsapling[a-z0-9]{40,}|zs1[a-z0-9]{40,}|tm[a-z0-9]{33}|t1[a-z0-9]{33})\b/i);

  let recipientRaw = "";
  let recipientAddress: string | undefined;
  let recipientAlias: string | undefined;

  if (rawAddrMatch) {
    recipientAddress = rawAddrMatch[1];
    recipientRaw = recipientAddress;
    recipientAlias = maskAddressForModel(recipientAddress);
  } else {
    // Check against known contacts
    for (const [key, contact] of Object.entries(DEMO_ZCASH_CONTACTS)) {
      if (new RegExp(`\\b${key}\\b`, "i").test(text)) {
        recipientRaw = contact.name;
        recipientAlias = contact.name;
        recipientAddress = contact.address;
        break;
      }
    }

    if (!recipientRaw) {
      // Look for name after "send", "pay", "to"
      const nameMatch = text.match(/(?:send|pay|transfer)\s+([A-Za-z]+)\s+(\d+(\.\d{1,8})?)/i) ||
                        text.match(/(?:to)\s+([A-Za-z]+)/i);
      if (nameMatch) {
        recipientRaw = nameMatch[1];
        recipientAlias = nameMatch[1];
      }
    }
  }

  // Extract memo hint if specified ("for ...", "memo: ...")
  let memoHint: string | undefined;
  const memoMatch = text.match(/(?:for|memo:?)\s+([^.]+)/i);
  if (memoMatch) {
    memoHint = sanitizeMemoForModel(memoMatch[1].trim());
  }

  return {
    recipientRaw,
    recipientAlias,
    recipientAddress,
    amountZec,
    isPrivate: true,
    memoHint,
    confidence: recipientAddress && amountZec ? "high" : "medium",
  };
}

/**
 * Orchestrates conversational preparation of a shielded payment.
 */
export function processConversationalPaymentRequest(
  owner: string,
  userMessage: string,
  walletService: ZcashWalletService,
): {
  success: boolean;
  intent?: ZcashPaymentIntent;
  modelOutput: ZcashSanitizedModelOutput | { message: string; requiresClarification: boolean };
  ownerReview?: ZcashOwnerReviewDetails;
} {
  const extracted = extractZcashConversationalIntent(userMessage);
  if (!extracted) {
    return {
      success: false,
      modelOutput: {
        message: "I didn't detect a Zcash payment request. You can say 'Send Daniel 0.2 ZEC privately'.",
        requiresClarification: true,
      },
    };
  }

  if (!extracted.amountZec) {
    return {
      success: false,
      modelOutput: {
        message: `How much ZEC would you like to send to ${extracted.recipientAlias || "the recipient"}?`,
        requiresClarification: true,
      },
    };
  }

  if (!extracted.recipientAddress) {
    return {
      success: false,
      modelOutput: {
        message: `Recipient '${extracted.recipientRaw}' was not found in your private address book. Please provide their Unified Address (utest1...).`,
        requiresClarification: true,
      },
    };
  }

  // Prepare intent in wallet service
  const prepared = walletService.preparePaymentIntent({
    owner,
    recipient: extracted.recipientAddress,
    recipientAlias: extracted.recipientAlias,
    amountZec: extracted.amountZec,
    memoText: extracted.memoHint,
    network: "testnet",
  });

  return {
    success: true,
    intent: prepared.intent,
    modelOutput: prepared.modelView,
    ownerReview: prepared.ownerReview,
  };
}
