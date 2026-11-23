import type {
  ParsedInstruction,
  PartiallyDecodedInstruction,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import type { z } from "zod";
import * as C from "../../../packages/contracts/src/crypto";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../../lib/solana/classic-spl";
import { MAX_U64, safeLamports } from "../../lib/solana/money";
import { sol, token, type Amount } from "./portfolio";
import { explorerTransaction } from "./rpc";
import { readSource, type Cluster, type Wallet } from "./registry";

type Leg = Omit<
  z.infer<typeof C.CryptoActivityLeg>,
  "fromWalletId" | "toWalletId" | "walletDeltas"
> & {
  fromOwner: string | null;
  toOwner: string | null;
};
export type ChainEvent = Omit<
  z.infer<typeof C.CryptoActivityEvent>,
  "legs" | "classification" | "reason"
> & { legs: Leg[] };
const system = "11111111111111111111111111111111";
const tokenProgram = TOKEN_PROGRAM_ID.toBase58();
const associated = ASSOCIATED_TOKEN_PROGRAM_ID.toBase58();
const transparent = new Set([
  system,
  tokenProgram,
  associated,
  "ComputeBudget111111111111111111111111111111",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
  "Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo",
]);

export function normalizeTransaction(
  cluster: Cluster,
  signature: string,
  tx: ParsedTransactionWithMeta,
): ChainEvent | null {
  if (!tx.meta || tx.transaction.signatures[0] !== signature) return null;
  const {
    meta,
    transaction: { message },
  } = tx;
  const observedAt = new Date().toISOString(),
    id = `${cluster}:${signature}`;
  const payer = message.accountKeys[0]?.pubkey.toBase58() ?? null;
  const legs: Leg[] = [];
  function add(
    path: string,
    kind: Leg["kind"],
    from: string | null,
    to: string | null,
    amount: Amount | null,
    fromOwner = from,
    toOwner = to,
  ) {
    legs.push({
      id: `${id}:${path}`,
      instructionPath: path,
      kind,
      from,
      to,
      fromOwner,
      toOwner,
      amount,
    });
  }
  if (payer && Number.isSafeInteger(meta.fee) && meta.fee >= 0)
    add("fee", "fee", payer, null, sol(cluster, safeLamports(meta.fee)));
  const tokenStates = new Map<
    string,
    { mint: string; owner?: string; decimals: number; ambiguous: boolean }
  >();
  for (const balance of [
    ...(meta.preTokenBalances ?? []),
    ...(meta.postTokenBalances ?? []),
  ]) {
    if (balance.programId && balance.programId !== tokenProgram) continue;
    const key = message.accountKeys[balance.accountIndex]?.pubkey.toBase58();
    if (!key) continue;
    const old = tokenStates.get(key);
    const decimals = balance.uiTokenAmount.decimals;
    const ambiguous =
      !!old &&
      (old.ambiguous ||
        old.mint !== balance.mint ||
        old.decimals !== decimals ||
        (!!old.owner && !!balance.owner && old.owner !== balance.owner));
    tokenStates.set(key, {
      mint: balance.mint,
      decimals,
      owner: balance.owner ?? old?.owner,
      ambiguous,
    });
  }
  const plain = message.instructions.every(
    (ix) =>
      transparent.has(ix.programId.toBase58()) &&
      (ix.programId.toBase58() !== system ||
        ("parsed" in ix &&
          ["transfer", "createAccount", "createAccountWithSeed"].includes(
            ix.parsed?.type,
          ))) &&
      (ix.programId.toBase58() !== tokenProgram ||
        ("parsed" in ix &&
          [
            "transfer",
            "transferChecked",
            "initializeAccount",
            "initializeAccount2",
            "initializeAccount3",
            "initializeImmutableOwner",
          ].includes(ix.parsed?.type))),
  );

  function instruction(
    ix: ParsedInstruction | PartiallyDecodedInstruction,
    path: string,
    underAta: boolean,
  ) {
    const program = ix.programId.toBase58();
    if (!("parsed" in ix) || !ix.parsed?.info) {
      if (
        !transparent.has(program) ||
        [system, tokenProgram, associated].includes(program)
      )
        add(path, "unknown", null, null, null);
      return;
    }
    const { type, info } = ix.parsed;
    const source = C.CryptoAddress.safeParse(info.source);
    const destination = C.CryptoAddress.safeParse(
      info.destination ?? info.newAccount,
    );
    if (
      program === system &&
      ["transfer", "createAccount", "createAccountWithSeed"].includes(type) &&
      source.success &&
      destination.success &&
      Number.isSafeInteger(info.lamports) &&
      info.lamports >= 0
    ) {
      const kind =
        underAta || type !== "transfer"
          ? "rent"
          : plain
            ? "transfer"
            : "unknown";
      add(
        path,
        kind,
        source.data,
        destination.data,
        sol(cluster, safeLamports(info.lamports)),
      );
      return;
    }
    if (
      program === tokenProgram &&
      ["transfer", "transferChecked"].includes(type) &&
      source.success &&
      destination.success
    ) {
      const from = tokenStates.get(source.data),
        to = tokenStates.get(destination.data);
      const mint = C.CryptoAddress.safeParse(
        info.mint ?? from?.mint ?? to?.mint,
      );
      const decimals =
        info.tokenAmount?.decimals ?? from?.decimals ?? to?.decimals;
      const atoms = C.CryptoAtoms.safeParse(
        info.tokenAmount?.amount ?? info.amount,
      );
      const consistent = [from, to].every(
        (state) =>
          !state ||
          (state.mint === mint.data &&
            state.decimals === decimals &&
            !state.ambiguous),
      );
      const exact =
        mint.success &&
        Number.isInteger(decimals) &&
        decimals >= 0 &&
        decimals <= 255 &&
        atoms.success &&
        BigInt(atoms.data) <= MAX_U64 &&
        consistent;
      add(
        path,
        exact && plain && from?.owner && to?.owner ? "transfer" : "unknown",
        source.data,
        destination.data,
        exact ? token(cluster, mint.data, atoms.data, decimals) : null,
        from?.ambiguous ? null : (from?.owner ?? null),
        to?.ambiguous ? null : (to?.owner ?? null),
      );
      return;
    }
    if (
      program === associated ||
      (program === tokenProgram &&
        [
          "initializeAccount",
          "initializeAccount2",
          "initializeAccount3",
          "initializeImmutableOwner",
          "getAccountDataSize",
        ].includes(type))
    )
      return;
    if (!transparent.has(program) || [system, tokenProgram].includes(program))
      add(path, "unknown", null, null, null);
  }
  if (!meta.err) {
    const inner = new Map(
      (meta.innerInstructions ?? []).map((group) => [
        group.index,
        group.instructions,
      ]),
    );
    for (const [i, ix] of message.instructions.entries()) {
      instruction(ix, String(i), false);
      for (const [j, child] of (inner.get(i) ?? []).entries()) {
        instruction(child, `${i}.${j}`, ix.programId.toBase58() === associated);
      }
    }
  }
  return {
    id,
    signature,
    slot: tx.slot,
    blockTime:
      tx.blockTime == null ? null : new Date(tx.blockTime * 1000).toISOString(),
    source: readSource(cluster, tx.slot, observedAt),
    finality: "finalized",
    status: meta.err ? "failed" : "success",
    legs,
    explorerUrl: explorerTransaction(cluster, signature),
  };
}

export function attributeEvent(event: ChainEvent, wallets: Wallet[]) {
  const ids = new Map(
    wallets
      .filter((w) => w.ownership === "verified")
      .map((w) => [w.address, w.id]),
  );
  const directions = new Set<string>();
  const legs = event.legs.map(({ fromOwner, toOwner, ...leg }) => {
    const fromWalletId = fromOwner ? (ids.get(fromOwner) ?? null) : null;
    const toWalletId = toOwner ? (ids.get(toOwner) ?? null) : null;
    const deltas = new Map<string, bigint>();
    if (leg.amount && leg.kind !== "unknown") {
      const atoms = BigInt(leg.amount.atoms);
      if (fromWalletId) deltas.set(fromWalletId, -atoms);
      if (toWalletId)
        deltas.set(toWalletId, (deltas.get(toWalletId) ?? 0n) + atoms);
      if (leg.kind === "transfer" && atoms > 0n) {
        if (fromWalletId && toWalletId) directions.add("internal");
        else if (fromWalletId) directions.add("outgoing");
        else if (toWalletId) directions.add("incoming");
      }
    }
    return {
      ...leg,
      fromWalletId,
      toWalletId,
      walletDeltas: [...deltas].map(([walletId, atoms]) => ({
        walletId,
        atoms: atoms.toString(),
      })),
    };
  });
  const classification = directions.size === 1 ? [...directions][0] : "unknown";
  return C.CryptoActivityEvent.parse({
    ...event,
    classification,
    legs,
    reason:
      event.status === "failed"
        ? "The finalized transaction reported an execution error."
        : classification === "unknown"
          ? "No single verified transfer direction can be attributed across linked wallets."
          : "Decoded finalized transfer and verified linked wallet ownership.",
  });
}
