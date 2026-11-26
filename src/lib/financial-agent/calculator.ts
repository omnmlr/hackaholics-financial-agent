import { z } from "zod";
import {
  AgentError,
  CalculationSchema,
  CalculationBindingSchema,
} from "./protocol";

type Calculation = z.infer<typeof CalculationSchema>;
type Binding = z.infer<typeof CalculationBindingSchema>;
type Rational = { n: bigint; d: bigint };
const rational = (n: bigint, d = 1n): Rational => {
  if (d === 0n) throw new AgentError("CALCULATION_ZERO_DIVISOR");
  if (n.toString().length > 80 || d.toString().length > 80)
    throw new AgentError("CALCULATION_RANGE");
  return d < 0n ? { n: -n, d: -d } : { n, d };
};
const decimal = (value: string) => {
  if (!/^-?\d{1,15}(?:\.\d{1,2})?$/.test(value))
    throw new AgentError("CALCULATION_INPUT");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return (
    (value.startsWith("-") ? -1n : 1n) *
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")))
  );
};

/** Numeric notation, not natural-language intent parsing. Role, negation,
 * corrections and ambiguous units are reviewed against the full dialogue. */
export function quotedNumber(quote: string): bigint {
  const clean = quote
    .toLowerCase()
    .trim()
    .replace(/,/g, "")
    .replace(/^(?:₦|ngn)\s*/, "")
    .replace(/\s*(?:naira|kobo|percent|%|months?|years?)$/, "")
    .trim();
  if (clean === "millionaire") return 100000000n;
  const digits = clean.match(
    /^(-?\d+(?:\.\d{1,2})?)\s*(k|m|thousand|million|billion)?$/,
  );
  if (digits) {
    const multiplier = {
      k: 1000n,
      m: 1000000n,
      thousand: 1000n,
      million: 1000000n,
      billion: 1000000000n,
    };
    return (
      decimal(digits[1]) *
      (multiplier[digits[2] as keyof typeof multiplier] ?? 1n)
    );
  }
  const small =
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
      " ",
    );
  const tens = "twenty thirty forty fifty sixty seventy eighty ninety".split(
    " ",
  );
  let total = 0n,
    group = 0n,
    seen = false;
  for (const word of clean.replace(/-/g, " ").split(/\s+/)) {
    if (word === "and") continue;
    if (small.includes(word)) group += BigInt(small.indexOf(word));
    else if (tens.includes(word))
      group += BigInt((tens.indexOf(word) + 2) * 10);
    else if (word === "hundred") group = (group || 1n) * 100n;
    else if (["thousand", "million", "billion"].includes(word)) {
      total +=
        (group || 1n) *
        { thousand: 1000n, million: 1000000n, billion: 1000000000n }[word]!;
      group = 0n;
    } else throw new AgentError("CALCULATION_QUOTE");
    seen = true;
  }
  if (!seen) throw new AgentError("CALCULATION_QUOTE");
  return (total + group) * 100n;
}

function format(value: Rational, unit: string) {
  const sign = value.n < 0n ? "-" : "";
  const absolute = value.n < 0n ? -value.n : value.n;
  const cents = (absolute * 100n + value.d / 2n) / value.d;
  return `${sign}${unit === "naira" ? "₦" : ""}${(cents / 100n).toLocaleString("en-NG")}.${String(cents % 100n).padStart(2, "0")}${unit === "percent" ? "%" : ""}`;
}

function hasNumericQuote(source: string, quote: string) {
  for (
    let offset = source.indexOf(quote);
    offset !== -1;
    offset = source.indexOf(quote, offset + 1)
  ) {
    const before = source.slice(0, offset),
      after = source.slice(offset + quote.length);
    // An exact substring is insufficient: "10" inside "10000" or "one"
    // inside "someone" cannot ground an operand. Preserve numeric signs.
    if (
      /\p{N}$/u.test(before) ||
      (/\p{L}$/u.test(before) && /^\p{L}/u.test(quote)) ||
      /^[\p{L}\p{N}]/u.test(after) ||
      /\d[.,]$/.test(before) ||
      /^[.,]\d/.test(after) ||
      /[−–-]\s*(?:₦|NGN)?\s*$/i.test(before)
    )
      continue;
    return true;
  }
  return false;
}

/** Source-linked inputs are assumptions, never account records. The only
 * implicit value accepted is zero starting savings, disclosed by the server. */
export function computeCalculation(
  c: Calculation,
  bindings: Binding[],
  userStatements: string[],
) {
  CalculationSchema.parse(c);
  const expected: Record<string, string | number> =
    c.kind === "arithmetic"
      ? Object.fromEntries(c.inputs.map((input) => [input.name, input.value]))
      : Object.fromEntries(Object.entries(c).filter(([k]) => k !== "kind"));
  if (
    (c.kind === "arithmetic" &&
      c.inputs.length !== Object.keys(expected).length) ||
    !Object.keys(expected).length ||
    Object.keys(expected).length > 20 ||
    bindings.length !== Object.keys(expected).length ||
    new Set(bindings.map((b) => b.field)).size !== bindings.length
  )
    throw new AgentError("CALCULATION_BINDINGS");
  for (const raw of bindings) {
    const b = CalculationBindingSchema.parse(raw);
    if (!Object.hasOwn(expected, b.field))
      throw new AgentError("CALCULATION_BINDINGS");
    let value: bigint;
    if (b.sourceIndex === null) {
      if (
        c.kind !== "savings_goal" ||
        b.field !== "startingNaira" ||
        decimal(String(expected[b.field])) !== 0n ||
        b.quote !== "" ||
        b.unit !== "naira"
      )
        throw new AgentError("CALCULATION_UNSOURCED");
      value = 0n;
    } else {
      const source = userStatements[b.sourceIndex];
      if (!source || !b.quote || !hasNumericQuote(source, b.quote))
        throw new AgentError("CALCULATION_UNSOURCED");
      value = quotedNumber(b.quote);
      if (b.unit === "kobo") {
        if (value % 100n) throw new AgentError("CALCULATION_INPUT");
        value /= 100n;
      }
      if (b.unit === "years") value *= 12n;
    }
    if (c.kind !== "arithmetic") {
      const units =
        b.field === "months"
          ? ["months", "years"]
          : b.field.endsWith("Percent")
            ? ["percent"]
            : ["naira", "kobo"];
      if (!units.includes(b.unit)) throw new AgentError("CALCULATION_UNITS");
    }
    if (value !== decimal(String(expected[b.field])))
      throw new AgentError("CALCULATION_UNSOURCED");
  }
  const slots: Record<string, string> = {};
  const put = (name: string, value: string) => {
    slots[`{{calculation.${name}}}`] = value;
  };
  const assumptions: string[] = [];
  let summary: string;
  if (c.kind === "arithmetic") {
    const values = new Map(
      c.inputs.map(({ name, value }) => [name, rational(decimal(value), 100n)]),
    );
    for (const step of c.steps) {
      const a = values.get(step.left),
        b = values.get(step.right);
      if (!a || !b || values.has(step.id))
        throw new AgentError("CALCULATION_REFERENCE");
      const value =
        step.op === "add"
          ? rational(a.n * b.d + b.n * a.d, a.d * b.d)
          : step.op === "subtract"
            ? rational(a.n * b.d - b.n * a.d, a.d * b.d)
            : step.op === "multiply"
              ? rational(a.n * b.n, a.d * b.d)
              : rational(a.n * b.d, a.d * b.n);
      values.set(step.id, value);
    }
    const result = values.get(c.output);
    if (!result || c.inputs.some((input) => input.name === c.output))
      throw new AgentError("CALCULATION_REFERENCE");
    put("result", format(result, c.unit));
    summary = `Calculated result: ${slots["{{calculation.result}}"]}${c.unit === "months" ? " months" : ""}.`;
    assumptions.push(
      "An illustration using your supplied figures; this does not access or verify an account.",
    );
  } else if (c.kind === "savings_goal") {
    const monthly = decimal(c.monthlySavingsNaira),
      goal = decimal(c.targetNaira),
      start = decimal(c.startingNaira);
    if (monthly <= 0n) throw new AgentError("CALCULATION_INPUT");
    const months = goal > start ? (goal - start + monthly - 1n) / monthly : 0n;
    put("months", String(months));
    put("years", String(months / 12n));
    put("remainingMonths", String(months % 12n));
    put("monthlySavings", format(rational(monthly, 100n), "naira"));
    put("target", format(rational(goal, 100n), "naira"));
    put("starting", format(rational(start, 100n), "naira"));
    summary = `Saving ${slots["{{calculation.monthlySavings}}"]} each month reaches ${slots["{{calculation.target}}"]} in ${months} months (${months / 12n} years and ${months % 12n} months).`;
    assumptions.push(
      `Assuming starting savings of ${slots["{{calculation.starting}}"]}, the stated monthly amount is saved in full, with no interest, fees or withdrawals.`,
    );
  } else {
    const percent =
      c.kind === "savings_total" ? c.savingsPercent : c.annualRatePercent;
    if (decimal(percent) > 10000n) throw new AgentError("CALCULATION_INPUT");
    const amount =
      c.kind === "savings_total" ? c.incomeNaira : c.principalNaira;
    const result = rational(
      decimal(amount) * decimal(percent) * BigInt(c.months),
      c.kind === "simple_interest" ? 12000000n : 1000000n,
    );
    put("result", format(result, "naira"));
    put("months", String(c.months));
    put("amount", format(rational(decimal(amount), 100n), "naira"));
    put("percent", percent + "%");
    summary =
      c.kind === "savings_total"
        ? `Saving ${percent}% of ${slots["{{calculation.amount}}"]} monthly for ${c.months} months gives ${slots["{{calculation.result}}"]}.`
        : `Simple interest on ${slots["{{calculation.amount}}"]} at ${percent}% per year for ${c.months} months is ${slots["{{calculation.result}}"]}.`;
    assumptions.push(
      c.kind === "savings_total"
        ? "Assuming steady income and savings rate, with no interest or withdrawals."
        : "Assuming the supplied annual rate and simple interest, with no fees, repayments or compounding.",
    );
  }
  return { slots, summary, assumptions };
}

/** The model controls language; only backend values can occupy numeric slots.
 * Semantic review also checks numeric words, roles and omitted qualifications. */
export function composeCalculation(
  text: string,
  result: ReturnType<typeof computeCalculation>,
) {
  const placeholders = text.match(/\{\{[^}]+\}\}/g) ?? [];
  if (
    !placeholders.length ||
    placeholders.some((p) => !Object.hasOwn(result.slots, p)) ||
    /\d|[₦$€£{}]/.test(text.replace(/\{\{[^}]+\}\}/g, ""))
  )
    throw new AgentError("CALCULATION_PROSE");
  return text.replace(/\{\{[^}]+\}\}/g, (p) => result.slots[p]);
}
