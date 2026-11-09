/** Devnet public-chain records only. No private key or wallet credential belongs here. */
export const DEVNET_RPC = "https://api.devnet.solana.com" as const;
export const DEVNET_GENESIS =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as const;
export type Asset = "SOL" | "SPL";
export type DraftState =
  | "prepared"
  | "approved"
  | "submitting"
  | "submitted"
  | "unknown"
  | "confirmed"
  | "finalized"
  | "failed"
  | "expired"
  | "cancelled";
export type PrepareTransfer = {
  sender: string;
  recipient: string;
  asset: Asset;
  /** Decimal text only, never a JS number. */
  amount: string;
  mint?: string;
};
export type SolanaDraft = {
  id: string;
  owner: string;
  revision: number;
  network: "devnet";
  rpcEndpoint: typeof DEVNET_RPC;
  genesisHash: typeof DEVNET_GENESIS;
  state: DraftState;
  sender: string;
  recipient: string;
  asset: Asset;
  mint: string | null;
  decimals: number;
  amount: string;
  amountAtoms: string;
  sourceTokenAccount: string | null;
  recipientTokenAccount: string | null;
  createsRecipientTokenAccount: boolean;
  feeLamports: string;
  estimatedRentLamports: string;
  totalSolRequiredLamports: string;
  blockhash: string;
  lastValidBlockHeight: number;
  preparedAt: string;
  expiresAt: string;
  /** Legacy @solana/web3.js Transaction serialization; wallet signs exactly this. */
  unsignedTransactionBase64: string;
  messageBase64: string;
  messageDigest: string;
  /** Binds owner, identity, exact message, amount, fee/rent review and expiry. */
  digest: string;
  approval: { actor: string; at: string; digest: string } | null;
  submission: { claimId: string; claimedAt: string; signature: string } | null;
  confirmation: {
    slot: number;
    at: string;
    commitment: "confirmed" | "finalized";
    feeLamports: string;
  } | null;
  failureCode: string | null;
};
export type WalletSnapshot = {
  network: "devnet";
  rpcEndpoint: typeof DEVNET_RPC;
  genesisHash: typeof DEVNET_GENESIS;
  wallet: string;
  fetchedAt: string;
  sol: { lamports: string; amount: string; decimals: 9 };
  tokens: {
    mint: string;
    decimals: number;
    amountAtoms: string;
    amount: string;
    accounts: { address: string; amountAtoms: string; frozen: boolean }[];
  }[];
};
export type DraftEvent = {
  action: string;
  at: string;
  details?: Record<string, string | number | boolean | null>;
};
export interface DraftStore {
  create(draft: SolanaDraft, event: DraftEvent): Promise<void>;
  get(owner: string, id: string): Promise<SolanaDraft | null>;
  list(owner: string): Promise<SolanaDraft[]>;
  /** Atomic compare-and-swap and event commit. Never runs network effects. */
  transition(
    previous: SolanaDraft,
    next: SolanaDraft,
    event: DraftEvent,
  ): Promise<boolean>;
}
export class SolanaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "SolanaError";
  }
}
export function requireDevnet() {
  if (process.env.AGUS_SOLANA_DEVNET_ENABLED !== "true")
    throw new SolanaError("DEVNET_DISABLED", "Solana devnet is disabled", 503);
  if ((process.env.PAYMENT_MODE ?? "fixture") === "live")
    throw new SolanaError(
      "LIVE_FORBIDDEN",
      "Devnet is unavailable in live payment mode",
      403,
    );
}
