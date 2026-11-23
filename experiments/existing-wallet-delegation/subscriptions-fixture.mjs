import assert from "node:assert/strict";
import {
  UNKNOWN_INIT_ID,
  decodeFixedDelegation,
  decodeRecurringDelegation,
  decodeSubscriptionAuthority,
  findFixedDelegationPda,
  findRecurringDelegationPda,
  findSubscriptionAuthorityPda,
  getCreateFixedDelegationOverlayInstructionAsync,
  getCreateRecurringDelegationOverlayInstructionAsync,
  getInitSubscriptionAuthorityOverlayInstructionAsync,
  getTransferFixedOverlayInstructionAsync,
  getTransferRecurringOverlayInstructionAsync,
} from "@solana/subscriptions";

import { subProgram } from "./local-ledger.mjs";

export function subscriptionFixture(ledger) {
  const { account, atas, tokenProgram, wallets } = ledger;
  const mint = wallets.mint.address;

  const init = (owner) =>
    getInitSubscriptionAuthorityOverlayInstructionAsync({
      owner: wallets[owner],
      payer: wallets.payer,
      tokenMint: mint,
      tokenProgram,
      userAta: atas[owner],
    });

  async function authority(owner) {
    const [address] = await findSubscriptionAuthorityPda({
      tokenMint: mint,
      user: wallets[owner].address,
    });
    const raw = account(address, subProgram);
    const state = decodeSubscriptionAuthority(raw).data;
    assert.equal(state.user, wallets[owner].address);
    assert.equal(state.tokenMint, mint);
    assert.equal(state.payer, wallets.payer.address);
    return {
      address,
      programOwner: raw.programAddress,
      lamports: raw.lamports,
      ...state,
    };
  }

  async function grant(type, owner, nonce, terms, initId = UNKNOWN_INIT_ID) {
    const fixed = type === "fixed";
    const find = fixed ? findFixedDelegationPda : findRecurringDelegationPda;
    const build = fixed
      ? getCreateFixedDelegationOverlayInstructionAsync
      : getCreateRecurringDelegationOverlayInstructionAsync;
    const delegatee = wallets.delegate.address;
    const delegator = wallets[owner].address;
    const [subscriptionAuthority] = await findSubscriptionAuthorityPda({
      tokenMint: mint,
      user: delegator,
    });
    const [address] = await find({
      subscriptionAuthority,
      delegatee,
      delegator,
      nonce,
    });
    const instruction = await build({
      delegator: wallets[owner],
      delegatee,
      nonce,
      ...terms,
      payer: wallets.payer,
      tokenMint: mint,
      expectedSubscriptionAuthorityInitId: initId,
    });
    return { address, type, owner, instruction };
  }

  async function grantState(grant) {
    const raw = account(grant.address, subProgram);
    const decode =
      grant.type === "fixed"
        ? decodeFixedDelegation
        : decodeRecurringDelegation;
    const state = decode(raw).data;
    const ownerAuthority = await authority(grant.owner);
    assert.equal(state.header.delegator, wallets[grant.owner].address);
    assert.equal(state.header.delegatee, wallets.delegate.address);
    assert.equal(state.header.payer, wallets.payer.address);
    assert.equal(state.header.initId, ownerAuthority.initId);
    assert.equal(state.subscriptionAuthority, ownerAuthority.address);
    assert.equal(state.mint, mint);
    return {
      address: grant.address,
      programOwner: raw.programAddress,
      lamports: raw.lamports,
      ...state,
    };
  }

  function pull(
    grant,
    destination,
    amount,
    { signer = "delegate", source = grant.owner } = {},
  ) {
    const build =
      grant.type === "fixed"
        ? getTransferFixedOverlayInstructionAsync
        : getTransferRecurringOverlayInstructionAsync;
    return build({
      delegatee: wallets[signer],
      delegationPda: grant.address,
      delegator: wallets[grant.owner].address,
      delegatorAta: atas[source],
      receiverAta: atas[destination],
      amount,
      tokenMint: mint,
      tokenProgram,
    });
  }

  return { init, authority, grant, grantState, pull };
}
