import assert from "node:assert/strict";
import test from "node:test";

import { AccountRole, createNoopSigner } from "@solana/kit";
import {
  getTransferSolInstruction,
  SYSTEM_PROGRAM_ADDRESS,
} from "@solana-program/system";
import {
  TOKEN_ERROR__INSUFFICIENT_FUNDS,
  TOKEN_ERROR__OWNER_MISMATCH,
} from "@solana-program/token";
import {
  PlanStatus,
  UNKNOWN_INIT_ID,
  SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_LIMIT,
  SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_PERIOD_LIMIT,
  SUBSCRIPTIONS_ERROR__DELEGATION_EXPIRED,
  SUBSCRIPTIONS_ERROR__INVALID_SUBSCRIPTION_AUTHORITY_PDA,
  SUBSCRIPTIONS_ERROR__NOT_PLAN_OWNER,
  SUBSCRIPTIONS_ERROR__SUBSCRIPTION_CANCELLED,
  SUBSCRIPTIONS_ERROR__UNAUTHORIZED,
  SUBSCRIPTIONS_ERROR__UNAUTHORIZED_DESTINATION,
  decodePlan,
  decodeSubscriptionDelegation,
  findPlanPda,
  findSubscriptionDelegationPda,
  getCancelSubscriptionOverlayInstructionAsync,
  getCreatePlanOverlayInstructionAsync,
  getRevokeDelegationOverlayInstruction,
  getRevokeSubscriptionAuthorityOverlayInstructionAsync,
  getSubscribeOverlayInstructionAsync,
  getTransferSubscriptionOverlayInstructionAsync,
  getUpdatePlanOverlayInstruction,
} from "@solana/subscriptions";

import {
  createLedger,
  DECIMALS,
  MAX,
  START,
  subProgram,
  units,
} from "./local-ledger.mjs";
import { subscriptionFixture } from "./subscriptions-fixture.mjs";

const subFailure = (code) => ({ failure: { program: subProgram, code } });

test("classic SPL baseline: one bounded delegate can pay arbitrary recipients or burn", async (t) => {
  const l = await createLedger(t);
  const { alice, delegate, mint } = l.wallets;
  const before = l.tokenState("alice");
  const tokenFailure = (code) => ({
    failure: { program: l.tokenProgram, code },
  });
  const pull = (destination, amount, signer = "delegate") =>
    l.directTransfer("alice", destination, signer, units(amount));

  await l.execute(
    "owner grants 15 tokens",
    [l.approve("alice", "delegate", units(15))],
    ["payer", "alice"],
  );
  l.assertToken("alice", units(100), delegate.address, units(15));
  const approved = l.tokenState("alice");
  await l.execute(
    "delegate sends 5 to merchant",
    [pull("merchant", 5)],
    ["payer", "delegate"],
  );
  l.setTime(START + 86_400n * 30n);
  await l.execute(
    "same delegate sends 4 to alternate 30 days later",
    [pull("alternate", 4)],
    ["payer", "delegate"],
  );
  await l.execute(
    "delegate burns 2",
    [
      l.token.getBurnCheckedInstruction({
        account: l.atas.alice,
        mint: mint.address,
        authority: delegate,
        amount: units(2),
        decimals: DECIMALS,
      }),
    ],
    ["payer", "delegate"],
  );
  l.assertToken("alice", units(89), delegate.address, units(4));
  await l.execute(
    "decline cumulative excess with sufficient balance",
    [pull("merchant", 5)],
    ["payer", "delegate"],
    tokenFailure(TOKEN_ERROR__INSUFFICIENT_FUNDS),
  );
  l.assertToken("alice", units(89), delegate.address, units(4));
  l.assertToken("merchant", units(5));
  l.assertToken("alternate", units(4));

  await l.execute(
    "owner immediately revokes unspent allowance",
    [l.revoke("alice")],
    ["payer", "alice"],
  );
  await l.execute(
    "decline the revoked delegate",
    [pull("merchant", 1)],
    ["payer", "delegate"],
    tokenFailure(TOKEN_ERROR__OWNER_MISMATCH),
  );
  l.assertToken("alice", units(89));
  assert.equal(l.tokenState("alice").tokenOwner, alice.address);
  l.evidence("baseline", { before, approved, final: l.tokenState("alice") });
});

test("Subscriptions: two independent owners approve fixed and recurring limits in place", async (t) => {
  const l = await createLedger(t);
  const s = subscriptionFixture(l);
  const before = { alice: l.tokenState("alice"), bob: l.tokenState("bob") };
  const fixed = await s.grant("fixed", "alice", 1n, {
    amount: units(25),
    expiryTs: START + 180n,
  });
  const recurring = await s.grant("recurring", "bob", 1n, {
    amountPerPeriod: units(20),
    periodLengthS: 60n,
    startTs: START,
    expiryTs: START + 180n,
  });
  await l.execute(
    "Alice approves PDA and fixed grant in one transaction",
    [await s.init("alice"), fixed.instruction],
    ["alice", "payer"],
  );
  await l.execute(
    "Bob approves PDA and recurring grant in one transaction",
    [await s.init("bob"), recurring.instruction],
    ["bob", "payer"],
  );
  const authorities = {
    alice: await s.authority("alice"),
    bob: await s.authority("bob"),
  };
  assert.notEqual(authorities.alice.address, authorities.bob.address);
  for (const role of ["alice", "bob"])
    l.assertToken(role, units(100), authorities[role].address, MAX);
  const approved = { alice: l.tokenState("alice"), bob: l.tokenState("bob") };

  await l.execute(
    "decline unrelated signer",
    [await s.pull(fixed, "merchant", units(1), { signer: "replacement" })],
    ["replacement", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__UNAUTHORIZED),
  );
  await l.execute(
    "decline pairing Alice's grant with Bob's ATA",
    [await s.pull(fixed, "merchant", units(1), { source: "bob" })],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__UNAUTHORIZED),
  );
  await l.execute(
    "fixed pull 10 to merchant",
    [await s.pull(fixed, "merchant", units(10))],
    ["delegate", "payer"],
  );
  await l.execute(
    "fixed pull 15 to a different payee",
    [await s.pull(fixed, "alternate", units(15))],
    ["delegate", "payer"],
  );
  await l.execute(
    "decline fixed cumulative excess",
    [await s.pull(fixed, "merchant", units(1))],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_LIMIT),
  );
  assert.equal((await s.grantState(fixed)).amount, 0n);
  l.assertToken("alice", units(75), authorities.alice.address, MAX - units(25));

  const expiring = await s.grant(
    "fixed",
    "alice",
    2n,
    { amount: units(5), expiryTs: START + 70n },
    authorities.alice.initId,
  );
  await l.execute(
    "owner creates a second grant on existing authority",
    [expiring.instruction],
    ["alice", "payer"],
  );
  assert.equal((await s.grantState(expiring)).amount, units(5));
  await l.execute(
    "first-period recurring pull of 8",
    [await s.pull(recurring, "merchant", units(8))],
    ["delegate", "payer"],
  );
  await l.execute(
    "decline first-period cumulative excess",
    [await s.pull(recurring, "merchant", units(13))],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_PERIOD_LIMIT),
  );
  assert.equal((await s.grantState(recurring)).amountPulledInPeriod, units(8));

  l.setTime(START + 120n);
  // An unused period elapsed with no scheduler. No transfer happened and no allowance accumulated.
  l.assertToken("bob", units(92), authorities.bob.address, MAX - units(8));
  await l.execute(
    "decline carryover after a skipped period",
    [await s.pull(recurring, "alternate", units(21))],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_PERIOD_LIMIT),
  );
  await l.execute(
    "new window permits 20 to another payee",
    [await s.pull(recurring, "alternate", units(20))],
    ["delegate", "payer"],
  );
  const recurringAfterRollover = await s.grantState(recurring);
  assert.equal(recurringAfterRollover.currentPeriodStartTs, START + 120n);
  assert.equal(recurringAfterRollover.amountPulledInPeriod, units(20));
  await l.execute(
    "decline expired fixed grant with unspent amount",
    [await s.pull(expiring, "merchant", units(1))],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__DELEGATION_EXPIRED),
  );

  l.setTime(START + 181n);
  await l.execute(
    "decline recurring past expiry",
    [await s.pull(recurring, "merchant", units(1))],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__DELEGATION_EXPIRED),
  );
  l.assertToken("alice", units(75), authorities.alice.address, MAX - units(25));
  l.assertToken("bob", units(72), authorities.bob.address, MAX - units(28));
  l.assertToken("merchant", units(18));
  l.assertToken("alternate", units(35));
  l.evidence("independent subscriptions grants", {
    before,
    approved,
    authorities,
    grants: {
      fixed: await s.grantState(fixed),
      expiring: await s.grantState(expiring),
      recurring: recurringAfterRollover,
    },
    final: { alice: l.tokenState("alice"), bob: l.tokenState("bob") },
  });
});

test("Subscriptions: balance failures roll back, delegate replacement and revocation stop pulls", async (t) => {
  const l = await createLedger(t);
  const s = subscriptionFixture(l);
  const { alice, delegate, replacement, payer, mint } = l.wallets;
  const tokenFailure = (code) => ({
    failure: { program: l.tokenProgram, code },
  });
  const before = l.tokenState("alice");
  await l.execute(
    "ordinary prior delegate already exists",
    [l.approve("alice", "replacement", units(4))],
    ["alice", "payer"],
  );
  const prior = l.tokenState("alice");
  l.assertToken("alice", units(100), replacement.address, units(4));

  const fixed = await s.grant("fixed", "alice", 1n, {
    amount: units(20),
    expiryTs: START + 600n,
  });
  await l.execute(
    "Subscriptions initialization replaces prior SPL delegate",
    [await s.init("alice"), fixed.instruction],
    ["alice", "payer"],
  );
  const authority = await s.authority("alice");
  const approved = l.tokenState("alice");
  l.assertToken("alice", units(100), authority.address, MAX);
  await l.execute(
    "decline displaced raw delegate",
    [l.directTransfer("alice", "merchant", "replacement", units(1))],
    ["replacement", "payer"],
    tokenFailure(TOKEN_ERROR__OWNER_MISMATCH),
  );
  await l.execute(
    "decline raw SPL transfer signed only by the program's delegatee",
    [l.directTransfer("alice", "merchant", "delegate", units(1))],
    ["delegate", "payer"],
    tokenFailure(TOKEN_ERROR__OWNER_MISMATCH),
  );

  await l.execute(
    "owner spends 94 independently",
    [l.directTransfer("alice", "alternate", "alice", units(94))],
    ["alice", "payer"],
  );
  await l.execute(
    "decline 10-token pull when 6 remain",
    [await s.pull(fixed, "merchant", units(10))],
    ["delegate", "payer"],
    tokenFailure(TOKEN_ERROR__INSUFFICIENT_FUNDS),
  );
  l.assertToken("alice", units(6), authority.address, MAX);
  l.assertToken("merchant", 0n);
  assert.equal(
    (await s.grantState(fixed)).amount,
    units(20),
    "failed CPI did not consume the grant",
  );
  await l.execute(
    "delegate pulls 3 from the remaining balance",
    [await s.pull(fixed, "merchant", units(3))],
    ["delegate", "payer"],
  );
  assert.equal((await s.grantState(fixed)).amount, units(17));

  await l.execute(
    "owner replaces the program PDA delegate",
    [l.approve("alice", "replacement", units(1))],
    ["alice", "payer"],
  );
  l.assertToken("alice", units(3), replacement.address, units(1));
  await l.execute(
    "decline Subscription pull after approval replacement",
    [await s.pull(fixed, "merchant", units(1))],
    ["delegate", "payer"],
    tokenFailure(TOKEN_ERROR__OWNER_MISMATCH),
  );
  assert.equal(
    (await s.grantState(fixed)).amount,
    units(17),
    "the policy record still exists",
  );
  await l.execute(
    "new raw delegate can spend its separate allowance",
    [l.directTransfer("alice", "merchant", "replacement", units(1))],
    ["replacement", "payer"],
  );
  l.assertToken("alice", units(2));

  await l.execute(
    "owner reinstates the program's ATA approval",
    [await s.init("alice")],
    ["alice", "payer"],
  );
  assert.equal((await s.authority("alice")).initId, authority.initId);
  assert.equal((await s.grantState(fixed)).header.delegatee, delegate.address);
  l.assertToken("alice", units(2), authority.address, MAX);
  await l.execute(
    "original grant collects again after owner reinstates approval",
    [await s.pull(fixed, "merchant", units(1))],
    ["delegate", "payer"],
  );
  assert.equal((await s.grantState(fixed)).amount, units(16));
  await l.execute(
    "owner removes only the fixed grant",
    [
      getRevokeDelegationOverlayInstruction({
        authority: alice,
        delegationAccount: fixed.address,
        receiver: payer.address,
      }),
    ],
    ["alice", "payer"],
  );
  assert.equal(l.vm.getAccount(fixed.address).exists, false);
  l.assertToken("alice", units(1), authority.address, MAX - units(1));
  await l.execute(
    "decline removed fixed grant",
    [await s.pull(fixed, "merchant", units(1))],
    ["delegate", "payer"],
    { failure: { program: subProgram, instructionError: 44 } },
  ); // InvalidAccountOwner on the closed PDA

  const active = await s.grant(
    "fixed",
    "alice",
    2n,
    { amount: units(1), expiryTs: START + 600n },
    authority.initId,
  );
  await l.execute(
    "owner creates another fixed grant",
    [active.instruction],
    ["alice", "payer"],
  );
  await l.execute(
    "owner atomically revokes ATA approval and closes the authority",
    [
      await getRevokeSubscriptionAuthorityOverlayInstructionAsync({
        user: alice,
        tokenMint: mint.address,
        tokenProgram: l.tokenProgram,
        receiver: payer.address,
      }),
    ],
    ["alice", "payer"],
  );
  assert.equal(l.vm.getAccount(authority.address).exists, false);
  assert.equal(l.vm.getAccount(active.address).exists, true);
  l.assertToken("alice", units(1));
  await l.execute(
    "decline surviving grant without active authority",
    [await s.pull(active, "merchant", units(1))],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__INVALID_SUBSCRIPTION_AUTHORITY_PDA),
  );
  l.assertToken("merchant", units(5));
  l.evidence("balance, replacement and revocation", {
    before,
    prior,
    approved,
    authority,
    final: l.tokenState("alice"),
  });
});

test("merchant plan: only entitled pullers and allowlisted recipient owners, with period-end cancellation", async (t) => {
  const l = await createLedger(t);
  const s = subscriptionFixture(l);
  const { alice, delegate, merchant, mint, payer, replacement } = l.wallets;
  const mintAddress = mint.address;
  const planId = 12n;
  const endTs = START + 10_800n;
  const periodHours = 1n;
  const planAmount = units(12);
  const metadataUri = "https://example.invalid/plan";
  const before = l.tokenState("alice");

  const [planPda] = await findPlanPda({ owner: merchant.address, planId });
  await l.execute(
    "merchant publishes plan with one payee owner and one optional puller",
    [
      await getCreatePlanOverlayInstructionAsync({
        amount: planAmount,
        destinations: [merchant.address],
        endTs,
        metadataUri,
        mint: mintAddress,
        owner: merchant,
        payer,
        periodHours,
        planId,
        pullers: [delegate.address],
        tokenProgram: l.tokenProgram,
      }),
    ],
    ["merchant", "payer"],
  );

  const plan = decodePlan(l.account(planPda, subProgram)).data;
  assert.equal(plan.owner, merchant.address);
  assert.equal(plan.data.destinations[0], merchant.address);
  assert.equal(plan.data.pullers[0], delegate.address);
  assert.equal(plan.data.terms.amount, planAmount);
  assert.equal(plan.data.terms.periodHours, periodHours);
  const [subscriptionPda] = await findSubscriptionDelegationPda({
    planPda,
    subscriber: alice.address,
  });
  await l.execute(
    "Alice approves the plan and ATA delegation in one transaction",
    [
      await s.init("alice"),
      await getSubscribeOverlayInstructionAsync({
        expectedAmount: plan.data.terms.amount,
        expectedCreatedAt: plan.data.terms.createdAt,
        expectedPeriodHours: plan.data.terms.periodHours,
        expectedSubscriptionAuthorityInitId: UNKNOWN_INIT_ID,
        merchant: merchant.address,
        payer,
        planId,
        subscriber: alice,
        tokenMint: mintAddress,
      }),
    ],
    ["alice", "payer"],
  );
  const authority = await s.authority("alice");
  const approved = l.tokenState("alice");
  l.assertToken("alice", units(100), authority.address, MAX);
  const subState = () =>
    decodeSubscriptionDelegation(l.account(subscriptionPda, subProgram)).data;
  assert.equal(subState().header.delegator, alice.address);
  assert.equal(subState().header.delegatee, planPda);
  assert.equal(subState().header.initId, authority.initId);
  assert.deepEqual(subState().terms, plan.data.terms);

  const pull = (caller, destination, amount) =>
    getTransferSubscriptionOverlayInstructionAsync({
      amount: units(amount),
      caller: l.wallets[caller],
      delegator: alice.address,
      planPda,
      receiverAta: l.atas[destination],
      subscriptionPda,
      tokenMint: mintAddress,
      tokenProgram: l.tokenProgram,
    });

  await l.execute(
    "decline unlisted caller",
    [await pull("replacement", "merchant", 5)],
    ["replacement", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__UNAUTHORIZED),
  );
  await l.execute(
    "decline approved puller directing the payment to an unlisted owner",
    [await pull("delegate", "alternate", 5)],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__UNAUTHORIZED_DESTINATION),
  );
  assert.equal(subState().amountPulledInPeriod, 0n);
  l.assertToken("alice", units(100), authority.address, MAX);
  l.assertToken("alternate", 0n);
  await l.execute(
    "puller collects 5 for allowed merchant owner",
    [await pull("delegate", "merchant", 5)],
    ["delegate", "payer"],
  );
  await l.execute(
    "decline merchant trying to exceed remaining budget",
    [await pull("merchant", "merchant", 8)],
    ["merchant", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__AMOUNT_EXCEEDS_PERIOD_LIMIT),
  );

  const update = (owner) =>
    getUpdatePlanOverlayInstruction({
      endTs,
      expectedCreatedAt: plan.data.terms.createdAt,
      expectedEndTs: endTs,
      expectedMetadataUri: metadataUri,
      expectedPullers: [delegate.address],
      metadataUri,
      owner,
      planPda,
      pullers: [replacement.address],
      status: PlanStatus.Active,
    });
  await l.execute(
    "decline puller changing merchant plan",
    [await update(delegate)],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__NOT_PLAN_OWNER),
  );
  await l.execute(
    "merchant changes the optional puller without subscriber signature",
    [await update(merchant)],
    ["merchant", "payer"],
  );
  const updated = decodePlan(l.account(planPda, subProgram)).data;
  assert.equal(updated.data.pullers[0], replacement.address);
  assert.deepEqual(updated.data.destinations, plan.data.destinations);
  await l.execute(
    "decline removed puller",
    [await pull("delegate", "merchant", 1)],
    ["delegate", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__UNAUTHORIZED),
  );

  const firstPeriodEnd = subState().currentPeriodStartTs + 3_600n;
  await l.execute(
    "subscriber cancels at period end",
    [
      await getCancelSubscriptionOverlayInstructionAsync({
        planPda,
        subscriber: alice,
        subscriptionPda,
      }),
    ],
    ["alice", "payer"],
  );
  assert.equal(subState().expiresAtTs, firstPeriodEnd);
  await l.execute(
    "replacement puller can collect the remaining 7 during the current period",
    [await pull("replacement", "merchant", 7)],
    ["replacement", "payer"],
  );
  l.setTime(firstPeriodEnd);
  await l.execute(
    "decline pull at cancellation boundary",
    [await pull("merchant", "merchant", 1)],
    ["merchant", "payer"],
    subFailure(SUBSCRIPTIONS_ERROR__SUBSCRIPTION_CANCELLED),
  );

  l.assertToken("alice", units(88), authority.address, MAX - units(12));
  l.assertToken("merchant", units(12));
  l.assertToken("alternate", 0n);
  l.evidence("allowlisted merchant plan", {
    before,
    approved,
    authority,
    planPda,
    subscriptionPda,
    plan,
    updatedPullers: updated.data.pullers,
    subscription: subState(),
    final: { alice: l.tokenState("alice"), merchant: l.tokenState("merchant") },
  });
});

test("Subscriptions: a basic Token-2022 mint uses the same in-place authority flow", async (t) => {
  const l = await createLedger(t, { useToken2022: true });
  const s = subscriptionFixture(l);
  const before = l.tokenState("bob");
  const grant = await s.grant("fixed", "bob", 1n, {
    amount: units(4),
    expiryTs: START + 180n,
  });
  await l.execute(
    "Bob grants 4 units of the synthetic Token-2022 mint",
    [await s.init("bob"), grant.instruction],
    ["bob", "payer"],
  );
  const authority = await s.authority("bob");
  l.assertToken("bob", units(100), authority.address, MAX);
  const approved = l.tokenState("bob");
  await l.execute(
    "delegate pulls 3 using the Token-2022 program",
    [await s.pull(grant, "merchant", units(3))],
    ["delegate", "payer"],
  );
  l.assertToken("bob", units(97), authority.address, MAX - units(3));
  l.assertToken("merchant", units(3));
  assert.equal((await s.grantState(grant)).amount, units(1));
  await l.execute(
    "Bob revokes at the Token-2022 layer",
    [l.revoke("bob")],
    ["bob", "payer"],
  );
  await l.execute(
    "decline Token-2022 pull after token revoke",
    [await s.pull(grant, "merchant", units(1))],
    ["delegate", "payer"],
    { failure: { program: l.tokenProgram, code: TOKEN_ERROR__OWNER_MISMATCH } },
  );
  l.assertToken("bob", units(97));
  l.evidence("basic Token-2022", {
    before,
    approved,
    authority,
    final: l.tokenState("bob"),
  });
});

test("native SOL: the delegate cannot sign for the existing System Program account", async (t) => {
  const l = await createLedger(t);
  const s = subscriptionFixture(l);
  const { alice, merchant } = l.wallets;
  const grant = await s.grant("fixed", "alice", 1n, {
    amount: units(1),
    expiryTs: START + 180n,
  });
  await l.execute(
    "Alice authorizes only the synthetic token account",
    [await s.init("alice"), grant.instruction],
    ["alice", "payer"],
  );
  const authority = await s.authority("alice");
  l.assertToken("alice", units(100), authority.address, MAX);
  const before = l.account(alice.address, SYSTEM_PROGRAM_ADDRESS).lamports;
  const destinationBefore = l.account(
    merchant.address,
    SYSTEM_PROGRAM_ADDRESS,
  ).lamports;
  const transfer = (source) =>
    getTransferSolInstruction({
      source,
      destination: merchant.address,
      amount: 10_000n,
    });
  await l.execute(
    "decline native SOL send missing Alice's signature",
    [transfer(createNoopSigner(alice.address))],
    ["delegate"],
    { feePayer: "delegate", missing: ["alice"] },
  );
  const unsignedSource = transfer(createNoopSigner(alice.address));
  await l.execute(
    "System Program declines when source is a nonsigner",
    [
      {
        ...unsignedSource,
        accounts: [
          { address: alice.address, role: AccountRole.WRITABLE },
          unsignedSource.accounts[1],
        ],
      },
    ],
    ["delegate"],
    {
      feePayer: "delegate",
      failure: { program: SYSTEM_PROGRAM_ADDRESS, instructionError: 7 }, // MissingRequiredSignature
    },
  );
  assert.equal(
    l.account(alice.address, SYSTEM_PROGRAM_ADDRESS).lamports,
    before,
  );
  assert.equal(
    l.account(merchant.address, SYSTEM_PROGRAM_ADDRESS).lamports,
    destinationBefore,
  );
  await l.execute(
    "Alice signs the same native SOL operation as a control",
    [transfer(alice)],
    ["alice", "payer"],
  );
  const after = l.account(alice.address, SYSTEM_PROGRAM_ADDRESS).lamports;
  assert.equal(after, before - 10_000n);
  assert.equal(
    l.account(merchant.address, SYSTEM_PROGRAM_ADDRESS).lamports,
    destinationBefore + 10_000n,
  );
  l.assertToken("alice", units(100), authority.address, MAX);
  l.evidence("native SOL", {
    nativeAccount: {
      address: alice.address,
      programOwner: SYSTEM_PROGRAM_ADDRESS,
      before,
      after,
    },
  });
});
