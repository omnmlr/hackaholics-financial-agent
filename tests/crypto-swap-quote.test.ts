import { afterEach, expect, it, vi } from "vitest";
import { sol, token } from "../src/server/crypto/portfolio";
import { SOLANA_NETWORKS } from "../src/server/crypto/rpc";
import { quoteJupiter } from "../src/server/crypto/swap-quotes";

const cluster = "mainnet-beta";
const solMint = "So11111111111111111111111111111111111111112";
const usdc = SOLANA_NETWORKS[cluster].usdc;
const request = {
  input: sol(cluster, 1_000_000n),
  output: token(cluster, usdc, "0", 6).asset,
  slippageBps: 50,
};
const wire = {
  inputMint: solMint,
  outputMint: usdc,
  inAmount: "1000000",
  outAmount: "68925",
  otherAmountThreshold: "68580",
  swapMode: "ExactIn",
  slippageBps: 50,
  feeBps: 2,
  feeMint: solMint,
  priceImpact: 0.01232,
  transaction: null,
  taker: null,
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("normalizes a fixed Mainnet pair quote and never emits wallet or transaction data", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2000-01-01T00:00:00Z"));
  const fetcher = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json(wire));
  const [first, duplicate] = await Promise.all([
    quoteJupiter(request),
    quoteJupiter(request),
  ]);
  expect(first).toEqual(duplicate);
  expect(first).toMatchObject({
    input: { atoms: "1000000" },
    expectedOut: { atoms: "68925", decimals: 6 },
    minOut: { atoms: "68580" },
    slippageBps: 50,
    priceImpactBps: 2,
    providerFeeBps: 2,
    providerFeeAsset: sol(cluster, 0n).asset,
  });
  expect(
    new URL(String(fetcher.mock.calls[0][0])).searchParams.toString(),
  ).toBe(
    new URLSearchParams({
      inputMint: solMint,
      outputMint: usdc,
      amount: "1000000",
      slippageBps: "50",
    }).toString(),
  );
  expect(first).not.toHaveProperty("transaction");
  await expect(
    quoteJupiter({ ...request, input: sol(cluster, 2_000_000n) }),
  ).rejects.toThrow("RATE_LIMITED");
  await expect(
    quoteJupiter({ ...request, input: sol("devnet", 1_000_000n) }),
  ).rejects.toThrow("UNSUPPORTED_ASSET");
  await expect(
    quoteJupiter({
      ...request,
      input: { ...request.input, atoms: "not an amount" },
    }),
  ).rejects.toThrow("INVALID_INPUT");
  await expect(quoteJupiter({ ...request, slippageBps: 1000 })).rejects.toThrow(
    "INVALID_INPUT",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);

  vi.advanceTimersByTime(16_000);
  fetcher.mockImplementationOnce(async () =>
    Response.json({ ...wire, otherAmountThreshold: "68579" }),
  );
  await expect(quoteJupiter(request)).rejects.toThrow("PROVIDER_UNAVAILABLE");
  vi.advanceTimersByTime(2001);
  fetcher.mockImplementationOnce(async () =>
    Response.json({ ...wire, transaction: "unsigned-bytes" }),
  );
  await expect(quoteJupiter(request)).rejects.toThrow("PROVIDER_UNAVAILABLE");
  vi.advanceTimersByTime(2001);
  fetcher.mockImplementationOnce(
    async () => new Response(null, { status: 429 }),
  );
  await expect(quoteJupiter(request)).rejects.toThrow("RATE_LIMITED");
});

it.skipIf(process.env.AGUS_CRYPTO_LIVE_SWAP_QUOTE !== "true")(
  "reads a live keyless Jupiter quote without transaction authority",
  async () => {
    const result = await quoteJupiter(request);
    expect(result.expectedOut.asset).toEqual(request.output);
    expect(BigInt(result.minOut.atoms)).toBeGreaterThan(0n);
    expect(result.slippageBps).toBe(50);
    console.info(JSON.stringify(result));
  },
);
