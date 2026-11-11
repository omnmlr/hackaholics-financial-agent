import { DomainError } from "../errors";
import type {
  ReceivingPartner,
  ConversionPartner,
  BlockchainDeliveryPartner,
  NgnSettlementPartner,
  ReturnsPartner,
} from "./contracts";
const unavailable = async (): Promise<never> => {
  throw new DomainError("USD_PARTNER_NOT_ACCEPTED", 503, false);
};
/** Vendor selection and commercial entitlement remain external gates. No
 * undocumented Bridge/Paycrest HTTP endpoints or automatic paid calls. */
export const unavailablePartners: {
  receiving: ReceivingPartner;
  conversion: ConversionPartner;
  delivery: BlockchainDeliveryPartner;
  settlement: NgnSettlementPartner;
  returns: ReturnsPartner;
} = {
  receiving: {
    eligibility: unavailable,
    issueAccount: unavailable,
    incoming: unavailable,
  },
  conversion: { quote: unavailable, submit: unavailable, read: unavailable },
  delivery: { request: unavailable, read: unavailable },
  settlement: { quote: unavailable, submit: unavailable, read: unavailable },
  returns: { request: unavailable, read: unavailable },
};
export function usdCapabilities() {
  return {
    enabled: false,
    purpose: "personal freelance/salary receipts for Nigerian residents",
    receivingEnabled: false,
    conversionEnabled: false,
    blockchainDeliveryEnabled: false,
    ngnSettlementEnabled: false,
    returnsEnabled: false,
    acceptedPartners: [],
    fixtureWorkflowAvailable:
      (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
  };
}
