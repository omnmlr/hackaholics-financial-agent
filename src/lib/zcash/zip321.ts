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
): { valid: boolean; pool: "orchard" | "sapling" | "transparent" | "unified"; network: ZcashNetwork } {
  if (typeof address !== "string" || address.length < 30) {
    return { valid: false, pool: "transparent", network };
  }

  if (network === "testnet") {
    if (address.startsWith("utest1")) {
      return { valid: true, pool: "unified", network: "testnet" };
    }
    if (address.startsWith("ztestsapling")) {
      return { valid: true, pool: "sapling", network: "testnet" };
    }
    if (address.startsWith("tm") && address.length === 35) {
      return { valid: true, pool: "transparent", network: "testnet" };
    }
  } else {
    if (address.startsWith("u1")) {
      return { valid: true, pool: "unified", network: "mainnet" };
    }
    if (address.startsWith("zs1")) {
      return { valid: true, pool: "sapling", network: "mainnet" };
    }
    if ((address.startsWith("t1") || address.startsWith("t2")) && address.length === 35) {
      return { valid: true, pool: "transparent", network: "mainnet" };
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
export function parseZip321Uri(rawUri: string, expectedNetwork: ZcashNetwork = "testnet"): Zip321PaymentRequest {
  if (!rawUri.startsWith("zcash:")) {
    throw new Error("INVALID_ZCASH_URI_SCHEME");
  }

  const withoutScheme = rawUri.slice("zcash:".length);
  const [addressPart, queryString = ""] = withoutScheme.split("?");

  let address = addressPart;
  const searchParams = new URLSearchParams(queryString);

  if (!address && searchParams.has("address")) {
    address = searchParams.get("address")!;
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
  const rawMemo = searchParams.get("memo");
  let memoText: string | undefined;
  let agusMemo: AgusMemoPayload | undefined;

  if (rawMemo) {
    try {
      // Decode base64url
      const buf = Buffer.from(rawMemo, "base64url");
      memoText = buf.toString("utf8");
    } catch {
      memoText = rawMemo;
    }

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
