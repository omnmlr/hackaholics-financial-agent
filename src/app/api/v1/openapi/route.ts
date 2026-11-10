import document from "../../../../../packages/contracts/openapi.json";
export const dynamic = "force-static";
export function GET() {
  return Response.json(document, {
    headers: { "cache-control": "public,max-age=300" },
  });
}
