/**
 * AGUS 2.0 — Pollar SDK Web Integration Contracts
 *
 * Ground-truth typed interfaces for Pollar-powered conversational payments
 * on Stellar Testnet and multi-rail web infrastructure.
 */

import { createHash } from "node:crypto";

// Stellar Testnet Configuration
export const STELLAR_TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
export const STELLAR_TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";
export const STELLAR_TESTNET_EXPLORER_BASE = "https://stellar.expert/explorer/testnet";

// Circle Canonical Testnet USDC Issuer on Stellar
export const STELLAR_TESTNET_USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const STELLAR_USDC_DECIMALS = 7;
export const STELLAR_XLM_DECIMALS = 7;

// Controlled, Genuine Test Recipient on Stellar Testnet (created & funded with 10,000 XLM via Friendbot)
// DO NOT use the USDC issuer address as a payment destination.
export const CONTROLLED_TEST_RECIPIENT_STELLAR = "GAE2WA6Q5V5SDOHCF3CGEK7AQEERFZ6BS7NI4AAXON2D2KZTPATB2VAU";

// Solana Devnet Reference Configuration (Multi-Rail Support)
export const SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";
export const SOLANA_DEVNET_GENESIS = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
export const SOLANA_DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const SOLANA_DEVNET_EXPLORER_BASE = "https://explorer.solana.com";

// Pollar API Defaults
export const DEFAULT_POLLAR_BASE_URL = "https://sdk.api.pollar.xyz";

export type PollarSupportedChain = "STELLAR" | "SOLANA";
export type PollarCustodyMode = "internal" | "smart" | "turnkey" | "external";
export type PollarProvisioningStatus = "READY" | "CREATING" | "FAILED" | "NONE";

export interface PollarConfig {
  apiKey?: string;
  publishableKey?: string;
  baseUrl?: string;
  stellarNetwork?: "testnet" | "mainnet";
  environment?: "testnet" | "fixture";
}

export interface PollarWalletSession {
  userId: string;
  clientSessionId: string;
  address: string;
  chain: PollarSupportedChain;
  network: "testnet" | "mainnet";
  custody: PollarCustodyMode;
  provisioning: PollarProvisioningStatus;
  email?: string;
  connectedAt: string;
}

export interface PollarAssetBalance {
  asset: string;
  chain: PollarSupportedChain;
  amount: string;
  amountAtoms: string;
  decimals: number;
  issuer?: string;
  limit?: string;
  sponsored?: boolean;
  available: string | null;
}

export interface PollarWalletState {
  address: string;
  chain: PollarSupportedChain;
  network: "testnet";
  balances: PollarAssetBalance[];
  provisioning: PollarProvisioningStatus;
  updatedAt: string;
}

export interface PollarPreparePaymentInput {
  senderAddress: string;
  recipientAddress: string;
  amount: string;
  asset: "USDC" | "XLM" | "SOL";
  chain?: PollarSupportedChain;
  memo?: string;
  reference?: string;
}

export type PollarDraftState =
  | "prepared"
  | "approved"
  | "submitting"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled";

export interface PollarPaymentDraft {
  id: string;
  owner: string;
  chain: PollarSupportedChain;
  network: "testnet";
  sender: string;
  recipient: string;
  asset: "USDC" | "XLM" | "SOL";
  assetDetail: {
    code: string;
    issuer?: string;
    type: "native" | "credit_alphanum4" | "credit_alphanum12";
  };
  amount: string;
  amountBaseUnits: string;
  decimals: number;
  fee: {
    amount: string;
    unit: string;
    sponsored: boolean;
  };
  memo?: string;
  reference: string;
  idempotencyKey: string;
  preparedAt: string;
  expiresAt: string;
  unsignedXdr?: string;
  unsignedTransactionHex?: string;
  digest: string;
  state: PollarDraftState;
  approval?: {
    actor: string;
    at: string;
    digest: string;
  };
  submission?: {
    claimId: string;
    claimedAt: string;
    hash: string;
  };
  settlement?: {
    hash: string;
    ledgerOrSlot: number;
    confirmedAt: string;
    explorerUrl: string;
  };
  failureReason?: string;
}

export interface PollarReviewPayload {
  draftId: string;
  recipient: string;
  recipientDisplay: string;
  amount: string;
  asset: string;
  feeDisplay: string;
  networkDisplay: string;
  digest: string;
  expiresAt: string;
  requiresPasswordReauth: boolean;
}

export type PollarExecutionMode = "genuine-pollar-sdk" | "testnet-sandbox-fallback";

export interface PollarPaymentReceipt {
  receiptId: string;
  idempotencyKey: string;
  owner: string;
  chain: PollarSupportedChain;
  network: "testnet";
  sender: string;
  recipient: string;
  amount: string;
  asset: string;
  fee: string;
  transactionHash: string;
  timestamp: string;
  explorerUrl: string;
  verified: boolean;
  executionMode: PollarExecutionMode;
  verificationSource: "pollar-tx-status" | "horizon-testnet" | "solana-rpc" | "sandbox-simulation";
}

export interface PollarExecutionResult {
  success: boolean;
  draftId: string;
  transactionHash: string;
  status: "SUCCESS" | "PENDING" | "FAILED";
  chain: PollarSupportedChain;
  ledgerSequence?: number;
  explorerUrl: string;
  executionMode: PollarExecutionMode;
  evidence: {
    liveNetworkSubmitted: boolean;
    verificationSource: "pollar-tx-status" | "horizon-testnet" | "solana-rpc" | "sandbox-simulation";
    details: string;
  };
  receipt?: PollarPaymentReceipt;
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}

/**
 * Validates whether an address is an asset issuer account.
 * Direct payments to asset issuers are blocked to avoid misrouted funds.
 */
export function isIssuerAddress(
  address: string,
  configuredIssuer?: string | null,
): boolean {
  if (!address || typeof address !== "string") return false;
  const trimmed = address.trim();
  return (
    trimmed === STELLAR_TESTNET_USDC_ISSUER ||
    (!!configuredIssuer && trimmed === configuredIssuer.trim())
  );
}

/**
 * Validates a Pollar publishable key.
 *
 * Pollar's official developer dashboard (https://dashboard.pollar.xyz) generates
 * client-side publishable keys prefixed with:
 *   - `pub_testnet_` (for Stellar/Solana testnet environments)
 *   - `pub_live_` (for mainnet environments)
 *   - `pub_` (general publishable prefix)
 *
 * For backwards compatibility with mock transports, unit test fixtures, and earlier
 * Stripe-convention assumptions, `pk_testnet_`, `pk_live_`, and `pk_` are also accepted.
 */
export function isPollarPublishableKey(key: unknown): boolean {
  if (!key || typeof key !== "string") return false;
  const trimmed = key.trim();
  return (
    trimmed.startsWith("pub_testnet_") ||
    trimmed.startsWith("pub_live_") ||
    trimmed.startsWith("pub_") ||
    trimmed.startsWith("pk_testnet_") ||
    trimmed.startsWith("pk_live_") ||
    trimmed.startsWith("pk_")
  );
}

/**
 * Validates any recognized Pollar API key (publishable or secret).
 */
export function isValidPollarKey(key: unknown): boolean {
  if (!key || typeof key !== "string") return false;
  const trimmed = key.trim();
  return (
    isPollarPublishableKey(trimmed) ||
    trimmed.startsWith("sk_testnet_") ||
    trimmed.startsWith("sk_live_") ||
    trimmed.startsWith("sk_") ||
    trimmed.startsWith("sec_")
  );
}

/**
 * Calculates deterministic approval digest binding draft parameters.
 * Mandated by AGUS security invariants: exact re-authentication must verify
 * that the submitted payment corresponds to what the user explicitly reviewed.
 */
export function calculatePollarDraftDigest(params: {
  owner: string;
  sender: string;
  recipient: string;
  amount: string;
  asset: string;
  chain: string;
  feeAmount: string;
  expiresAt: string;
  idempotencyKey: string;
}): string {
  const payload = [
    params.owner,
    params.sender,
    params.recipient,
    params.amount,
    params.asset,
    params.chain,
    params.feeAmount,
    params.expiresAt,
    params.idempotencyKey,
  ].join(":");
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Formats a Stellar explorer URL for a given transaction hash.
 */
export function stellarExplorerTxUrl(txHash: string): string {
  return `${STELLAR_TESTNET_EXPLORER_BASE}/tx/${txHash}`;
}

/**
 * Formats a Stellar explorer URL for a given account public key.
 */
export function stellarExplorerAccountUrl(address: string): string {
  return `${STELLAR_TESTNET_EXPLORER_BASE}/account/${address}`;
}

/**
 * Validates a Stellar public key (G-address).
 * Starts with 'G', 56 characters, base32 encoded.
 */
export function isValidStellarAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  return /^G[A-Z2-7]{55}$/.test(address);
}

/**
 * Converts decimal string to atomic base units using fixed-point precision.
 */
export function toStellarAtoms(amountStr: string, decimals = STELLAR_USDC_DECIMALS): string {
  const parts = amountStr.trim().split(".");
  const whole = parts[0] || "0";
  let frac = parts[1] || "";
  if (frac.length > decimals) {
    frac = frac.slice(0, decimals);
  } else {
    frac = frac.padEnd(decimals, "0");
  }
  const combined = `${whole}${frac}`.replace(/^0+/, "");
  return combined === "" ? "0" : combined;
}

/**
 * Converts atomic base units to decimal string.
 */
export function fromStellarAtoms(atomsStr: string, decimals = STELLAR_USDC_DECIMALS): string {
  const padded = atomsStr.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return frac.length > 0 ? `${whole}.${frac}` : whole;
}
