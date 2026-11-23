import { Platform } from "react-native";
import { Buffer } from "buffer";
import { base58 } from "@scure/base";
import {
  PublicKey,
  SystemInstruction,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { digest, CryptoDigestAlgorithm } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import type { components } from "@agus/api-client";
import {
  WalletRouteError,
  walletFailure,
  type WalletDiagnostic,
  type WalletStage,
} from "./crypto-wallet-policy";

const packages = {
  phantom: "app.phantom",
  solflare: "com.solflare.mobile",
} as const;
type Provider = keyof typeof packages;
type Chain = "devnet" | "mainnet-beta";
type WalletApi = Parameters<Parameters<typeof transact>[0]>[0];
type Schemas = components["schemas"];
type Route = Schemas["CryptoRoute"];
type Review = Schemas["CryptoReview"];
type Claim = Schemas["CryptoHandoff"];
type Outcome = Schemas["CryptoWalletOutcome"];

function packageConfig(provider: Provider) {
  if (Platform.OS !== "android") throw new Error("ANDROID_WALLET_REQUIRED");
  return { baseUri: `agus-mwa-package:${packages[provider]}` };
}

function keyAddress(value: string) {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== value)
    throw new Error("INVALID_WALLET_ADDRESS");
  return new PublicKey(bytes).toBase58();
}

export function createCryptoSigner(
  userId: string,
  publishedOrigin: string,
  diagnostic?: (event: WalletDiagnostic) => void,
) {
  const url = new URL(publishedOrigin);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("VERIFIED_WALLET_ORIGIN_REQUIRED");
  if (!/^[A-Za-z0-9._-]+$/.test(userId)) throw new Error("INVALID_AGUS_USER");
  const identity = { name: "AGUS", uri: url.origin, icon: "favicon.png" };
  const storage = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
  const grantKey = (provider: Provider, cluster: Chain, address: string) =>
    `agus.crypto.grant.${userId}.${provider}.${cluster}.${address}`;
  const chainId = (cluster: Chain) =>
    cluster === "devnet" ? "solana:devnet" : "solana:mainnet";
  const providerFor = (route: Route): Provider => {
    if (route.provider !== "phantom" && route.provider !== "solflare")
      throw new Error("UNSUPPORTED_WALLET_PROVIDER");
    return route.provider;
  };
  async function select(
    wallet: WalletApi,
    provider: Provider,
    cluster: Chain,
    address: string,
  ) {
    const key = grantKey(provider, cluster, address);
    const token = await SecureStore.getItemAsync(key);
    if (!token) throw new WalletRouteError("WALLET_RECONNECT_REQUIRED");
    const wanted = new PublicKey(address).toBuffer().toString("base64");
    const chain = chainId(cluster);
    const authorization = await wallet.authorize({
      chain,
      identity,
      addresses: [wanted],
      auth_token: token,
    });
    if (
      !authorization.auth_token ||
      !authorization.accounts.some(
        (account) =>
          keyAddress(account.address) === address &&
          (!account.chains?.length || account.chains.includes(chain)),
      )
    )
      throw new WalletRouteError("WALLET_ACCOUNT_CHANGED");
    await SecureStore.setItemAsync(key, authorization.auth_token, storage);
    return wanted;
  }

  function emit(provider: Provider, stage: WalletStage, reason: string) {
    diagnostic?.({ provider, stage, reason });
  }

  async function withWallet<T>(
    provider: Provider,
    callback: (
      wallet: WalletApi,
      setStage: (stage: WalletStage) => void,
    ) => Promise<T>,
  ) {
    let stage: WalletStage = "association";
    let completed: { value: T } | undefined;
    function setStage(next: WalletStage) {
      stage = next;
      emit(provider, stage, "STARTED");
    }
    setStage("association");
    try {
      return await transact(async (wallet) => {
        setStage("authorization");
        const value = await callback(wallet, setStage);
        completed = { value };
        return value;
      }, packageConfig(provider));
    } catch (error) {
      if (completed) {
        emit(provider, stage, "WALLET_SESSION_CLEANUP");
        return completed.value;
      }
      const failure = walletFailure(error, stage);
      emit(provider, stage, failure.reason);
      throw new WalletRouteError(failure.reason);
    }
  }

  return {
    async authorize(provider: Provider, cluster: Chain) {
      return withWallet(provider, async (wallet, setStage) => {
        const chain = chainId(cluster);
        const auth = await wallet.authorize({ chain, identity });
        if (!auth.auth_token)
          throw new WalletRouteError("WALLET_RECONNECT_REQUIRED");
        const addresses = auth.accounts
          .filter(
            (account) =>
              !account.chains?.length || account.chains.includes(chain),
          )
          .map((account) => keyAddress(account.address));
        if (!addresses.length)
          throw new WalletRouteError("WALLET_ACCOUNT_CHANGED");
        for (const address of addresses)
          await SecureStore.setItemAsync(
            grantKey(provider, cluster, address),
            auth.auth_token,
            storage,
          );
        setStage("capabilities");
        return { addresses, capabilities: await wallet.getCapabilities() };
      });
    },
    async signProof(
      provider: Provider,
      cluster: Chain,
      expectedSigner: string,
      challenge: Schemas["CryptoChallenge"],
    ) {
      if (Date.parse(challenge.expiresAt) <= Date.now())
        throw new Error("CHALLENGE_EXPIRED");
      const message = Buffer.from(challenge.messageBase64, "base64");
      return withWallet(provider, async (wallet, setStage) => {
        const address = await select(wallet, provider, cluster, expectedSigner);
        setStage("ownership-proof");
        const [signed] = await wallet.signMessages({
          addresses: [address],
          payloads: [message],
        });
        if (!signed) throw new WalletRouteError("WALLET_PROOF_MISSING");
        const bytes = Buffer.from(signed);
        const signature =
          bytes.length === 64
            ? bytes
            : bytes.length === message.length + 64 &&
                Buffer.from(bytes.subarray(0, message.length)).equals(message)
              ? bytes.subarray(message.length)
              : null;
        if (!signature) throw new WalletRouteError("WALLET_PROOF_MISMATCH");
        return base58.encode(signature);
      });
    },
    async handoff(
      claim: Claim,
      route: Route,
      review: Review,
    ): Promise<Outcome> {
      const { attempt } = claim;
      if (!claim.launchGranted || attempt.state !== "handoff")
        return { kind: "unknown" };
      if (
        route.cluster !== "devnet" ||
        review.cluster !== "devnet" ||
        attempt.cluster !== "devnet" ||
        attempt.routeId !== route.id ||
        review.routeId !== route.id ||
        attempt.reviewId !== review.id ||
        attempt.reviewDigest !== review.reviewDigest ||
        attempt.revision !== review.revision ||
        attempt.expectedSigner !== route.address ||
        review.expectedSigner !== route.address ||
        review.transactionVersion !== "legacy" ||
        review.operation !== "transfer" ||
        review.feePayer !== route.address ||
        review.amount?.asset.cluster !== "devnet" ||
        !review.amount ||
        !review.recipient ||
        !(Date.parse(review.expiresAt) > Date.now())
      )
        return { kind: "unavailable", reason: "EXACT_FRESH_REVIEW_REQUIRED" };
      const provider = providerFor(route);
      let stage: WalletStage = "association";
      let returnedSignature: string | undefined;
      try {
        const tx = Transaction.from(
          Buffer.from(review.unsignedTransactionBase64, "base64"),
        );
        const digestHex = Buffer.from(
          await digest(
            CryptoDigestAlgorithm.SHA256,
            Uint8Array.from(tx.serializeMessage()),
          ),
        ).toString("hex");
        if (
          digestHex !== review.messageDigest ||
          tx.feePayer?.toBase58() !== route.address ||
          tx.recentBlockhash !== review.blockhash ||
          tx.compileMessage().header.numRequiredSignatures !== 1
        )
          return { kind: "unavailable", reason: "REVIEW_MESSAGE_MISMATCH" };
        if (review.amount.asset.kind === "sol") {
          const ix = tx.instructions[0];
          const decoded =
            ix && ix.programId.equals(SystemProgram.programId)
              ? SystemInstruction.decodeTransfer(ix)
              : null;
          if (
            !decoded ||
            tx.instructions.length !== 1 ||
            decoded.fromPubkey.toBase58() !== route.address ||
            decoded.toPubkey.toBase58() !== review.recipient ||
            decoded.lamports.toString() !== review.amount.atoms
          )
            return { kind: "unavailable", reason: "REVIEW_MESSAGE_MISMATCH" };
        } else {
          const transfer = tx.instructions.at(-1);
          const data = transfer && Buffer.from(transfer.data);
          const asset = review.amount.asset;
          if (
            !transfer ||
            !data ||
            data.length !== 10 ||
            data[0] !== 12 ||
            data[9] !== review.amount.decimals ||
            data.readBigUInt64LE(1).toString() !== review.amount.atoms ||
            transfer.programId.toBase58() !== asset.program ||
            transfer.keys[0]?.pubkey.toBase58() !== review.sourceTokenAccount ||
            transfer.keys[1]?.pubkey.toBase58() !== asset.mint ||
            transfer.keys[2]?.pubkey.toBase58() !==
              review.destinationTokenAccount ||
            transfer.keys[3]?.pubkey.toBase58() !== route.address
          )
            return { kind: "unavailable", reason: "REVIEW_MESSAGE_MISMATCH" };
        }
        const marker = `agus.crypto.launch.${userId}.${attempt.id}`;
        if (await SecureStore.getItemAsync(marker)) return { kind: "unknown" };
        await SecureStore.setItemAsync(marker, review.messageDigest, storage);
        emit(provider, stage, "STARTED");
        return await transact(async (wallet) => {
          stage = "authorization";
          emit(provider, stage, "STARTED");
          await select(wallet, provider, "devnet", route.address);
          stage = "capabilities";
          emit(provider, stage, "STARTED");
          const caps = await wallet.getCapabilities();
          if (
            !caps.supported_transaction_versions?.includes("legacy") ||
            !caps.supports_sign_and_send_transactions
          )
            throw new WalletRouteError("UNSUPPORTED_SIGNER_CAPABILITY");
          if (!(Date.parse(review.expiresAt) > Date.now()))
            throw new WalletRouteError("EXACT_FRESH_REVIEW_REQUIRED");
          stage = "submission";
          emit(provider, stage, "STARTED");
          const [signature] = await wallet.signAndSendTransactions({
            transactions: [tx],
            minContextSlot: review.minContextSlot,
            commitment: "confirmed",
          });
          if (!signature || base58.decode(signature).length !== 64)
            throw new WalletRouteError("WALLET_SIGNATURE_UNAVAILABLE");
          returnedSignature = signature;
          emit(provider, stage, "SIGNATURE_RETURNED");
          return { kind: "signature", signature };
        }, packageConfig(provider));
      } catch (error) {
        if (returnedSignature) {
          emit(provider, stage, "WALLET_SESSION_CLEANUP");
          return { kind: "signature", signature: returnedSignature };
        }
        const failure = walletFailure(error, stage);
        emit(provider, stage, failure.reason);
        return failure.outcome;
      }
    },
    async unlink(route: Route) {
      const provider = providerFor(route);
      const key = grantKey(provider, route.cluster, route.address);
      const token = await SecureStore.getItemAsync(key);
      await SecureStore.deleteItemAsync(key);
      if (token)
        await transact(
          (wallet) => wallet.deauthorize({ auth_token: token }),
          packageConfig(provider),
        );
    },
  };
}
