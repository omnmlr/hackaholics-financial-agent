import { Buffer } from "buffer";
import { PublicKey, Transaction } from "@solana/web3.js";
import type { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { validSignature } from "./solana-control";
import {
  ControlError,
  walletProviders,
  type WalletSigner,
} from "./wallet-control";

type WalletAPI = Parameters<Parameters<typeof transact>[0]>[0];

function addressBytes(address: string) {
  const bytes = Buffer.from(address, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== address)
    throw new Error("The wallet returned an invalid account address.");
  return new PublicKey(bytes);
}

function walletError(error: unknown, resuming: boolean): never {
  if (error instanceof ControlError) throw error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === -1 && resuming)
    throw new ControlError(
      "relink",
      "The wallet did not renew this authorization. Link the account again.",
    );
  if (
    code === -1 ||
    code === -3 ||
    code === "ERROR_ASSOCIATION_CANCELLED" ||
    (typeof code === "string" && code.includes("Local association cancelled"))
  ) {
    throw new ControlError(
      "reject",
      "Wallet authorization was declined or cancelled.",
    );
  }
  if (code === "ERROR_WALLET_NOT_FOUND")
    throw new ControlError(
      "wallet-missing",
      "The selected app did not handle Android Mobile Wallet Adapter.",
    );
  if (code === -100)
    throw new ControlError(
      "failed",
      "The wallet requires Android origin attestation for this build.",
    );
  throw new ControlError(
    "failed",
    "The selected wallet could not complete the Devnet MWA request.",
  );
}

export function mwaSigner(
  open: typeof transact,
  identity: { name: string; uri: string; icon: string },
): WalletSigner {
  const chain = "solana:devnet";
  function authorize(wallet: WalletAPI, auth_token?: string, address?: string) {
    return wallet.authorize({
      chain,
      identity,
      ...(auth_token && address ? { auth_token, addresses: [address] } : {}),
    });
  }
  return {
    async connect(provider) {
      try {
        return await open(
          async (wallet) => {
            const result = await authorize(wallet);
            const accounts = result.accounts
              .filter(
                (account) =>
                  !account.chains?.length || account.chains.includes(chain),
              )
              .map((account) => ({
                address: addressBytes(account.address).toBase58(),
                label: account.label?.slice(0, 80),
                token: result.auth_token,
              }));
            if (!accounts.length || !result.auth_token)
              throw new ControlError(
                "failed",
                "The wallet did not authorize a Devnet account.",
              );
            return accounts;
          },
          {
            baseUri: `agus-mwa-package:${walletProviders[provider].androidPackage}`,
          },
        );
      } catch (error) {
        return walletError(error, false);
      }
    },
    async send(provider, token, transfer, onAuthorized, beforeSubmit) {
      if (transfer.network !== "devnet")
        throw new Error("Only Devnet transfers are enabled.");
      const transaction = Transaction.from(
        Buffer.from(transfer.unsignedTransaction, "base64"),
      );
      if (
        transaction.serializeMessage().toString("base64") !==
          transfer.message ||
        transaction.feePayer?.toBase58() !== transfer.sender ||
        transaction.compileMessage().header.numRequiredSignatures !== 1
      ) {
        throw new Error(
          "The reviewed transfer does not match the transaction to be signed.",
        );
      }
      let resuming = true;
      try {
        return await open(
          async (wallet) => {
            const wanted = new PublicKey(transfer.sender)
              .toBuffer()
              .toString("base64");
            const result = await authorize(wallet, token, wanted);
            if (
              !result.auth_token ||
              !result.accounts.some(
                (row) =>
                  addressBytes(row.address).toBase58() === transfer.sender &&
                  (!row.chains?.length || row.chains.includes(chain)),
              )
            ) {
              throw new ControlError(
                "wrong-account",
                "The wallet authorized a different account. No transaction was requested.",
              );
            }
            resuming = false;
            await onAuthorized(result.auth_token);
            await beforeSubmit();
            const [signature] = await wallet.signAndSendTransactions({
              transactions: [transaction],
              minContextSlot: transfer.slot,
              commitment: "confirmed",
            });
            if (!validSignature(signature))
              throw new Error("Wallet did not return a transaction signature.");
            return signature;
          },
          {
            baseUri: `agus-mwa-package:${walletProviders[provider].androidPackage}`,
          },
        );
      } catch (error) {
        return walletError(error, resuming);
      }
    },
  };
}
