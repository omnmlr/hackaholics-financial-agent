import { DefaultZcashPrivacyAdapter } from "@/lib/zcash/privacy-adapter";

export const runtime = "nodejs";

const adapter = new DefaultZcashPrivacyAdapter();

export async function GET() {
  try {
    const capabilities = await adapter.discoverCapabilities();
    return Response.json(capabilities, {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  } catch (err: any) {
    return Response.json(
      { error: err.message || "Failed to query Zcash capabilities." },
      { status: 500 },
    );
  }
}
