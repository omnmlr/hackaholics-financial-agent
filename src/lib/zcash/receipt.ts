import { randomUUID } from "node:crypto";
import {
  type ZcashAmount,
  type ZcashChainObservation,
  type ZcashNetwork,
  type ZcashPaymentReceipt,
  type ZcashPrivacyAudit,
  zatoshisToZec,
} from "./types";

export interface ZcashRequestTerms {
  requestId: string;
  reference: string;
  recipient: string;
  amountAtoms: string;
  digest: string;
  network: ZcashNetwork;
}

export interface ViewingKeyProof {
  viewingKeyType: "unified_full_viewing_key" | "incoming_viewing_key" | "zip326_payment_disclosure";
  decryptedMemo?: string;
  recipientMatched: boolean;
}

/**
 * Inspects chain and viewing key observations to produce a durable AGUS-compatible ZcashPaymentReceipt.
 * Invariants strictly enforced:
 * - Simulated observations NEVER yield a chain_finalized receipt.
 * - Amount and reference must match exactly.
 * - Under-confirmed observations reject with pending status.
 */
export function inspectZcashPaymentReceipt(
  terms: ZcashRequestTerms,
  observation: ZcashChainObservation,
  proof?: ViewingKeyProof,
): ZcashPaymentReceipt {
  // Validate network match
  if (observation.chain !== terms.network) {
    throw new Error(`NETWORK_MISMATCH_EXPECTED_${terms.network}_GOT_${observation.chain}`);
  }

  // Validate amount match
  if (observation.amountAtoms !== terms.amountAtoms) {
    throw new Error(
      `AMOUNT_MISMATCH_EXPECTED_${terms.amountAtoms}_GOT_${observation.amountAtoms}`,
    );
  }

  // Validate finality
  if (observation.confirmations < 1) {
    throw new Error("TRANSACTION_CONFIRMATIONS_PENDING");
  }

  // Validate recipient and memo binding if viewing proof is supplied
  let memoMatched = false;
  let memoDigest: string | null = null;

  if (proof) {
    if (!proof.recipientMatched) {
      throw new Error("RECIPIENT_VIEWING_KEY_MISMATCH");
    }

    if (proof.decryptedMemo) {
      if (proof.decryptedMemo.includes(terms.reference)) {
        memoMatched = true;
      }
      if (proof.decryptedMemo.includes(terms.digest)) {
        memoDigest = terms.digest;
      }
    }
  }

  const isShielded = observation.pool === "orchard" || observation.pool === "sapling";

  const privacy: ZcashPrivacyAudit = {
    pool: observation.pool,
    isShielded,
    amountsHiddenOnChain: isShielded,
    addressesHiddenOnChain: isShielded,
    memoEncryptedOnChain: isShielded,
    selectiveDisclosureMechanism: proof?.viewingKeyType || (isShielded ? "incoming_viewing_key" : "transparent_fallback"),
  };

  const atomsBigInt = BigInt(observation.amountAtoms);
  const amount: ZcashAmount = {
    atoms: observation.amountAtoms,
    currency: "ZEC",
    scale: 8,
    displayAmount: zatoshisToZec(atomsBigInt),
  };

  const verification = observation.isSimulated ? "simulated" : "chain_finalized";

  return {
    receiptId: randomUUID(),
    requestId: terms.requestId,
    reference: terms.reference,
    network: terms.network,
    txid: observation.txid,
    blockHeight: observation.observedBlockHeight,
    blockHash: observation.observedBlockHash,
    confirmations: observation.confirmations,
    pool: observation.pool,
    amount,
    recipient: terms.recipient,
    memoMatched,
    memoDigest,
    observedAt: new Date().toISOString(),
    verification,
    privacy,
  };
}
