import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { URL } from "node:url";
import { getBase58Decoder, getTransactionDecoder } from "@solana/kit";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToCheckedInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
} from "@solana/spl-token";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import {
  Actions,
  SWIG_PROGRAM_ADDRESS,
  Swig,
  createEd25519AuthorityInfo,
  createEd25519SessionAuthorityInfo,
  findSwigPda,
  getAddAuthorityInstructions,
  getCreateSessionInstructions,
  getCreateSwigInstruction,
  getSignInstructions,
  getSwigCodec,
  getSwigWalletAddress,
  toPublicKey,
} from "@swig-wallet/classic";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";

export const MICRO = 1_000_000n;
const [filename, digest] = argv.includes("--devnet-snapshot")
  ? [
      "devnet-swig.so",
      "0418f037fe1c9f6c0cd9d3ee57d684f69aca2ed9b3388f5d0c45020b01cce1d9",
    ]
  : [
      "swig.so",
      "3991e3ee04c17238f47baafa73285b4fc65c41ac88aeb396134b950442886a8e",
    ];
const binary = readFileSync(
  new URL(`./.artifacts/${filename}`, import.meta.url),
);
assert.equal(createHash("sha256").update(binary).digest("hex"), digest);
const signatureCodec = getBase58Decoder();
const transactionCodec = getTransactionDecoder();

export async function lab(t) {
  const svm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
  svm.addProgram(SWIG_PROGRAM_ADDRESS.toBase58(), binary);
  svm.warpToSlot(10n);
  const root = Keypair.generate();
  const funder = Keypair.generate();
  const payer = Keypair.generate();
  const authority = Keypair.generate();
  const session = Keypair.generate();
  const recipient = Keypair.generate();
  const other = Keypair.generate();
  const mint = Keypair.generate();
  const events = [];
  for (const key of [
    root,
    funder,
    payer,
    authority,
    session,
    recipient,
    other,
  ]) {
    const result = svm.airdrop(key.publicKey.toBase58(), 2_000_000_000n);
    assert.ok(result && !(result instanceof FailedTransactionMetadata));
  }

  function prepare(instructions, feePayer, signers = []) {
    svm.expireBlockhash();
    const tx = new Transaction({
      feePayer: feePayer.publicKey,
      recentBlockhash: svm.latestBlockhash(),
    }).add(...instructions);
    tx.sign(feePayer, ...signers);
    const bytes = tx.serialize();
    return {
      transaction: transactionCodec.decode(bytes),
      signature: signatureCodec.decode(tx.signature),
      signers: tx.signatures.map(({ publicKey }) => publicKey.toBase58()),
      blockhash: tx.recentBlockhash,
      bytesSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  function commit(label, signed, expectSwigRejection = false) {
    const result = svm.sendTransaction(signed.transaction);
    if (expectSwigRejection) {
      assert.ok(
        result instanceof FailedTransactionMetadata,
        `${label} unexpectedly succeeded`,
      );
      const failure = result
        .meta()
        .logs()
        .findLast((line) =>
          line.startsWith(`Program ${SWIG_PROGRAM_ADDRESS} failed:`),
        );
      assert.ok(failure, result.toString());
      events.push({
        label,
        signature: signed.signature,
        signers: signed.signers,
        failure,
      });
    } else {
      assert.ok(
        !(result instanceof FailedTransactionMetadata),
        `${label}: ${result.toString()}`,
      );
      assert.equal(signatureCodec.decode(result.signature()), signed.signature);
      events.push({
        label,
        signature: signed.signature,
        signers: signed.signers,
        compute: result.computeUnitsConsumed(),
      });
    }
    return result;
  }

  const send = (
    label,
    instructions,
    feePayer,
    signers = [],
    rejected = false,
  ) => commit(label, prepare(instructions, feePayer, signers), rejected);
  const balance = (pubkey) => svm.getBalance(pubkey.toBase58()) ?? 0n;

  const id = randomBytes(32);
  const config = findSwigPda(id);
  send(
    "create Pocket",
    [
      await getCreateSwigInstruction({
        id,
        payer: root.publicKey,
        authorityInfo: createEd25519AuthorityInfo(root.publicKey),
        actions: Actions.set().all().get(),
      }),
    ],
    root,
  );
  function loadConfig(address) {
    const account = svm.getAccount(toPublicKey(address).toBase58());
    assert.ok(account.exists);
    assert.equal(account.programAddress, SWIG_PROGRAM_ADDRESS.toBase58());
    return getSwigCodec().decode(account.data);
  }
  const swig = new Swig(config, loadConfig(config), async (address) =>
    loadConfig(address),
  );
  const pocket = await getSwigWalletAddress(swig);
  const rootRole = swig.findRolesByEd25519SignerPk(root.publicKey)[0];
  assert.ok(rootRole);
  const initialPocketLamports = balance(pocket);

  const pocketAta = getAssociatedTokenAddressSync(mint.publicKey, pocket, true);
  const funderAta = getAssociatedTokenAddressSync(
    mint.publicKey,
    funder.publicKey,
  );
  const recipientAta = getAssociatedTokenAddressSync(
    mint.publicKey,
    recipient.publicKey,
  );
  const otherAta = getAssociatedTokenAddressSync(
    mint.publicKey,
    other.publicKey,
  );
  const ata = (address, owner) =>
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      address,
      owner,
      mint.publicKey,
    );
  send(
    "create fixture mint and ATAs",
    [
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint.publicKey,
        lamports: Number(svm.minimumBalanceForRentExemption(BigInt(MINT_SIZE))),
        space: MINT_SIZE,
        programId: TOKEN_PROGRAM_ID,
      }),
      createInitializeMint2Instruction(
        mint.publicKey,
        6,
        payer.publicKey,
        null,
      ),
      ata(pocketAta, pocket),
      ata(funderAta, funder.publicKey),
      ata(recipientAta, recipient.publicKey),
      ata(otherAta, other.publicKey),
      createMintToCheckedInstruction(
        mint.publicKey,
        funderAta,
        payer.publicKey,
        80n * MICRO,
        6,
      ),
    ],
    payer,
    [mint],
  );

  function tokenState(address) {
    const account = svm.getAccount(address.toBase58());
    assert.ok(account.exists);
    assert.equal(account.programAddress, TOKEN_PROGRAM_ID.toBase58());
    return unpackAccount(address, {
      data: Buffer.from(account.data),
      owner: TOKEN_PROGRAM_ID,
      executable: false,
      lamports: Number(account.lamports),
    });
  }
  const tokenAmount = (address) => tokenState(address).amount;
  const tokenTransfer = (source, destination, owner, amount) =>
    createTransferCheckedInstruction(
      source,
      mint.publicKey,
      destination,
      owner,
      amount,
      6,
    );
  const solTransfer = (source, destination, amount) =>
    SystemProgram.transfer({
      fromPubkey: source,
      toPubkey: destination,
      lamports: amount,
    });

  assert.ok(tokenState(pocketAta).owner.equals(pocket));
  assert.ok(tokenState(funderAta).owner.equals(funder.publicKey));
  assert.equal(tokenAmount(pocketAta), 0n);
  const funderLamports = balance(funder.publicKey);
  const funding = prepare(
    [
      solTransfer(funder.publicKey, pocket, 400_000_000n),
      tokenTransfer(funderAta, pocketAta, funder.publicKey, 50n * MICRO),
    ],
    payer,
    [funder],
  );
  assert.deepEqual(funding.signers, [
    payer.publicKey.toBase58(),
    funder.publicKey.toBase58(),
  ]);
  commit("external wallet funds SOL and SPL in one transaction", funding);
  assert.equal(balance(pocket), initialPocketLamports + 400_000_000n);
  assert.equal(balance(funder.publicKey), funderLamports - 400_000_000n);
  assert.equal(tokenAmount(pocketAta), 50n * MICRO);
  assert.equal(tokenAmount(funderAta), 30n * MICRO);

  async function grant(actions) {
    send(
      "root grants bounded session authority",
      await getAddAuthorityInstructions(
        swig,
        rootRole.id,
        createEd25519SessionAuthorityInfo(authority.publicKey, 150n),
        actions,
      ),
      payer,
      [root],
    );
    await swig.refetch();
    const role = swig.findRolesByAuthorityAddress(
      authority.publicKey.toBytes(),
    )[0];
    assert.ok(role);
    send(
      "role authority opens temporary session",
      await getCreateSessionInstructions(
        swig,
        role.id,
        session.publicKey,
        100n,
      ),
      payer,
      [authority],
    );
    await swig.refetch();
    assert.equal(swig.findRoleBySessionKey(session.publicKey)?.id, role.id);
    return role.id;
  }

  const wrap = (roleId, instructions) =>
    getSignInstructions(swig, roleId, instructions, false, {
      currentSlot: svm.getClock().slot,
    });
  const evidence = (details) =>
    t.diagnostic(
      JSON.stringify(
        {
          program: SWIG_PROGRAM_ADDRESS.toBase58(),
          digest,
          config: config.toBase58(),
          pocket: pocket.toBase58(),
          pocketAta: pocketAta.toBase58(),
          funder: funder.publicKey.toBase58(),
          funderAta: funderAta.toBase58(),
          mint: mint.publicKey.toBase58(),
          root: root.publicKey.toBase58(),
          session: session.publicKey.toBase58(),
          payer: payer.publicKey.toBase58(),
          recipient: recipient.publicKey.toBase58(),
          recipientAta: recipientAta.toBase58(),
          initialPocketLamports,
          details,
          events,
        },
        (_, value) => (typeof value === "bigint" ? value.toString() : value),
      ),
    );

  return {
    svm,
    initialPocketLamports,
    root,
    funder,
    payer,
    session,
    recipient,
    other,
    mint,
    swig,
    rootRole,
    pocket,
    pocketAta,
    funderAta,
    recipientAta,
    otherAta,
    prepare,
    commit,
    send,
    balance,
    tokenAmount,
    grant,
    wrap,
    solTransfer,
    tokenTransfer,
    evidence,
  };
}
