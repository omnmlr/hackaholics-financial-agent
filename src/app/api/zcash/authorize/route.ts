import { z } from "zod";
import { operator, sameOrigin } from "@/lib/auth";
import { DefaultZcashPrivacyAdapter } from "@/lib/zcash/privacy-adapter";

export const runtime = "nodejs";

const adapter = new DefaultZcashPrivacyAdapter();

const AuthorizeInput = z.strictObject({
  intentId: z.string().uuid(),
  stepUpCredential: z.string().min(8),
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
    const parsed = AuthorizeInput.parse(body);

    const result = adapter.authorizePayment(
      parsed.intentId,
      owner,
      parsed.stepUpCredential,
    );

    return Response.json(result, {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (err: any) {
    const status = err instanceof z.ZodError ? 400 : 403;
    return Response.json({ error: err.message }, { status });
  }
}
