/** Server-only authenticated viewing boundary. No seeds, UFVKs or signing methods. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../domain";
import { decodeUnifiedAddress } from "./unified-address";
import {
  atomic,
  type PaymentRequest,
  type VerificationEvidence,
} from "../web-product/contracts";
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const WalletObservation = z.object({
  network: z.literal("testnet"),
  walletId: z.string().regex(/^[a-f0-9]{24}$/),
  invoiceKey: Hash,
  termsDigest: Hash,
  walletRequestId: z.string().regex(/^req_[a-f0-9-]+$/),
  address: z.string().min(30).max(2048),
  amountAtoms: z.string().regex(/^[1-9][0-9]*$/),
  chainTip: z.number().int().positive(),
  synced: z.literal(true),
  observedAt: z.number().int(),
  source: z.literal("zaw-librustzcash-receiving-wallet"),
  signingAvailable: z.literal(false),
  outputs: z
    .array(
      z.object({
        amountAtoms: z.string().regex(/^\d+$/),
        transactionId: Hash,
        height: z.number().int().positive().nullable(),
        confirmations: z.number().int().nonnegative(),
        pool: z.union([z.literal(3), z.literal(4)]),
        outputIndex: z.number().int().nonnegative(),
        blockTime: z.number().int().positive().nullable(),
      }),
    )
    .max(100),
});
export type NativeBinding = {
  invoiceKey: string;
  termsDigest: string;
  walletId: string;
  walletRequestId: string;
};
export function receivingWalletConfigured() {
  return (
    !!process.env.ZCASH_RECEIVE_SERVICE_URL && !!process.env.ZCASH_RECEIVE_TOKEN
  );
}
export async function walletCall(path: string, body?: unknown) {
  if (!receivingWalletConfigured())
    throw new AppError(
      "The authenticated Zcash receiving wallet is unavailable.",
      503,
    );
  const base = new URL(process.env.ZCASH_RECEIVE_SERVICE_URL!);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !["https:", "http:"].includes(base.protocol)
  )
    throw new AppError("Invalid receiving service configuration", 503);
  if (
    process.env.NODE_ENV === "production" &&
    base.protocol === "http:" &&
    !base.hostname.endsWith(".railway.internal")
  )
    throw new AppError(
      "Receiving service must use TLS or private networking",
      503,
    );
  const r = await fetch(new URL(path, base), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${process.env.ZCASH_RECEIVE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok)
    throw new AppError(
      "The trusted receiving wallet is syncing or unavailable. No receipt is assumed.",
      503,
    );
  const raw = await r.text();
  if (raw.length > 64000) throw new AppError("Invalid wallet observation", 502);
  return JSON.parse(raw);
}
export const walletStatusSchema = z.object({
  network: z.literal("testnet"),
  synced: z.literal(true),
  walletId: z.string().regex(/^[a-f0-9]{24}$/),
  spendableZec: z.string().regex(/^\d+(\.\d{1,8})?$/),
  pendingZec: z.string().regex(/^\d+(\.\d{1,8})?$/),
  signingAvailable: z.literal(false),
  implementation: z.literal("zaw-0.1.2"),
  nu7Compatible: z.literal(true),
});
export async function receivingWalletStatus() {
  return walletStatusSchema.parse(await walletCall("/status"));
}
export function invoiceTerms(owner: string, invoiceId: string, amount: string) {
  const invoiceKey = createHash("sha256")
    .update(JSON.stringify(["agus-zcash-receive-v1", owner, invoiceId]))
    .digest("hex");
  const amountAtoms = atomic(amount, 8).toString();
  const termsDigest = createHash("sha256")
    .update(
      JSON.stringify([
        invoiceKey,
        amountAtoms,
        "ZEC",
        "testnet",
        "unique-orchard-receiver",
        3,
      ]),
    )
    .digest("hex");
  return { invoiceKey, termsDigest, amountAtoms };
}
export async function allocateReceivingAddress(
  owner: string,
  invoiceId: string,
  amount: string,
) {
  const terms = invoiceTerms(owner, invoiceId, amount);
  const observation = WalletObservation.parse(
    await walletCall("/invoices", terms),
  );
  validateObservation(observation, terms);
  return observation;
}
function validateObservation(
  o: z.infer<typeof WalletObservation>,
  terms: { invoiceKey: string; termsDigest: string; amountAtoms: string },
) {
  if (
    o.invoiceKey !== terms.invoiceKey ||
    o.termsDigest !== terms.termsDigest ||
    o.amountAtoms !== terms.amountAtoms ||
    Math.abs(Date.now() / 1000 - o.observedAt) > 90
  )
    throw new AppError("Receiving wallet terms or freshness mismatch", 409);
  const ua = decodeUnifiedAddress(o.address);
  if (!ua.orchard || ua.receivers.some((t) => t !== 3))
    throw new AppError(
      "Expected a wallet-controlled Orchard-only Unified address",
      409,
    );
}
export function matchWalletReceipt(
  request: PaymentRequest,
  raw: unknown,
): VerificationEvidence | null {
  const binding = request.nativeWallet;
  if (!binding)
    throw new AppError(
      "No managed receiving wallet is bound to this request",
      409,
    );
  const o = WalletObservation.parse(raw);
  validateObservation(o, {
    ...binding,
    amountAtoms: atomic(request.amount, 8).toString(),
  });
  if (
    o.walletId !== binding.walletId ||
    o.walletRequestId !== binding.walletRequestId ||
    o.address !== request.recipient
  )
    throw new AppError("Receiving wallet identity mismatch", 409);
  // A dedicated diversified receiver binds the invoice. Never infer hidden amounts
  // from a public txid, accept a partial total, or pretend a missing memo matched.
  if (o.outputs.length !== 1) return null;
  const note = o.outputs[0];
  if (
    note.amountAtoms !== o.amountAtoms ||
    !note.height ||
    !note.blockTime ||
    note.confirmations < 3 ||
    note.height > o.chainTip ||
    note.confirmations !== o.chainTip - note.height + 1 ||
    note.blockTime * 1000 < Date.parse(request.createdAt) - 120000 ||
    note.blockTime * 1000 > Date.parse(request.expiresAt)
  )
    return null;
  return {
    source: "zcash-receiving-wallet",
    network: "testnet",
    transactionId: note.transactionId,
    recipient: o.address,
    amount: request.amount,
    asset: "ZEC",
    memo: request.memo,
    observedAt: new Date(o.observedAt * 1000).toISOString(),
    confirmedAt: new Date(note.blockTime * 1000).toISOString(),
    confirmations: note.confirmations,
    walletReceipt: {
      ...binding,
      matching: "unique-wallet-address",
      pool: note.pool,
      outputIndex: note.outputIndex,
      chainTip: o.chainTip,
      minedHeight: note.height,
    },
  };
}
export async function observeWalletRequest(request: PaymentRequest) {
  if (!request.nativeWallet)
    throw new AppError("No managed wallet binding", 409);
  return WalletObservation.parse(
    await walletCall("/invoices/" + request.nativeWallet.invoiceKey),
  );
}
