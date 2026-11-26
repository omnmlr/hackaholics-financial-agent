/** Circle's canonical Solana Devnet test-USDC mint. These assets have no cash
 * value. Never identify a token from its name, symbol, logo or decimal count. */
export const CIRCLE_DEVNET_USDC_MINT =
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const CIRCLE_DEVNET_USDC_DECIMALS = 6;
export const CIRCLE_DEVNET_USDC_SOURCE =
  "https://developers.circle.com/stablecoins/usdc-contract-addresses";

export function devnetTokenLabel(mint: string | null, decimals: number) {
  return mint === CIRCLE_DEVNET_USDC_MINT &&
    decimals === CIRCLE_DEVNET_USDC_DECIMALS
    ? "Circle test USDC (Devnet; no cash value)"
    : "token units";
}
