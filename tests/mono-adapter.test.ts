/** Sanitized documentation-contract fixtures, not genuine Mono acceptance. */
import { expect, it, vi } from "vitest";
import { MonoDataAdapter } from "../src/server/banking/mono";
const id = "0123456789abcdef01234567";
it("exchanges only the temporary authorization code and retains an account-ID credential lifecycle", async () => {
  const transport = vi.fn(async () =>
    Response.json({ status: "successful", data: { id } }),
  );
  const adapter = new MonoDataAdapter(
    "sandbox",
    "fixture-contract-secret",
    undefined,
    transport,
  );
  expect(await adapter.exchange("temporary-code")).toEqual({
    credential: { kind: "mono-account-id", accountId: id },
    expiresAt: null,
  });
  expect(transport).toHaveBeenCalledWith(
    "https://api.withmono.com/v2/accounts/auth",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ code: "temporary-code" }),
      redirect: "error",
      headers: expect.objectContaining({
        "mono-sec-key": "fixture-contract-secret",
      }),
    }),
  );
});
it("parses documented account and paginated transaction responses without inventing available/ledger semantics", async () => {
  const transport = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes("transactions"))
      return Response.json({
        status: "successful",
        data: [
          {
            id: "tx-fixture",
            amount: 500,
            type: "debit",
            date: "2026-11-10T00:00:00.000Z",
            narration: "Sanitized fixture",
          },
        ],
        meta: { next: `https://api.withmono.com/v2/${id}/transactions?page=2` },
      });
    return Response.json({
      status: "successful",
      data: {
        account: { id, name: "Fixture", currency: "NGN", balance: 22644 },
      },
    });
  });
  const adapter = new MonoDataAdapter(
      "sandbox",
      "fixture-contract-secret",
      undefined,
      transport,
    ),
    credential = { kind: "mono-account-id" as const, accountId: id };
  expect(await adapter.accounts(credential)).toEqual([
    { id, displayName: "Fixture", currency: "NGN", scale: 2 },
  ]);
  expect(await adapter.balances(credential, id)).toMatchObject({
    available: null,
    ledger: null,
    reported: { atoms: "22644", currency: "NGN", scale: 2 },
  });
  const page = await adapter.transactions(credential, id);
  expect(page.nextCursor).toBe("2");
  expect(page.data[0].amountAtoms).toBe("500");
  expect(page.complete).toBe(false);
});
it("uses the documented reauth initiation and unlink operations with no arbitrary URL following", async () => {
  const transport = vi.fn(async (url: string | URL | Request) =>
    Response.json({
      status: "successful",
      data: String(url).endsWith("/initiate")
        ? { mono_url: "https://link.mono.co/fixture" }
        : {},
    }),
  );
  const adapter = new MonoDataAdapter(
      "sandbox",
      "fixture-contract-secret",
      undefined,
      transport,
    ),
    credential = { kind: "mono-account-id" as const, accountId: id };
  await adapter.reauthorize(credential, {
    state: "fixture-state",
    redirectUri: "https://fixture.invalid/callback",
  });
  await adapter.revoke(credential);
  expect(transport.mock.calls.map((c) => String(c[0]))).toEqual([
    "https://api.withmono.com/v2/accounts/initiate",
    `https://api.withmono.com/v2/accounts/${id}/unlink`,
  ]);
  expect(await adapter.health()).toMatchObject({
    linking: false,
    sourcePayments: false,
  });
});
it("rejects unsafe numeric amounts, foreign pagination URLs and rate limits", async () => {
  const credential = { kind: "mono-account-id" as const, accountId: id };
  const unsafe = new MonoDataAdapter(
    "sandbox",
    "fixture-contract-secret",
    undefined,
    async () =>
      Response.json({
        status: "successful",
        data: {
          account: {
            id,
            name: "Fixture",
            currency: "NGN",
            balance: Number.MAX_SAFE_INTEGER + 1,
          },
        },
      }),
  );
  await expect(unsafe.balances(credential, id)).rejects.toThrow();
  const foreign = new MonoDataAdapter(
    "sandbox",
    "fixture-contract-secret",
    undefined,
    async () =>
      Response.json({
        status: "successful",
        data: [],
        meta: { next: "https://attacker.invalid/?page=2" },
      }),
  );
  await expect(foreign.transactions(credential, id)).rejects.toMatchObject({
    code: "MONO_CURSOR_INVALID",
  });
  const limited = new MonoDataAdapter(
    "sandbox",
    "fixture-contract-secret",
    undefined,
    async () => new Response("", { status: 429 }),
  );
  await expect(limited.accounts(credential)).rejects.toMatchObject({
    code: "MONO_RATE_LIMITED",
    retryable: true,
  });
});
