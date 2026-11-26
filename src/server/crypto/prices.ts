import Decimal from "decimal.js";
import type { z } from "zod";
import type { CryptoHolding } from "../../../packages/contracts/src/crypto";

type Holding = z.infer<typeof CryptoHolding>;
type Valuation = NonNullable<Holding["valuation"]>;
type Symbol = "SOL" | "USDC";
type Quote = Pick<Valuation, "usdPerUnit" | "provider" | "observedAt">;
type QuoteEntry = { quote: Quote | null; expiresAt: number };

const TTL_MS = 60_000;
const RETRY_MS = 15_000;
const Usd = Decimal.clone({ precision: 48 });
const cache = new Map<Symbol, QuoteEntry>();
const pending = new Map<Symbol, Promise<Quote | null>>();

function quoteSymbol(holding: Holding): Symbol | null {
  if (holding.amount.asset.cluster !== "mainnet-beta") return null;
  return holding.symbol === "SOL" || holding.symbol === "USDC"
    ? holding.symbol
    : null;
}

async function readSpot(symbol: Symbol): Promise<Quote | null> {
  try {
    const response = await fetch(
      `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`,
      {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(1800),
      },
    );
    if (!response.ok) return null;
    const { data } = await response.json();
    if (
      data?.base !== symbol ||
      data.currency !== "USD" ||
      typeof data.amount !== "string" ||
      !/^\d{1,8}(?:\.\d{1,12})?$/.test(data.amount) ||
      new Usd(data.amount).lte(0)
    )
      return null;
    return {
      usdPerUnit: data.amount,
      provider: "Coinbase spot",
      observedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function spot(symbol: Symbol) {
  const entry = cache.get(symbol);
  if (entry && entry.expiresAt > Date.now())
    return Promise.resolve(entry.quote);
  const running = pending.get(symbol);
  if (running) return running;
  const query = readSpot(symbol).then((quote) => {
    cache.set(symbol, {
      quote,
      expiresAt: Date.now() + (quote ? TTL_MS : RETRY_MS),
    });
    pending.delete(symbol);
    return quote;
  });
  pending.set(symbol, query);
  return query;
}

export async function priceHoldings(holdings: Holding[]) {
  const symbols = new Set(holdings.flatMap((item) => quoteSymbol(item) ?? []));
  const quotes = new Map(
    await Promise.all(
      [...symbols]
        .sort()
        .map(async (symbol) => [symbol, await spot(symbol)] as const),
    ),
  );
  const items = holdings.map((item) => {
    const symbol = quoteSymbol(item);
    const quote = symbol ? quotes.get(symbol) : null;
    if (!quote) return item;
    const value = new Usd(item.amount.atoms)
      .times(quote.usdPerUnit)
      .div(new Usd(10).pow(item.amount.decimals));
    return { ...item, valuation: { ...quote, valueUsd: value.toFixed() } };
  });
  const subtotal = items.reduce<Decimal | null>((total, { valuation }) => {
    if (!valuation) return total;
    return total ? total.plus(valuation.valueUsd) : new Usd(valuation.valueUsd);
  }, null);
  return {
    holdings: items,
    quotes: [...quotes.values()],
    subtotal: subtotal?.toFixed() ?? null,
  };
}
