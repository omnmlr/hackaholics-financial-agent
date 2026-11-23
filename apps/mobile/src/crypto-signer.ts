import { Platform } from "react-native";
import { Buffer } from "buffer";
import { base58 } from "@scure/base";
import { PublicKey, Transaction } from "@solana/web3.js";
import { digest, CryptoDigestAlgorithm } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import type { components } from "@agus/api-client";

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

export function createCryptoSigner(userId: string, publishedOrigin: string) {
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
    if (!token) throw new Error("WALLET_RECONNECT_REQUIRED");
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
      throw new Error("WALLET_ACCOUNT_CHANGED");
    await SecureStore.setItemAsync(key, authorization.auth_token, storage);
    return wanted;
  }

  return {
    async authorize(provider: Provider, cluster: Chain) {
      return transact(async (wallet) => {
        const chain = chainId(cluster);
        const auth = await wallet.authorize({ chain, identity });
        if (!auth.auth_token) throw new Error("WALLET_RECONNECT_REQUIRED");
        const addresses = auth.accounts
          .filter(
            (account) =>
              !account.chains?.length || account.chains.includes(chain),
          )
          .map((account) => keyAddress(account.address));
        for (const address of addresses)
          await SecureStore.setItemAsync(
            grantKey(provider, cluster, address),
            auth.auth_token,
            storage,
          );
        return { addresses, capabilities: await wallet.getCapabilities() };
      }, packageConfig(provider));
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
      return transact(async (wallet) => {
        const address = await select(wallet, provider, cluster, expectedSigner);
        const [signed] = await wallet.signMessages({
          addresses: [address],
          payloads: [message],
        });
        if (!signed) throw new Error("WALLET_PROOF_MISSING");
        const bytes = Buffer.from(signed);
        const signature =
          bytes.length === 64
            ? bytes
            : bytes.length === message.length + 64 &&
                Buffer.from(bytes.subarray(0, message.length)).equals(message)
              ? bytes.subarray(message.length)
              : null;
        if (!signature) throw new Error("WALLET_PROOF_MISMATCH");
        return base58.encode(signature);
      }, packageConfig(provider));
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
        Date.parse(review.expiresAt) <= Date.now()
      )
        return { kind: "unavailable", reason: "EXACT_FRESH_REVIEW_REQUIRED" };
      const provider = providerFor(route);
      const tx = Transaction.from(
        Buffer.from(review.unsignedTransactionBase64, "base64"),
      );
      const digestHex = Buffer.from(
        await digest(CryptoDigestAlgorithm.SHA256, tx.serializeMessage()),
      ).toString("hex");
      if (
        digestHex !== review.messageDigest ||
        tx.feePayer?.toBase58() !== route.address ||
        tx.compileMessage().header.numRequiredSignatures !== 1
      )
        return { kind: "unavailable", reason: "REVIEW_MESSAGE_MISMATCH" };
      const marker = `agus.crypto.launch.${userId}.${attempt.id}`;
      if (await SecureStore.getItemAsync(marker)) return { kind: "unknown" };
      await SecureStore.setItemAsync(marker, review.messageDigest, storage);
      let signingRequested = false;
      try {
        return await transact(async (wallet) => {
          await select(wallet, provider, "devnet", route.address);
          const caps = await wallet.getCapabilities();
          if (
            !caps.supported_transaction_versions.includes("legacy") ||
            (!caps.supports_sign_and_send_transactions &&
              !caps.features.includes("solana:signAndSendTransaction"))
          )
            return {
              kind: "unavailable",
              reason: "UNSUPPORTED_SIGNER_CAPABILITY",
            };
          signingRequested = true;
          const [signature] = await wallet.signAndSendTransactions({
            transactions: [tx],
            minContextSlot: review.minContextSlot,
            commitment: "confirmed",
            skipPreflight: false,
            maxRetries: 0,
          });
          if (!signature || base58.decode(signature).length !== 64)
            return { kind: "unknown" };
          return { kind: "signature", signature };
        }, packageConfig(provider));
      } catch (error) {
        const code = (error as { code?: string | number })?.code;
        if (code === -3) return { kind: "declined" };
        if (signingRequested) return { kind: "unknown" };
        if (code === "ERROR_WALLET_NOT_FOUND")
          return { kind: "unavailable", reason: "WALLET_NOT_INSTALLED" };
        if (
          error instanceof Error &&
          /low power|battery saver/i.test(error.message)
        )
          return { kind: "unavailable", reason: "WALLET_POWER_RESTRICTION" };
        if (code === -100)
          return { kind: "unavailable", reason: "WALLET_ATTESTATION_REQUIRED" };
        return { kind: "unavailable", reason: "WALLET_RECONNECT_REQUIRED" };
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
