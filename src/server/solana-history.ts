import { PublicKey } from "@solana/web3.js";
import { pinnedDevnetConnection } from "../lib/solana/rpc";
import {
  requireDevnet,
  DEVNET_GENESIS,
  DEVNET_RPC,
} from "../lib/solana/contracts";
import { invariant } from "./errors";
export async function readWalletHistory(wallet: string, cursor?: string) {
  requireDevnet();
  const key = new PublicKey(wallet);
  let before: string | undefined;
  if (cursor) {
    invariant(cursor.length <= 512, "INVALID_CURSOR", 400);
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      invariant(false, "INVALID_CURSOR", 400);
    }
    invariant(
      parsed.wallet === wallet &&
        typeof parsed.before === "string" &&
        /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(parsed.before),
      "INVALID_CURSOR",
      400,
    );
    before = parsed.before;
  }
  const connection = pinnedDevnetConnection();
  invariant(
    (await connection.getGenesisHash()) === DEVNET_GENESIS,
    "WRONG_DEVNET_GENESIS",
    503,
  );
  const entries = await connection.getSignaturesForAddress(
      key,
      { limit: 26, ...(before ? { before } : {}) },
      "finalized",
    ),
    visible = entries.slice(0, 25);
  return {
    data: visible.map((e) => ({
      signature: e.signature,
      slot: e.slot,
      blockTime: e.blockTime,
      failed: e.err !== null,
      commitment: e.confirmationStatus ?? "unknown",
    })),
    nextCursor:
      entries.length > 25
        ? Buffer.from(
            JSON.stringify({ wallet, before: visible.at(-1)!.signature }),
          ).toString("base64url")
        : null,
    provider: "solana-public-rpc",
    environment: "devnet",
    rpcEndpoint: DEVNET_RPC,
    genesisHash: DEVNET_GENESIS,
    simulated: false,
    observedAt: new Date().toISOString(),
    historyComplete: false,
    coverage:
      "Wallet-address signatures only. Incoming token-account history and pruned RPC history may be missing. Signature listing alone is not settlement evidence.",
  };
}
