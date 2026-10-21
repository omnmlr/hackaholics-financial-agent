import Decimal from "decimal.js";
import { z } from "zod";
import { AgentError } from "../financial-agent/protocol";

// A bounded mathematical grammar, never JavaScript, eval or model-authored code.
// Decimal arithmetic keeps everyday monetary subtraction exact. This verifies
// evaluation of the supplied expression; semantic interpretation remains fallible.
const D = Decimal.clone({ precision: 120, rounding: Decimal.ROUND_HALF_UP });
export const SavingsArgs = z.strictObject({
  target: z.number().finite().positive().max(1e12),
  startingAmount: z.number().finite().nonnegative().max(1e12),
  contribution: z.number().finite().positive().max(1e12),
  cadence: z.enum(["weeks", "months", "days", "years"]),
});
export const CalculateArgs = z.strictObject({
  expression: z.string().trim().min(1).max(400),
  description: z.string().trim().min(1).max(160),
  unit: z.enum([
    "months",
    "weeks",
    "years",
    "naira",
    "percent",
    "number",
    "days",
    "hours",
    "units",
  ]),
  assumptions: z.array(z.string().trim().min(1).max(160)).max(4),
});
export type Calculation = {
  id: string;
  expression: string;
  description: string;
  unit: string;
  value: string;
  displayValue: string;
  assumptions: string[];
  approximate: boolean;
  duration?: { text: string; values: string[] };
  savings?: z.infer<typeof SavingsArgs>;
};

export function calculate(raw: unknown, id: string): Calculation {
  const args = CalculateArgs.parse(raw);
  const tokens = args.expression.match(/\d+(?:\.\d+)?|[A-Za-z_]+|[^\s]/g) ?? [];
  if (tokens.length > 120) throw new AgentError("CALCULATION_LIMIT");
  let at = 0;
  const peek = () => tokens[at];
  const take = () => tokens[at++];
  function bounded(value: Decimal): Decimal {
    if (!value.isFinite() || value.abs().gt("1e100"))
      throw new AgentError("CALCULATION_RANGE");
    return value;
  }
  function atom(depth: number): Decimal {
    if (depth > 20) throw new AgentError("CALCULATION_LIMIT");
    const token = take();
    if (token === "(") {
      const value = expression(depth + 1);
      if (take() !== ")") throw new AgentError("CALCULATION_SYNTAX");
      return value;
    }
    if (["ceil", "floor", "round", "sqrt", "abs"].includes(token)) {
      if (take() !== "(") throw new AgentError("CALCULATION_SYNTAX");
      const value = expression(depth + 1);
      if (take() !== ")") throw new AgentError("CALCULATION_SYNTAX");
      return bounded(
        token === "ceil"
          ? value.ceil()
          : token === "floor"
            ? value.floor()
            : token === "round"
              ? value.round()
              : token === "sqrt"
                ? value.sqrt()
                : value.abs(),
      );
    }
    if (!/^\d+(?:\.\d+)?$/.test(token ?? ""))
      throw new AgentError("CALCULATION_SYNTAX");
    return bounded(new D(token));
  }
  function power(depth: number): Decimal {
    let value = atom(depth + 1);
    if (peek() === "^") {
      take();
      const exponent = unary(depth + 1);
      if (!exponent.isInteger() || exponent.abs().gt(1000))
        throw new AgentError("CALCULATION_RANGE");
      value = bounded(value.pow(exponent));
    }
    if (peek() === "%") {
      take();
      value = value.div(100);
    }
    return value;
  }
  function unary(depth: number): Decimal {
    if (depth > 20) throw new AgentError("CALCULATION_LIMIT");
    if (peek() === "+") {
      take();
      return unary(depth + 1);
    }
    if (peek() === "-") {
      take();
      return unary(depth + 1).neg();
    }
    return power(depth + 1);
  }
  function term(depth: number): Decimal {
    let value = unary(depth + 1);
    while (peek() === "*" || peek() === "/") {
      const op = take(),
        right = unary(depth + 1);
      value = bounded(op === "*" ? value.mul(right) : value.div(right));
    }
    return value;
  }
  function expression(depth: number): Decimal {
    let value = term(depth + 1);
    while (peek() === "+" || peek() === "-") {
      const op = take(),
        right = term(depth + 1);
      value = bounded(op === "+" ? value.add(right) : value.sub(right));
    }
    return value;
  }
  const result = expression(0);
  if (at !== tokens.length) throw new AgentError("CALCULATION_SYNTAX");
  // Keep all bounded integer digits. Financial amounts round to kobo;
  // other fractional outputs have at most twelve decimal places, explicitly
  // marked approximate rather than pretending finite decimal division is exact.
  const rounded = result.toDecimalPlaces(args.unit === "naira" ? 2 : 12);
  const approximate = !rounded.eq(result);
  const value = rounded.toFixed();
  const [whole, fraction] = value.split(".");
  const displayValue =
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    (fraction ? `.${fraction}` : "");
  // Calendar equivalents are estimates, not exact deposit schedules. Compute
  // them here so narration never has to invent secondary arithmetic.
  let duration: Calculation["duration"];
  if (["weeks", "months", "days"].includes(args.unit) && rounded.gte(0)) {
    const months =
      args.unit === "months"
        ? rounded
        : rounded
            .mul(args.unit === "weeks" ? 7 : 1)
            .mul(12)
            .div("365.2425");
    const total = months.round();
    const years = total.div(12).floor();
    const remainder = total.mod(12);
    const parts = [
      ...(years.gt(0)
        ? [`${years.toFixed()} ${years.eq(1) ? "year" : "years"}`]
        : []),
      ...(remainder.gt(0)
        ? [`${remainder.toFixed()} ${remainder.eq(1) ? "month" : "months"}`]
        : []),
    ];
    if ((parts.length && args.unit !== "months") || years.gt(0))
      duration = {
        text: `roughly ${parts.join(" and ")}`,
        values: [years.toFixed(), remainder.toFixed()],
      };
  }
  return {
    id,
    ...args,
    value,
    displayValue,
    approximate,
    ...(duration ? { duration } : {}),
  };
}

/** Fixed savings formula, with deposits at the end of each stated period.
 * Inputs are user figures, never inferred account balances or live rates. */
export function planSavings(raw: unknown, id: string): Calculation {
  const args = SavingsArgs.parse(raw);
  const expression = `ceil((${new D(args.target).toFixed()}-${new D(args.startingAmount).toFixed()})/${new D(args.contribution).toFixed()})`;
  const result = calculate(
    {
      expression: args.startingAmount >= args.target ? "0" : expression,
      description: "Time to reach your savings goal",
      unit: args.cadence,
      assumptions: [
        "Consistent deposits at the end of each period; no interest, fees or withdrawals.",
      ],
    },
    id,
  );
  return { ...result, savings: args };
}

/** Model writes the explanation; backend inserts exact values into explicit slots. */
export function composeVerified(text: string, calculations: Calculation[]) {
  let rendered = text;
  for (const c of calculations) {
    rendered = rendered.replaceAll(`{{${c.id}}}`, c.displayValue);
  }
  // Unsupported placeholders or numerals cannot replace a verified answer.
  // All explicit numbers in explanations must come from supplied expressions or
  // independently computed values. Wording/units still require evaluation.
  const allowed = new Set(
    calculations
      .flatMap((c) => [
        ...(c.expression.match(/\d+(?:\.\d+)?/g) ?? []),
        c.value,
        ...(c.duration?.values ?? []),
        ...(c.savings
          ? [
              String(c.savings.target),
              String(c.savings.startingAmount),
              String(c.savings.contribution),
            ]
          : []),
      ])
      .map((n) => new D(n).toString()),
  );
  // A speculative secondary derivation must not erase a valid explanation in
  // another paragraph. Retain only complete paragraphs whose explicit values
  // are grounded; the agent still reviews the resulting answer and formula.
  // This is output validation, never language/intent routing or numeric repair.
  rendered = rendered
    .split(/\n\s*\n/)
    .filter((paragraph) => {
      const numbers = paragraph.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
      return (
        !/\{\{/.test(paragraph) &&
        numbers.every((n) =>
          allowed.has(new D(n.replaceAll(",", "")).toString()),
        )
      );
    })
    .join("\n\n")
    .trim();
  const numeric = rendered.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  // Require each result to appear; do not accept a qualitative non-answer.
  if (
    calculations.some(
      (c) => !numeric.some((n) => new D(n.replaceAll(",", "")).eq(c.value)),
    )
  )
    return calculationFallback(calculations);
  return rendered;
}

export function calculationFallback(calculations: Calculation[]) {
  return calculations
    .map((c) => {
      const value = `${c.approximate ? "approximately " : ""}${c.displayValue}${c.unit === "number" ? "" : ` ${c.unit}`}${c.duration ? ` (${c.duration.text})` : ""}`;
      if (c.savings) {
        const money = (n: number) =>
          `₦${new D(n).toFixed().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
        const s = c.savings;
        if (s.startingAmount >= s.target)
          return `With ${money(s.startingAmount)} saved, you’ve already reached your ${money(s.target)} goal.`;
        return `Saving ${money(s.contribution)} ${s.cadence === "days" ? "daily" : s.cadence === "weeks" ? "weekly" : s.cadence === "months" ? "monthly" : "yearly"}, you’ll reach ${money(s.target)} in ${value}.\n\nThat assumes ${s.startingAmount ? `you start with ${money(s.startingAmount)}` : "you start from zero"}, save consistently at the end of each period and earn no interest, with no fees or withdrawals.`;
      }
      return `That comes to ${value}.`;
    })
    .join("\n\n");
}
