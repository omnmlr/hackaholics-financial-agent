import Decimal from "decimal.js";
import { z } from "zod";
import type { CryptoQuoteInput } from "../../../packages/contracts/src/crypto";
import { MAX_U64 } from "../../lib/solana/money";
import { DomainError, invariant } from "../errors";
import { assetSymbol, sol, token, type Amount } from "./portfolio";
import { SOLANA_NETWORKS } from "./rpc";

type Request = Pick<
  z.infer<typeof CryptoQuoteInput>,
  "input" | "output" | "slippageBps"
>;
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";
const CLUSTER = "mainnet-beta";
const USDC = SOLANA_NETWORKS[CLUSTER].usdc;
const CACHE_SIZE = 32;
const TTL_MS = 15_000;
const U64 = z
  .string()
  .refine((value) => /^[1-9]\d{0,19}$/.test(value) && BigInt(value) <= MAX_U64);
const WireQuote = z.object({
  inputMint: z.string(),
  outputMint: z.string(),
  inAmount: U64,
  outAmount: U64,
  otherAmountThreshold: U64,
  swapMode: z.literal("ExactIn"),
  slippageBps: z.number().int(),
  feeBps: z.number().int().min(0).max(10_000),
  feeMint: z.string(),
  priceImpact: z.number().min(-10000).max(10000).nullable().optional(),
  transaction: z.null(),
  taker: z.null(),
});

function mint(asset: Amount["asset"]) {
  if (asset.cluster !== CLUSTER) return null;
  if (asset.kind === "sol") return WRAPPED_SOL;
  return assetSymbol({ asset, atoms: "0", decimals: 6 }) === "USDC"
    ? USDC
    : null;
}

function amount(mint: string, atoms: string): Amount {
  return mint === WRAPPED_SOL
    ? sol(CLUSTER, BigInt(atoms))
    : token(CLUSTER, USDC, atoms, 6);
}

async function readQuote(
  inputMint: string,
  outputMint: string,
  atoms: string,
  slippageBps: number,
) {
  const url = new URL("https://api.jup.ag/swap/v2/order");
  url.search = new URLSearchParams({
    inputMint,
    outputMint,
    amount: atoms,
    slippageBps: String(slippageBps),
  }).toString();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(2500),
    });
    if (response.status === 429)
      throw new DomainError("RATE_LIMITED", 429, true);
    if (!response.ok) throw new DomainError("PROVIDER_UNAVAILABLE", 503, true);
    const parsed = WireQuote.safeParse(await response.json());
    invariant(parsed.success, "PROVIDER_UNAVAILABLE", 503);
    const quoted = parsed.data;
    const out = BigInt(quoted.outAmount);
    const minOut = BigInt(quoted.otherAmountThreshold);
    invariant(
      quoted.inputMint === inputMint &&
        quoted.outputMint === outputMint &&
        quoted.inAmount === atoms &&
        quoted.slippageBps === slippageBps &&
        minOut <= out &&
        minOut >= (out * BigInt(10000 - slippageBps)) / 10_000n &&
        [inputMint, outputMint].includes(quoted.feeMint),
      "PROVIDER_UNAVAILABLE",
      503,
    );
    const observedAt = Date.now();
    return {
      venue: "jupiter" as const,
      adapterVersion: "swap-v2-order",
      input: amount(inputMint, atoms),
      expectedOut: amount(outputMint, quoted.outAmount),
      minOut: amount(outputMint, quoted.otherAmountThreshold),
      slippageBps,
      providerFeeBps: quoted.feeBps,
      providerFeeAsset: amount(quoted.feeMint, "0").asset,
      priceImpactBps:
        quoted.priceImpact == null
          ? null
          : new Decimal(quoted.priceImpact).times(100).ceil().toNumber(),
      observedAt: new Date(observedAt).toISOString(),
      expiresAt: new Date(observedAt + TTL_MS).toISOString(),
    };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("PROVIDER_UNAVAILABLE", 503, true);
  }
}

type Quote = Awaited<ReturnType<typeof readQuote>>;
const cache = new Map<string, Quote>();
const pending = new Map<string, Promise<Quote>>();
let nextRequestAt = 0;

/** Read-only, address-free market quote. A quote here cannot authorize execution. */
export async function quoteJupiter(request: Request) {
  const { input, output, slippageBps } = request;
  const inputMint = mint(input.asset);
  const outputMint = mint(output);
  invariant(
    inputMint &&
      outputMint &&
      inputMint !== outputMint &&
      input.decimals === (inputMint === WRAPPED_SOL ? 9 : 6),
    "UNSUPPORTED_ASSET",
    422,
  );
  invariant(
    U64.safeParse(input.atoms).success &&
      Number.isInteger(slippageBps) &&
      slippageBps >= 1 &&
      slippageBps <= 300,
    "INVALID_INPUT",
    400,
  );
  const key = [inputMint, outputMint, input.atoms, slippageBps].join(":");
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && Date.parse(cached.expiresAt) > now) return cached;
  const running = pending.get(key);
  if (running) return running;
  invariant(now >= nextRequestAt && pending.size === 0, "RATE_LIMITED", 429);
  // Jupiter's keyless limit is one request every two seconds.
  nextRequestAt = now + 2000;
  const query = readQuote(inputMint, outputMint, input.atoms, slippageBps)
    .then((result) => {
      if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
      cache.set(key, result);
      return result;
    })
    .finally(() => pending.delete(key));
  pending.set(key, query);
  return query;
}
