import { operator } from "@/lib/auth";
import { DefaultZcashPrivacyAdapter } from "@/lib/zcash/privacy-adapter";

export const runtime = "nodejs";

const adapter = new DefaultZcashPrivacyAdapter();

export async function GET(req: Request) {
  try {
    let owner = "demo-operator";
    try {
      owner = await operator(req);
    } catch {
      // Fallback to demo operator if unauthenticated in preview mode
    }

    const balance = await adapter.getShieldedWalletStatus(owner);
    return Response.json(
      {
        spendableZec: balance.spendableZec,
        spendableAtoms: balance.spendableAtoms.toString(),
        totalZec: balance.totalZec,
        totalAtoms: balance.totalAtoms.toString(),
        network: balance.network,
      },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (err: any) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
