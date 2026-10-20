import { describe, expect, it } from "vitest";
import {
  calculate,
  calculationFallback,
  composeVerified,
} from "../src/lib/model-led-agent/calculate";

const run = (
  expression: string,
  unit: "number" | "naira" | "months" = "number",
) =>
  calculate(
    {
      expression,
      unit,
      description: "hypothetical arithmetic",
      assumptions: [],
    },
    "c1",
  );

describe("generic decimal calculator", () => {
  it("retains a grounded explanation while rejecting an unverified secondary derivation", () => {
    const computed = run("900000/18000", "months");
    const result = composeVerified(
      "Divide the 900,000 target by the 18,000 monthly deposit: {{c1}} months.\n\nThat is 4 years and 2 months.",
      [computed],
    );
    expect(result).toBe(
      "Divide the 900,000 target by the 18,000 monthly deposit: 50 months.",
    );
    expect(
      composeVerified("The result is {{unknown}}.\n\nLooks good.", [computed]),
    ).toContain("Hypothetical result: 50 months");
  });
  it("verifies ordinary monetary subtraction and decimal precision without phrase templates", () => {
    expect(run("150000-80000-25000", "naira").value).toBe("45000");
    expect(run("0.3-0.1-0.2", "naira").value).toBe("0");
    expect(run("250000*20%*6", "naira").value).toBe("300000");
  });
  it("uses mathematical operator precedence and right associative integer powers", () => {
    expect(run("-2^2").value).toBe("-4");
    expect(run("2^-2").value).toBe("0.25");
    expect(run("2^3^2").value).toBe("512");
    expect(run("(-2)^2").value).toBe("4");
  });
  it("supports methods the model chooses, including rounded savings durations and compound growth", () => {
    expect(run("ceil((1000000-200000)/25000)", "months").value).toBe("32");
    expect(run("100000*(1+10%)^3", "naira").value).toBe("133100");
    expect(run("sqrt(81)+abs(-4)").value).toBe("13");
  });
  it("retains large exact integers and explicitly marks fractional rounding", () => {
    expect(run("1000000000000000+1").value).toBe("1000000000000001");
    expect(run("1/3", "naira")).toMatchObject({
      value: "0.33",
      approximate: true,
    });
    expect(calculationFallback([run("1/3")])).toContain("approximately");
  });
  it.each([
    "1/0",
    "0/0",
    "sqrt(-1)",
    "2^1001",
    "globalThis.fetch('x')",
    "1;process.exit()",
    "2**4",
    "min(1,2)",
    "1+",
    "1e1000000",
  ])("rejects unsafe or unsupported expression %s", (value) => {
    expect(() => run(value)).toThrow();
  });
  it("keeps a verified answer when model prose changes its number or omits its result", () => {
    const computed = run("150000-80000-25000", "naira");
    expect(composeVerified("That leaves ₦{{c1}}.", [computed])).toBe(
      "That leaves ₦45,000.",
    );
    expect(composeVerified("You have ₦46,000 left", [computed])).toContain(
      "45,000 naira",
    );
    expect(composeVerified("Looks good", [computed])).toContain("45,000 naira");
  });
  it("does not copy untrusted model assumptions into authoritative fallback", () => {
    const computed = calculate(
      {
        expression: "1+1",
        unit: "number",
        description: "foo",
        assumptions: ["Your account balance is ₦999,999"],
      },
      "c1",
    );
    expect(calculationFallback([computed])).not.toContain("999,999");
    expect(composeVerified("Result: 3", [computed])).toContain("2");
  });
});
