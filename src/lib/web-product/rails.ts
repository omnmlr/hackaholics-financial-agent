import { isPollarPublishableKey } from "./runtime-configuration";
import { buildZip321Uri, validateZcashAddress } from "../zcash/zip321";
import {
  STELLAR_TESTNET_HORIZON,
  isIssuerAddress,
  STELLAR_TESTNET_USDC_ISSUER,
} from "../pollar/network";
import { base32 } from "@scure/base";
import { AppError } from "../domain";
import {
  atomic,
  type PaymentRequest,
  type VerificationEvidence,
} from "./contracts";

export function stellarAddress(value: string): boolean {
  if (!/^G[A-Z2-7]{55}$/.test(value)) return false;
  try {
    const bytes = base32.decode(value);
    if (bytes.length !== 35 || bytes[0] !== 48) return false;
    let crc = 0;
    for (const byte of bytes.slice(0, -2)) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit++)
        crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
    }
    return bytes[33] === (crc & 255) && bytes[34] === crc >> 8;
  } catch {
    return false;
  }
}

/** Only checksum-validated shielded receivers supported by this integration. */
export function zcashTestnetAddress(value: string): boolean {
  return validateZcashAddress(value, "testnet").valid;
}

export function zcashUri(
  recipient: string,
  amount: string,
  memo: string,
): string {
  if (!zcashTestnetAddress(recipient))
    throw new AppError(
      "Use a valid Sapling testnet receiving address (ztestsapling…).",
    );
  if (atomic(amount, 8) <= 0n)
    throw new AppError("Enter a positive ZEC amount.");
  return buildZip321Uri({
    address: recipient,
    amountAtoms: atomic(amount, 8),
    memo,
    label: "AGUS testnet payment",
    network: "testnet",
  });
}

export function pollarConfiguration() {
  const key =
    process.env.NEXT_PUBLIC_POLLAR_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY?.trim() ||
    "";
  const issuer =
    process.env.POLLAR_TESTNET_USDC_ISSUER?.trim() ||
    STELLAR_TESTNET_USDC_ISSUER;
  return {
    configured: isPollarPublishableKey(key) && stellarAddress(issuer),
    publicKey: isPollarPublishableKey(key) ? key : null,
    issuer: stellarAddress(issuer) ? issuer : null,
    sdkVersion: "0.12.0",
    network: "testnet" as const,
  };
}

export async function readStellarTestnet(path: string) {
  const response = await fetch(`${STELLAR_TESTNET_HORIZON}${path}`, {
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (response.status === 404)
    throw new AppError(
      "Transaction not found on Stellar testnet. The request remains pending.",
      409,
    );
  if (!response.ok)
    throw new AppError(
      "Stellar testnet verification is unavailable. No settlement was recorded.",
      502,
    );
  return response.json();
}

/** Independent network evidence, never an SDK success toast or client-supplied receipt. */
export async function verifyStellar(
  request: PaymentRequest,
  transactionId: string,
): Promise<VerificationEvidence> {
  if (isIssuerAddress(request.recipient, request.issuer))
    throw new AppError(
      "An issuer-address payment is not an accepted recipient settlement.",
      409,
    );
  const tx = await readStellarTestnet(`/transactions/${transactionId}`);
  if (
    tx.successful !== true ||
    tx.memo_type !== "text" ||
    tx.memo !== request.memo
  )
    throw new AppError(
      "The transaction is unsuccessful or its invoice memo does not match.",
      409,
    );
  if (!Number.isSafeInteger(tx.ledger) || tx.operation_count > 100)
    throw new AppError("This transaction needs manual review.", 409);
  const time = Date.parse(tx.created_at);
  if (
    !Number.isFinite(time) ||
    time < Date.parse(request.createdAt) - 60000 ||
    time > Date.parse(request.expiresAt)
  )
    throw new AppError(
      "The transaction is outside this request’s payment window.",
      409,
    );
  const operations = await readStellarTestnet(
    `/transactions/${transactionId}/operations?limit=100`,
  );
  const matching = (operations._embedded?.records ?? []).filter(
    (op: Record<string, unknown>) =>
      op.type === "payment" &&
      op.to === request.recipient &&
      op.asset_code === "USDC" &&
      op.asset_issuer === request.issuer &&
      typeof op.amount === "string" &&
      atomic(op.amount, 7) === atomic(request.amount, 7),
  );
  if (matching.length !== 1)
    throw new AppError(
      "No unique payment matches the recipient, exact amount and USDC issuer.",
      409,
    );
  return {
    source: "stellar-horizon-testnet",
    network: "testnet",
    transactionId,
    recipient: request.recipient,
    amount: request.amount,
    asset: `USDC:${request.issuer}`,
    memo: request.memo,
    observedAt: new Date().toISOString(),
    confirmedAt: tx.created_at,
    ledger: tx.ledger,
  };
}

async function walletRpc(method: string, params: unknown[]) {
  const url = process.env.ZCASH_WALLET_RPC_URL;
  if (!url)
    throw new AppError(
      "Receiving-wallet verification is not configured. A transaction ID cannot prove a shielded payment.",
      503,
    );
  const target = new URL(url);
  if (
    target.username ||
    target.password ||
    !["http:", "https:"].includes(target.protocol)
  )
    throw new AppError(
      "Configure Zcash RPC credentials separately from the RPC URL.",
      503,
    );
  const response = await fetch(target, {
    method: "POST",
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${process.env.ZCASH_WALLET_RPC_USER ?? ""}:${process.env.ZCASH_WALLET_RPC_PASSWORD ?? ""}`).toString("base64")}`,
    },
    body: JSON.stringify({
      jsonrpc: "1.0",
      id: "agus-read-only",
      method,
      params,
    }),
  });
  if (!response.ok)
    throw new AppError(
      "The authorized receiving wallet is unavailable. No settlement was recorded.",
      502,
    );
  const data = await response.json();
  if (data.error)
    throw new AppError(
      "The receiving wallet could not verify this request. Check wallet synchronization and viewing access.",
      409,
    );
  return data.result;
}

/** All reads run against an operator-configured receiving wallet. No key enters AGUS. */
export async function verifyZcash(
  request: PaymentRequest,
  transactionId: string,
): Promise<VerificationEvidence> {
  const chain = await walletRpc("getblockchaininfo", []);
  if (chain.chain !== "test" || chain.initialblockdownload !== false)
    throw new AppError(
      "The receiving wallet must be synchronized on Zcash testnet.",
      409,
    );
  const receipts = await walletRpc("z_listreceivedbyaddress", [
    request.recipient,
    3,
  ]);
  const memoHex = Buffer.from(request.memo, "utf8").toString("hex");
  const matching = Array.isArray(receipts)
    ? receipts.filter(
        (r) =>
          r.txid === transactionId &&
          typeof r.memo === "string" &&
          r.memo.toLowerCase().replace(/(?:00)+$/, "") === memoHex &&
          (typeof r.amount === "string" || typeof r.amount === "number") &&
          atomic(
            typeof r.amount === "number" ? r.amount.toFixed(8) : r.amount,
            8,
          ) === atomic(request.amount, 8),
      )
    : [];
  if (matching.length !== 1)
    throw new AppError(
      "The receiving wallet has not confirmed a unique matching amount and memo with at least 3 confirmations.",
      409,
    );
  const tx = await walletRpc("gettransaction", [transactionId]);
  if (
    !Number.isInteger(tx.confirmations) ||
    tx.confirmations < 3 ||
    !tx.blocktime ||
    tx.blocktime * 1000 < Date.parse(request.createdAt) - 60000 ||
    tx.blocktime * 1000 > Date.parse(request.expiresAt)
  )
    throw new AppError(
      "The receiving-wallet transaction is not confirmed within this request’s payment window.",
      409,
    );
  return {
    source: "zcash-receiving-wallet",
    network: "testnet",
    transactionId,
    recipient: request.recipient,
    amount: request.amount,
    asset: "ZEC",
    memo: request.memo,
    observedAt: new Date().toISOString(),
    confirmedAt: new Date(tx.blocktime * 1000).toISOString(),
    confirmations: tx.confirmations,
  };
}
