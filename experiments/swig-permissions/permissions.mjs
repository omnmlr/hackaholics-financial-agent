import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { log } from "node:console";
import { argv } from "node:process";
import { getBase58Decoder, getTransactionDecoder } from "@solana/kit";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  Actions,
  createEd25519AuthorityInfo,
  createEd25519SessionAuthorityInfo,
  findSwigPda,
  getAddAuthorityInstructions,
  getCreateSessionInstructions,
  getCreateSwigInstruction,
  getRemoveAuthorityInstructions,
  getSignInstructions,
  getSwigCodec,
  getSwigWalletAddress,
  Swig,
  SWIG_PROGRAM_ADDRESS,
  toPublicKey,
} from "@swig-wallet/classic";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

async function deployedProgram() {
  const rpc = new Connection("https://api.devnet.solana.com", "finalized");
  assert.equal(
    await rpc.getGenesisHash(),
    "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  );
  const executable = await rpc.getAccountInfo(SWIG_PROGRAM_ADDRESS);
  const loader = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  assert(
    executable?.executable &&
      executable.owner.equals(loader) &&
      executable.data.readUInt32LE(0) === 2,
  );
  const programData = new PublicKey(executable.data.subarray(4, 36));
  const info = await rpc.getAccountInfo(programData);
  assert(info?.owner.equals(loader) && info.data.readUInt32LE(0) === 3);
  // Upgradeable Loader uses a fixed 45-byte ProgramData metadata prefix.
  log(
    "Devnet Swig ProgramData",
    programData.toBase58(),
    "deployment slot",
    info.data.readBigUInt64LE(4).toString(),
  );
  return info.data.subarray(45);
}

const binary = argv[2] ? readFileSync(argv[2]) : await deployedProgram();
assert.equal(binary.subarray(0, 4).toString("hex"), "7f454c46");
log("Swig ELF SHA-256", createHash("sha256").update(binary).digest("hex"));
const svm = new LiteSVM();
svm.addProgram(SWIG_PROGRAM_ADDRESS.toBase58(), binary);
svm.warpToSlot(10n);
const root = Keypair.generate();
const delegate = Keypair.generate();
const session = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const id = randomBytes(32);
const config = findSwigPda(id);

function transact(instructions, payer, ...signers) {
  svm.expireBlockhash();
  const transaction = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: svm.latestBlockhash(),
  }).add(...instructions);
  transaction.sign(payer, ...signers);
  return svm.sendTransaction(
    getTransactionDecoder().decode(transaction.serialize()),
  );
}
function succeed(label, metadata) {
  assert(
    !(metadata instanceof FailedTransactionMetadata),
    `${label}: ${metadata instanceof FailedTransactionMetadata && metadata.meta().logs().join("\n")}`,
  );
  log(label, getBase58Decoder().decode(metadata.signature()));
}
function deny(label, metadata) {
  assert(
    metadata instanceof FailedTransactionMetadata,
    `${label} unexpectedly succeeded`,
  );
  const failureLine = metadata
    .meta()
    .logs()
    .findLast((line) =>
      line.startsWith(`Program ${SWIG_PROGRAM_ADDRESS} failed:`),
    );
  assert(failureLine, metadata.meta().logs().join("\n"));
  log(label, failureLine);
}
function fetchConfig(address) {
  const info = svm.getAccount(toPublicKey(address).toBase58());
  assert(info.exists, "Swig configuration is missing");
  return getSwigCodec().decode(info.data);
}
function balance(address) {
  return svm.getBalance(address.toBase58()) ?? 0n;
}
for (const signer of [root, delegate, session])
  svm.airdrop(signer.publicKey.toBase58(), 1_000_000_000n);
svm.airdrop(recipient.toBase58(), 10_000_000n);
succeed(
  "create smart account",
  transact(
    [
      await getCreateSwigInstruction({
        authorityInfo: createEd25519AuthorityInfo(root.publicKey),
        id,
        payer: root.publicKey,
        actions: Actions.set().all().get(),
      }),
    ],
    root,
  ),
);
const swig = new Swig(config, fetchConfig(config), async (address) =>
  fetchConfig(address),
);
const wallet = await getSwigWalletAddress(swig);
svm.airdrop(wallet.toBase58(), 1_000_000_000n);
const rootRole = swig.findRolesByEd25519SignerPk(root.publicKey)[0];
assert(rootRole);
succeed(
  "grant capped delegate",
  transact(
    await getAddAuthorityInstructions(
      swig,
      rootRole.id,
      createEd25519SessionAuthorityInfo(delegate.publicKey, 100n),
      Actions.set().solLimit({ amount: 100_000_000n }).get(),
    ),
    root,
  ),
);
await swig.refetch();
const role = swig.findRolesByAuthorityAddress(delegate.publicKey.toBytes())[0];
assert(role);
succeed(
  "open time-limited session",
  transact(
    await getCreateSessionInstructions(swig, role.id, session.publicKey, 20n),
    delegate,
  ),
);
await swig.refetch();
assert.equal(swig.findRoleBySessionKey(session.publicKey)?.id, role.id);

const spending = (lamports) =>
  SystemProgram.transfer({
    fromPubkey: wallet,
    toPubkey: recipient,
    lamports,
  });
const signedBySession = (ix) =>
  getSignInstructions(swig, role.id, [ix], false, {
    currentSlot: svm.getClock().slot,
  });
const before = balance(recipient);
succeed(
  "within cap",
  transact(await signedBySession(spending(50_000_000n)), session),
);
assert.equal(balance(recipient) - before, 50_000_000n);
await swig.refetch();
const remainingBalance = balance(wallet);
deny(
  "over remaining cap",
  transact(await signedBySession(spending(60_000_000n)), session),
);
assert.equal(balance(wallet), remainingBalance);

const memo = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
assert(svm.getAccount(memo.toBase58()).exists);
succeed(
  "zero-spend Memo with a vault signer is allowed",
  transact(
    await signedBySession(
      new TransactionInstruction({
        programId: memo,
        keys: [{ pubkey: wallet, isSigner: true, isWritable: false }],
        data: Buffer.from("policy probe"),
      }),
    ),
    session,
  ),
);
assert.equal(balance(wallet), remainingBalance);

const mint = Keypair.generate();
const vaultAta = getAssociatedTokenAddressSync(mint.publicKey, wallet, true);
const recipientAta = getAssociatedTokenAddressSync(mint.publicKey, recipient);
succeed(
  "create local test token",
  transact(
    [
      SystemProgram.createAccount({
        fromPubkey: root.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(mint.publicKey, 0, root.publicKey, null),
      createAssociatedTokenAccountInstruction(
        root.publicKey,
        vaultAta,
        wallet,
        mint.publicKey,
      ),
      createAssociatedTokenAccountInstruction(
        root.publicKey,
        recipientAta,
        recipient,
        mint.publicKey,
      ),
      createMintToInstruction(mint.publicKey, vaultAta, root.publicKey, 2n),
    ],
    root,
    mint,
  ),
);
deny(
  "SPL spend without a token grant",
  transact(
    await signedBySession(
      createTransferCheckedInstruction(
        vaultAta,
        mint.publicKey,
        recipientAta,
        wallet,
        1n,
        0,
      ),
    ),
    session,
  ),
);
assert.equal(
  Buffer.from(svm.getAccount(vaultAta.toBase58()).data).readBigUInt64LE(64),
  2n,
);

const expiring = await signedBySession(spending(20_000_000n));
svm.warpToSlot(31n);
deny("expired session", transact(expiring, session));
assert.equal(balance(wallet), remainingBalance);
succeed(
  "renew time-limited session",
  transact(
    await getCreateSessionInstructions(swig, role.id, session.publicKey, 20n),
    delegate,
  ),
);
await swig.refetch();
const revoked = await signedBySession(spending(21_000_000n));
succeed(
  "root revokes delegate",
  transact(
    await getRemoveAuthorityInstructions(swig, rootRole.id, role.id),
    root,
  ),
);
await swig.refetch();
assert.equal(swig.findRoleBySessionKey(session.publicKey), null);
deny("revoked session", transact(revoked, session));
assert.equal(balance(wallet), remainingBalance);
assert.equal(balance(recipient) - before, 50_000_000n);
log("PASS: local runtime executed the deployed program with ephemeral signers");
