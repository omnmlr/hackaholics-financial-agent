import type { components } from "@agus/api-client";

type Schemas = components["schemas"];
type Outcome = Exclude<Schemas["CryptoWalletOutcome"], { kind: "signed" }>;

export type SavedAttempt = {
  id: string;
  outcome?: Outcome;
};

export function parseSavedAttempt(value: string | null): SavedAttempt | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SavedAttempt;
    if (!/^[0-9a-f-]{36}$/i.test(parsed.id)) return null;
    const out = parsed.outcome;
    if (!out) return { id: parsed.id };
    switch (out.kind) {
      case "signature":
        return /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(out.signature)
          ? { id: parsed.id, outcome: out }
          : { id: parsed.id };
      case "declined":
      case "unknown":
      case "unavailable":
        return { id: parsed.id, outcome: out };
      default:
        return { id: parsed.id };
    }
  } catch {
    return null;
  }
}

export function canRecover(state: Schemas["CryptoAttempt"]["state"]) {
  return (
    state === "ready" ||
    state === "handoff" ||
    state === "pending" ||
    state === "unknown"
  );
}

export function solAtoms(amount: string): string {
  const match = /^(0|[1-9][0-9]{0,9})(?:\.([0-9]{1,9}))?$/.exec(amount.trim());
  if (!match) throw new Error("INVALID_DEVNET_SOL_AMOUNT");
  const atoms =
    BigInt(match[1]) * 1_000_000_000n + BigInt((match[2] ?? "").padEnd(9, "0"));
  if (atoms <= 0n || atoms > (1n << 64n) - 1n)
    throw new Error("INVALID_DEVNET_SOL_AMOUNT");
  return atoms.toString();
}
