import { z } from "zod";

/**
 * Zcash network definition for AGUS.
 * Testnet uses SLIP-44 coin type 1 and network magic 0xfa1a5d01.
 */
export const ZcashNetwork = z.enum(["testnet", "mainnet"]);
export type ZcashNetwork = z.infer<typeof ZcashNetwork>;

export const ZcashPool = z.enum(["orchard", "sapling", "transparent"]);
export type ZcashPool = z.infer<typeof ZcashPool>;

/**
 * Zcash zatoshis: 1 ZEC = 10^8 zatoshis (8 decimal places).
 */
export const ZATOSHIS_PER_ZEC = 100_000_000n;
export const ZIP317_CONVENTIONAL_FEE_ZATOSHIS = 10_000n; // 0.0001 ZEC

export const ZcashAmount = z.strictObject({
  atoms: z.string().regex(/^(0|[1-9][0-9]{0,19})$/),
  currency: z.literal("ZEC"),
  scale: z.literal(8),
  displayAmount: z.string(),
});
export type ZcashAmount = z.infer<typeof ZcashAmount>;

export function zatoshisToZec(atoms: bigint): string {
  if (atoms < 0n) throw new Error("NEGATIVE_ZEC_AMOUNT");
  const whole = atoms / ZATOSHIS_PER_ZEC;
  const fraction = atoms % ZATOSHIS_PER_ZEC;
  if (fraction === 0n) return whole.toString();
  const fracStr = fraction.toString().padStart(8, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

export function zecToZatoshis(val: string): bigint {
  if (!/^(?:0|[1-9]\d{0,7})(\.\d{1,8})?$/.test(val)) {
    throw new Error("INVALID_ZEC_DECIMAL_FORMAT");
  }
  const [whole, fraction = ""] = val.split(".");
  const padded = fraction.padEnd(8, "0");
  return BigInt(whole + padded);
}

/**
 * Structured AGUS memo payload embedded inside the 512-byte encrypted memo field.
 * Binds the on-chain shielded output directly to the AGUS payment request.
 */
export interface AgusMemoPayload {
  magic: "AGUS";
  version: 1;
  requestId: string;
  reference: string;
  digest: string;
}

/**
 * Parsed ZIP 321 Payment Request URI structure.
 */
export interface Zip321PaymentRequest {
  address: string;
  network: ZcashNetwork;
  amountAtoms: string;
  displayAmount: string;
  memo?: string;
  agusMemo?: AgusMemoPayload;
  message?: string;
  label?: string;
  rawUri: string;
}

/**
 * Zcash observation returned from Lightwalletd or chain indexer.
 */
export interface ZcashChainObservation {
  chain: ZcashNetwork;
  endpoint: string;
  chainTipHeight: number;
  chainTipHash: string;
  observedBlockHeight: number;
  observedBlockHash: string;
  confirmations: number;
  txid: string;
  pool: ZcashPool;
  amountAtoms: string;
  memoPayloadHex?: string;
  decryptedMemo?: string;
  isSimulated: boolean;
}

/**
 * Privacy properties guaranteed by the verified Zcash transaction.
 */
export interface ZcashPrivacyAudit {
  pool: ZcashPool;
  isShielded: boolean;
  amountsHiddenOnChain: boolean;
  addressesHiddenOnChain: boolean;
  memoEncryptedOnChain: boolean;
  selectiveDisclosureMechanism:
    | "unified_full_viewing_key"
    | "incoming_viewing_key"
    | "zip326_payment_disclosure"
    | "transparent_fallback";
}

/**
 * Durable, AGUS-compatible settlement receipt for Zcash transactions.
 */
export interface ZcashPaymentReceipt {
  receiptId: string;
  requestId: string;
  reference: string;
  network: ZcashNetwork;
  txid: string;
  blockHeight: number;
  blockHash: string;
  confirmations: number;
  pool: ZcashPool;
  amount: ZcashAmount;
  recipient: string;
  memoMatched: boolean;
  memoDigest: string | null;
  observedAt: string; // ISO datetime
  verification: "chain_finalized" | "simulated" | "unverified";
  privacy: ZcashPrivacyAudit;
}
