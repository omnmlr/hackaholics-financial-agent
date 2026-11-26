/** The SDK is a development-only protocol oracle, never a production import. */
import { describe, expect, it } from "vitest";
import {
  Keypair,
  PublicKey,
  Transaction,
  type AccountInfo,
  type TransactionInstruction,
} from "@solana/web3.js";
import * as sdk from "@solana/spl-token";
import * as classic from "../src/lib/solana/classic-spl";
const key = () => Keypair.generate().publicKey;
function info(
  bytes: Buffer,
  owner = sdk.TOKEN_PROGRAM_ID,
): AccountInfo<Buffer> {
  return {
    data: bytes,
    owner,
    lamports: 2039280,
    executable: false,
    rentEpoch: 0,
  };
}
function normalized(ix: TransactionInstruction) {
  return {
    program: ix.programId.toBase58(),
    data: ix.data.toString("hex"),
    keys: ix.keys.map((k) => ({
      address: k.pubkey.toBase58(),
      signer: k.isSigner,
      writable: k.isWritable,
    })),
  };
}

describe("classic SPL protocol oracle", () => {
  it("pins complete canonical program IDs and exact classic layout sizes", () => {
    expect(classic.TOKEN_PROGRAM_ID.toBase58()).toBe(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );
    expect(classic.ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()).toBe(
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
    );
    expect(classic.TOKEN_PROGRAM_ID.equals(sdk.TOKEN_PROGRAM_ID)).toBe(true);
    expect(
      classic.ASSOCIATED_TOKEN_PROGRAM_ID.equals(
        sdk.ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    ).toBe(true);
    expect(classic.ACCOUNT_SIZE).toBe(sdk.ACCOUNT_SIZE);
    expect(classic.MINT_SIZE).toBe(sdk.MINT_SIZE);
  });
  it.each([0n, 1n, 9007199254740993n, (1n << 64n) - 1n])(
    "matches PDA, account metas, instructions and full wire transaction for %s atoms",
    (amount) => {
      const payer = key(),
        recipient = key(),
        mint = key(),
        source = key(),
        blockhash = key().toBase58();
      const destination = classic.getAssociatedTokenAddressSync(
        mint,
        recipient,
      );
      expect(
        destination.equals(sdk.getAssociatedTokenAddressSync(mint, recipient)),
      ).toBe(true);
      for (const decimals of [0, 6, 9, 255]) {
        const ours = [
          classic.createAssociatedTokenAccountIdempotentInstruction(
            payer,
            destination,
            recipient,
            mint,
          ),
          classic.createTransferCheckedInstruction(
            source,
            mint,
            destination,
            payer,
            amount,
            decimals,
          ),
        ];
        const expected = [
          sdk.createAssociatedTokenAccountIdempotentInstruction(
            payer,
            destination,
            recipient,
            mint,
          ),
          sdk.createTransferCheckedInstruction(
            source,
            mint,
            destination,
            payer,
            amount,
            decimals,
          ),
        ];
        expect(ours.map(normalized)).toEqual(expected.map(normalized));
        const serialize = (ixs: TransactionInstruction[]) =>
          new Transaction({ feePayer: payer, recentBlockhash: blockhash })
            .add(...ixs)
            .serialize({
              requireAllSignatures: false,
              verifySignatures: false,
            });
        expect(serialize(ours).equals(serialize(expected))).toBe(true);
      }
    },
  );
  it("matches initialized/frozen/uninitialized token-account decoding and optional authorities", () => {
    for (const state of [0, 1, 2])
      for (const present of [0, 1] as const) {
        const mint = key(),
          owner = key(),
          account = key(),
          delegate = key(),
          closeAuthority = key();
        const bytes = Buffer.alloc(sdk.ACCOUNT_SIZE);
        sdk.AccountLayout.encode(
          {
            mint,
            owner,
            amount: 9007199254740993n,
            delegateOption: present,
            delegate,
            state,
            isNativeOption: present,
            isNative: 2039280n,
            delegatedAmount: 42n,
            closeAuthorityOption: present,
            closeAuthority,
          },
          bytes,
        );
        expect(classic.unpackAccount(account, info(bytes))).toEqual(
          sdk.unpackAccount(account, info(bytes)),
        );
      }
  });
  it("matches mint supply, decimals, initialization and authority decoding", () => {
    for (const isInitialized of [true, false])
      for (const present of [0, 1] as const)
        for (const decimals of [0, 6, 9, 255]) {
          const bytes = Buffer.alloc(sdk.MINT_SIZE),
            mint = key();
          sdk.MintLayout.encode(
            {
              mintAuthorityOption: present,
              mintAuthority: key(),
              supply: (1n << 64n) - 1n,
              decimals,
              isInitialized,
              freezeAuthorityOption: present,
              freezeAuthority: key(),
            },
            bytes,
          );
          expect(classic.unpackMint(mint, info(bytes))).toEqual(
            sdk.unpackMint(mint, info(bytes)),
          );
        }
  });
  it("rejects Token-2022, extensions, truncation, executable accounts and invalid enum encodings", () => {
    for (const [size, decode] of [
      [82, classic.unpackMint],
      [165, classic.unpackAccount],
    ] as const) {
      expect(() =>
        decode(key(), info(Buffer.alloc(size), sdk.TOKEN_2022_PROGRAM_ID)),
      ).toThrow();
      expect(() => decode(key(), info(Buffer.alloc(size + 1)))).toThrow();
      expect(() => decode(key(), info(Buffer.alloc(size - 1)))).toThrow();
      expect(() =>
        decode(key(), { ...info(Buffer.alloc(size)), executable: true }),
      ).toThrow();
    }
    for (const offset of [0, 46]) {
      const bytes = Buffer.alloc(82);
      bytes.writeUInt32LE(2, offset);
      expect(() => classic.unpackMint(key(), info(bytes))).toThrow();
    }
    const badBoolean = Buffer.alloc(82);
    badBoolean[45] = 2;
    expect(() => classic.unpackMint(key(), info(badBoolean))).toThrow();
    for (const offset of [72, 109, 129]) {
      const bytes = Buffer.alloc(165);
      bytes.writeUInt32LE(2, offset);
      expect(() => classic.unpackAccount(key(), info(bytes))).toThrow();
    }
    const badState = Buffer.alloc(165);
    badState[108] = 3;
    expect(() => classic.unpackAccount(key(), info(badState))).toThrow();
  });
  it("rejects custom programs, off-curve wallet owners, noncanonical ATA, multisig and invalid amounts", () => {
    const payer = key(),
      mint = key(),
      source = key(),
      destination = key();
    expect(() =>
      classic.getAssociatedTokenAddressSync(
        mint,
        payer,
        false,
        sdk.TOKEN_2022_PROGRAM_ID,
      ),
    ).toThrow();
    const pda = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle-test")],
      sdk.TOKEN_PROGRAM_ID,
    )[0];
    expect(() => classic.getAssociatedTokenAddressSync(mint, pda)).toThrow();
    expect(() =>
      classic.createAssociatedTokenAccountIdempotentInstruction(
        payer,
        destination,
        payer,
        mint,
      ),
    ).toThrow();
    expect(() =>
      classic.createTransferCheckedInstruction(
        source,
        mint,
        destination,
        payer,
        1n,
        6,
        [key()],
      ),
    ).toThrow();
    for (const amount of [-1n, 1n << 64n])
      expect(() =>
        classic.createTransferCheckedInstruction(
          source,
          mint,
          destination,
          payer,
          amount,
          6,
        ),
      ).toThrow();
    for (const decimals of [-1, 256, 1.5])
      expect(() =>
        classic.createTransferCheckedInstruction(
          source,
          mint,
          destination,
          payer,
          1n,
          decimals,
        ),
      ).toThrow();
  });
});
