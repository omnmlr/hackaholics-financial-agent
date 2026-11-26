import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { Connection } from "@solana/web3.js";
import { z } from "zod";
import {
  CryptoReceipt,
  CryptoReview,
} from "../../packages/contracts/src/crypto";
import { DEVNET_GENESIS } from "../../src/lib/solana/contracts";
import { safeLamports } from "../../src/lib/solana/money";
import { cryptoRpc, explorerTransaction } from "../../src/server/crypto/rpc";
import { invariant } from "../../src/server/errors";
import { inspectRequestPayment } from "../../src/server/request-chain";

const Entry = z.strictObject({ review: CryptoReview, receipt: CryptoReceipt });
const Sequence = z.tuple([Entry, Entry, Entry]);
type Entry = z.infer<typeof Entry>;
const amount = 1_000_000n;

async function readEvidence(path: string) {
  const file = await open(path, "r");
  try {
    const limit = 128 * 1024;
    const buffer = Buffer.alloc(limit + 1);
    invariant((await file.stat()).isFile(), "EVIDENCE_FILE_REQUIRED");
    const { bytesRead } = await file.read(buffer);
    invariant(bytesRead <= limit, "EVIDENCE_FILE_TOO_LARGE");
    return Sequence.parse(JSON.parse(buffer.subarray(0, bytesRead).toString()));
  } finally {
    await file.close();
  }
}

async function observe(chain: Connection, { review, receipt }: Entry) {
  const { signature } = receipt;
  const { expectedSigner, recipient, reference } = review;
  invariant(recipient && reference, "TRANSFER_REFERENCE_REQUIRED");
  const [transaction, statuses] = await Promise.all([
    chain.getTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    }),
    chain.getSignatureStatuses([signature], { searchTransactionHistory: true }),
  ]);
  const verified = inspectRequestPayment(
    {
      recipient,
      reference,
      amountAtoms: amount.toString(),
      asset: "SOL",
      mint: null,
      scale: 9,
    },
    signature,
    { genesisHash: DEVNET_GENESIS, status: statuses.value[0], transaction },
  );
  invariant(
    transaction?.meta && verified.sender === expectedSigner,
    "WALLET_SIGNER_MISMATCH",
  );
  const {
    meta,
    transaction: { message },
  } = transaction;
  const messageDigest = createHash("sha256")
    .update(message.serialize())
    .digest("hex");
  const feeLamports = safeLamports(meta.fee).toString();
  const blockTime =
    verified.blockTime === null
      ? null
      : new Date(verified.blockTime * 1000).toISOString();
  invariant(
    messageDigest === review.messageDigest &&
      messageDigest === receipt.messageDigest &&
      feeLamports === receipt.feeLamports &&
      verified.slot === receipt.slot &&
      blockTime === receipt.time,
    "ON_CHAIN_RECEIPT_MISMATCH",
  );
  function balanceChange(address: string) {
    const index = message.staticAccountKeys.findIndex(
      (key) => key.toBase58() === address,
    );
    invariant(index >= 0, "WALLET_BALANCES_UNAVAILABLE");
    const before = safeLamports(meta!.preBalances[index]);
    const after = safeLamports(meta!.postBalances[index]);
    return {
      address,
      before: before.toString(),
      after: after.toString(),
      delta: (after - before).toString(),
    };
  }
  return {
    attemptId: receipt.attemptId,
    receiptId: receipt.id,
    signature,
    slot: verified.slot,
    blockTime,
    messageDigest,
    feeLamports,
    sender: balanceChange(expectedSigner),
    recipient: balanceChange(recipient),
    explorerUrl: explorerTransaction("devnet", signature),
  };
}

try {
  const { values } = parseArgs({
    options: { input: { type: "string" }, output: { type: "string" } },
  });
  invariant(values.input, "EVIDENCE_FILE_REQUIRED");
  const sequence = await readEvidence(values.input);
  const [{ review: first }, { review: second }, { review: third }] = sequence;
  invariant(
    first.expectedSigner !== first.recipient &&
      second.expectedSigner === first.recipient &&
      second.recipient === first.expectedSigner &&
      third.expectedSigner === first.expectedSigner &&
      third.recipient === first.recipient,
    "WALLET_SEQUENCE_MISMATCH",
  );
  invariant(
    new Set(sequence.map(({ receipt }) => receipt.signature)).size === 3 &&
      new Set(sequence.map(({ receipt }) => receipt.attemptId)).size === 3 &&
      new Set(sequence.map(({ review }) => review.reference)).size === 3,
    "WALLET_SEQUENCE_DUPLICATE",
  );
  for (const { review, receipt } of sequence) {
    invariant(
      review.cluster === "devnet" &&
        review.operation === "transfer" &&
        review.amount?.asset.kind === "sol" &&
        review.amount.asset.cluster === "devnet" &&
        review.amount.atoms === amount.toString() &&
        review.amount.decimals === 9 &&
        receipt.source.cluster === "devnet" &&
        receipt.source.mode === "public-rpc" &&
        receipt.attemptId !== null &&
        receipt.walletIds.includes(review.sourceWalletId),
      "DEVNET_RECEIPT_REQUIRED",
    );
  }
  const [primary, verifier] = await Promise.all([
    cryptoRpc("devnet"),
    cryptoRpc("devnet", true),
  ]);
  const observations = [];
  for (const entry of sequence) {
    const [left, right] = await Promise.all([
      observe(primary, entry),
      observe(verifier, entry),
    ]);
    invariant(
      JSON.stringify(left) === JSON.stringify(right),
      "INDEPENDENT_RPC_DISAGREEMENT",
    );
    observations.push(left);
  }
  const output =
    JSON.stringify(
      {
        network: "devnet",
        genesisHash: DEVNET_GENESIS,
        verification: "finalized_chain_and_receipt_agreement",
        providers: 2,
        observedAt: new Date().toISOString(),
        observations,
      },
      null,
      2,
    ) + "\n";
  if (values.output)
    await writeFile(values.output, output, { flag: "wx", mode: 0o600 });
  process.stdout.write(output);
} catch (error) {
  const code =
    error instanceof Error && /^[A-Z_]+$/.test(error.message)
      ? error.message
      : "WALLET_RECEIPT_VERIFICATION_FAILED";
  console.error(code);
  process.exitCode = 1;
}
