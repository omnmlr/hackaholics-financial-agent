import { Platform } from "react-native";
import { PublicKey, Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import type { DevnetDraft } from "@agus/contracts";
import { apiOrigin } from "./session";
export async function connectAndroidWallet() {
  if (Platform.OS !== "android") throw new Error("ANDROID_WALLET_REQUIRED");
  return transact(async (wallet) => {
    const result = await wallet.authorize({
      chain: "solana:devnet",
      identity: {
        name: "AGUS Devnet prototype",
        uri: apiOrigin,
        icon: "favicon.ico",
      },
    });
    if (!result.accounts[0]) throw new Error("WALLET_ACCOUNT_REQUIRED");
    return new PublicKey(
      Buffer.from(result.accounts[0].address, "base64"),
    ).toBase58();
  });
}
export async function signExactDraft(draft: DevnetDraft) {
  if (Platform.OS !== "android") throw new Error("ANDROID_WALLET_REQUIRED");
  if (
    draft.network !== "devnet" ||
    draft.state !== "approved" ||
    !draft.simulation?.passed ||
    Date.parse(draft.expiresAt) <= Date.now()
  )
    throw new Error("EXACT_FRESH_APPROVAL_REQUIRED");
  return transact(async (wallet) => {
    const authorization = await wallet.authorize({
      chain: "solana:devnet",
      identity: {
        name: "AGUS Devnet prototype",
        uri: apiOrigin,
        icon: "favicon.ico",
      },
    });
    const account = authorization.accounts[0];
    if (
      !account ||
      new PublicKey(Buffer.from(account.address, "base64")).toBase58() !==
        draft.sender
    )
      throw new Error("WALLET_ACCOUNT_CHANGED");
    const transaction = Transaction.from(
      Buffer.from(draft.unsignedTransactionBase64, "base64"),
    );
    if (
      transaction.serializeMessage().toString("base64") !== draft.messageBase64
    )
      throw new Error("DRAFT_MESSAGE_MISMATCH");
    const [signed] = await wallet.signTransactions({
      transactions: [transaction],
    });
    if (
      !signed ||
      signed.serializeMessage().toString("base64") !== draft.messageBase64 ||
      !signed.verifySignatures()
    )
      throw new Error("WALLET_SIGNATURE_MISMATCH");
    // MWA signs only. AGUS's existing server submission claim remains the sole
    // broadcast boundary; never call the wallet's signAndSendTransactions API.
    return signed.serialize().toString("base64");
  });
}
