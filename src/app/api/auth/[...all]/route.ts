import { identity } from "@/server/auth";
import { endpoint } from "@/server/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handler(req: Request) {
  try {
    return await (await identity()).handler(req);
  } catch {
    return endpoint(async () => {
      throw new Error("IDENTITY_UNAVAILABLE");
    });
  }
}
export { handler as GET, handler as POST };
