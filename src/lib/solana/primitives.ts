/** Devnet public-chain records only. No private key or wallet credential belongs here. */
export const DEVNET_RPC = "https://api.devnet.solana.com" as const;
export const DEVNET_GENESIS =
  "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as const;
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
