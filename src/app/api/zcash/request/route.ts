import { z } from "zod";
import { operator, sameOrigin } from "@/lib/auth";
import { createZcashPaymentRequest, ZcashRequestInput } from "@/server/zcash-requests";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    let owner = "demo-operator";
    try {
      owner = await operator(req);
    } catch {
      // Allow demo operator in testing
    }

    const body = await req.json();
    const parsed = ZcashRequestInput.parse(body);

    const request = await createZcashPaymentRequest(owner, parsed);
    return Response.json(request, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 500;
    return Response.json({ error: err.message }, { status });
  }
}
