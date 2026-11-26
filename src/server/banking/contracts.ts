import type {
  AtomicMoney,
  FixtureScenario,
} from "../../../packages/contracts/src";
export type ProviderEnvironment = "fixture" | "sandbox" | "live";
export type GrantCredential =
  | { kind: "fixture-grant"; id: string }
  | { kind: "mono-account-id"; accountId: string };
export type ProviderAccount = {
  id: string;
  currency: string;
  scale: number;
  displayName: string;
};
export type ProviderTransaction = {
  id: string;
  revision: number;
  amountAtoms: string;
  direction: "debit" | "credit";
  status: "posted" | "reversed" | "pending";
  occurredAt: string;
  description: string;
};
export interface AccountDataProvider {
  readonly id: string;
  readonly environment: ProviderEnvironment;
  readonly simulated: boolean;
  initiate(input: {
    state: string;
    institutionId: string;
    redirectUri: string;
  }): Promise<{ hostedUrl: string }>;
  exchange(
    code: string,
  ): Promise<{ credential: GrantCredential; expiresAt: string | null }>;
  accounts(credential: GrantCredential): Promise<ProviderAccount[]>;
  balances(
    credential: GrantCredential,
    account: string,
  ): Promise<{
    available: AtomicMoney | null;
    ledger: AtomicMoney | null;
    reported?: AtomicMoney;
    observedAt: string;
  }>;
  transactions(
    credential: GrantCredential,
    account: string,
    cursor?: string,
  ): Promise<{
    data: ProviderTransaction[];
    nextCursor: string | null;
    complete: boolean;
    observedAt: string;
  }>;
  reauthorize(
    credential: GrantCredential,
    input: { state: string; redirectUri: string },
  ): Promise<{ hostedUrl: string }>;
  revoke(credential: GrantCredential): Promise<void>;
  health(): Promise<{
    linking: boolean;
    balances: boolean;
    history: boolean;
    sourcePayments: false;
  }>;
}
export type SourceInstruction = {
  sourceAccountId: string;
  providerAccountId: string;
  grantId: string;
  grantRevision: number;
  beneficiaryId: string;
  beneficiaryIdentityHash: string;
  amount: AtomicMoney;
  fee: AtomicMoney;
  feeQuoteVersion: string;
  expiresAt: string;
  provider: string;
  environment: ProviderEnvironment;
  testScenario?: FixtureScenario;
};
export type PaymentObservation = {
  status: "not_found" | "pending" | "succeeded" | "failed" | "reversed";
  observedAt: string;
  simulated: boolean;
  providerReference: string;
};
export interface SourcePaymentProvider {
  readonly id: string;
  readonly environment: ProviderEnvironment;
  readonly simulated: boolean;
  quote(input: {
    amount: AtomicMoney;
    sourceAccountId: string;
  }): Promise<{ fee: AtomicMoney; version: string; expiresAt: string }>;
  submit(
    reference: string,
    instruction: SourceInstruction,
  ): Promise<PaymentObservation>;
  verify(reference: string): Promise<PaymentObservation>;
}
export interface BeneficiaryDirectoryProvider {
  readonly id: string;
  readonly environment: ProviderEnvironment;
  readonly simulated: boolean;
  banks(): Promise<{ code: string; name: string }[]>;
  verify(
    bankCode: string,
    accountNumber: string,
  ): Promise<{ name: string; observedAt: string }>;
}
