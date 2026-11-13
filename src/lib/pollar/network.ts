/** Protocol constants integrated from AG-POLLAR f992b6f. Never a recipient alias. */
export const STELLAR_TESTNET_HORIZON = "https://horizon-testnet.stellar.org";
export const STELLAR_TESTNET_USDC_ISSUER =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
export const STELLAR_TESTNET_EXPLORER_BASE =
  "https://stellar.expert/explorer/testnet";

export function isIssuerAddress(
  address: string,
  configuredIssuer?: string | null,
) {
  return (
    address === STELLAR_TESTNET_USDC_ISSUER || address === configuredIssuer
  );
}
