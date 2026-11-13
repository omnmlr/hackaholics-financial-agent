import {
  type ZcashNetwork,
  type ZcashPool,
  type ZcashAmount,
  type ZcashPaymentReceipt,
  type ZcashChainObservation,
} from "./types";
import {
  type ZcashCoarseStatus,
  type ZcashOwnerReviewDetails,
  type ZcashPrivacyLevel,
  type ZcashSanitizedModelOutput,
  maskAddressForModel,
} from "./trust-boundary";
import {
  ZcashWalletService,
  type ZcashPaymentIntent,
  type PrepareIntentParams,
  type WalletBalance,
} from "./wallet-service";
import {
  createZcashPaymentRequest,
  type ZcashRequestInput,
  type ZcashRequestView,
} from "../../server/zcash-requests";
import {
  type ViewingKeyProof,
  type ZcashRequestTerms,
} from "./receipt";
import {
  ZcashReceiverVerifier,
  type SettlementAuditResult,
} from "./receiver-verification";
import { validateZcashAddress } from "./zip321";
import { LightwalletdClient } from "./lightwalletd-client";

export interface ZcashCapabilities {
  supportedNetworks: ZcashNetwork[];
  activeNetwork: ZcashNetwork;
  supportedPools: ZcashPool[];
  recommendedPool: ZcashPool;
  lightwalletdEndpoint: string;
  lightwalletdHealthy: boolean;
  chainTipHeight: number;
  chainTipHash: string;
  privacyGuarantees: string[];
}

export interface ZcashPrivacyAssessment {
  recipient: string;
  pool: "orchard" | "sapling" | "transparent" | "unified";
  isShielded: boolean;
  privacyLevel: ZcashPrivacyLevel;
  guarantees: string[];
  warnings: string[];
}

/**
 * ZcashPrivacyPaymentAdapter
 * The canonical integration adapter exposed to Codex for the AGUS web frontend.
 */
export interface ZcashPrivacyPaymentAdapter {
  discoverCapabilities(): Promise<ZcashCapabilities>;
  getShieldedWalletStatus(owner: string): Promise<WalletBalance>;
  assessPrivacyCapabilities(recipient: string, network?: ZcashNetwork): ZcashPrivacyAssessment;
  createPaymentRequest(owner: string, input: ZcashRequestInput): Promise<ZcashRequestView>;
  preparePaymentIntent(params: PrepareIntentParams): {
    intent: ZcashPaymentIntent;
    modelView: ZcashSanitizedModelOutput;
    ownerReview: ZcashOwnerReviewDetails;
  };
  authorizePayment(
    intentId: string,
    owner: string,
    stepUpCredential: string,
  ): { authorizationToken: string; modelView: ZcashSanitizedModelOutput };
  submitShieldedPayment(
    intentId: string,
    authorizationToken: string,
  ): Promise<{ intent: ZcashPaymentIntent; txid: string; modelView: ZcashSanitizedModelOutput }>;
  inspectPaymentStatus(intentId: string): ZcashPaymentIntent | undefined;
  verifySettlement(
    terms: ZcashRequestTerms,
    observation: ZcashChainObservation,
    proof?: ViewingKeyProof,
  ): Promise<SettlementAuditResult>;
  getSanitizedModelOutput(intentId: string): ZcashSanitizedModelOutput | undefined;
}

/**
 * Concrete implementation of the Codex adapter.
 */
export class DefaultZcashPrivacyAdapter implements ZcashPrivacyPaymentAdapter {
  private walletService: ZcashWalletService;
  private receiverVerifier: ZcashReceiverVerifier;
  private lightwalletd: LightwalletdClient;
  private network: ZcashNetwork;

  constructor(
    network: ZcashNetwork = "testnet",
    lightwalletdClient?: LightwalletdClient,
  ) {
    this.network = network;
    this.lightwalletd = lightwalletdClient || new LightwalletdClient();
    this.walletService = new ZcashWalletService(network, this.lightwalletd);
    this.receiverVerifier = new ZcashReceiverVerifier(this.lightwalletd);
  }

  async discoverCapabilities(): Promise<ZcashCapabilities> {
    const health = await this.lightwalletd.checkHealth();
    return {
      supportedNetworks: ["testnet"],
      activeNetwork: this.network,
      supportedPools: ["orchard", "sapling", "transparent"],
      recommendedPool: "orchard",
      lightwalletdEndpoint: "testnet.zec.rocks:443",
      lightwalletdHealthy: health.live,
      chainTipHeight: health.tipHeight,
      chainTipHash: health.tipHash,
      privacyGuarantees: [
        "Shielded Unified Addresses (ZIP 316) conceal sender, recipient, and amount.",
        "Zero-knowledge Halo 2 SNARKs eliminate trusted setup for Orchard pool.",
        "512-byte encrypted memos bind AGUS request references privately.",
        "Selective disclosure via viewing keys enables audits without spending risk.",
      ],
    };
  }

  async getShieldedWalletStatus(owner: string): Promise<WalletBalance> {
    return this.walletService.getBalance(owner);
  }

  assessPrivacyCapabilities(recipient: string, network: ZcashNetwork = this.network): ZcashPrivacyAssessment {
    const check = validateZcashAddress(recipient, network);
    const isShielded = check.valid && (check.pool === "unified" || check.pool === "sapling" || check.pool === "orchard");

    const guarantees: string[] = [];
    const warnings: string[] = [];

    if (!check.valid) {
      warnings.push(`Address is not a valid Zcash ${network} address.`);
      return {
        recipient,
        pool: "transparent",
        isShielded: false,
        privacyLevel: "transparent_warning",
        guarantees,
        warnings,
      };
    }

    if (isShielded) {
      guarantees.push("Recipient address is fully shielded on the block explorer.");
      guarantees.push("Transacted amounts are cryptographically hidden via Pedersen commitments.");
      guarantees.push("Memos are end-to-end encrypted with ChaCha20-Poly1305.");
    } else {
      warnings.push("TRANSPARENT RECIPIENT: Values, sender, and receiver are completely public on chain.");
      warnings.push("Recommend using a Unified Address (utest1...) for complete financial privacy.");
    }

    return {
      recipient,
      pool: check.pool,
      isShielded,
      privacyLevel: isShielded ? (check.pool === "unified" ? "shielded_orchard" : "shielded_sapling") : "transparent_warning",
      guarantees,
      warnings,
    };
  }

  async createPaymentRequest(owner: string, input: ZcashRequestInput): Promise<ZcashRequestView> {
    return createZcashPaymentRequest(owner, input);
  }

  preparePaymentIntent(params: PrepareIntentParams) {
    return this.walletService.preparePaymentIntent(params);
  }

  authorizePayment(intentId: string, owner: string, stepUpCredential: string) {
    return this.walletService.authorizeIntent(intentId, owner, stepUpCredential);
  }

  async submitShieldedPayment(intentId: string, authorizationToken: string) {
    return this.walletService.executeShieldedPayment(intentId, authorizationToken);
  }

  inspectPaymentStatus(intentId: string): ZcashPaymentIntent | undefined {
    return this.walletService.getIntent(intentId);
  }

  async verifySettlement(
    terms: ZcashRequestTerms,
    observation: ZcashChainObservation,
    proof?: ViewingKeyProof,
  ): Promise<SettlementAuditResult> {
    return this.receiverVerifier.verifyShieldedSettlement(terms, observation, proof);
  }

  getSanitizedModelOutput(intentId: string): ZcashSanitizedModelOutput | undefined {
    const intent = this.walletService.getIntent(intentId);
    if (!intent) return undefined;
    return {
      intentId: intent.intentId,
      reference: intent.reference,
      recipientAlias: intent.recipientAlias,
      amountZec: intent.amountZec,
      currency: "ZEC",
      status: intent.status,
      privacyLevel: intent.privacyLevel,
      displaySummary: `Payment of ${intent.amountZec} ZEC to ${intent.recipientAlias}: status is ${intent.status}.`,
      feeZec: intent.feeZec,
      requiresOwnerApproval: intent.status === "pending_approval",
      errorCode: intent.errorCode,
      network: intent.network,
    };
  }
}
