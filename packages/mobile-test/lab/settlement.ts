import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Keypair, Transaction } from "@solana/web3.js";
import { createMint, createTransferCheckedInstruction, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { base58 } from "../../../src/lib/solana/encoding";
import { assertTokenTransfer, connection, finalizedTransaction, startWindow, type TokenExpectation } from "../src/chain";
import { publicKey } from "../src/contracts";

type Prepared = { runId: string | null; genesis: string; startSlot: number; signature: string; expected: TokenExpectation };

const [directory, runId] = process.argv.slice(2);
const genesis = publicKey.parse(process.env.AGUS_TEST_LOCAL_GENESIS);
if (!directory) throw new Error("Pass a new job directory and optionally a verified run ID");
const evidenceRoot = process.env.AGUS_TEST_EVIDENCE;
if (runId) {
  if (!evidenceRoot || !/^[0-9a-f-]{36}$/.test(runId)) throw new Error("Set the evidence root and pass a valid run ID");
  const report = JSON.parse(await readFile(join(evidenceRoot, runId, "report.json"), "utf8"));
  if (report.state !== "passed" || !report.receipt || report.chainWindow.genesis !== genesis) {
    throw new Error("Provider demo requires a passed, independently verified local test run");
  }
}
const network = { cluster: "localnet" as const, genesis };
const rpc = connection(network);
const window = await startWindow(rpc, network);
const journal = join(directory, "job.json");
const save = async (value: object) => {
  await writeFile(journal + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(journal + ".tmp", journal);
};

let fresh = true;
try { await mkdir(directory, { mode: 0o700 }); }
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  fresh = false;
}
let prepared: Prepared;
if (fresh) {
  await save({ state: "preparing", genesis, runId: runId ?? null });
  const payer = Keypair.generate();
  const provider = Keypair.generate().publicKey;
  const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash("confirmed");
  const funding = await rpc.requestAirdrop(payer.publicKey, 500_000_000);
  const funded = await rpc.confirmTransaction({ blockhash, lastValidBlockHeight, signature: funding }, "confirmed");
  if (funded.value.err) throw new Error("The local validator could not fund the disposable operator");
  const confirmation = { commitment: "confirmed" as const, preflightCommitment: "confirmed" as const };
  const mint = await createMint(rpc, payer, payer.publicKey, null, 6, undefined, confirmation);
  const source = await getOrCreateAssociatedTokenAccount(rpc, payer, mint, payer.publicKey, false, "confirmed", confirmation);
  const destination = await getOrCreateAssociatedTokenAccount(rpc, payer, mint, provider, false, "confirmed", confirmation);
  await mintTo(rpc, payer, mint, source.address, payer, 5_000_000n, [], confirmation);
  const { blockhash: recentBlockhash } = await rpc.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: payer.publicKey, recentBlockhash })
    .add(createTransferCheckedInstruction(source.address, mint, destination.address, payer.publicKey, 2_500_000n, 6));
  transaction.sign(payer);
  const signature = base58(transaction.signature!);
  prepared = {
    runId: runId ?? null, genesis, startSlot: window.slot, signature,
    expected: {
      payer: payer.publicKey.toBase58(), owner: provider.toBase58(), mint: mint.toBase58(),
      source: source.address.toBase58(), destination: destination.address.toBase58(), amount: "2500000", decimals: 6,
    },
  };
  await save({ state: "submitted_or_unknown", ...prepared });
  try {
    const returned = await rpc.sendRawTransaction(transaction.serialize(), {
      maxRetries: 0, preflightCommitment: "confirmed",
    });
    if (returned !== signature) throw new Error("RPC signature differs from the pre-recorded signature");
  } catch {
    console.error("Submission unresolved. Reconciling the saved signature without resending.");
  }
} else {
  const saved = JSON.parse(await readFile(journal, "utf8"));
  if (!saved.signature || saved.genesis !== genesis || saved.runId !== (runId ?? null)) {
    throw new Error("The job has no reviewable signature or belongs to another run or validator");
  }
  prepared = saved;
}

const tx = await finalizedTransaction(rpc, prepared.signature, 35_000);
const receipt = assertTokenTransfer(tx, prepared.signature, prepared.startSlot, prepared.expected);
const result = {
  ...prepared, state: "finalized", asset: "local six-decimal test SPL token", jobQuote: { currency: "USDC", atoms: "2500000", decimals: 6 },
  receipt,
};
await save(result);
console.log(JSON.stringify(result, null, 2));
