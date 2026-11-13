/* global Request, Response, URL, Buffer */
// Loaded only by the browser acceptance runner with --import. Never production.
// These responses are synthetic transport evidence, not on-chain receipts.
import { readFile } from "node:fs/promises";
const originalFetch = globalThis.fetch;
if (!process.env.AGUS_TEST_TRANSPORT_FILE) throw new Error("Test transport file required");
globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://horizon-testnet.stellar.org/") || url === "http://127.0.0.1:18232/") {
    const fixture = JSON.parse(await readFile(process.env.AGUS_TEST_TRANSPORT_FILE, "utf8"));
    if (url.startsWith("https://horizon-testnet.stellar.org/")) {
      if (!url.includes("a".repeat(64))) return Response.json({}, { status: 404 });
      if (url.includes("/operations?")) return Response.json({ _embedded: { records: [{ type: "payment", to: fixture.recipient, asset_code: "USDC", asset_issuer: fixture.issuer, amount: fixture.amount }] } });
      return Response.json({ successful: true, memo_type: "text", memo: fixture.memo, created_at: new Date().toISOString(), operation_count: 1, ledger: 123456 });
    }
    const { method } = JSON.parse(init.body);
    const result = method === "getblockchaininfo" ? { chain: "test", initialblockdownload: false } : method === "z_listreceivedbyaddress" ? [{ txid: "b".repeat(64), amount: Number(fixture.amount), memo: Buffer.from(fixture.memo).toString("hex").padEnd(1024, "0") }] : method === "gettransaction" ? { confirmations: 4, blocktime: Math.floor(Date.now() / 1000) } : null;
    if (!result) throw new Error("Unexpected wallet test method");
    return Response.json({ result, error: null });
  }
  if (new URL(url).hostname === "localhost" || new URL(url).hostname === "127.0.0.1") return originalFetch(input, init);
  throw new Error("External network blocked by web acceptance runner");
};
