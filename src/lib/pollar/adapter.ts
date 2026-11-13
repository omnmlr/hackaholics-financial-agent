/**
 * AGUS 2.0 — Pollar Payment Adapter
 *
 * Provides a clean, typed payment adapter interface designed for Codex
 * to integrate into AGUS's conversational payment experience.
 */

import {
  type PollarPaymentDraft,
  type PollarReviewPayload,
  type PollarPaymentReceipt,
  type PollarExecutionResult,
  type PollarWalletSession,
  type PollarAssetBalance,
  type PollarSupportedChain,
  STELLAR_TESTNET_HORIZON,
  STELLAR_TESTNET_USDC_ISSUER,
  stellarExplorerTxUrl,
  isValidStellarAddress,
} from "./contracts";
import { PollarService, defaultPollarService, type PollarPrerequisiteResult } from "./service";

export interface PollarAdapterMetadata {
  providerId: "pollar";
  displayName: "Pollar Payment Infrastructure";
  version: "0.12.0";
  primaryNetwork: "stellar-testnet";
  secondaryNetwork: "solana-devnet";
  supportedAssets: Array<{
    code: string;
    chain: PollarSupportedChain;
    decimals: number;
    issuer?: string;
    isNative: boolean;
    description: string;
  }>;
  features: {
    gaslessOrSponsored: boolean;
    passkeySupport: boolean;
    embeddedWallets: boolean;
    externalWallets: boolean;
    conversationalApproval: boolean;
  };
}

export interface PrepareConversationalPaymentInput {
  recipient: string;
  amount: string;
  asset?: "USDC" | "XLM" | "SOL";
  chain?: PollarSupportedChain;
  memo?: string;
  reference?: string;
}

export class PollarPaymentAdapter {
  private service: PollarService;

  constructor(service: PollarService = defaultPollarService) {
    this.service = service;
  }

  getMetadata(): PollarAdapterMetadata {
    return {
      providerId: "pollar",
      displayName: "Pollar Payment Infrastructure",
      version: "0.12.0",
      primaryNetwork: "stellar-testnet",
      secondaryNetwork: "solana-devnet",
      supportedAssets: [
        {
          code: "USDC",
          chain: "STELLAR",
          decimals: 7,
          issuer: STELLAR_TESTNET_USDC_ISSUER,
          isNative: false,
          description: "Circle Testnet USDC on Stellar",
        },
        {
          code: "XLM",
          chain: "STELLAR",
          decimals: 7,
          isNative: true,
          description: "Stellar Lumens",
        },
        {
          code: "USDC",
          chain: "SOLANA",
          decimals: 6,
          isNative: false,
          description: "Circle Testnet USDC on Solana Devnet",
        },
        {
          code: "SOL",
          chain: "SOLANA",
          decimals: 9,
          isNative: true,
          description: "Solana Devnet SOL",
        },
      ],
      features: {
        gaslessOrSponsored: true,
        passkeySupport: true,
        embeddedWallets: true,
        externalWallets: true,
        conversationalApproval: true,
      },
    };
  }

  getPrerequisites(): PollarPrerequisiteResult {
    return this.service.checkPrerequisites();
  }

  /**
   * Retrieves or establishes the user's Pollar wallet session.
   */
  async getWalletSession(userId: string): Promise<PollarWalletSession> {
    return this.service.getOrCreateSession(userId);
  }

  /**
   * Reads available balances for the user's wallet.
   */
  async getBalances(userId: string, chain: PollarSupportedChain = "STELLAR"): Promise<PollarAssetBalance[]> {
    const session = await this.getWalletSession(userId);
    return this.service.getBalances(session.address, chain);
  }

  /**
   * Prepares a conversational payment.
   * Example: User: "AGUS, send Daniel 10 USDC"
   */
  async prepareConversationalPayment(
    userId: string,
    input: PrepareConversationalPaymentInput,
  ): Promise<{ draft: PollarPaymentDraft; review: PollarReviewPayload }> {
    const session = await this.getWalletSession(userId);
    return this.service.preparePayment(userId, {
      senderAddress: session.address,
      recipientAddress: input.recipient,
      amount: input.amount,
      asset: input.asset ?? "USDC",
      chain: input.chain ?? session.chain,
      memo: input.memo,
      reference: input.reference,
    });
  }

  /**
   * Retrieves payment review details for the user to confirm in chat.
   */
  async getReviewPayload(userId: string, draftId: string): Promise<PollarReviewPayload> {
    const session = await this.getWalletSession(userId);
    const balances = await this.service.getBalances(session.address, session.chain);
    // Prepare validation check
    const draft = await (this.service as any).store?.getDraft(draftId);
    if (!draft) {
      throw new Error(`Draft ${draftId} not found`);
    }
    return {
      draftId: draft.id,
      recipient: draft.recipient,
      recipientDisplay: `${draft.recipient.slice(0, 6)}...${draft.recipient.slice(-6)}`,
      amount: draft.amount,
      asset: draft.asset,
      feeDisplay: draft.fee.sponsored ? "Sponsored by Pollar (0.00 XLM)" : `${draft.fee.amount} ${draft.fee.unit}`,
      networkDisplay: draft.chain === "STELLAR" ? "Stellar Testnet" : "Solana Devnet",
      digest: draft.digest,
      expiresAt: draft.expiresAt,
      requiresPasswordReauth: true,
    };
  }

  /**
   * Authorizes and executes the payment in one coordinated flow once owner approval is confirmed.
   */
  async authorizeAndExecute(
    userId: string,
    draftId: string,
    digest: string,
    passwordVerified = true,
  ): Promise<PollarExecutionResult> {
    // 1. Enforce owner re-authentication & exact digest match
    await this.service.authorizePayment(userId, draftId, digest, passwordVerified);

    // 2. Submit transaction via Pollar infrastructure
    const result = await this.service.submitPayment(userId, draftId);

    return result;
  }

  /**
   * Verifies payment settlement on the public ledger.
   */
  async verifyPayment(
    txHash: string,
    chain: PollarSupportedChain = "STELLAR",
  ): Promise<{
    verified: boolean;
    status: "CONFIRMED" | "NOT_FOUND" | "FAILED";
    ledgerSequence?: number;
    confirmedAt?: string;
    explorerUrl: string;
  }> {
    return this.service.verifySettlement(txHash, chain);
  }

  /**
   * Direct address validator.
   */
  isValidAddress(address: string, chain: PollarSupportedChain = "STELLAR"): boolean {
    if (chain === "STELLAR") {
      return isValidStellarAddress(address);
    }
    return /^[1-9A-HJ-NP-za-km-z]{32,44}$/.test(address);
  }
}

export const defaultPollarAdapter = new PollarPaymentAdapter();
