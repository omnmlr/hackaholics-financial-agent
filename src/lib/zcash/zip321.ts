/** Integrated from AG-ZCASH b9efe96; checksum-validated Sapling testnet only. */
import { bech32 } from "@scure/base";
import {
  type AgusMemoPayload,
  type ZcashNetwork,
  type Zip321PaymentRequest,
  zatoshisToZec,
  zecToZatoshis,
} from "./types";

/**
 * Validates Zcash address format based on network and receiver type.
 */
export function validateZcashAddress(
  address: string,
  network: ZcashNetwork = "testnet",
): {
  valid: boolean;
  pool: "orchard" | "sapling" | "transparent" | "unified";
  network: ZcashNetwork;
} {
  // Unified receiver decoding needs ZIP 316/F4Jumble validation. Prefix-only
  // checks cannot establish a shielded receiver, so those remain unsupported.
  if (network === "testnet" && typeof address === "string") {
    try {
      const decoded = bech32.decode(address as `${string}1${string}`, 200);
      if (
        decoded.prefix === "ztestsapling" &&
        bech32.fromWords(decoded.words).length === 43
      )
        return { valid: true, pool: "sapling", network };
    } catch {
      /* malformed encoding or checksum */
    }
  }
  return { valid: false, pool: "transparent", network };
}

/**
 * Creates a standard ZIP 321 Payment Request URI.
 */
export function buildZip321Uri(params: {
  address: string;
  amountAtoms: bigint;
  memo?: string;
  agusMemo?: AgusMemoPayload;
  message?: string;
  label?: string;
  network?: ZcashNetwork;
}): string {
  const network = params.network || "testnet";
  const validation = validateZcashAddress(params.address, network);
  if (!validation.valid) {
    throw new Error(`INVALID_ZCASH_ADDRESS_${params.address}`);
  }

  if (
    params.amountAtoms <= 0n ||
    params.amountAtoms > 21_000_000n * 100_000_000n
  )
    throw new Error("INVALID_ZEC_AMOUNT");
  const query = new URLSearchParams();
  const decimalAmount = zatoshisToZec(params.amountAtoms);
  query.set("amount", decimalAmount);

  // Encode structured AGUS memo or standard memo
  let finalMemo = params.memo;
  if (params.agusMemo) {
    finalMemo = `AGUS:v1:${params.agusMemo.requestId}:${params.agusMemo.reference}:${params.agusMemo.digest}`;
  }

  if (finalMemo) {
    const memoBytes = Buffer.from(finalMemo, "utf8");
    if (memoBytes.length > 512) {
      throw new Error(`MEMO_EXCEEDS_512_BYTES_${memoBytes.length}`);
    }
    // ZIP 321 standard encodes shielded memos as URL-safe base64 without padding
    const base64url = memoBytes.toString("base64url");
    query.set("memo", base64url);
  }

  if (params.message) {
    query.set("message", params.message);
  }

  if (params.label) {
    query.set("label", params.label);
  }

  return `zcash:${params.address}?${query.toString()}`;
}

/**
 * Parses a ZIP 321 Payment Request URI.
 */
export function parseZip321Uri(
  rawUri: string,
  expectedNetwork: ZcashNetwork = "testnet",
): Zip321PaymentRequest {
  if (!rawUri.startsWith("zcash:")) {
    throw new Error("INVALID_ZCASH_URI_SCHEME");
  }

  if (rawUri.length > 5000 || rawUri.split("?").length !== 2)
    throw new Error("INVALID_ZCASH_URI");
  const withoutScheme = rawUri.slice("zcash:".length);
  const [addressPart, queryString = ""] = withoutScheme.split("?");

  let address = addressPart;
  const searchParams = new URLSearchParams(queryString);

  if (!address && searchParams.has("address")) {
    address = searchParams.get("address")!;
  }

  const allowed = new Set(["amount", "memo", "message", "label"]);
  for (const key of searchParams.keys()) {
    if (!allowed.has(key) || searchParams.getAll(key).length !== 1)
      throw new Error("UNSUPPORTED_ZCASH_URI_PARAMETER");
  }
  const validation = validateZcashAddress(address, expectedNetwork);
  if (!validation.valid) {
    throw new Error(`INVALID_ZCASH_URI_ADDRESS_${address}`);
  }

  const amountStr = searchParams.get("amount");
  if (!amountStr) {
    throw new Error("MISSING_AMOUNT_IN_ZCASH_URI");
  }

  const atoms = zecToZatoshis(amountStr);
  if (atoms <= 0n || atoms > 21_000_000n * 100_000_000n)
    throw new Error("INVALID_ZEC_AMOUNT");
  const rawMemo = searchParams.get("memo");
  let memoText: string | undefined;
  let agusMemo: AgusMemoPayload | undefined;

  if (rawMemo) {
    if (!/^[A-Za-z0-9_-]+$/.test(rawMemo))
      throw new Error("INVALID_ZCASH_MEMO");
    const buf = Buffer.from(rawMemo, "base64url");
    if (buf.length > 512 || buf.toString("base64url") !== rawMemo)
      throw new Error("INVALID_ZCASH_MEMO");
    memoText = buf.toString("utf8");

    if (memoText && memoText.startsWith("AGUS:v1:")) {
      const parts = memoText.split(":");
      if (parts.length === 5 && parts[0] === "AGUS" && parts[1] === "v1") {
        agusMemo = {
          magic: "AGUS",
          version: 1,
          requestId: parts[2],
          reference: parts[3],
          digest: parts[4],
        };
      }
    }
  }

  return {
    address,
    network: expectedNetwork,
    amountAtoms: atoms.toString(),
    displayAmount: zatoshisToZec(atoms),
    memo: memoText,
    agusMemo,
    message: searchParams.get("message") || undefined,
    label: searchParams.get("label") || undefined,
    rawUri,
  };
}
