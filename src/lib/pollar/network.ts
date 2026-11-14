/**
 * Protocol constants and network helpers for Pollar Stellar integration.
 * Shared boundary between Pollar SDK adapters and AGUS conversational payments.
 */
import {
  STELLAR_TESTNET_HORIZON,
  STELLAR_TESTNET_USDC_ISSUER,
  STELLAR_TESTNET_EXPLORER_BASE,
  CONTROLLED_TEST_RECIPIENT_STELLAR,
  isValidStellarAddress,
  isIssuerAddress,
  isPollarPublishableKey,
  isValidPollarKey,
} from "./contracts";

export {
  STELLAR_TESTNET_HORIZON,
  STELLAR_TESTNET_USDC_ISSUER,
  STELLAR_TESTNET_EXPLORER_BASE,
  CONTROLLED_TEST_RECIPIENT_STELLAR,
  isValidStellarAddress,
  isIssuerAddress,
  isPollarPublishableKey,
  isValidPollarKey,
};

/**
 * Resolves the active Pollar configuration from environment variables.
 *
 * Resolves both standard `pub_testnet_...` (official Pollar dashboard)
 * and legacy/mock `pk_...` keys. Checks both `NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY`
 * and `NEXT_PUBLIC_POLLAR_API_KEY`.
 */
export function pollarConfiguration() {
  const key =
    process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_POLLAR_API_KEY ??
    "";
  const issuer =
    process.env.POLLAR_TESTNET_USDC_ISSUER ?? STELLAR_TESTNET_USDC_ISSUER;
  const isKeyValid = isPollarPublishableKey(key);
  const isIssuerValid = isValidStellarAddress(issuer);

  return {
    configured: isKeyValid && isIssuerValid,
    publicKey: isKeyValid ? key.trim() : null,
    issuer: isIssuerValid ? issuer.trim() : null,
    sdkVersion: "0.12.0",
    network: "testnet" as const,
  };
}
