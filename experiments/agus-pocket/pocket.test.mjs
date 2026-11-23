import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { Actions, getRemoveAuthorityInstructions } from "@swig-wallet/classic";
import { FailedTransactionMetadata } from "litesvm";
import { lab, MICRO } from "./pocket-lab.mjs";
import { reconcileAttempt, rememberAttempt } from "./attempts.mjs";

test("Pocket funding, scoped SOL and SPL spending, revocation and root exit", async (t) => {
  const l = await lab(t);
  const destination = l.recipient.publicKey;
  const role = await l.grant(
    Actions.set()
      .programLimit({ programId: SystemProgram.programId })
      .programLimit({ programId: TOKEN_PROGRAM_ID })
      .solDestinationLimit({ amount: 70_000_000n, destination })
      .tokenDestinationLimit({
        mint: l.mint.publicKey,
        amount: 9n * MICRO,
        destination: l.recipientAta,
      })
      .get(),
  );
  const sol = (amount, payee = destination) =>
    l.solTransfer(l.pocket, payee, amount);
  const token = (amount, payee = l.recipientAta) =>
    l.tokenTransfer(l.pocketAta, payee, l.pocket, amount * MICRO);
  const use = async (label, ix, rejected = false) =>
    l.send(label, await l.wrap(role, [ix]), l.payer, [l.session], rejected);
  const signers = [
    l.payer.publicKey.toBase58(),
    l.session.publicKey.toBase58(),
  ];
  const fundingBalances = {
    sol: l.balance(l.pocket),
    token: l.tokenAmount(l.pocketAta),
  };
  const recipientStart = l.balance(destination);

  const solSigned = l.prepare(await l.wrap(role, [sol(50_000_000n)]), l.payer, [
    l.session,
  ]);
  assert.deepEqual(solSigned.signers, signers);
  l.commit("session pays 0.05 SOL", solSigned);
  const tokenSigned = l.prepare(await l.wrap(role, [token(5n)]), l.payer, [
    l.session,
  ]);
  assert.deepEqual(tokenSigned.signers, signers);
  l.commit("session pays five tokens", tokenSigned);
  assert.equal(l.balance(l.pocket), l.initialPocketLamports + 350_000_000n);
  assert.equal(l.balance(destination) - recipientStart, 50_000_000n);
  assert.equal(l.tokenAmount(l.pocketAta), 45n * MICRO);
  assert.equal(l.tokenAmount(l.recipientAta), 5n * MICRO);

  await use("reject SOL above remaining cap", sol(21_000_000n), true);
  await use("reject token payment above remaining cap", token(5n), true);
  await use(
    "reject unapproved SOL recipient",
    sol(1n, l.other.publicKey),
    true,
  );
  await use("reject unapproved token account", token(1n, l.otherAta), true);
  const memo = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
  assert.ok(l.svm.getAccount(memo.toBase58()).exists);
  await use(
    "reject a Memo invocation outside the configured programs",
    new TransactionInstruction({
      programId: memo,
      keys: [{ pubkey: l.pocket, isSigner: true, isWritable: false }],
      data: Buffer.from("local fixture"),
    }),
    true,
  );
  assert.equal(l.balance(l.pocket), l.initialPocketLamports + 350_000_000n);
  assert.equal(l.tokenAmount(l.pocketAta), 45n * MICRO);
  assert.equal(l.tokenAmount(l.otherAta), 0n);
  const oldRoleInstruction = await l.wrap(role, [token(1n)]);
  l.send(
    "root revokes session role",
    await getRemoveAuthorityInstructions(l.swig, l.rootRole.id, role),
    l.payer,
    [l.root],
  );
  await l.swig.refetch();
  assert.equal(l.swig.findRoleBySessionKey(l.session.publicKey), null);
  l.send("reject revoked role", oldRoleInstruction, l.payer, [l.session], true);
  assert.equal(l.balance(l.pocket), l.initialPocketLamports + 350_000_000n);
  assert.equal(l.tokenAmount(l.pocketAta), 45n * MICRO);

  const funderSolBefore = l.balance(l.funder.publicKey);
  l.send(
    "root returns remaining SOL and tokens to external funder",
    await l.wrap(l.rootRole.id, [
      sol(350_000_000n, l.funder.publicKey),
      token(45n, l.funderAta),
    ]),
    l.payer,
    [l.root],
  );
  assert.equal(l.balance(l.pocket), l.initialPocketLamports);
  assert.equal(l.balance(l.funder.publicKey) - funderSolBefore, 350_000_000n);
  assert.equal(l.tokenAmount(l.pocketAta), 0n);
  assert.equal(l.tokenAmount(l.funderAta), 75n * MICRO);
  l.evidence({
    fundingBalances,
    rootExit: { sol: l.balance(l.pocket), token: l.tokenAmount(l.pocketAta) },
  });
});

test("a Swig window enforces cumulative spend and recipient, not a 5-token per-payment cap", async (t) => {
  const l = await lab(t);
  const role = await l.grant(
    Actions.set()
      .programLimit({ programId: TOKEN_PROGRAM_ID })
      .tokenRecurringDestinationLimit({
        mint: l.mint.publicKey,
        recurringAmount: 20n * MICRO,
        window: 20n,
        destination: l.recipientAta,
      })
      .get(),
  );
  const payment = (amount) =>
    l.tokenTransfer(l.pocketAta, l.recipientAta, l.pocket, amount * MICRO);
  const pull = async (label, amount, rejected = false) =>
    l.send(
      label,
      await l.wrap(role, [payment(amount)]),
      l.payer,
      [l.session],
      rejected,
    );

  // Six exceeds the proposed five-token per-transaction limit. The program
  // accepts it because this grant defines only a cumulative window budget.
  await pull("window allows a single 6-token payment", 6n);
  await pull("same window allows remaining 14", 14n);
  await pull("same window rejects more after 20", 1n, true);
  assert.equal(l.tokenAmount(l.pocketAta), 30n * MICRO);
  l.svm.warpToSlot(35n);
  await l.swig.refetch();
  await pull("next window allows another payment", 5n);
  assert.equal(l.tokenAmount(l.pocketAta), 25n * MICRO);
  assert.equal(l.tokenAmount(l.recipientAta), 25n * MICRO);
  const expired = await l.wrap(role, [payment(1n)]);
  l.svm.warpToSlot(111n);
  l.send("reject expired session", expired, l.payer, [l.session], true);
  assert.equal(l.tokenAmount(l.pocketAta), 25n * MICRO);
  l.evidence({ window: { firstTotal: 20n * MICRO, nextPaid: 5n * MICRO } });
});

test("lost acknowledgement settles by saved signature; duplicates and failures do not trigger a new send", async (t) => {
  const l = await lab(t);
  const records = new Map();
  const transfer = (amount) =>
    l.tokenTransfer(l.pocketAta, l.recipientAta, l.pocket, amount * MICRO);
  const sign = async (amount) =>
    l.prepare(await l.wrap(l.rootRole.id, [transfer(amount)]), l.payer, [
      l.root,
    ]);
  const lookUp = (id) => {
    const result = l.svm.getTransaction(id);
    if (!result) return null;
    return result instanceof FailedTransactionMetadata ? "failed" : "settled";
  };
  const good = await sign(5n);
  const pending = rememberAttempt(records, "invoice-1", good);
  assert.equal(
    reconcileAttempt(pending, lookUp, l.svm.latestBlockhash()),
    "unconfirmed",
  );
  let broadcastCount = 0;
  function submitThenLoseAcknowledgement() {
    broadcastCount++;
    l.commit("payment lands before the acknowledgement is lost", good);
    throw new Error("connection lost after submit");
  }
  assert.throws(submitThenLoseAcknowledgement, /connection lost/);
  const reloaded = new Map(JSON.parse(JSON.stringify([...records])));
  const recovered = reloaded.get("invoice-1");
  assert.equal(
    reconcileAttempt(recovered, lookUp, l.svm.latestBlockhash()),
    "settled",
  );
  assert.equal(rememberAttempt(reloaded, "invoice-1", good), recovered);
  assert.equal(broadcastCount, 1);
  const duplicate = l.svm.sendTransaction(good.transaction);
  assert.ok(duplicate instanceof FailedTransactionMetadata);
  assert.equal(duplicate.err(), 6, "AlreadyProcessed");
  assert.equal(l.tokenAmount(l.recipientAta), 5n * MICRO);
  assert.equal(l.tokenAmount(l.pocketAta), 45n * MICRO);

  const failed = await sign(90n);
  const failedAttempt = rememberAttempt(reloaded, "invoice-2", failed);
  l.commit("insufficient vault balance", failed, true);
  assert.equal(
    reconcileAttempt(failedAttempt, lookUp, l.svm.latestBlockhash()),
    "failed",
  );
  const neverSubmitted = await sign(1n);
  const unknown = rememberAttempt(reloaded, "invoice-3", neverSubmitted);
  assert.equal(
    reconcileAttempt(unknown, lookUp, l.svm.latestBlockhash()),
    "unconfirmed",
  );
  l.svm.expireBlockhash();
  assert.equal(
    reconcileAttempt(unknown, lookUp, l.svm.latestBlockhash()),
    "expired-in-local-ledger",
  );
  const different = await sign(5n);
  assert.throws(
    () => rememberAttempt(reloaded, "invoice-1", different),
    /different signed attempt/,
  );
  assert.equal(l.tokenAmount(l.recipientAta), 5n * MICRO);
  l.evidence({
    recovered,
    broadcastCount,
    duplicateRuntimeCode: 6,
    failedAttempt,
    unknown,
  });
});
