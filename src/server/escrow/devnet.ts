import { createHash } from "node:crypto";
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  type AccountInfo,
  type Message,
  type SignatureStatus,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { CIRCLE_DEVNET_USDC_MINT } from "../../lib/solana/assets";
import { TOKEN_PROGRAM_ID, unpackAccount } from "../../lib/solana/classic-spl";
import { DEVNET_GENESIS, requireDevnet } from "../../lib/solana/contracts";
import { pinnedDevnetConnection } from "../../lib/solana/rpc";
import { invariant } from "../errors";
import { MAX_U64 } from "../../lib/solana/money";
export const ESCROW_PROGRAM_ID = new PublicKey(
  "AYCkNeJSmk99TSDYq7tH7yRmAfv64vw6vA6SvT732yCi",
);
export type EscrowTerms = {
  digest: string;
  amountAtoms: string;
  buyer: string;
  seller: string;
  buyerDestination: string;
  sellerSource: string;
  verifier: string;
  arbitrators: [string, string, string];
};
const discriminator = (name: string) =>
  createHash("sha256").update(name).digest().subarray(0, 8);
function validate(t: EscrowTerms) {
  invariant(
    /^[a-f0-9]{64}$/.test(t.digest) && t.digest !== "0".repeat(64),
    "INVALID_ORDER_DIGEST",
    400,
  );
  invariant(
    /^[1-9][0-9]{0,19}$/.test(t.amountAtoms) &&
      BigInt(t.amountAtoms) <= MAX_U64,
    "INVALID_ESCROW_AMOUNT",
    400,
  );
  const authorities = [t.buyer, t.seller, t.verifier, ...t.arbitrators];
  invariant(
    authorities.length === 6 && new Set(authorities).size === 6,
    "INVALID_ESCROW_AUTHORITIES",
    400,
  );
  for (const address of [...authorities, t.buyerDestination, t.sellerSource])
    invariant(
      new PublicKey(address).toBase58() === address,
      "INVALID_ESCROW_ADDRESS",
      400,
    );
  invariant(
    t.buyerDestination !== t.sellerSource,
    "INVALID_ESCROW_DESTINATIONS",
    400,
  );
}
export function escrowAddresses(t: EscrowTerms) {
  validate(t);
  const [escrow, bump] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("order"),
      new PublicKey(t.seller).toBuffer(),
      Buffer.from(t.digest, "hex"),
    ],
    ESCROW_PROGRAM_ID,
  );
  const [vault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), escrow.toBuffer()],
    ESCROW_PROGRAM_ID,
  );
  return { escrow, vault, bump };
}
export function fundingInstruction(t: EscrowTerms) {
  const { escrow, vault } = escrowAddresses(t);
  const amount = Buffer.alloc(8);
  amount.writeBigUInt64LE(BigInt(t.amountAtoms));
  const keys = [
    { pubkey: new PublicKey(t.seller), isSigner: true, isWritable: true },
    { pubkey: new PublicKey(t.buyer), isSigner: false, isWritable: false },
    {
      pubkey: new PublicKey(CIRCLE_DEVNET_USDC_MINT),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: new PublicKey(t.sellerSource),
      isSigner: false,
      isWritable: true,
    },
    {
      pubkey: new PublicKey(t.buyerDestination),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: escrow, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys,
    data: Buffer.concat([
      discriminator("global:fund"),
      Buffer.from(t.digest, "hex"),
      amount,
      new PublicKey(t.verifier).toBuffer(),
      ...t.arbitrators.map((a) => new PublicKey(a).toBuffer()),
    ]),
  });
}
export function settlementInstruction(
  t: EscrowTerms,
  action: "cooperative_release" | "mutual_cancel" | "dispute" | "arbitrate",
  signers: string[],
  release = false,
) {
  const { escrow, vault } = escrowAddresses(t);
  const signer = (pubkey: string) => ({
    pubkey: new PublicKey(pubkey),
    isSigner: true,
    isWritable: false,
  });
  if (action === "dispute") {
    invariant(
      signers.length === 1 && [t.buyer, t.seller].includes(signers[0]),
      "PARTY_REQUIRED",
      403,
    );
    return new TransactionInstruction({
      programId: ESCROW_PROGRAM_ID,
      keys: [
        { pubkey: escrow, isSigner: false, isWritable: true },
        signer(signers[0]),
      ],
      data: discriminator("global:dispute"),
    });
  }
  if (action === "cooperative_release")
    invariant(
      signers.length === 2 &&
        signers[0] === t.seller &&
        signers[1] === t.verifier,
      "SELLER_AND_VERIFIER_REQUIRED",
      403,
    );
  if (action === "mutual_cancel")
    invariant(
      signers.length === 2 && signers[0] === t.buyer && signers[1] === t.seller,
      "BOTH_PARTIES_REQUIRED",
      403,
    );
  if (action === "arbitrate")
    invariant(
      signers.length === 2 &&
        signers[0] !== signers[1] &&
        signers.every((k) => t.arbitrators.includes(k)),
      "TWO_ARBITRATORS_REQUIRED",
      403,
    );
  return new TransactionInstruction({
    programId: ESCROW_PROGRAM_ID,
    keys: [
      { pubkey: escrow, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      {
        pubkey: new PublicKey(CIRCLE_DEVNET_USDC_MINT),
        isSigner: false,
        isWritable: false,
      },
      {
        pubkey: new PublicKey(
          action === "cooperative_release" ||
            (action === "arbitrate" && release)
            ? t.buyerDestination
            : t.sellerSource,
        ),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...signers.map(signer),
    ],
    data: Buffer.concat([
      discriminator(`global:${action}`),
      ...(action === "arbitrate" ? [Buffer.from([release ? 1 : 0])] : []),
    ]),
  });
}
export function decodeEscrow(info: AccountInfo<Buffer>) {
  invariant(
    info.owner.equals(ESCROW_PROGRAM_ID) &&
      !info.executable &&
      info.data.length === 307 &&
      info.data.subarray(0, 8).equals(discriminator("account:Escrow")),
    "ESCROW_ACCOUNT_INVALID",
    502,
  );
  const bytes = info.data;
  let offset = 8;
  const digest = bytes.subarray(offset, (offset += 32)).toString("hex");
  const key = () =>
    new PublicKey(bytes.subarray(offset, (offset += 32))).toBase58();
  const buyer = key(),
    seller = key(),
    buyerDestination = key(),
    sellerSource = key(),
    verifier = key(),
    arbitrators: [string, string, string] = [key(), key(), key()];
  const amountAtoms = bytes.readBigUInt64LE(offset).toString();
  offset += 8;
  const bump = bytes[offset++],
    state = bytes[offset++],
    simulatedVerifier = bytes[offset] === 1;
  invariant(state <= 3 && simulatedVerifier, "ESCROW_ACCOUNT_INVALID", 502);
  return {
    digest,
    buyer,
    seller,
    buyerDestination,
    sellerSource,
    verifier,
    arbitrators,
    amountAtoms,
    bump,
    state,
    simulatedVerifier,
  };
}
export type FundingObservation = {
  genesisHash: string;
  status: SignatureStatus | null;
  transaction: VersionedTransactionResponse | null;
  escrow: AccountInfo<Buffer> | null;
  vault: AccountInfo<Buffer> | null;
  accountContextSlot: number;
};
/** Read-only verifier. Its observations must come from a pinned trusted RPC,
 * never an HTTP request body. It neither signs nor broadcasts. */
export function verifyFinalizedFunding(
  t: EscrowTerms,
  signature: string,
  o: FundingObservation,
) {
  const { escrow, vault, bump } = escrowAddresses(t),
    tx = o.transaction;
  invariant(o.genesisHash === DEVNET_GENESIS, "WRONG_DEVNET_GENESIS", 502);
  invariant(
    o.status?.confirmationStatus === "finalized" &&
      o.status.err === null &&
      tx?.meta &&
      tx.meta.err === null &&
      o.status.slot === tx.slot,
    "ESCROW_FINALITY_PENDING",
    409,
  );
  invariant(
    tx.version === "legacy" &&
      tx.transaction.signatures[0] === signature &&
      o.escrow &&
      o.vault,
    "ESCROW_FUNDING_MISMATCH",
    502,
  );
  invariant(
    Number.isSafeInteger(o.accountContextSlot) &&
      o.accountContextSlot >= tx.slot,
    "ESCROW_ACCOUNT_OBSERVATION_STALE",
    502,
  );
  const actual = Transaction.populate(
      tx.transaction.message as Message,
      tx.transaction.signatures,
    ),
    expected = fundingInstruction(t);
  invariant(
    actual.verifySignatures(true) &&
      actual.signatures.length === 1 &&
      actual.feePayer?.toBase58() === t.seller &&
      actual.instructions.length === 1,
    "ESCROW_FUNDING_MISMATCH",
    502,
  );
  const ix = actual.instructions[0];
  invariant(
    ix.programId.equals(expected.programId) &&
      ix.data.equals(expected.data) &&
      ix.keys.length === expected.keys.length &&
      ix.keys.every(
        (k, i) =>
          k.pubkey.equals(expected.keys[i].pubkey) &&
          k.isSigner === expected.keys[i].isSigner &&
          k.isWritable === expected.keys[i].isWritable,
      ),
    "ESCROW_FUNDING_MISMATCH",
    502,
  );
  const account = decodeEscrow(o.escrow);
  invariant(
    account.bump === bump &&
      account.state === 0 &&
      (
        [
          "digest",
          "amountAtoms",
          "buyer",
          "seller",
          "buyerDestination",
          "sellerSource",
          "verifier",
        ] as const
      ).every((k) => account[k] === t[k]) &&
      account.arbitrators.every((key, i) => key === t.arbitrators[i]),
    "ESCROW_TERMS_MISMATCH",
    502,
  );
  const token = unpackAccount(vault, o.vault);
  invariant(
    token.mint.toBase58() === CIRCLE_DEVNET_USDC_MINT &&
      token.owner.equals(escrow) &&
      token.isInitialized &&
      !token.isFrozen &&
      !token.delegate &&
      !token.closeAuthority &&
      token.amount >= BigInt(t.amountAtoms),
    "ESCROW_VAULT_MISMATCH",
    502,
  );
  const keys = (tx.transaction.message as Message).accountKeys;
  const balance = (
    phase: "preTokenBalances" | "postTokenBalances",
    address: string,
    owner: string,
    allowMissing = false,
  ) => {
    const index = keys.findIndex((k) => k.toBase58() === address),
      entries = tx.meta![phase]?.filter((b) => b.accountIndex === index) ?? [];
    if (!entries.length && allowMissing) return 0n;
    invariant(
      entries.length === 1 &&
        entries[0].mint === CIRCLE_DEVNET_USDC_MINT &&
        entries[0].owner === owner &&
        entries[0].uiTokenAmount.decimals === 6 &&
        /^[0-9]+$/.test(entries[0].uiTokenAmount.amount),
      "ESCROW_TOKEN_EVIDENCE_INVALID",
      502,
    );
    return BigInt(entries[0].uiTokenAmount.amount);
  };
  invariant(
    balance("preTokenBalances", t.sellerSource, t.seller) -
      balance("postTokenBalances", t.sellerSource, t.seller) ===
      BigInt(t.amountAtoms) &&
      balance("postTokenBalances", vault.toBase58(), escrow.toBase58()) -
        balance(
          "preTokenBalances",
          vault.toBase58(),
          escrow.toBase58(),
          true,
        ) ===
        BigInt(t.amountAtoms),
    "ESCROW_FUNDING_DELTA_MISMATCH",
    502,
  );
  return {
    signature,
    slot: tx.slot,
    escrow: escrow.toBase58(),
    vault: vault.toBase58(),
    amount: { atoms: t.amountAtoms, currency: "USDC", scale: 6 },
    network: "devnet",
    verification: "chain_finalized",
    simulatedVerifier: true,
    fiatSettlementVerified: false,
  };
}
export async function observeFinalizedFunding(
  t: EscrowTerms,
  signature: string,
) {
  requireDevnet();
  invariant(
    /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(signature),
    "INVALID_SIGNATURE",
    400,
  );
  const c = pinnedDevnetConnection(),
    genesisHash = await c.getGenesisHash();
  invariant(genesisHash === DEVNET_GENESIS, "WRONG_DEVNET_GENESIS", 502);
  const [statuses, transaction] = await Promise.all([
    c.getSignatureStatuses([signature], { searchTransactionHistory: true }),
    c.getTransaction(signature, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    }),
  ]);
  invariant(transaction, "ESCROW_FINALITY_PENDING", 409);
  const { escrow, vault } = escrowAddresses(t);
  const accounts = await c.getMultipleAccountsInfoAndContext([escrow, vault], {
    commitment: "finalized",
    minContextSlot: transaction.slot,
  });
  return verifyFinalizedFunding(t, signature, {
    genesisHash,
    status: statuses.value[0],
    transaction,
    escrow: accounts.value[0],
    vault: accounts.value[1],
    accountContextSlot: accounts.context.slot,
  });
}
