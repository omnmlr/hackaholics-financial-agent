import { Connection } from "@solana/web3.js";
import { CIRCLE_DEVNET_USDC_MINT } from "../../lib/solana/assets";
import { DEVNET_GENESIS, DEVNET_RPC } from "../../lib/solana/contracts";
import { DomainError } from "../errors";
import type { Cluster } from "./registry";

export const SOLANA_NETWORKS = {
  devnet: {
    genesis: DEVNET_GENESIS,
    url: DEVNET_RPC,
    usdc: CIRCLE_DEVNET_USDC_MINT,
  },
  "mainnet-beta": {
    genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    url: "https://api.mainnet-beta.solana.com",
    usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
} as const;

const connections = new Map<
  string,
  {
    connection: Connection;
    pin?: Promise<void>;
    pinUntil: number;
  }
>();

export async function cryptoRpc(cluster: Cluster, independent = false) {
  const network = SOLANA_NETWORKS[cluster];
  const configured = independent
    ? cluster === "devnet"
      ? process.env.AGUS_DEVNET_VERIFY_RPC
      : process.env.AGUS_MAINNET_VERIFY_RPC
    : cluster === "devnet"
      ? process.env.AGUS_DEVNET_RPC
      : process.env.AGUS_MAINNET_RPC;
  const endpoint = new URL(configured || network.url);
  if (
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.hash
  )
    throw new DomainError("PROVIDER_UNAVAILABLE", 503, true);
  if (
    independent &&
    (!configured ||
      endpoint.hostname ===
        new URL(
          (cluster === "devnet"
            ? process.env.AGUS_DEVNET_RPC
            : process.env.AGUS_MAINNET_RPC) || network.url,
        ).hostname)
  )
    throw new DomainError("INDEPENDENT_VERIFIER_REQUIRED", 503);
  const key = cluster + ":" + endpoint.href;
  let entry = connections.get(key);
  if (!entry) {
    const connection = new Connection(endpoint.href, {
      commitment: "finalized",
      disableRetryOnRateLimit: true,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(3500),
        }),
    });
    entry = { connection, pinUntil: 0 };
    connections.set(key, entry);
  }
  const current = entry;
  if (current.pinUntil < Date.now()) {
    current.pin ??= current.connection
      .getGenesisHash()
      .then((actual) => {
        if (actual !== network.genesis)
          throw new DomainError("CHAIN_IDENTITY_MISMATCH", 503);
        current.pinUntil = Date.now() + 60_000;
      })
      .finally(() => {
        current.pin = undefined;
      });
    await current.pin;
  }
  return current.connection;
}

export function explorerTransaction(cluster: Cluster, signature: string) {
  return `https://explorer.solana.com/tx/${signature}${cluster === "devnet" ? "?cluster=devnet" : ""}`;
}
