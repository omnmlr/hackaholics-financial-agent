import {
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  SystemProgram,
  type Message,
  type SignatureStatus,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { DEVNET_GENESIS } from "../lib/solana/contracts";
import { CIRCLE_DEVNET_USDC_MINT } from "../lib/solana/assets";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "../lib/solana/classic-spl";
import { safeLamports, MAX_U64 } from "../lib/solana/money";
import { invariant } from "./errors";
export type RequestTerms = {
  reference: string;
  recipient: string;
  asset: "SOL" | "SPL";
  amountAtoms: string;
  mint: string | null;
  scale: number;
};
export type RequestChainObservation = {
  genesisHash: string;
  status: SignatureStatus | null;
  transaction: VersionedTransactionResponse | null;
};
export type RequestChainReceipt = {
  signature: string;
  sender: string;
  slot: number;
  blockTime: number | null;
  amountAtoms: string;
  asset: "SOL" | "SPL";
  mint: string | null;
  genesisHash: typeof DEVNET_GENESIS;
  verification: "chain_finalized";
};
/** A receipt inspector, not transaction approval. External wallets supply their
 * own signatures. References alone, memo text, status strings and screenshots
 * are insufficient. Unsupported/ambiguous observations remain unresolved. */
export function inspectRequestPayment(
  t: RequestTerms,
  signature: string,
  o: RequestChainObservation,
): RequestChainReceipt {
  invariant(o.genesisHash === DEVNET_GENESIS, "WRONG_DEVNET_GENESIS", 502);
  const observed = o.transaction;
  invariant(
    o.status?.confirmationStatus === "finalized" &&
      o.status.err === null &&
      observed?.meta &&
      observed.meta.err === null &&
      o.status.slot === observed.slot &&
      Number.isSafeInteger(observed.slot) &&
      observed.slot >= 0,
    "REQUEST_FINALITY_PENDING",
    409,
  );
  invariant(
    observed.version === "legacy" &&
      observed.transaction.signatures.length === 1 &&
      observed.transaction.signatures[0] === signature,
    "REQUEST_TRANSACTION_UNSUPPORTED",
    409,
  );
  const message = observed.transaction.message as Message,
    tx = Transaction.populate(message, observed.transaction.signatures);
  invariant(
    tx.verifySignatures(true) && tx.feePayer,
    "REQUEST_SIGNATURE_INVALID",
    409,
  );
  const sender = tx.feePayer.toBase58(),
    amount = BigInt(t.amountAtoms);
  invariant(
    amount > 0n &&
      amount <= MAX_U64 &&
      (t.asset === "SOL"
        ? t.mint === null && t.scale === 9
        : t.mint === CIRCLE_DEVNET_USDC_MINT && t.scale === 6),
    "REQUEST_ASSET_UNSUPPORTED",
    409,
  );
  const transfers = tx.instructions.filter((ix) =>
    ix.programId.equals(
      t.asset === "SOL" ? SystemProgram.programId : TOKEN_PROGRAM_ID,
    ),
  );
  invariant(transfers.length === 1, "REQUEST_TRANSFER_AMBIGUOUS", 409);
  const transfer = transfers[0],
    reference = transfer.keys.at(-1);
  invariant(
    reference?.pubkey.toBase58() === t.reference &&
      !reference.isSigner &&
      !reference.isWritable,
    "REQUEST_REFERENCE_MISMATCH",
    409,
  );
  const destination =
    t.asset === "SOL"
      ? new PublicKey(t.recipient)
      : getAssociatedTokenAddressSync(
          new PublicKey(CIRCLE_DEVNET_USDC_MINT),
          new PublicKey(t.recipient),
          true,
        );
  for (const ix of tx.instructions) {
    if (ix === transfer) continue;
    if (ix.programId.equals(ComputeBudgetProgram.programId)) {
      invariant(
        ix.keys.length === 0 &&
          ((ix.data[0] === 2 && ix.data.length === 5) ||
            (ix.data[0] === 3 && ix.data.length === 9)),
        "REQUEST_TRANSACTION_UNSUPPORTED",
        409,
      );
      continue;
    }
    if (t.asset === "SPL" && ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      const expected = createAssociatedTokenAccountIdempotentInstruction(
        tx.feePayer,
        destination,
        new PublicKey(t.recipient),
        new PublicKey(CIRCLE_DEVNET_USDC_MINT),
      );
      invariant(
        (ix.data.length === 0 ||
          (ix.data.length === 1 && [0, 1].includes(ix.data[0]))) &&
          ix.keys.length === expected.keys.length &&
          ix.keys.every((k, i) => k.pubkey.equals(expected.keys[i].pubkey)),
        "REQUEST_TRANSACTION_UNSUPPORTED",
        409,
      );
      continue;
    }
    invariant(false, "REQUEST_TRANSACTION_UNSUPPORTED", 409);
  }
  const index = (address: string) =>
    message.accountKeys.findIndex((k) => k.toBase58() === address);
  if (t.asset === "SOL") {
    invariant(
      transfer.keys.length === 3 &&
        transfer.data.length === 12 &&
        transfer.data.readUInt32LE(0) === 2 &&
        transfer.data.readBigUInt64LE(4) === amount &&
        transfer.keys[0].pubkey.toBase58() === sender &&
        transfer.keys[0].isSigner &&
        transfer.keys[1].pubkey.equals(destination) &&
        transfer.keys[1].isWritable,
      "REQUEST_TRANSFER_MISMATCH",
      409,
    );
    const si = index(sender),
      di = index(t.recipient),
      meta = observed.meta;
    invariant(
      si >= 0 &&
        di >= 0 &&
        safeLamports(meta.postBalances[di]) -
          safeLamports(meta.preBalances[di]) ===
          amount &&
        safeLamports(meta.preBalances[si]) -
          safeLamports(meta.postBalances[si]) ===
          amount + safeLamports(meta.fee),
      "REQUEST_BALANCE_MISMATCH",
      409,
    );
  } else {
    invariant(
      transfer.keys.length === 5 &&
        transfer.data.length === 10 &&
        transfer.data[0] === 12 &&
        transfer.data.readBigUInt64LE(1) === amount &&
        transfer.data[9] === 6 &&
        transfer.keys[1].pubkey.toBase58() === CIRCLE_DEVNET_USDC_MINT &&
        transfer.keys[2].pubkey.equals(destination) &&
        transfer.keys[2].isWritable &&
        transfer.keys[3].pubkey.toBase58() === sender &&
        transfer.keys[3].isSigner,
      "REQUEST_TRANSFER_MISMATCH",
      409,
    );
    const tokenBalance = (
      phase: "preTokenBalances" | "postTokenBalances",
      address: string,
      owner: string,
      missing = false,
    ) => {
      const entries =
        observed.meta![phase]?.filter(
          (b) => b.accountIndex === index(address),
        ) ?? [];
      if (missing && entries.length === 0) return 0n;
      invariant(
        entries.length === 1 &&
          entries[0].owner === owner &&
          entries[0].mint === CIRCLE_DEVNET_USDC_MINT &&
          entries[0].uiTokenAmount.decimals === 6 &&
          /^[0-9]+$/.test(entries[0].uiTokenAmount.amount),
        "REQUEST_TOKEN_EVIDENCE_INCOMPLETE",
        409,
      );
      return BigInt(entries[0].uiTokenAmount.amount);
    };
    const source = transfer.keys[0].pubkey.toBase58();
    invariant(
      tokenBalance("postTokenBalances", destination.toBase58(), t.recipient) -
        tokenBalance(
          "preTokenBalances",
          destination.toBase58(),
          t.recipient,
          true,
        ) ===
        amount &&
        tokenBalance("preTokenBalances", source, sender) -
          tokenBalance("postTokenBalances", source, sender) ===
          amount,
      "REQUEST_BALANCE_MISMATCH",
      409,
    );
  }
  return {
    signature,
    sender,
    slot: observed.slot,
    blockTime:
      Number.isSafeInteger(observed.blockTime) && observed.blockTime! >= 0
        ? observed.blockTime!
        : null,
    amountAtoms: t.amountAtoms,
    asset: t.asset,
    mint: t.mint,
    genesisHash: DEVNET_GENESIS,
    verification: "chain_finalized",
  };
}
