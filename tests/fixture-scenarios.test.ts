import { expect, it } from "vitest";
import { fixtureAccountProvider } from "../src/server/banking/fixture-scenarios";
const credential = { kind: "fixture-grant" as const, id: "fixture-grant" };
it.each([
  ["outage", "FIXTURE_PROVIDER_OUTAGE"],
  ["rate_limited", "FIXTURE_RATE_LIMITED"],
  ["data_delayed", "FIXTURE_DATA_PENDING"],
])(
  "exposes explicit simulated %s account-data failures",
  async (scenario, code) => {
    const provider = fixtureAccountProvider(scenario);
    expect(provider.simulated).toBe(true);
    expect(provider.environment).toBe("fixture");
    await expect(
      provider.balances(credential, "fixture-grant:current"),
    ).rejects.toMatchObject({ code, retryable: true });
    expect((await provider.health()).balances).toBe(false);
  },
);
it("models partial history, expired grants and failed provider revocation without enabling source-bank access", async () => {
  const partial = await fixtureAccountProvider("partial_history").transactions(
    credential,
    "fixture-grant:current",
  );
  expect(partial.complete).toBe(false);
  expect(partial.nextCursor).toBeNull();
  const expired = await fixtureAccountProvider("grant_expired").exchange(
    "fixture-consent-approved",
  );
  expect(Date.parse(expired.expiresAt!)).toBeLessThan(Date.now());
  await expect(
    fixtureAccountProvider("revocation_outage").revoke(credential),
  ).rejects.toMatchObject({ code: "FIXTURE_REVOCATION_PENDING" });
});
