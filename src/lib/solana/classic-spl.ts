/**
 * Deliberately limited classic SPL protocol helpers; no Token-2022 or multisig.
 * Formats are checked by differential tests against @solana/spl-token 0.4.x.
 * Protocol references: solana-program/token `state.rs`, `instruction.rs`, and
 * associated-token-account `instruction.rs`. PDA/signature cryptography stays
 * entirely in @solana/web3.js; amounts use native bigint and bounded buffers.
 */
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  type AccountInfo,
} from "@solana/web3.js";
import { SolanaError } from "./primitives";
import { MAX_U64 } from "./money";

export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const ACCOUNT_SIZE = 165;
export const MINT_SIZE = 82;
function invalid(message: string): never {
  throw new SolanaError("UNSUPPORTED_TOKEN", message);
}
function classic(programId: PublicKey) {
  if (!programId.equals(TOKEN_PROGRAM_ID))
    invalid("Only the classic SPL Token program is supported");
}
function associated(programId: PublicKey) {
  if (!programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID))
    invalid("Only the canonical associated token program is supported");
}
function data(
  info: AccountInfo<Buffer> | null,
  size: number,
  programId: PublicKey,
) {
  classic(programId);
  if (
    !info ||
    !info.owner.equals(TOKEN_PROGRAM_ID) ||
    info.executable ||
    !Buffer.isBuffer(info.data) ||
    info.data.length !== size
  )
    invalid(
      "Expected a classic SPL account with the exact supported byte length",
    );
  return info.data;
}
function option(bytes: Buffer, offset: number) {
  const tag = bytes.readUInt32LE(offset);
  if (tag !== 0 && tag !== 1) invalid("Invalid classic SPL optional authority");
  return tag === 1;
}
function optionalKey(bytes: Buffer, offset: number) {
  return option(bytes, offset)
    ? new PublicKey(bytes.subarray(offset + 4, offset + 36))
    : null;
}
export function unpackMint(
  address: PublicKey,
  info: AccountInfo<Buffer> | null,
  programId = TOKEN_PROGRAM_ID,
) {
  const bytes = data(info, MINT_SIZE, programId);
  if (bytes[45] !== 0 && bytes[45] !== 1)
    invalid("Invalid classic SPL mint initialization flag");
  return {
    address,
    mintAuthority: optionalKey(bytes, 0),
    supply: bytes.readBigUInt64LE(36),
    decimals: bytes[44],
    isInitialized: bytes[45] === 1,
    freezeAuthority: optionalKey(bytes, 46),
    tlvData: Buffer.alloc(0),
  };
}
export function unpackAccount(
  address: PublicKey,
  info: AccountInfo<Buffer> | null,
  programId = TOKEN_PROGRAM_ID,
) {
  const bytes = data(info, ACCOUNT_SIZE, programId);
  const state = bytes[108];
  if (state !== 0 && state !== 1 && state !== 2)
    invalid("Invalid classic SPL token-account state");
  const native = option(bytes, 109);
  return {
    address,
    mint: new PublicKey(bytes.subarray(0, 32)),
    owner: new PublicKey(bytes.subarray(32, 64)),
    amount: bytes.readBigUInt64LE(64),
    delegate: optionalKey(bytes, 72),
    delegatedAmount: bytes.readBigUInt64LE(121),
    isInitialized: state !== 0,
    isFrozen: state === 2,
    isNative: native,
    rentExemptReserve: native ? bytes.readBigUInt64LE(113) : null,
    closeAuthority: optionalKey(bytes, 129),
    tlvData: Buffer.alloc(0),
  };
}
export function getAssociatedTokenAddressSync(
  mint: PublicKey,
  owner: PublicKey,
  allowOwnerOffCurve = false,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
) {
  classic(programId);
  associated(associatedTokenProgramId);
  if (!allowOwnerOffCurve && !PublicKey.isOnCurve(owner.toBytes()))
    invalid("Token owner must be a wallet public key");
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId,
  )[0];
}
export function createAssociatedTokenAccountIdempotentInstruction(
  payer: PublicKey,
  associatedToken: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  programId = TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
) {
  classic(programId);
  associated(associatedTokenProgramId);
  if (
    !associatedToken.equals(
      getAssociatedTokenAddressSync(
        mint,
        owner,
        false,
        programId,
        associatedTokenProgramId,
      ),
    )
  )
    invalid("Recipient token account must be the canonical associated address");
  return new TransactionInstruction({
    programId: associatedTokenProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}
export function createTransferCheckedInstruction(
  source: PublicKey,
  mint: PublicKey,
  destination: PublicKey,
  owner: PublicKey,
  amount: bigint,
  decimals: number,
  multiSigners: readonly unknown[] = [],
  programId = TOKEN_PROGRAM_ID,
) {
  classic(programId);
  if (multiSigners.length || !PublicKey.isOnCurve(owner.toBytes()))
    invalid("Only a single wallet owner can authorize this token transfer");
  if (
    typeof amount !== "bigint" ||
    amount < 0n ||
    amount > MAX_U64 ||
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 255
  )
    invalid("Invalid checked-transfer atomic amount or decimal count");
  const bytes = Buffer.alloc(10);
  bytes[0] = 12;
  bytes.writeBigUInt64LE(amount, 1);
  bytes[9] = decimals;
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: bytes,
  });
}
