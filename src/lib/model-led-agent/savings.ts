import Decimal from "decimal.js";
import { z } from "zod";
import { IdSchema } from "../financial-data/contracts";
import { SavingsArgs } from "./calculate";

export const SavingsMemorySchema = z.strictObject({
  target: SavingsArgs.shape.target,
  contribution: SavingsArgs.shape.contribution,
  cadence: SavingsArgs.shape.cadence,
  starting: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("amount"),
      value: SavingsArgs.shape.startingAmount,
    }),
    z.strictObject({
      kind: z.literal("balance"),
      accountId: IdSchema,
      field: z.enum(["available", "current"]),
    }),
  ]),
});
export type SavingsMemory = z.infer<typeof SavingsMemorySchema>;
export const SavingsRequestSchema = SavingsArgs.safeExtend({
  startingBalance: z.enum(["available", "current"]).optional(),
});

const ones: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const scales: Record<string, number> = {
  h: 100,
  hundred: 100,
  k: 1000,
  thousand: 1000,
  m: 1000000,
  million: 1000000,
  billion: 1000000000,
};
const word = `(?:${Object.keys(ones).join("|")}|hundred|thousand|million|billion)`;
const quantities = new RegExp(
  `(?<![\\w.])(?:₦\\s*|NGN\\s*)?(?:\\d[\\d,]*(?:\\.\\d+)?\\s*(?:hundred|thousand|million|billion|[hkm]\\b)?|${word}(?:[ -]+(?:and[ -]+)?${word})*)(?:\\s*naira)?(?![\\w.])`,
  "gi",
);
export function moneyQuantities(text: string) {
  return [...text.matchAll(quantities)].flatMap((m) => {
    const normalized = m[0]
      .toLowerCase()
      .replace(/₦|ngn|naira|,/g, "")
      .trim();
    let amount: number;
    const numeric = normalized.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
    if (numeric)
      amount = new Decimal(numeric[1]).mul(scales[numeric[2]] ?? 1).toNumber();
    else {
      let sum = 0,
        part = 0;
      for (const token of normalized.split(/[ -]+/)) {
        if (token === "and") continue;
        if (token in ones) part += ones[token];
        else if (token === "hundred") part = (part || 1) * 100;
        else if (token in scales) {
          sum += (part || 1) * scales[token];
          part = 0;
        }
      }
      amount = sum + part;
    }
    return Number.isFinite(amount) && amount >= 0 && amount <= 1e12
      ? [{ amount, index: m.index!, end: m.index! + m[0].length, text: m[0] }]
      : [];
  });
}
const cadencePattern =
  /\b(?:daily|weekly|monthly|yearly|annually|(?:every|each|per|a)\s+(?:day|week|month|year))\b/i;
function cadence(text: string): SavingsMemory["cadence"] | undefined {
  const match = text.match(cadencePattern)?.[0];
  return match
    ? /day|daily/i.test(match)
      ? "days"
      : /week/i.test(match)
        ? "weeks"
        : /month/i.test(match)
          ? "months"
          : "years"
    : undefined;
}

/** Validates a model-selected savings tool, not an intent router. Explicit roles
 * and cadence are checked independently before any arithmetic is executed.
 * Unsupported/ambiguous wording asks for figures instead of trusting a reviewer. */
export function checkedSavings(
  raw: unknown,
  text: string,
  prior: SavingsMemory | undefined,
  accountIds: string[],
) {
  const args = SavingsRequestSchema.parse(raw);
  const values = moneyQuantities(text);
  let target = /\bmillionaire\b/i.test(text) ? 1000000 : undefined;
  let contribution: number | undefined, starting: number | undefined;
  let unresolved = false;
  for (const q of values) {
    const before = text.slice(0, q.index).toLowerCase(),
      after = text.slice(q.end).toLowerCase();
    // Time quantities are not money, even if a plausible numeric formula exists.
    if (
      /^\s*(?:hours?|minutes?|hrs?)\b/.test(after) ||
      (/h$/i.test(q.text.trim()) &&
        /\b(?:time|hours?|work|study)\b/i.test(text))
    ) {
      unresolved = true;
      continue;
    }
    if (
      /\b(?:start(?:ing)?(?:\s+(?:from|with|at))?|already (?:have|saved)|from|saved up)\s*(?:₦|ngn)?\s*$/i.test(
        before,
      )
    )
      starting = q.amount;
    else if (
      /\b(?:until|till|reach|target(?:\s+(?:of|is))?|goal(?:\s+(?:of|is))?|to(?:\s+have)?)\s*(?:i\s+(?:have|get)|of)?\s*(?:₦|ngn)?\s*$/i.test(
        before,
      ) ||
      /^\s*(?:goal|target)\b/.test(after)
    )
      target = q.amount;
    else if (
      cadencePattern.test(after.slice(0, 28)) ||
      /\b(?:save|saving|saved|deposit|contribute|contribution|make it|change it to)\s*(?:₦|ngn)?\s*$/i.test(
        before,
      )
    )
      contribution = q.amount;
    else unresolved = true;
  }
  if (
    /\b(?:zero|nothing|scratch)\b/i.test(text) &&
    /\b(?:start|from|saved)\b/i.test(text)
  )
    starting = 0;
  const period = cadence(text) ?? prior?.cadence;
  target ??= prior?.target;
  contribution ??= prior?.contribution;
  let basis: SavingsMemory["starting"] =
    starting !== undefined
      ? { kind: "amount", value: starting }
      : (prior?.starting ?? { kind: "amount", value: 0 });
  const balanceRequested =
    /\bbalance\b/i.test(text) &&
    /\b(?:use|using|start|starting|from|instead|switch|what if|how about|make)\b/i.test(
      text,
    );
  if (balanceRequested) {
    if (accountIds.length !== 1)
      return {
        clarification:
          "Choose one authorized account to use as the savings starting point.",
        accountRequired: true,
      } as const;
    // Everyday 'my current balance' means money available to save. Explicit
    // switching or contrast selects the ledger/current balance deliberately.
    const field =
      /\bcurrent\b/i.test(text) &&
      /\b(?:instead|switch|rather|ledger|not available)\b/i.test(text)
        ? "current"
        : "available";
    basis = { kind: "balance", accountId: accountIds[0], field };
  }
  if (basis.kind === "balance" && !accountIds.includes(basis.accountId))
    return {
      clarification:
        "Choose the account for this plan, or give me a starting amount.",
      accountRequired: true,
    } as const;
  if (
    unresolved ||
    target === undefined ||
    contribution === undefined ||
    !period
  )
    return {
      clarification:
        "What amount will you save per day, week or month, and what is your savings target?",
    } as const;
  if (
    args.target !== target ||
    args.contribution !== contribution ||
    args.cadence !== period ||
    (basis.kind === "amount" && args.startingAmount !== basis.value) ||
    (args.startingBalance &&
      (basis.kind !== "balance" || args.startingBalance !== basis.field))
  )
    return {
      clarification:
        "Please confirm the contribution, how often you’ll save, and the target amount so I can use the right figures.",
    } as const;
  return {
    memory: SavingsMemorySchema.parse({
      target,
      contribution,
      cadence: period,
      starting: basis,
    }),
  } as const;
}

/** An approving semantic reviewer cannot launder a wrongly expanded shorthand. */
export function calculationQuantityMismatch(text: string, expression: string) {
  const literals = (expression.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  return moneyQuantities(text).some(
    (q) =>
      /[hkm]\b|hundred|thousand|million|billion|naira|₦|ngn/i.test(q.text) &&
      !literals.includes(q.amount),
  );
}
export function calculationCadenceMismatch(text: string, unit: string) {
  const stated = cadence(text);
  if (
    !stated ||
    !/\b(?:sav(?:e|ed|ing)|millionaire|goal)\b/i.test(text) ||
    !["days", "weeks", "months", "years"].includes(unit) ||
    unit === stated
  )
    return false;
  // An explicitly requested conversion still uses the generic reviewed math path.
  return !new RegExp(
    `(?:how many|in|into|convert.{0,20})\\s+${unit}\\b`,
    "i",
  ).test(text);
}
