import { describe, expect, it } from "vitest";
import { createApiClient } from "../packages/api-client/src";
import {
  createCryptoFixtureTransport,
  cryptoFixtureScenarios,
} from "../packages/api-client/fixtures/crypto";
import {
  CryptoActivityPage,
  CryptoAddress,
  CryptoPortfolio,
  CryptoWalletPage,
} from "../packages/contracts/src/crypto";

describe("AGUS Crypto generated client", () => {
  it.each(cryptoFixtureScenarios)(
    "validates the %s reads and atom totals",
    async (scenario) => {
      const api = createApiClient(
        "https://fixture.invalid",
        createCryptoFixtureTransport(scenario),
      );
      const params = { query: { cluster: "devnet" as const } };
      const wallets = CryptoWalletPage.parse(
        (await api.GET("/api/v1/crypto/wallets", { params })).data,
      );
      expect(wallets.items).toHaveLength(3);
      expect(wallets.items[0].routes).toHaveLength(2);
      const portfolio = CryptoPortfolio.parse(
        (await api.GET("/api/v1/crypto/portfolio", { params })).data,
      );
      const total = portfolio.holdings.reduce(
        (sum, holding) => sum + BigInt(holding.amount.atoms),
        0n,
      );
      expect(total).toBe(
        scenario === "outside_inflow_replay" ? 130_000_000n : 125_000_000n,
      );
      const activity = CryptoActivityPage.parse(
        (await api.GET("/api/v1/crypto/activity", { params })).data,
      );
      if (scenario === "internal_transfer")
        expect(
          activity.items.map(({ classification }) => classification),
        ).toEqual(["internal"]);
    },
  );
  it("rejects addresses that do not decode to 32 bytes", () => {
    expect(CryptoAddress.safeParse("1".repeat(33)).success).toBe(false);
  });
});
