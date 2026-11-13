import { z } from "zod";
import { operator, sameOrigin } from "@/lib/auth";
import { DefaultZcashPrivacyAdapter } from "@/lib/zcash/privacy-adapter";

export const runtime = "nodejs";

const adapter = new DefaultZcashPrivacyAdapter();

const SubmitInput = z.strictObject({
  intentId: z.string().uuid(),
  authorizationToken: z.string().min(16),
});

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const body = await req.json();
    const parsed = SubmitInput.parse(body);

    const result = await adapter.submitShieldedPayment(
      parsed.intentId,
      parsed.authorizationToken,
    );

    return Response.json(
      {
        txid: result.txid,
        status: result.intent.status,
        submittedAt: result.intent.submittedAt,
        modelView: result.modelView,
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 500;
    return Response.json({ error: err.message }, { status });
  }
}
