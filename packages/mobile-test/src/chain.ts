import { Connection, PublicKey, SystemProgram, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { DEVNET_GENESIS } from "../../../src/lib/solana/contracts";
import { pinnedDevnetConnection } from "../../../src/lib/solana/rpc";
import { RunFailure, type Config } from "./contracts";

export const localRpc = "http://127.0.0.1:8899";
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export type SolExpectation = { payer: string; recipient: string; lamports: string };
export type TokenExpectation = { payer: string; mint: string; source: string; destination: string; amount: string; decimals: number; owner: string };

export function connection(network: Config["network"]) {
  if (network.cluster === "devnet") return pinnedDevnetConnection();
  return new Connection(localRpc, {
    disableRetryOnRateLimit: true,
    fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(5_000) }),
  });
}

export async function startWindow(rpc: Connection, network: Config["network"]) {
  try {
    const expectedGenesis = network.cluster === "devnet" ? DEVNET_GENESIS : network.genesis;
    const genesis = await rpc.getGenesisHash();
    if (genesis !== expectedGenesis) throw new RunFailure("WRONG_CLUSTER");
    return { genesis, slot: await rpc.getSlot("confirmed") };
  } catch (error) {
    if (error instanceof RunFailure) throw error;
    throw new RunFailure("RPC_UNAVAILABLE");
  }
}

function requireEvidence(condition: unknown): asserts condition {
  if (!condition) throw new RunFailure("CHAIN_MISMATCH");
}

function safeAtoms(n: unknown) {
  requireEvidence(typeof n === "number" && Number.isSafeInteger(n) && n >= 0);
  return BigInt(n);
}

function checkBase(tx: ParsedTransactionWithMeta, signature: string, payer: string, startSlot: number) {
  if (tx.slot <= startSlot) throw new RunFailure("CHAIN_STALE");
  if (tx.meta?.err) throw new RunFailure("CHAIN_FAILED");
  requireEvidence(tx.meta && tx.transaction.signatures[0] === signature);
  const message = tx.transaction.message;
  requireEvidence(message.accountKeys[0]?.signer && message.accountKeys[0].pubkey.toBase58() === payer);
  return { meta: tx.meta, message };
}

export function assertSolTransfer(tx: ParsedTransactionWithMeta, signature: string, startSlot: number, expected: SolExpectation) {
  const { meta, message } = checkBase(tx, signature, expected.payer, startSlot);
  const [transfer] = message.instructions;
  requireEvidence(message.instructions.length === 1 && transfer && "parsed" in transfer &&
    transfer.programId.equals(SystemProgram.programId) && transfer.parsed.type === "transfer");
  const atoms = BigInt(expected.lamports);
  const { source, destination, lamports } = transfer.parsed.info;
  requireEvidence(expected.payer !== expected.recipient && source === expected.payer &&
    destination === expected.recipient && safeAtoms(lamports) === atoms);
  const recipientIndex = message.accountKeys.findIndex((key) => key.pubkey.toBase58() === expected.recipient);
  const fee = safeAtoms(meta.fee);
  requireEvidence(recipientIndex > 0 &&
    safeAtoms(meta.postBalances[recipientIndex]) - safeAtoms(meta.preBalances[recipientIndex]) === atoms &&
    safeAtoms(meta.preBalances[0]) - safeAtoms(meta.postBalances[0]) === atoms + fee);
  return { slot: tx.slot, feeLamports: fee.toString(), ...expected };
}

export function assertTokenTransfer(tx: ParsedTransactionWithMeta, signature: string, startSlot: number, expected: TokenExpectation) {
  const { meta, message } = checkBase(tx, signature, expected.payer, startSlot);
  const [transfer] = message.instructions;
  requireEvidence(message.instructions.length === 1 && transfer && "parsed" in transfer &&
    transfer.programId.equals(new PublicKey(TOKEN_PROGRAM)) && transfer.parsed.type === "transferChecked");
  const { info } = transfer.parsed;
  requireEvidence(info.authority === expected.payer && info.mint === expected.mint &&
    info.source === expected.source && info.destination === expected.destination &&
    expected.source !== expected.destination && info.tokenAmount.amount === expected.amount &&
    info.tokenAmount.decimals === expected.decimals);
  const sourceIndex = message.accountKeys.findIndex((key) => key.pubkey.toBase58() === expected.source);
  const destIndex = message.accountKeys.findIndex((key) => key.pubkey.toBase58() === expected.destination);
  const balance = (index: number, after: boolean, owner: string) => {
    const entries = after ? meta.postTokenBalances : meta.preTokenBalances;
    const account = entries?.find((item) => item.accountIndex === index);
    requireEvidence(account?.owner === owner && account.mint === expected.mint &&
      account.uiTokenAmount.decimals === expected.decimals && /^\d+$/.test(account.uiTokenAmount.amount));
    return BigInt(account.uiTokenAmount.amount);
  };
  const atoms = BigInt(expected.amount);
  requireEvidence(balance(sourceIndex, false, expected.payer) - balance(sourceIndex, true, expected.payer) === atoms &&
    balance(destIndex, true, expected.owner) - balance(destIndex, false, expected.owner) === atoms);
  return { slot: tx.slot, ...expected };
}

export async function finalizedTransaction(rpc: Connection, signature: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  let observedResponse = false;
  do {
    try {
      const { value: [status] } = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
      observedResponse = true;
      if (status?.confirmationStatus === "finalized") {
        if (status.err) throw new RunFailure("CHAIN_FAILED");
        const tx = await rpc.getParsedTransaction(signature, { commitment: "finalized", maxSupportedTransactionVersion: 0 });
        if (tx) {
          if (tx.slot !== status.slot) throw new RunFailure("CHAIN_MISMATCH");
          return tx;
        }
      }
    } catch (error) {
      if (error instanceof RunFailure) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  } while (Date.now() < until);
  throw new RunFailure(observedResponse ? "FINALITY_TIMEOUT" : "RPC_UNAVAILABLE");
}
