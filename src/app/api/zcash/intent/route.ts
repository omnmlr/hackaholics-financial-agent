import { z } from "zod";
import { operator, sameOrigin } from "@/lib/auth";
import { DefaultZcashPrivacyAdapter } from "@/lib/zcash/privacy-adapter";

export const runtime = "nodejs";

const adapter = new DefaultZcashPrivacyAdapter();

const IntentInput = z.strictObject({
  recipient: z.string().min(30),
  recipientAlias: z.string().max(80).optional(),
  amountZec: z.string().regex(/^\d+(\.\d{1,8})?$/).optional(),
  amountAtoms: z.string().regex(/^[1-9][0-9]{0,19}$/).optional(),
  memoText: z.string().max(512).optional(),
  network: z.enum(["testnet", "mainnet"]).default("testnet"),
});

export async function POST(req: Request) {
  try {
    sameOrigin(req);
    let owner = "demo-operator";
    try {
      owner = await operator(req);
    } catch {
      // Demo fallback
    }

    const body = await req.json();
    const parsed = IntentInput.parse(body);

    const result = adapter.preparePaymentIntent({
      owner,
      recipient: parsed.recipient,
      recipientAlias: parsed.recipientAlias,
      amountZec: parsed.amountZec,
      amountAtoms: parsed.amountAtoms,
      memoText: parsed.memoText,
      network: parsed.network,
    });

    return Response.json(
      {
        intentId: result.intent.intentId,
        reference: result.intent.reference,
        modelView: result.modelView,
        ownerReview: result.ownerReview,
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 500;
    return Response.json({ error: err.message }, { status });
  }
}
