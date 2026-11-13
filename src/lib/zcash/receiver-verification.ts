import {
  type ZcashChainObservation,
  type ZcashPaymentReceipt,
  type ZcashNetwork,
} from "./types";
import {
  type ViewingKeyProof,
  type ZcashRequestTerms,
  inspectZcashPaymentReceipt,
} from "./receipt";
import { LightwalletdClient } from "./lightwalletd-client";

export interface SettlementAuditResult {
  verified: boolean;
  status: "chain_finalized" | "simulated" | "pending_confirmations" | "unverified" | "rejected";
  receipt?: ZcashPaymentReceipt;
  rejectionReason?: string;
  blockHeight?: number;
  confirmations?: number;
}

/**
 * Receiver-Side Shielded Settlement Verifier.
 *
 * Enforces:
 * 1. User-supplied txid ALONE is NEVER accepted as proof of payment.
 * 2. Requires authorized receiving-wallet evidence (viewing key decryption or chain observation).
 * 3. Requires at least 1 confirmed block on chain.
 * 4. Verifies exact amount and reference/terms binding in encrypted memo.
 */
export class ZcashReceiverVerifier {
  private lightwalletd: LightwalletdClient;

  constructor(lightwalletdClient?: LightwalletdClient) {
    this.lightwalletd = lightwalletdClient || new LightwalletdClient();
  }

  /**
   * Evaluates settlement proof against live chain and viewing key evidence.
   */
  async verifyShieldedSettlement(
    terms: ZcashRequestTerms,
    observation: ZcashChainObservation,
    proof?: ViewingKeyProof,
  ): Promise<SettlementAuditResult> {
    // Invariant 1: Reject unverified / zero-confirmation transactions
    if (observation.confirmations < 1) {
      return {
        verified: false,
        status: "pending_confirmations",
        rejectionReason: "TRANSACTION_CONFIRMATIONS_PENDING: Shielded output requires >= 1 block confirmation.",
        confirmations: observation.confirmations,
      };
    }

    // Invariant 2: Network match
    if (observation.chain !== terms.network) {
      return {
        verified: false,
        status: "rejected",
        rejectionReason: `NETWORK_MISMATCH: Expected ${terms.network}, observed ${observation.chain}.`,
      };
    }

    // Invariant 3: Amount match
    if (observation.amountAtoms !== terms.amountAtoms) {
      return {
        verified: false,
        status: "rejected",
        rejectionReason: `AMOUNT_MISMATCH: Expected ${terms.amountAtoms} zatoshis, observed ${observation.amountAtoms}.`,
      };
    }

    // Invariant 4: Viewing proof checks
    if (proof) {
      if (!proof.recipientMatched) {
        return {
          verified: false,
          status: "rejected",
          rejectionReason: "RECIPIENT_MISMATCH: Viewing key does not match designated receiver.",
        };
      }

      if (proof.decryptedMemo && !proof.decryptedMemo.includes(terms.reference)) {
        return {
          verified: false,
          status: "rejected",
          rejectionReason: "MEMO_REFERENCE_MISMATCH: Decrypted memo does not bind payment reference.",
        };
      }
    }

    // Invariant 5: Verify against live Lightwalletd block tip if not simulated
    if (!observation.isSimulated) {
      try {
        const latest = await this.lightwalletd.getLatestBlock();
        if (latest.height < observation.observedBlockHeight) {
          return {
            verified: false,
            status: "rejected",
            rejectionReason: `INVALID_BLOCK_HEIGHT: Observed height ${observation.observedBlockHeight} exceeds chain tip ${latest.height}.`,
          };
        }
      } catch (err: any) {
        // If RPC connection fails, we cannot attest chain_finalized
        return {
          verified: false,
          status: "unverified",
          rejectionReason: `LIGHTWALLETD_SYNC_FAILURE: ${err.message}`,
        };
      }
    }

    // Generate durable receipt
    const receipt = inspectZcashPaymentReceipt(terms, observation, proof);

    return {
      verified: true,
      status: receipt.verification,
      receipt,
      blockHeight: receipt.blockHeight,
      confirmations: receipt.confirmations,
    };
  }
}
