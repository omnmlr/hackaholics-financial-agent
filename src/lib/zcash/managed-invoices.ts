import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../domain";
import { config } from "../config";
import { transaction, database } from "../../server/sql";
import {
  createInvoice,
  getPaymentRequest,
  initializeProduct,
  recordSettlement,
  currentRequest,
} from "../web-product/service";
import { type PaymentRequest, InvoiceInput } from "../web-product/contracts";
import {
  allocateReceivingAddress,
  matchWalletReceipt,
  observeWalletRequest,
  receivingWalletConfigured,
} from "./receiving-wallet";
import { buildZip321Uri } from "./zip321";
import { atomic } from "../web-product/contracts";
export async function createManagedInvoice(owner: string, raw: unknown) {
  const input = InvoiceInput.parse(raw);
  if (input.currency !== "ZEC" || input.direction !== "receivable")
    throw new AppError("Managed Zcash invoices must receive testnet ZEC");
  // Allocate before creating application records. Unavailability never creates a fake wallet.
  const wallet = await allocateReceivingAddress(owner, input.id, input.amount);
  const invoice = await createInvoice(owner, input);
  const id = createHash("sha256")
    .update("managed-request:" + owner + ":" + invoice.id)
    .digest("hex");
  const requestId = `${id.slice(0, 8)}-${id.slice(8, 12)}-4${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`;
  return transaction(async (sql) => {
    // Serialize against all other requests for the same invoice.
    await sql.query(
      "SELECT id FROM agus_web_invoices WHERE owner=$1 AND id=$2 FOR UPDATE",
      [owner, invoice.id],
    );
    const rows = await sql.query(
      "SELECT payload FROM agus_web_requests WHERE owner=$1 AND invoice_id=$2",
      [owner, invoice.id],
    );
    const prior = rows.rows.find((r) => r.payload.id === requestId)?.payload as
      PaymentRequest | undefined;
    if (prior) return { invoice, request: currentRequest(prior) };
    if (
      rows.rows.some((r) =>
        ["pending", "confirmed"].includes(currentRequest(r.payload).state),
      )
    )
      throw new AppError("This invoice already has an active request", 409);
    const createdAt = new Date().toISOString();
    const request: PaymentRequest = {
      id: requestId,
      owner,
      invoiceId: invoice.id,
      rail: "zcash",
      network: "testnet",
      asset: "ZEC",
      amount: invoice.amount,
      recipient: wallet.address,
      memo: "",
      uri: buildZip321Uri({
        address: wallet.address,
        amountAtoms: atomic(invoice.amount, 8),
        label: "AGUS private invoice",
      }),
      createdAt,
      expiresAt: new Date(Date.now() + 24 * 3600000).toISOString(),
      state: "pending",
      nativeWallet: {
        invoiceKey: wallet.invoiceKey,
        termsDigest: wallet.termsDigest,
        walletId: wallet.walletId,
        walletRequestId: wallet.walletRequestId,
      },
    };
    await sql.query(
      "INSERT INTO agus_web_requests(owner,id,invoice_id,payload) VALUES($1,$2,$3,$4::jsonb)",
      [owner, request.id, invoice.id, JSON.stringify(request)],
    );
    const event = {
      id: randomUUID(),
      at: createdAt,
      kind: "request.created",
      text: "Private ZEC invoice created with a fresh wallet-controlled receiver. Awaiting wallet evidence.",
      invoiceId: invoice.id,
      requestId: request.id,
    };
    await sql.query(
      "INSERT INTO agus_web_events(owner,id,payload) VALUES($1,$2,$3::jsonb)",
      [owner, event.id, JSON.stringify(event)],
    );
    return { invoice, request };
  });
}
export async function checkManagedReceipt(owner: string, id: string) {
  const request = await getPaymentRequest(owner, id);
  if (request.state === "confirmed") return request;
  if (request.state !== "pending" || !request.nativeWallet)
    throw new AppError("This managed receiving request is not open", 409);
  const observation = await observeWalletRequest(request);
  const evidence = matchWalletReceipt(request, observation);
  if (evidence) return recordSettlement(owner, id, evidence);
  const lastCheck = observation.outputs.length
    ? "Payment detected; exact amount and 3 confirmations required."
    : "Unpaid · receiving wallet checked";
  const sql = await database();
  await sql.query(
    "UPDATE agus_web_requests SET payload=payload || $3::jsonb WHERE owner=$1 AND id=$2 AND payload->>'state'='pending'",
    [
      owner,
      id,
      JSON.stringify({ lastCheckedAt: new Date().toISOString(), lastCheck }),
    ],
  );
  return getPaymentRequest(owner, id);
}
const runtime = globalThis as typeof globalThis & {
  agusZcashWatcher?: boolean;
};
export function startZcashReceivingWatcher() {
  if (
    runtime.agusZcashWatcher ||
    !receivingWalletConfigured() ||
    process.env.NEXT_PHASE === "phase-production-build"
  )
    return;
  runtime.agusZcashWatcher = true;
  const tick = async () => {
    try {
      const sql = await initializeProduct();
      const rows = await sql.query(
        "SELECT id FROM agus_web_requests WHERE owner=$1 AND payload->>'state'='pending' AND payload->'nativeWallet' IS NOT NULL ORDER BY created_at LIMIT 50",
        [config().operator],
      );
      for (const row of rows.rows) {
        try {
          await checkManagedReceipt(config().operator, row.id);
        } catch {
          /* fail closed, retry next scan; no provider payload logs */
        }
      }
    } catch {
      /* storage unavailable; no settlement assumed */
    } finally {
      setTimeout(() => void tick(), 20000).unref?.();
    }
  };
  setTimeout(() => void tick(), 1000).unref?.();
}
