import { z } from "zod";
import QRCode from "qrcode";
import { operator, sameOrigin } from "@/lib/auth";
import { AppError } from "@/lib/domain";
import { workspaceError, workspaceResponse } from "@/lib/agent-workspace/http";
import {
  productSnapshot,
  createInvoice,
  createPaymentRequest,
  getPaymentRequest,
  checkPayment,
  cancelRequest,
  beginPollarSubmission,
  importStatement,
  financialGuidance,
  initializeProduct,
  completeOnboarding,
} from "@/lib/web-product/service";
import {
  FinancialIntelligenceRepository,
  MultiAccountFinancialIntelligenceService,
} from "@/lib/financial-intelligence";
import {
  preparePaymentIntent,
  getPaymentPlan,
  listPaymentPlans,
  updatePaymentPlan,
  quotePaymentPlan,
  approvePaymentPlan,
  claimPaymentSubmission,
  recordWalletOutcome,
  verifyOutgoingPayment,
} from "@/lib/web-product/conversational-payments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function body(req: Request) {
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new AppError("JSON required", 415);
  const reader = req.body?.getReader();
  if (!reader) throw new AppError("A request body is required");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.length;
    if (bytes > 600000) {
      await reader.cancel();
      throw new AppError("CSV uploads are limited to 500 KB", 413);
    }
    chunks.push(part.value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function handle(req: Request) {
  try {
    if (req.method !== "GET" || req.headers.has("origin")) sameOrigin(req);
    if (req.headers.get("sec-fetch-site") === "cross-site")
      throw new AppError("Origin rejected", 403);
    const owner = await operator(req);
    const url = new URL(req.url);
    if (url.search) throw new AppError("Query parameters are not accepted");
    const path = url.pathname.replace(/^\/api\/product\/?/, "").split("/");
    if (req.method === "GET") {
      if (!path[0]) return workspaceResponse(await productSnapshot(owner));
      if (path[0] === "zcash-network" && !path[1]) {
        const { LightwalletdClient } =
          await import("@/lib/zcash/lightwalletd-client");
        const health = await new LightwalletdClient().checkHealth();
        return workspaceResponse({
          ...health,
          endpoint: "testnet.zec.rocks:443",
          observedAt: new Date().toISOString(),
          classification: "public-network-read-only",
        });
      }
      if (path[0] === "payment-plans")
        return workspaceResponse(
          path[1]
            ? await getPaymentPlan(owner, z.uuid().parse(path[1]))
            : { plans: await listPaymentPlans(owner) },
        );
      if (path[0] === "guidance")
        return workspaceResponse(await financialGuidance(owner));
      if (path[0] === "export") {
        const service = new MultiAccountFinancialIntelligenceService(
          new FinancialIntelligenceRepository(await initializeProduct()),
        );
        return new Response(await service.exportTransactionsCsv(owner), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="agus-imported-transactions.csv"',
            "Cache-Control": "no-store, private",
          },
        });
      }
      if (path[0] === "requests" && path[1]) {
        const request = await getPaymentRequest(owner, z.uuid().parse(path[1]));
        if (path[2] === "qr") {
          if (request.state !== "pending")
            throw new AppError("This request is no longer payable", 409);
          return workspaceResponse({
            dataUrl: await QRCode.toDataURL(request.uri, {
              margin: 3,
              width: 280,
              errorCorrectionLevel: "M",
            }),
          });
        }
        return workspaceResponse(request);
      }
    }
    if (req.method === "POST") {
      if (path[0] === "preferences" && !path[1]) {
        z.strictObject({ onboardingCompleted: z.literal(true) }).parse(
          await body(req),
        );
        return workspaceResponse(await completeOnboarding(owner));
      }
      if (path[0] === "payment-plans") {
        if (!path[1])
          return workspaceResponse(
            await preparePaymentIntent(owner, await body(req)),
            201,
          );
        const id = z.uuid().parse(path[1]);
        if (path[2] === "details")
          return workspaceResponse(
            await updatePaymentPlan(owner, id, await body(req)),
          );
        if (path[2] === "quote") {
          const input = z
            .strictObject({
              unsignedXdr: z.string().min(1).max(16000),
              sourceAddress: z.string().length(56),
            })
            .parse(await body(req));
          return workspaceResponse(
            await quotePaymentPlan(
              owner,
              id,
              input.unsignedXdr,
              input.sourceAddress,
            ),
          );
        }
        if (path[2] === "approve") {
          const input = z
            .strictObject({
              password: z.string().max(256),
              reviewDigest: z.string().length(64),
              acknowledged: z.literal(true),
            })
            .parse(await body(req));
          return workspaceResponse(
            await approvePaymentPlan(
              owner,
              id,
              input.reviewDigest,
              input.password,
            ),
          );
        }
        if (path[2] === "submit") {
          const input = z
            .strictObject({ nonce: z.uuid() })
            .parse(await body(req));
          return workspaceResponse(
            await claimPaymentSubmission(owner, id, input.nonce),
          );
        }
        if (path[2] === "outcome") {
          const input = z
            .strictObject({
              status: z.enum(["pending", "failed", "unknown"]),
              transactionId: z
                .string()
                .regex(/^[a-f0-9]{64}$/i)
                .optional(),
            })
            .parse(await body(req));
          return workspaceResponse(
            await recordWalletOutcome(
              owner,
              id,
              input.status,
              input.transactionId,
            ),
          );
        }
        if (path[2] === "verify") {
          z.strictObject({ acknowledged: z.literal(true) }).parse(
            await body(req),
          );
          return workspaceResponse(await verifyOutgoingPayment(owner, id));
        }
      }
      if (path[0] === "invoices")
        return workspaceResponse(
          await createInvoice(owner, await body(req)),
          201,
        );
      if (path[0] === "statements")
        return workspaceResponse(
          await importStatement(owner, await body(req)),
          201,
        );
      if (path[0] === "requests" && !path[1])
        return workspaceResponse(
          await createPaymentRequest(owner, await body(req)),
          201,
        );
      if (path[0] === "requests" && path[1] && path[2] === "verify") {
        const input = z
          .strictObject({ transactionId: z.string().regex(/^[a-f0-9]{64}$/i) })
          .parse(await body(req));
        return workspaceResponse(
          await checkPayment(
            owner,
            z.uuid().parse(path[1]),
            input.transactionId,
          ),
        );
      }
      if (path[0] === "requests" && path[1] && path[2] === "cancel") {
        z.strictObject({ acknowledged: z.literal(true) }).parse(
          await body(req),
        );
        return workspaceResponse(
          await cancelRequest(owner, z.uuid().parse(path[1])),
        );
      }
      if (path[0] === "requests" && path[1] && path[2] === "submit-intent") {
        const input = z
          .strictObject({
            acknowledged: z.literal(true),
            password: z.string().max(256),
            reviewDigest: z.string().length(64),
          })
          .parse(await body(req));
        return workspaceResponse(
          await beginPollarSubmission(
            owner,
            z.uuid().parse(path[1]),
            input.password,
            input.reviewDigest,
          ),
        );
      }
    }
    throw new AppError("Route not found", 404);
  } catch (error) {
    return workspaceError(error);
  }
}
export { handle as GET, handle as POST };
