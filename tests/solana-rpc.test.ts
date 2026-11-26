/** Actual SDK RPC serialization, intercepted before transport. No external calls or funds. */
import { afterEach, expect, it, vi } from "vitest";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { pinnedDevnetRpc } from "../src/lib/solana/rpc";
import { DEVNET_RPC } from "../src/lib/solana/contracts";
afterEach(() => vi.unstubAllGlobals());
it("simulates identical unsigned legacy bytes with signature verification disabled and without replacing the reviewed blockhash", async () => {
  const sender = Keypair.generate().publicKey;
  const transaction = new Transaction({
    feePayer: sender,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(
    SystemProgram.transfer({
      fromPubkey: sender,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    }),
  );
  const raw = transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    expect(String(url)).toBe(DEVNET_RPC);
    const body = JSON.parse(String(init.body));
    expect(body.method).toBe("simulateTransaction");
    expect(body.params[0]).toBe(raw.toString("base64"));
    expect(body.params[1]).toMatchObject({
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: "confirmed",
    });
    expect(init.redirect).toBe("error");
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          context: { slot: 123 },
          value: { err: null, logs: ["Not displayed"], unitsConsumed: 450 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  vi.stubGlobal("fetch", transport);
  expect(await pinnedDevnetRpc().simulateTransaction(raw)).toEqual({
    err: null,
    slot: 123,
    unitsConsumed: 450,
  });
  expect(transport).toHaveBeenCalledTimes(1);
});
