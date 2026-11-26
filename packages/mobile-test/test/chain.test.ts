import assert from "node:assert/strict";
import { test } from "node:test";
import { Keypair, PublicKey, SystemProgram, type Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";
import { assertSolTransfer, assertTokenTransfer, finalizedTransaction, startWindow } from "../src/chain";
import { configSchema, RunFailure } from "../src/contracts";
import { parseUi } from "../src/android";

const payer = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const expected = { payer: payer.toBase58(), recipient: recipient.toBase58(), lamports: "100" };
const signature = "2".repeat(88);

function solTransaction(): ParsedTransactionWithMeta {
  return {
    slot: 12,
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: [{ pubkey: payer, signer: true, writable: true }, { pubkey: recipient, signer: false, writable: true }],
        instructions: [{
          programId: SystemProgram.programId, program: "system",
          parsed: { type: "transfer", info: { source: expected.payer, destination: expected.recipient, lamports: 100 } },
        }],
        recentBlockhash: "placeholder",
      },
    },
    meta: { err: null, fee: 5, preBalances: [500, 0], postBalances: [395, 100] },
  };
}

function fails(code: RunFailure["code"]) {
  return (error: unknown) => error instanceof RunFailure && error.code === code;
}

test("SOL verifies exact instruction, balances, fee and freshness", () => {
  const tx = solTransaction();
  assert.deepEqual(assertSolTransfer(tx, signature, 11, expected), { ...expected, feeLamports: "5", slot: 12 });
  assert.throws(() => assertSolTransfer(tx, signature, 12, expected), fails("CHAIN_STALE"));
  assert.throws(() => assertSolTransfer(tx, "other", 11, expected), fails("CHAIN_MISMATCH"));
  assert.throws(() => assertSolTransfer(tx, signature, 11, { ...expected, lamports: "101" }), fails("CHAIN_MISMATCH"));
  tx.meta!.postBalances[1] = 99;
  assert.throws(() => assertSolTransfer(tx, signature, 11, expected), fails("CHAIN_MISMATCH"));
});

test("SPL verifies mint, source, destination owner, decimals and actual token deltas", () => {
  const tx = solTransaction();
  const mint = Keypair.generate().publicKey.toBase58();
  const source = Keypair.generate().publicKey;
  const destination = Keypair.generate().publicKey;
  const token = { payer: expected.payer, owner: expected.recipient, mint, source: source.toBase58(), destination: destination.toBase58(), decimals: 6, amount: "2500000" };
  tx.transaction.message.accountKeys.push({ pubkey: source, signer: false, writable: true }, { pubkey: destination, signer: false, writable: true });
  tx.transaction.message.instructions = [{
    programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), program: "spl-token",
    parsed: { type: "transferChecked", info: { ...token, authority: token.payer, tokenAmount: { amount: token.amount, decimals: 6 } } },
  }];
  const balance = (accountIndex: number, owner: string, amount: string) => ({
    accountIndex, owner, mint, uiTokenAmount: { amount, decimals: 6, uiAmount: null },
  });
  tx.meta!.preTokenBalances = [balance(2, token.payer, "4000000"), balance(3, token.owner, "0")];
  tx.meta!.postTokenBalances = [balance(2, token.payer, "1500000"), balance(3, token.owner, "2500000")];
  assert.deepEqual(assertTokenTransfer(tx, signature, 11, token), { ...token, slot: 12 });
  tx.meta!.postTokenBalances[1].owner = token.payer;
  assert.throws(() => assertTokenTransfer(tx, signature, 11, token), fails("CHAIN_MISMATCH"));
});

test("an accepted callback is insufficient without consistent finalized RPC evidence", async () => {
  const rpc = {
    getSignatureStatuses: async () => ({ value: [{ slot: 13, err: null, confirmationStatus: "finalized" }] }),
    getParsedTransaction: async () => solTransaction(),
  } as unknown as Connection;
  await assert.rejects(finalizedTransaction(rpc, signature, 0), fails("CHAIN_MISMATCH"));
  const missing = { getSignatureStatuses: async () => ({ value: [null] }) } as unknown as Connection;
  await assert.rejects(finalizedTransaction(missing, signature, 0), fails("FINALITY_TIMEOUT"));
  await assert.rejects(startWindow({ getGenesisHash: async () => "unexpected" } as Connection,
    { cluster: "devnet" }), fails("WRONG_CLUSTER"));
});

test("runner contract rejects remote device addresses and UI capture drops other packages", () => {
  assert.equal(configSchema.safeParse({
    version: 1, device: { serial: "10.0.0.1:5555", kind: "android-device", isolated: true },
    network: { cluster: "devnet" }, apks: {}, scenarios: {},
  }).success, false);
  const xml = '<?xml version="1.0"?><hierarchy><node package="app.agus.testfixture" text="Authorize" bounds="[0,0][200,100]"/><node package="other.app" text="private" bounds="[0,0][200,100]"/></hierarchy>';
  assert.deepEqual(parseUi(xml, new Set(["app.agus.testfixture"])).map((node) => node.text), ["Authorize"]);
  assert.throws(() => parseUi('<!DOCTYPE hierarchy [<!ENTITY inline "value">]><hierarchy/>', new Set()));
});
