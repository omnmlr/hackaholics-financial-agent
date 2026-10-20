import { it, expect } from "vitest";
import { createServer } from "node:http";
import { once } from "node:events";

it("blocks external fetches and redirects from the isolated preview", async () => {
  const originalFetch = globalThis.fetch;
  const guard = new URL(
    "../scripts/fixtures/preview-network-guard.mjs",
    import.meta.url,
  ).href;
  await import(/* @vite-ignore */ guard);
  let requests = 0;
  const server = createServer((req, res) => {
    requests++;
    if (req.headers.host?.startsWith("127.0.0.2:")) {
      res.end("redirect target reached");
      return;
    }
    const port = (server.address() as { port: number }).port;
    res.writeHead(302, {
      Location: `http://127.0.0.2:${port}/blocked`,
    });
    res.end();
  });
  server.listen(0, "0.0.0.0");
  await once(server, "listening");
  try {
    await expect(
      fetch("https://generativelanguage.googleapis.com/blocked"),
    ).rejects.toThrow("Isolated fixture preview blocks external requests");
    expect(requests).toBe(0);
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing port");
    await expect(
      fetch(`http://127.0.0.1:${address.port}`, { redirect: "follow" }),
    ).rejects.toThrow();
    expect(requests).toBe(1);
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
