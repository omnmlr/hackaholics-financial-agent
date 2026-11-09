import {
  Connection,
  type AccountInfo,
  type Message,
  type PublicKey,
  type SignatureStatus,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { DEVNET_RPC, SolanaError } from "./contracts";
import { TOKEN_PROGRAM_ID } from "./classic-spl";

export interface SolanaRpc {
  readonly endpoint: string;
  getGenesisHash(): Promise<string>;
  getBalance(address: PublicKey): Promise<number>;
  getAccountInfo(address: PublicKey): Promise<AccountInfo<Buffer> | null>;
  getTokenAccountsByOwner(
    owner: PublicKey,
  ): Promise<{ pubkey: PublicKey; account: AccountInfo<Buffer> }[]>;
  getLatestBlockhash(): Promise<{
    blockhash: string;
    lastValidBlockHeight: number;
  }>;
  getFeeForMessage(message: Message): Promise<number | null>;
  getMinimumBalanceForRentExemption(size: number): Promise<number>;
  getBlockHeight(): Promise<number>;
  sendRawTransaction(raw: Buffer): Promise<string>;
  getSignatureStatus(signature: string): Promise<SignatureStatus | null>;
  getTransaction(
    signature: string,
  ): Promise<VersionedTransactionResponse | null>;
}

/** No caller-provided URL, custom cluster, websocket or redirect is permitted. */
export function pinnedDevnetRpc(): SolanaRpc {
  const connection = new Connection(DEVNET_RPC, {
    commitment: "confirmed",
    disableRetryOnRateLimit: true,
    fetch: async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (
        url.origin !== DEVNET_RPC ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new SolanaError(
          "RPC_ENDPOINT",
          "Only the pinned Solana devnet RPC is allowed",
          503,
        );
      return fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
    },
  });
  return {
    endpoint: DEVNET_RPC,
    getGenesisHash: () => connection.getGenesisHash(),
    getBalance: (address) => connection.getBalance(address, "confirmed"),
    getAccountInfo: (address) =>
      connection.getAccountInfo(address, "confirmed"),
    async getTokenAccountsByOwner(owner) {
      const result = await connection.getTokenAccountsByOwner(
        owner,
        { programId: TOKEN_PROGRAM_ID },
        "confirmed",
      );
      return [...result.value];
    },
    getLatestBlockhash: () => connection.getLatestBlockhash("confirmed"),
    getFeeForMessage: async (message) =>
      (await connection.getFeeForMessage(message, "confirmed")).value,
    getMinimumBalanceForRentExemption: (size) =>
      connection.getMinimumBalanceForRentExemption(size, "confirmed"),
    getBlockHeight: () => connection.getBlockHeight("confirmed"),
    // The application issues one send. An ambiguous response NEVER triggers a resend.
    sendRawTransaction: (raw) =>
      connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 0,
      }),
    getSignatureStatus: async (signature) =>
      (
        await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        })
      ).value[0],
    getTransaction: (signature) =>
      connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      }),
  };
}
