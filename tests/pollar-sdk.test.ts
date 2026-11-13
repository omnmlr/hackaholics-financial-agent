/** Official SDK exercised through a mocked HTTP transport. No genuine wallet or transfer claim. */
import { afterEach, expect, it, vi } from "vitest";
import {
  PollarClient,
  createMemoryAdapter,
  POLLAR_CORE_VERSION,
} from "@pollar/core";
import { isStellarTestnetApp } from "../src/components/agus/pollar-safety";
afterEach(() => vi.unstubAllGlobals());
it("initializes the official SDK and reads real SDK configuration and balance methods over a controlled transport", async () => {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push(url);
      if (url.endsWith("/applications/config"))
        return Response.json({
          success: true,
          code: "SDK_APPLICATION_CONFIG",
          content: {
            application: {
              name: "Test transport",
              network: "testnet",
              chains: ["STELLAR"],
            },
            styles: {},
          },
        });
      if (url.includes("/balance"))
        return Response.json({
          success: true,
          code: "SDK_WALLET_BALANCE",
          content: {
            publicKey: "G".repeat(56),
            network: "testnet",
            exists: true,
            balances: [
              {
                code: "USDC",
                issuer: "G".repeat(56),
                balance: "5.0000000",
                available: "5.0000000",
              },
            ],
          },
        });
      throw new Error(`Unexpected SDK request path: ${new URL(url).pathname}`);
    }),
  );
  const sdk = new PollarClient({
    apiKey: "pk_test_mock_transport",
    stellarNetwork: "testnet",
    storage: createMemoryAdapter(),
    logLevel: "silent",
  });
  try {
    await sdk.ready();
    expect(POLLAR_CORE_VERSION).toBe("0.12.0");
    expect(isStellarTestnetApp(await sdk.getAppConfig())).toBe(true);
    const balance = await sdk.getWalletBalance("G".repeat(56), "testnet");
    expect(balance.balances[0].balance).toBe("5.0000000");
    expect(
      calls.some(
        (path) => path === "https://sdk.api.pollar.xyz/v3/applications/config",
      ),
    ).toBe(true);
    expect(
      calls.some((path) => path.includes(`/wallet/${"G".repeat(56)}/balance`)),
    ).toBe(true);
  } finally {
    sdk.destroy();
  }
});
