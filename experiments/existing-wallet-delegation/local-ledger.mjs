import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

import {
  SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase58Decoder,
  partiallySignTransactionMessageWithSigners,
  setTransactionMessageFeePayerSigner,
  signTransactionMessageWithSigners,
  unwrapOption,
} from "@solana/kit";
import { getCreateAccountInstruction } from "@solana-program/system";
import * as classic from "@solana-program/token";
import * as token2022 from "@solana-program/token-2022";
import { SUBSCRIPTIONS_PROGRAM_ADDRESS } from "@solana/subscriptions";
import { Clock, FailedTransactionMetadata, LiteSVM } from "litesvm";

export const START = 1_800_000_000n;
export const MAX = (1n << 64n) - 1n;
export const DECIMALS = 6;
export const units = (tokens) => BigInt(tokens) * 10n ** BigInt(DECIMALS);
export const subProgram = SUBSCRIPTIONS_PROGRAM_ADDRESS;

const programFile = new URL(
  "./.artifacts/subscriptions_program.so",
  import.meta.url,
);
const checksumFile = new URL(
  "./.artifacts/subscriptions_program.sha256",
  import.meta.url,
);
const program = readFileSync(programFile);
const programSha256 = createHash("sha256").update(program).digest("hex");
assert.equal(programSha256, readFileSync(checksumFile, "utf8").split(/\s+/)[0]);
assert.equal(program.subarray(0, 4).toString("hex"), "7f454c46");

const signatureDecoder = getBase58Decoder();
const asJson = (data) =>
  JSON.stringify(data, (_, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );

export async function createLedger(test, { useToken2022 = false } = {}) {
  const vm = new LiteSVM().withSigverify(true).withBlockhashCheck(true);
  vm.addProgram(subProgram, program);
  const token = useToken2022 ? token2022 : classic;
  const tokenProgram = useToken2022
    ? token2022.TOKEN_2022_PROGRAM_ADDRESS
    : classic.TOKEN_PROGRAM_ADDRESS;

  const rolePairs = await Promise.all(
    [
      "payer",
      "mint",
      "alice",
      "bob",
      "delegate",
      "replacement",
      "merchant",
      "alternate",
    ].map(async (role) => [role, await generateKeyPairSigner()]),
  );
  const wallets = Object.fromEntries(rolePairs);
  const nameByAddress = new Map(
    rolePairs.map(([name, signer]) => [signer.address, name]),
  );
  const { payer, mint } = wallets;
  for (const [role, signer] of rolePairs) {
    if (role === "mint") continue;
    const result = vm.airdrop(signer.address, 1_000_000_000n);
    assert.ok(result && !(result instanceof FailedTransactionMetadata), role);
  }
  setTime(START);

  const atas = {};
  const diagnostics = [];

  function setTime(unixTimestamp) {
    vm.setClock(
      new Clock(100n + unixTimestamp - START, START, 0n, 0n, unixTimestamp),
    );
  }

  async function execute(
    label,
    instructions,
    expectedSigners,
    { failure, missing = [], feePayer = "payer" } = {},
  ) {
    // Advance the local blockhash so an intentional repeat tests authority again.
    vm.expireBlockhash();
    const message = vm.setTransactionMessageLifetimeUsingLatestBlockhash(
      appendTransactionMessageInstructions(
        instructions,
        setTransactionMessageFeePayerSigner(
          wallets[feePayer],
          createTransactionMessage({ version: "legacy" }),
        ),
      ),
    );
    const transaction = await (missing.length
      ? partiallySignTransactionMessageWithSigners(message)
      : signTransactionMessageWithSigners(message));
    const required = Object.entries(transaction.signatures);
    const roles = (entries) =>
      entries.map(([address]) => nameByAddress.get(address) ?? address).sort();
    const signers = roles(
      required.filter(([, signature]) => signature !== null),
    );
    assert.deepEqual(signers, [...expectedSigners].sort(), label);
    assert.deepEqual(
      roles(required.filter(([, signature]) => signature === null)),
      [...missing].sort(),
      label,
    );
    if (missing.length) {
      assert.throws(() => vm.sendTransaction(transaction), {
        name: "SolanaError",
        context: {
          __code: SOLANA_ERROR__TRANSACTION__SIGNATURES_MISSING,
          addresses: missing.map((role) => wallets[role].address),
        },
      });
      diagnostics.push({
        label,
        signers,
        feePayer,
        missing,
        failure: "missing required signatures",
      });
      return;
    }
    const result = vm.sendTransaction(transaction);
    if (failure) {
      assert.ok(
        result instanceof FailedTransactionMetadata,
        `${label}: unexpectedly succeeded`,
      );
      const error = result.err();
      const logs = result.meta().logs();
      if ("instructionError" in failure) {
        assert.equal(
          error.err?.(),
          failure.instructionError,
          `${label}: ${result.toString()}`,
        );
        assert.ok(
          logs.some((line) =>
            line.startsWith(`Program ${failure.program} failed:`),
          ),
          `${label}: ${result.toString()}`,
        );
      } else {
        assert.equal(
          error.err?.()?.code,
          failure.code,
          `${label}: ${result.toString()}`,
        );
        assert.ok(
          logs.some((line) =>
            line.startsWith(
              `Program ${failure.program} failed: custom program error: 0x${failure.code.toString(16)}`,
            ),
          ),
          `${label}: ${result.toString()}`,
        );
      }
      diagnostics.push({ label, signers, feePayer, failure });
      return;
    }
    assert.ok(
      !(result instanceof FailedTransactionMetadata),
      `${label}: ${result.toString()}`,
    );
    diagnostics.push({
      label,
      signers,
      feePayer,
      signature: signatureDecoder.decode(result.signature()),
      computeUnits: result.computeUnitsConsumed(),
    });
  }

  const mintSize = BigInt(token.getMintSize());
  await execute(
    "initialize synthetic mint",
    [
      getCreateAccountInstruction({
        payer,
        newAccount: mint,
        lamports: vm.minimumBalanceForRentExemption(mintSize),
        space: mintSize,
        programAddress: tokenProgram,
      }),
      token.getInitializeMint2Instruction({
        mint: mint.address,
        mintAuthority: payer.address,
        decimals: DECIMALS,
      }),
    ],
    ["payer", "mint"],
  );
  for (const role of ["alice", "bob", "merchant", "alternate"]) {
    const owner = wallets[role].address;
    [atas[role]] = await token.findAssociatedTokenPda({
      mint: mint.address,
      owner,
      tokenProgram,
    });
    const instructions = [
      token.getCreateAssociatedTokenIdempotentInstruction({
        payer,
        ata: atas[role],
        owner,
        mint: mint.address,
        tokenProgram,
      }),
    ];
    if (role === "alice" || role === "bob") {
      instructions.push(
        token.getMintToCheckedInstruction({
          mint: mint.address,
          token: atas[role],
          mintAuthority: payer,
          amount: units(100),
          decimals: DECIMALS,
        }),
      );
    }
    await execute(`initialize ${role} ATA`, instructions, ["payer"]);
  }
  diagnostics.length = 0;

  function account(address, programAddress) {
    const raw = vm.getAccount(address);
    assert.ok(raw.exists, `Missing account ${address}`);
    assert.equal(raw.programAddress, programAddress);
    return raw;
  }

  function tokenState(role) {
    const raw = account(atas[role], tokenProgram);
    const decoded = token.decodeToken(raw).data;
    assert.equal(decoded.owner, wallets[role].address);
    assert.equal(decoded.mint, mint.address);
    return {
      ata: raw.address,
      programOwner: raw.programAddress,
      tokenOwner: decoded.owner,
      mint: decoded.mint,
      amount: decoded.amount,
      delegate: unwrapOption(decoded.delegate),
      delegatedAmount: decoded.delegatedAmount,
    };
  }

  function assertToken(role, amount, delegate = null, delegatedAmount = 0n) {
    const state = tokenState(role);
    assert.equal(state.amount, amount, `${role} token balance`);
    assert.equal(state.delegate, delegate, `${role} delegate`);
    assert.equal(
      state.delegatedAmount,
      delegatedAmount,
      `${role} delegation allowance`,
    );
  }

  function approve(role, delegate, amount) {
    return token.getApproveCheckedInstruction({
      source: atas[role],
      mint: mint.address,
      delegate: wallets[delegate].address,
      owner: wallets[role],
      amount,
      decimals: DECIMALS,
    });
  }

  function revoke(role) {
    return token.getRevokeInstruction({
      source: atas[role],
      owner: wallets[role],
    });
  }

  function directTransfer(source, destination, authority, amount) {
    return token.getTransferCheckedInstruction({
      source: atas[source],
      destination: atas[destination],
      authority: wallets[authority],
      mint: mint.address,
      amount,
      decimals: DECIMALS,
    });
  }

  function evidence(label, data) {
    test.diagnostic(
      asJson({
        label,
        programSha256,
        tokenProgram,
        roles: Object.fromEntries(
          rolePairs.map(([role, signer]) => [role, signer.address]),
        ),
        ...data,
        transactions: diagnostics,
      }),
    );
  }

  return {
    vm,
    token,
    tokenProgram,
    wallets,
    atas,
    setTime,
    execute,
    account,
    tokenState,
    assertToken,
    approve,
    revoke,
    directTransfer,
    evidence,
  };
}
