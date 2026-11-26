import { fixtureAccounts } from "./fixture";
import { DomainError } from "../errors";
import type { AccountDataProvider } from "./contracts";
export function fixtureAccountProvider(
  scenario = "normal",
): AccountDataProvider {
  const readable = () => {
    if (scenario === "outage")
      throw new DomainError("FIXTURE_PROVIDER_OUTAGE", 503, true);
    if (scenario === "rate_limited")
      throw new DomainError("FIXTURE_RATE_LIMITED", 429, true);
    if (scenario === "data_delayed")
      throw new DomainError("FIXTURE_DATA_PENDING", 409, true);
  };
  return {
    ...fixtureAccounts,
    async exchange(code) {
      if (scenario === "outage")
        throw new DomainError("FIXTURE_PROVIDER_OUTAGE", 503, true);
      const result = await fixtureAccounts.exchange(code);
      return {
        ...result,
        expiresAt:
          scenario === "grant_expired"
            ? new Date(Date.now() - 1000).toISOString()
            : result.expiresAt,
      };
    },
    async balances(...args) {
      readable();
      return fixtureAccounts.balances(...args);
    },
    async transactions(...args) {
      readable();
      const result = await fixtureAccounts.transactions(...args);
      return scenario === "partial_history"
        ? { ...result, nextCursor: null, complete: false }
        : result;
    },
    async revoke(credential) {
      if (scenario === "revocation_outage" || scenario === "outage")
        throw new DomainError("FIXTURE_REVOCATION_PENDING", 503, true);
      await fixtureAccounts.revoke(credential);
    },
    async health() {
      return {
        linking: scenario !== "outage",
        balances: !["outage", "rate_limited", "data_delayed"].includes(
          scenario,
        ),
        history: !["outage", "rate_limited", "data_delayed"].includes(scenario),
        sourcePayments: false,
      };
    },
  };
}
