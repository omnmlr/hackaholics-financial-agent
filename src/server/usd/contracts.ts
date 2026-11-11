import type { AtomicMoney } from "../../../packages/contracts/src";
/** Partner ports, not a claim that a particular vendor supports this product.
 * Each segment requires its own issued access and acceptance evidence. */
export type Context = {
  customerReference: string;
  environment: "sandbox" | "live";
  idempotencyKey: string;
};
export type Observation = {
  provider: string;
  reference: string;
  observedAt: string;
  simulated: false;
  status: "pending" | "unknown" | "succeeded" | "failed" | "reversed";
};
export interface ReceivingPartner {
  eligibility(input: {
    residency: "NG";
    purpose: "freelance" | "salary";
    customerReference: string;
  }): Promise<{
    eligible: boolean;
    evidenceReference: string;
    observedAt: string;
  }>;
  issueAccount(context: Context): Promise<{
    reference: string;
    status: "pending" | "issued" | "rejected";
    currency: "USD";
    details: Record<string, string>;
  }>;
  incoming(
    context: Context,
    cursor?: string,
  ): Promise<{
    entries: Array<
      Observation & { amount: AtomicMoney; purpose: "freelance" | "salary" }
    >;
    nextCursor: string | null;
    complete: boolean;
  }>;
}
export type ConversionTerms = {
  sourceReference: string;
  input: AtomicMoney;
  output: AtomicMoney;
  fee: AtomicMoney;
  quoteReference: string;
  expiresAt: string;
  destination: { network: "solana"; address: string; mint: string };
};
export interface ConversionPartner {
  quote(
    context: Context,
    input: {
      sourceReference: string;
      amount: AtomicMoney;
      destination: ConversionTerms["destination"];
    },
  ): Promise<ConversionTerms>;
  submit(context: Context, terms: ConversionTerms): Promise<Observation>;
  read(context: Context, reference: string): Promise<Observation>;
}
export interface BlockchainDeliveryPartner {
  request(
    context: Context,
    input: {
      conversionReference: string;
      amount: AtomicMoney;
      destination: ConversionTerms["destination"];
    },
  ): Promise<Observation>;
  read(
    context: Context,
    reference: string,
  ): Promise<
    Observation & {
      signature: string | null;
      commitment: "finalized" | "confirmed" | null;
    }
  >;
}
export interface NgnSettlementPartner {
  quote(
    context: Context,
    input: {
      deliveryReference: string;
      beneficiaryReference: string;
      amount: AtomicMoney;
    },
  ): Promise<{
    reference: string;
    input: AtomicMoney;
    output: AtomicMoney;
    fee: AtomicMoney;
    expiresAt: string;
  }>;
  submit(context: Context, quoteReference: string): Promise<Observation>;
  read(
    context: Context,
    reference: string,
  ): Promise<Observation & { bankCreditEvidenceReference: string | null }>;
}
export interface ReturnsPartner {
  request(
    context: Context,
    input: {
      originalReference: string;
      amount: AtomicMoney;
      reasonCode: string;
    },
  ): Promise<Observation>;
  read(context: Context, reference: string): Promise<Observation>;
}
