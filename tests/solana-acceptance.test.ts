/** Synthetic signed transactions and chain responses only. Never public proof. */
import { randomUUID } from "node:crypto";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { expect, it } from "vitest";
import {
  DEVNET_GENESIS,
  DEVNET_RPC,
  type SolanaDraft,
} from "../src/lib/solana/contracts";
import { CIRCLE_DEVNET_USDC_MINT } from "../src/lib/solana/assets";
import {
  TOKEN_PROGRAM_ID,
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "../src/lib/solana/classic-spl";
import { base58 } from "../src/lib/solana/encoding";
import { draftDigest } from "../src/lib/solana/service";
import {
  verifyDevnetTransfer,
  validateCircleDevnetMint,
} from "../src/lib/solana/acceptance";
import { createHash } from "node:crypto";

function setup(spl = false, creates = false) {
  const signer = Keypair.generate(),
    recipient = Keypair.generate().publicKey;
  const sender = signer.publicKey,
    mint = new PublicKey(CIRCLE_DEVNET_USDC_MINT);
  const source = getAssociatedTokenAddressSync(mint, sender),
    destination = getAssociatedTokenAddressSync(mint, recipient);
  const tx = new Transaction({
    feePayer: sender,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  });
  if (spl) {
    if (creates)
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          sender,
          destination,
          recipient,
          mint,
        ),
      );
    tx.add(
      createTransferCheckedInstruction(
        source,
        mint,
        destination,
        sender,
        1_000_000n,
        6,
      ),
    );
  } else
    tx.add(
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: recipient,
        lamports: 1_000_000n,
      }),
    );
  const unsigned = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  tx.sign(signer);
  const at = new Date().toISOString();
  const draft: SolanaDraft = {
    id: randomUUID(),
    owner: "fixture-owner",
    revision: 3,
    network: "devnet",
    rpcEndpoint: DEVNET_RPC,
    genesisHash: DEVNET_GENESIS,
    state: "submitted",
    sender: sender.toBase58(),
    recipient: recipient.toBase58(),
    asset: spl ? "SPL" : "SOL",
    mint: spl ? mint.toBase58() : null,
    decimals: spl ? 6 : 9,
    amount: spl ? "1" : "0.001",
    amountAtoms: "1000000",
    sourceTokenAccount: spl ? source.toBase58() : null,
    recipientTokenAccount: spl ? destination.toBase58() : null,
    createsRecipientTokenAccount: creates,
    feeLamports: "5000",
    estimatedRentLamports: creates ? "2039280" : "0",
    totalSolRequiredLamports: "fixture-only-not-used",
    blockhash: tx.recentBlockhash!,
    lastValidBlockHeight: 1000,
    preparedAt: at,
    expiresAt: at,
    unsignedTransactionBase64: unsigned,
    messageBase64: tx.serializeMessage().toString("base64"),
    messageDigest: createHash("sha256")
      .update(tx.serializeMessage())
      .digest("hex"),
    digest: "",
    approval: null,
    submission: {
      claimId: randomUUID(),
      claimedAt: at,
      signature: base58(tx.signature!),
    },
    confirmation: null,
    failureCode: null,
    simulation: { at, slot: 123, passed: true, unitsConsumed: 1000 },
  };
  draft.digest = draftDigest(draft);
  draft.approval = { actor: draft.owner, at, digest: draft.digest };
  const keys = tx.compileMessage().accountKeys.map((k) => k.toBase58());
  const preBalances = keys.map(() => 10_000_000),
    postBalances = [...preBalances];
  postBalances[0] -= 5000;
  if (!spl) {
    postBalances[0] -= 1_000_000;
    postBalances[keys.indexOf(draft.recipient)] += 1_000_000;
  }
  if (creates) {
    preBalances[keys.indexOf(destination.toBase58())] = 0;
    postBalances[keys.indexOf(destination.toBase58())] = 2039280;
    postBalances[0] -= 2039280;
  }
  const token = (address: PublicKey, owner: string, amount: string) => ({
    accountIndex: keys.indexOf(address.toBase58()),
    mint: mint.toBase58(),
    owner,
    uiTokenAmount: { amount, decimals: 6 },
  });
  const observation = {
    genesisHash: DEVNET_GENESIS,
    status: { slot: 124, err: null, confirmationStatus: "finalized" },
    transaction: {
      slot: 124,
      transaction: [tx.serialize().toString("base64"), "base64"],
      meta: {
        err: null,
        fee: 5000,
        preBalances,
        postBalances,
        preTokenBalances: spl
          ? [
              token(source, draft.sender, "2000000"),
              ...(!creates ? [token(destination, draft.recipient, "0")] : []),
            ]
          : [],
        postTokenBalances: spl
          ? [
              token(source, draft.sender, "1000000"),
              token(destination, draft.recipient, "1000000"),
            ]
          : [],
      },
    },
  };
  const data = Buffer.alloc(82);
  data[44] = 6;
  data[45] = 1;
  const mintInfo = {
    data,
    owner: TOKEN_PROGRAM_ID,
    executable: false,
    lamports: 1,
    rentEpoch: 0,
  };
  return { draft, observation, mintInfo };
}
it.each([
  [false, false],
  [true, false],
  [true, true],
])(
  "verifies exact signed instructions, finality and balance/fee/rent changes (SPL=%s, ATA=%s)",
  (spl, creates) => {
    const s = setup(spl, creates);
    expect(
      verifyDevnetTransfer(s.draft, s.observation, s.mintInfo),
    ).toMatchObject({
      amountAtoms: "1000000",
      commitment: "finalized",
      feeLamports: "5000",
      recipientAccountCreated: creates,
      balanceChangesVerified: true,
    });
  },
);
it.each([
  "finality",
  "cluster",
  "status-error",
  "meta-error",
  "slot",
  "amount",
  "recipient",
  "signature",
  "digest",
  "approval",
  "message",
  "unsafe-balance",
  "missing-balance",
])("rejects conflicting or incomplete %s evidence", (which) => {
  const s = setup();
  if (which === "finality")
    s.observation.status.confirmationStatus = "confirmed";
  if (which === "cluster")
    Object.assign(s.observation, { genesisHash: "mainnet" });
  if (which === "status-error")
    Object.assign(s.observation.status, {
      err: { InstructionError: [0, "failure"] },
    });
  if (which === "meta-error")
    Object.assign(s.observation.transaction.meta, {
      err: { InstructionError: [0, "failure"] },
    });
  if (which === "slot") s.observation.status.slot++;
  if (which === "amount") s.observation.transaction.meta.postBalances[1]++;
  if (which === "recipient") {
    s.draft.recipient = Keypair.generate().publicKey.toBase58();
    s.draft.digest = draftDigest(s.draft);
    s.draft.approval!.digest = s.draft.digest;
  }
  if (which === "signature") s.draft.submission!.signature = "1".repeat(88);
  if (which === "digest") s.draft.digest = "0".repeat(64);
  if (which === "approval") s.draft.approval!.actor = "other-owner";
  if (which === "message") s.draft.messageBase64 = "AA==";
  if (which === "unsafe-balance")
    s.observation.transaction.meta.preBalances[0] = Number.MAX_SAFE_INTEGER + 1;
  if (which === "missing-balance")
    s.observation.transaction.meta.preBalances.pop();
  expect(() =>
    verifyDevnetTransfer(s.draft, s.observation, s.mintInfo),
  ).toThrow();
});
it.each([
  "wrong-mint",
  "wrong-owner",
  "wrong-amount",
  "missing-token-evidence",
  "rent",
  "creation-not-demonstrated",
])("rejects invalid SPL evidence: %s", (which) => {
  const s = setup(true, true),
    meta = s.observation.transaction.meta;
  if (which === "wrong-mint")
    meta.postTokenBalances[1].mint = Keypair.generate().publicKey.toBase58();
  if (which === "wrong-owner") meta.postTokenBalances[1].owner = s.draft.sender;
  if (which === "wrong-amount")
    meta.postTokenBalances[1].uiTokenAmount.amount = "999999";
  if (which === "missing-token-evidence") meta.preTokenBalances = [];
  if (which === "rent") meta.postBalances[0]++;
  if (which === "creation-not-demonstrated")
    meta.preBalances[meta.postTokenBalances[1].accountIndex] = 1;
  expect(() =>
    verifyDevnetTransfer(s.draft, s.observation, s.mintInfo),
  ).toThrow();
});
it("rejects missing transaction evidence without inferring failure or resubmitting", () => {
  const s = setup();
  expect(() =>
    verifyDevnetTransfer(s.draft, { ...s.observation, transaction: null }),
  ).toThrow();
  expect(s.draft.state).toBe("submitted");
});
it("checks classic mint ownership, initialization, and canonical six decimals", () => {
  const s = setup();
  expect(validateCircleDevnetMint(s.mintInfo)).toMatchObject({
    decimals: 6,
    initialized: true,
  });
  s.mintInfo.data[44] = 9;
  expect(() => validateCircleDevnetMint(s.mintInfo)).toThrow();
  s.mintInfo.data[44] = 6;
  expect(() =>
    validateCircleDevnetMint({ ...s.mintInfo, owner: SystemProgram.programId }),
  ).toThrow();
});
