import { SolanaError } from "./contracts";
export const MAX_U64 = (1n << 64n) - 1n;
export function decimalToAtoms(amount: string, decimals: number): bigint {
  if (
    typeof amount !== "string" ||
    amount.length > 280 ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255 ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(amount)
  )
    throw new SolanaError(
      "INVALID_AMOUNT",
      "Use a positive decimal amount without separators or exponents",
    );
  const [whole, fraction = ""] = amount.split(".");
  if (fraction.length > decimals)
    throw new SolanaError(
      "AMOUNT_PRECISION",
      "Amount has more decimal places than the asset supports",
    );
  const atoms = BigInt(whole + fraction.padEnd(decimals, "0"));
  if (atoms <= 0n || atoms > MAX_U64)
    throw new SolanaError(
      "AMOUNT_RANGE",
      "Amount is outside the supported token range",
    );
  return atoms;
}
export function atomsToDecimal(atoms: bigint, decimals: number): string {
  if (
    atoms < 0n ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  )
    throw new SolanaError("INVALID_AMOUNT", "Invalid atomic amount");
  if (!decimals) return atoms.toString();
  const value = atoms.toString().padStart(decimals + 1, "0");
  const fraction = value.slice(-decimals).replace(/0+$/, "");
  return value.slice(0, -decimals) + (fraction ? "." + fraction : "");
}
export function safeLamports(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new SolanaError(
      "INVALID_RPC_AMOUNT",
      "RPC returned an unsafe integer amount",
      502,
    );
  return BigInt(value);
}
