import { DomainError } from "../errors";
/** No invented consumer-payment endpoints. Paystack merchant payouts remain in
 * their existing adapter and never satisfy this personal-source capability. */
export const externalIntegrationGates = Object.freeze({
  "open-banking-sponsor": {
    enabled: false,
    requires: [
      "sponsor",
      "registered client",
      "authorization server",
      "certificates",
      "scopes",
      "issued endpoints",
    ],
  },
  "remita-consumer": {
    enabled: false,
    requires: [
      "written consumer delegation contract",
      "source-payment scope",
      "issued endpoints",
    ],
  },
  "mono-source-payments": {
    enabled: false,
    requires: ["documented arbitrary-beneficiary consumer source contract"],
  },
  "bridge-usd": {
    enabled: false,
    requires: [
      "Nigerian resident eligibility",
      "KYC",
      "personal freelance/salary scope",
      "issued account access",
    ],
  },
  "paycrest-settlement": {
    enabled: false,
    requires: [
      "sender approval",
      "Solana liquidity",
      "authenticated payout/return evidence",
    ],
  },
});
export function sourceProviderUnavailable(): never {
  throw new DomainError("SOURCE_PAYMENT_PARTNER_NOT_APPROVED", 503, false);
}
