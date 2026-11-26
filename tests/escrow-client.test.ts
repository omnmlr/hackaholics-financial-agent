/** Synthetic signatures and RPC observations. The Rust vector independently
 * checks wire serialization; none of these fixtures establishes Devnet proof. */
import { readFileSync } from "node:fs";
import {
  PublicKey,
  Keypair,
  Transaction,
  type AccountInfo,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { expect, it } from "vitest";
import {
  decodeEscrow,
  escrowAddresses,
  fundingInstruction,
  settlementInstruction,
  verifyFinalizedFunding,
  ESCROW_PROGRAM_ID,
  type EscrowTerms,
  type FundingObservation,
} from "../src/server/escrow/devnet";
import { CIRCLE_DEVNET_USDC_MINT } from "../src/lib/solana/assets";
import { DEVNET_GENESIS } from "../src/lib/solana/contracts";
import { TOKEN_PROGRAM_ID } from "../src/lib/solana/classic-spl";
import { base58 } from "../src/lib/solana/encoding";
const vector = JSON.parse(
  readFileSync("escrow/fixtures/client-vector.json", "utf8"),
);
it("matches the Anchor Rust oracle for per-order PDAs, exact funding instruction, privileges and account layout", () => {
  const t = vector.terms as EscrowTerms,
    ix = fundingInstruction(t),
    a = escrowAddresses(t);
  expect(ix.data.toString("hex")).toBe(vector.fundDataHex);
  expect(
    ix.keys.map((k) => ({
      address: k.pubkey.toBase58(),
      signer: k.isSigner,
      writable: k.isWritable,
    })),
  ).toEqual(vector.keys);
  expect(a.escrow.toBase58()).toBe(vector.escrow);
  expect(a.vault.toBase58()).toBe(vector.vault);
  const account = decodeEscrow({
    owner: ESCROW_PROGRAM_ID,
    data: Buffer.from(vector.accountHex, "hex"),
    executable: false,
    lamports: 3000000,
    rentEpoch: 0,
  });
  expect(account).toMatchObject(t);
  expect(account).toMatchObject({ state: 0, simulatedVerifier: true });
  for (const [expected, instruction] of [
    [
      vector.release,
      settlementInstruction(t, "cooperative_release", [t.seller, t.verifier]),
    ],
    [
      vector.cancel,
      settlementInstruction(t, "mutual_cancel", [t.buyer, t.seller]),
    ],
    [
      vector.arbitrateRelease,
      settlementInstruction(
        t,
        "arbitrate",
        [t.arbitrators[0], t.arbitrators[2]],
        true,
      ),
    ],
    [
      vector.arbitrateRefund,
      settlementInstruction(
        t,
        "arbitrate",
        [t.arbitrators[0], t.arbitrators[2]],
        false,
      ),
    ],
    [vector.dispute, settlementInstruction(t, "dispute", [t.buyer])],
  ] as const) {
    expect(instruction.data.toString("hex")).toBe(expected.dataHex);
    expect(
      instruction.keys.map((k) => ({
        address: k.pubkey.toBase58(),
        signer: k.isSigner,
        writable: k.isWritable,
      })),
    ).toEqual(expected.keys);
  }
  expect(() =>
    settlementInstruction(t, "cooperative_release", [t.seller, t.buyer]),
  ).toThrow("SELLER_AND_VERIFIER_REQUIRED");
  expect(() => settlementInstruction(t, "mutual_cancel", [t.seller])).toThrow(
    "BOTH_PARTIES_REQUIRED",
  );
  expect(() =>
    settlementInstruction(t, "arbitrate", [t.arbitrators[0], t.arbitrators[0]]),
  ).toThrow("TWO_ARBITRATORS_REQUIRED");
  expect(
    settlementInstruction(
      t,
      "arbitrate",
      [t.arbitrators[0], t.arbitrators[2]],
      false,
    ).data.at(-1),
  ).toBe(0);
});
function fixture() {
  const seller = Keypair.generate();
  const t: EscrowTerms = {
    ...vector.terms,
    seller: seller.publicKey.toBase58(),
  };
  const a = escrowAddresses(t);
  const tx = new Transaction({
    feePayer: seller.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).add(fundingInstruction(t));
  tx.sign(seller);
  const signature = base58(tx.signature!),
    message = tx.compileMessage(),
    keys = message.accountKeys;
  const account = Buffer.from(vector.accountHex, "hex");
  new PublicKey(t.seller).toBuffer().copy(account, 72);
  account[304] = a.bump;
  const vaultData = Buffer.alloc(165);
  new PublicKey(CIRCLE_DEVNET_USDC_MINT).toBuffer().copy(vaultData);
  a.escrow.toBuffer().copy(vaultData, 32);
  vaultData.writeBigUInt64LE(1000000n, 64);
  vaultData[108] = 1;
  const token = (address: string, owner: string, amount: string) => ({
    accountIndex: keys.findIndex((k) => k.toBase58() === address),
    mint: CIRCLE_DEVNET_USDC_MINT,
    owner,
    uiTokenAmount: {
      amount,
      decimals: 6,
      uiAmount: null,
      uiAmountString: "fixture",
    },
  });
  const info = (owner: PublicKey, data: Buffer): AccountInfo<Buffer> => ({
    owner,
    data,
    executable: false,
    lamports: 3000000,
    rentEpoch: 0,
  });
  const observation: FundingObservation = {
    genesisHash: DEVNET_GENESIS,
    status: {
      slot: 42,
      confirmations: null,
      err: null,
      confirmationStatus: "finalized",
    },
    accountContextSlot: 43,
    transaction: {
      slot: 42,
      version: "legacy",
      transaction: { message, signatures: [signature] },
      meta: {
        err: null,
        fee: 5000,
        preBalances: keys.map(() => 10000000),
        postBalances: keys.map(() => 10000000),
        preTokenBalances: [token(t.sellerSource, t.seller, "2000000")],
        postTokenBalances: [
          token(t.sellerSource, t.seller, "1000000"),
          token(a.vault.toBase58(), a.escrow.toBase58(), "1000000"),
        ],
      },
    } as VersionedTransactionResponse,
    escrow: info(ESCROW_PROGRAM_ID, account),
    vault: info(TOKEN_PROGRAM_ID, vaultData),
  };
  return { t, signature, observation };
}
it("requires finalized exact funding, immutable authorities, classic vault ownership, matching deltas and sufficiently fresh account reads", () => {
  const f = fixture();
  expect(verifyFinalizedFunding(f.t, f.signature, f.observation)).toMatchObject(
    {
      verification: "chain_finalized",
      simulatedVerifier: true,
      fiatSettlementVerified: false,
    },
  );
  const wrongGenesis = fixture();
  wrongGenesis.observation.genesisHash = "mainnet";
  expect(() =>
    verifyFinalizedFunding(
      wrongGenesis.t,
      wrongGenesis.signature,
      wrongGenesis.observation,
    ),
  ).toThrow("WRONG_DEVNET_GENESIS");
  const pending = fixture();
  pending.observation.status!.confirmationStatus = "confirmed";
  expect(() =>
    verifyFinalizedFunding(pending.t, pending.signature, pending.observation),
  ).toThrow("ESCROW_FINALITY_PENDING");
  const stale = fixture();
  stale.observation.accountContextSlot = 41;
  expect(() =>
    verifyFinalizedFunding(stale.t, stale.signature, stale.observation),
  ).toThrow("ESCROW_ACCOUNT_OBSERVATION_STALE");
  const changed = fixture();
  changed.observation.escrow!.data[168] ^= 1;
  expect(() =>
    verifyFinalizedFunding(changed.t, changed.signature, changed.observation),
  ).toThrow("ESCROW_TERMS_MISMATCH");
  const delta = fixture();
  delta.observation.transaction!.meta!.postTokenBalances![1].uiTokenAmount.amount =
    "999999";
  expect(() =>
    verifyFinalizedFunding(delta.t, delta.signature, delta.observation),
  ).toThrow("ESCROW_FUNDING_DELTA_MISMATCH");
  const program = fixture();
  program.observation.vault!.owner = Keypair.generate().publicKey;
  expect(() =>
    verifyFinalizedFunding(program.t, program.signature, program.observation),
  ).toThrow();
});
