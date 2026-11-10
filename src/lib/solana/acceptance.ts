/** Independent, read-only Sprint 1 evidence validation. This does not authorize,
 * sign, submit or repair transfers. Missing/conflicting evidence fails closed. */
import { createHash } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
} from "@solana/web3.js";
import { z } from "zod";
import { DEVNET_GENESIS, DEVNET_RPC, type SolanaDraft } from "./contracts";
import { CIRCLE_DEVNET_USDC_MINT, CIRCLE_DEVNET_USDC_DECIMALS } from "./assets";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  unpackMint,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "./classic-spl";
import { base58 } from "./encoding";
import { draftDigest } from "./service";
import { decimalToAtoms } from "./money";

const amount = z.string().regex(/^(0|[1-9][0-9]*)$/);
const integer = z.number().int().nonnegative().safe();
const tokenBalance = z.object({
  accountIndex: integer,
  mint: z.string(),
  owner: z.string(),
  uiTokenAmount: z.object({ amount, decimals: integer }),
});
const observation = z.object({
  genesisHash: z.literal(DEVNET_GENESIS),
  status: z.object({
    slot: integer,
    err: z.null(),
    confirmationStatus: z.literal("finalized"),
  }),
  transaction: z.object({
    slot: integer,
    transaction: z.tuple([z.string().min(1).max(1644), z.literal("base64")]),
    meta: z.object({
      err: z.null(),
      fee: integer,
      preBalances: z.array(integer),
      postBalances: z.array(integer),
      preTokenBalances: z.array(tokenBalance).optional(),
      postTokenBalances: z.array(tokenBalance).optional(),
    }),
  }),
});
function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`DEVNET_ACCEPTANCE: ${message}`);
}
export function validateCircleDevnetMint(info: AccountInfo<Buffer> | null) {
  const mint = unpackMint(
    new PublicKey(CIRCLE_DEVNET_USDC_MINT),
    info,
    TOKEN_PROGRAM_ID,
  );
  ensure(
    mint.isInitialized && mint.decimals === CIRCLE_DEVNET_USDC_DECIMALS,
    "canonical test-USDC mint identity mismatch",
  );
  return {
    mint: CIRCLE_DEVNET_USDC_MINT,
    decimals: mint.decimals,
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    initialized: true as const,
  };
}

export function verifyDevnetTransfer(
  d: SolanaDraft,
  rawObservation: unknown,
  mintInfo?: AccountInfo<Buffer> | null,
) {
  const parsed = observation.safeParse(rawObservation);
  ensure(
    parsed.success,
    "missing, failed, unsafe or non-finalized chain evidence",
  );
  const o = parsed.data;
  ensure(
    d.network === "devnet" &&
      d.rpcEndpoint === DEVNET_RPC &&
      d.genesisHash === DEVNET_GENESIS,
    "wrong draft network",
  );
  ensure(
    d.digest === draftDigest(d) &&
      d.approval?.actor === d.owner &&
      d.approval?.digest === d.digest &&
      d.simulation?.passed,
    "draft approval integrity mismatch",
  );
  ensure(
    d.submission &&
      ["submitting", "submitted", "unknown", "confirmed", "finalized"].includes(
        d.state,
      ),
    "no saved submission claim",
  );
  ensure(
    d.sender !== d.recipient && /^[1-9][0-9]*$/.test(d.amountAtoms),
    "invalid expected instruction",
  );
  ensure(
    decimalToAtoms(d.amount, d.decimals).toString() === d.amountAtoms,
    "reviewed decimal amount mismatch",
  );
  const [serialized] = o.transaction.transaction;
  const bytes = Buffer.from(serialized, "base64");
  ensure(
    bytes.toString("base64") === serialized && bytes.length <= 1232,
    "noncanonical transaction encoding",
  );
  const tx = Transaction.from(bytes);
  const message = tx.serializeMessage();
  ensure(
    tx.signatures.length === 1 &&
      tx.verifySignatures(true) &&
      tx.signature &&
      base58(tx.signature) === d.submission.signature,
    "signature mismatch",
  );
  ensure(
    message.toString("base64") === d.messageBase64 &&
      createHash("sha256").update(message).digest("hex") === d.messageDigest,
    "reviewed message mismatch",
  );
  ensure(
    tx.feePayer?.toBase58() === d.sender &&
      o.status.slot === o.transaction.slot,
    "payer or slot mismatch",
  );
  const sender = new PublicKey(d.sender),
    recipient = new PublicKey(d.recipient);
  let expected;
  if (d.asset === "SOL") {
    ensure(
      d.mint === null &&
        d.decimals === 9 &&
        !d.createsRecipientTokenAccount &&
        d.sourceTokenAccount === null &&
        d.recipientTokenAccount === null,
      "SOL identity mismatch",
    );
    expected = [
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: recipient,
        lamports: BigInt(d.amountAtoms),
      }),
    ];
  } else {
    ensure(
      d.asset === "SPL" &&
        d.mint === CIRCLE_DEVNET_USDC_MINT &&
        d.decimals === 6 &&
        d.sourceTokenAccount &&
        d.recipientTokenAccount,
      "acceptance requires canonical Circle test-USDC",
    );
    validateCircleDevnetMint(mintInfo ?? null);
    const mint = new PublicKey(d.mint),
      destination = new PublicKey(d.recipientTokenAccount);
    ensure(
      getAssociatedTokenAddressSync(mint, recipient).equals(destination),
      "recipient associated account mismatch",
    );
    expected = d.createsRecipientTokenAccount
      ? [
          createAssociatedTokenAccountIdempotentInstruction(
            sender,
            destination,
            recipient,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          ),
        ]
      : [];
    expected.push(
      createTransferCheckedInstruction(
        new PublicKey(d.sourceTokenAccount),
        mint,
        destination,
        sender,
        BigInt(d.amountAtoms),
        d.decimals,
        [],
        TOKEN_PROGRAM_ID,
      ),
    );
  }
  // Compiling a message promotes account permissions across all instructions;
  // compare the compiled messages to account for canonical permission promotion.
  if (d.reference)
    expected
      .at(-1)!
      .keys.push({
        pubkey: new PublicKey(d.reference),
        isSigner: false,
        isWritable: false,
      });
  const expectedTx = new Transaction({
    feePayer: sender,
    recentBlockhash: d.blockhash,
  }).add(...expected);
  ensure(
    expectedTx.serializeMessage().equals(message),
    "unexpected instruction or destination",
  );
  const keys = tx.compileMessage().accountKeys.map((k) => k.toBase58());
  const meta = o.transaction.meta;
  ensure(
    meta.preBalances.length === keys.length &&
      meta.postBalances.length === keys.length,
    "incomplete balance evidence",
  );
  const delta = (key: string) => {
    const index = keys.indexOf(key);
    ensure(index >= 0, "missing account balance");
    return BigInt(meta.postBalances[index]) - BigInt(meta.preBalances[index]);
  };
  let actualRent = 0n;
  if (d.asset === "SOL") {
    ensure(
      delta(d.recipient) === BigInt(d.amountAtoms),
      "recipient SOL change mismatch",
    );
  } else {
    const tokenAmount = (
      balances: z.infer<typeof tokenBalance>[] | undefined,
      account: string,
      owner: string,
      absent = false,
    ) => {
      const rows = balances?.filter(
        (t) => t.accountIndex === keys.indexOf(account),
      );
      if (rows?.length === 0 && absent) return 0n;
      ensure(
        rows?.length === 1 &&
          rows[0].mint === d.mint &&
          rows[0].owner === owner &&
          rows[0].uiTokenAmount.decimals === d.decimals,
        "incomplete token ownership/balance evidence",
      );
      return BigInt(rows[0].uiTokenAmount.amount);
    };
    const sourceChange =
      tokenAmount(meta.postTokenBalances, d.sourceTokenAccount!, d.sender) -
      tokenAmount(meta.preTokenBalances, d.sourceTokenAccount!, d.sender);
    const recipientChange =
      tokenAmount(
        meta.postTokenBalances,
        d.recipientTokenAccount!,
        d.recipient,
      ) -
      tokenAmount(
        meta.preTokenBalances,
        d.recipientTokenAccount!,
        d.recipient,
        d.createsRecipientTokenAccount,
      );
    ensure(
      sourceChange === -BigInt(d.amountAtoms) &&
        recipientChange === BigInt(d.amountAtoms),
      "token amount change mismatch",
    );
    if (d.createsRecipientTokenAccount) {
      ensure(
        meta.preBalances[keys.indexOf(d.recipientTokenAccount!)] === 0,
        "recipient account creation not demonstrated",
      );
      actualRent = delta(d.recipientTokenAccount!);
      ensure(
        actualRent > 0n && actualRent.toString() === d.estimatedRentLamports,
        "rent change mismatch",
      );
    }
  }
  const senderCost =
    BigInt(meta.fee) +
    actualRent +
    (d.asset === "SOL" ? BigInt(d.amountAtoms) : 0n);
  ensure(
    delta(d.sender) === -senderCost,
    "sender amount, fee or rent mismatch",
  );
  return {
    network: "devnet" as const,
    genesisHash: DEVNET_GENESIS,
    rpcEndpoint: DEVNET_RPC,
    draftId: d.id,
    instructionDigest: d.digest,
    messageDigest: d.messageDigest,
    signature: d.submission.signature,
    sender: d.sender,
    recipient: d.recipient,
    asset: d.asset,
    mint: d.mint,
    amountAtoms: d.amountAtoms,
    decimals: d.decimals,
    slot: o.transaction.slot,
    commitment: "finalized" as const,
    metaError: null,
    feeLamports: String(meta.fee),
    quotedFeeLamports: d.feeLamports,
    recipientAccountCreated: d.createsRecipientTokenAccount,
    actualRentLamports: String(actualRent),
    balanceChangesVerified: true as const,
  };
}
