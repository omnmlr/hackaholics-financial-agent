import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  type AccountInfo,
} from "@solana/web3.js";
import {
  ACCOUNT_SIZE,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from "./classic-spl";
import { z } from "zod";
import {
  DEVNET_GENESIS,
  DEVNET_RPC,
  SolanaError,
  requireDevnet,
  type DraftEvent,
  type DraftStore,
  type PrepareTransfer,
  type SolanaDraft,
  type WalletSnapshot,
} from "./contracts";
import { atomsToDecimal, decimalToAtoms, safeLamports } from "./money";
import { pinnedDevnetRpc, type SolanaRpc } from "./rpc";
import { durableDraftStore } from "./store";
import { CIRCLE_DEVNET_USDC_MINT, CIRCLE_DEVNET_USDC_DECIMALS } from "./assets";
import { base58 } from "./encoding";

const Address = z.string().min(32).max(44);
const Prepare = z.strictObject({
  sender: Address,
  recipient: Address,
  asset: z.enum(["SOL", "SPL"]),
  amount: z.string().min(1).max(280),
  mint: Address.optional(),
  reference: Address.optional(),
});
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Approval = z.strictObject({
  digest: Digest,
  acknowledged: z.literal(true),
});
const Signed = z.strictObject({
  digest: Digest,
  signedTransactionBase64: z.string().min(1).max(1644),
});
const Owner = z.string().min(1).max(256);
const Id = z.uuid();
const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
function exactDigest(a: string, b: string) {
  return (
    /^[a-f0-9]{64}$/.test(a) &&
    /^[a-f0-9]{64}$/.test(b) &&
    timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
  );
}
function address(value: string, wallet = false) {
  try {
    const key = new PublicKey(value);
    if (
      key.toBase58() !== value ||
      (wallet && !PublicKey.isOnCurve(key.toBytes()))
    )
      throw new Error();
    return key;
  } catch {
    throw new SolanaError(
      "INVALID_ADDRESS",
      wallet
        ? "A valid wallet public key is required"
        : "Invalid Solana public key",
    );
  }
}
function integer(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new SolanaError(
      "INVALID_RPC_DATA",
      "RPC returned invalid chain data",
      502,
    );
  return value;
}
function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new SolanaError("INVALID_INPUT", "Invalid devnet request");
  return result.data;
}
/** Stable, closed review record; client prose and client fees never enter this digest. */
export function draftDigest(d: SolanaDraft): string {
  return sha256(
    JSON.stringify({
      version: 1,
      ...(d.reference ? { reference: d.reference } : {}),
      id: d.id,
      owner: d.owner,
      network: d.network,
      rpcEndpoint: d.rpcEndpoint,
      genesisHash: d.genesisHash,
      sender: d.sender,
      recipient: d.recipient,
      asset: d.asset,
      mint: d.mint,
      decimals: d.decimals,
      amount: d.amount,
      amountAtoms: d.amountAtoms,
      sourceTokenAccount: d.sourceTokenAccount,
      recipientTokenAccount: d.recipientTokenAccount,
      createsRecipientTokenAccount: d.createsRecipientTokenAccount,
      feeLamports: d.feeLamports,
      estimatedRentLamports: d.estimatedRentLamports,
      totalSolRequiredLamports: d.totalSolRequiredLamports,
      blockhash: d.blockhash,
      lastValidBlockHeight: d.lastValidBlockHeight,
      preparedAt: d.preparedAt,
      expiresAt: d.expiresAt,
      messageBase64: d.messageBase64,
      messageDigest: d.messageDigest,
      unsignedTransactionBase64: d.unsignedTransactionBase64,
      simulation: d.simulation,
    }),
  );
}
function chainAccount(info: AccountInfo<Buffer> | null) {
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID) || info.executable)
    throw new SolanaError(
      "UNSUPPORTED_TOKEN",
      "Only initialized classic SPL token accounts are supported",
    );
  return info;
}
function checkedToken(key: PublicKey, info: AccountInfo<Buffer>) {
  const token = unpackAccount(key, chainAccount(info), TOKEN_PROGRAM_ID);
  if (!token.isInitialized || info.data.length !== ACCOUNT_SIZE)
    throw new SolanaError("UNSUPPORTED_TOKEN", "Unsupported token account");
  return token;
}

export function createSolanaService(
  options: {
    rpc?: SolanaRpc;
    store?: DraftStore;
    now?: () => Date;
  } = {},
) {
  const rpc = options.rpc ?? pinnedDevnetRpc();
  const store = options.store ?? durableDraftStore();
  const now = options.now ?? (() => new Date());
  const instant = () => now().toISOString();
  async function network() {
    requireDevnet();
    if (rpc.endpoint !== DEVNET_RPC)
      throw new SolanaError(
        "RPC_ENDPOINT",
        "Only the pinned devnet RPC is allowed",
        503,
      );
    try {
      if ((await rpc.getGenesisHash()) !== DEVNET_GENESIS)
        throw new SolanaError(
          "WRONG_CLUSTER",
          "RPC genesis does not match Solana devnet",
          503,
        );
    } catch (error) {
      if (error instanceof SolanaError) throw error;
      throw new SolanaError(
        "RPC_UNAVAILABLE",
        "Solana devnet is unavailable",
        503,
      );
    }
  }
  async function rpcRead<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof SolanaError) throw error;
      throw new SolanaError(
        "RPC_UNAVAILABLE",
        "Solana devnet could not verify this request",
        503,
      );
    }
  }
  async function load(owner: string, id: string) {
    requireDevnet();
    parsed(Owner, owner);
    parsed(Id, id);
    const d = await store.get(owner, id);
    if (!d || d.owner !== owner || d.id !== id)
      throw new SolanaError("NOT_FOUND", "Devnet draft not found", 404);
    if (
      d.network !== "devnet" ||
      d.genesisHash !== DEVNET_GENESIS ||
      d.rpcEndpoint !== DEVNET_RPC ||
      !exactDigest(d.digest, draftDigest(d)) ||
      sha256(Buffer.from(d.messageBase64, "base64")) !== d.messageDigest
    )
      throw new SolanaError(
        "DRAFT_INTEGRITY",
        "Devnet draft integrity check failed",
        409,
      );
    return d;
  }
  async function transition(
    d: SolanaDraft,
    changes: Partial<SolanaDraft>,
    action: string,
    details?: DraftEvent["details"],
  ) {
    const next = { ...d, ...changes, revision: d.revision + 1 };
    if (!(await store.transition(d, next, { action, at: instant(), details })))
      throw new SolanaError(
        "STATE_CHANGED",
        "Devnet draft changed; refresh before continuing",
        409,
      );
    return next;
  }
  async function current(d: SolanaDraft) {
    const height = integer(await rpcRead(() => rpc.getBlockHeight()));
    if (
      now().getTime() >= Date.parse(d.expiresAt) ||
      height > d.lastValidBlockHeight
    ) {
      await transition(
        d,
        { state: "expired", failureCode: "BLOCKHASH_EXPIRED" },
        "expired",
      );
      throw new SolanaError(
        "DRAFT_EXPIRED",
        "This draft expired; prepare and review a new one",
        409,
      );
    }
  }
  async function tokenAccounts(owner: PublicKey) {
    const accounts = await rpcRead(() => rpc.getTokenAccountsByOwner(owner));
    if (accounts.length > 128)
      throw new SolanaError(
        "WALLET_LIMIT",
        "Wallet has too many token accounts for this devnet demonstration",
        422,
      );
    return accounts.map(({ pubkey, account }) => {
      const token = checkedToken(pubkey, account);
      if (!token.owner.equals(owner))
        throw new SolanaError(
          "INVALID_RPC_DATA",
          "Token account ownership mismatch",
          502,
        );
      return { key: pubkey, token };
    });
  }
  async function mintInfo(mint: PublicKey) {
    const info = await rpcRead(() => rpc.getAccountInfo(mint));
    try {
      const decoded = unpackMint(mint, chainAccount(info), TOKEN_PROGRAM_ID);
      if (!decoded.isInitialized || info!.data.length !== 82) throw new Error();
      if (
        mint.toBase58() === CIRCLE_DEVNET_USDC_MINT &&
        decoded.decimals !== CIRCLE_DEVNET_USDC_DECIMALS
      )
        throw new SolanaError(
          "MINT_IDENTITY_MISMATCH",
          "Canonical Circle Devnet test-USDC must have six decimals",
          502,
        );
      return decoded;
    } catch (error) {
      if (error instanceof SolanaError) throw error;
      throw new SolanaError(
        "UNSUPPORTED_TOKEN",
        "Mint must be an initialized classic SPL mint",
      );
    }
  }
  return {
    async discoverWallet(
      owner: string,
      wallet: string,
    ): Promise<WalletSnapshot> {
      parsed(Owner, owner);
      const key = address(wallet, true);
      await network();
      const lamports = safeLamports(await rpcRead(() => rpc.getBalance(key)));
      const accounts = await tokenAccounts(key);
      const grouped = new Map<string, WalletSnapshot["tokens"][number]>();
      // Bound RPC work; public token labels/metadata are deliberately not invented.
      for (const { key: account, token } of accounts) {
        const mint = token.mint.toBase58();
        let row = grouped.get(mint);
        if (!row) {
          if (grouped.size >= 32)
            throw new SolanaError(
              "WALLET_LIMIT",
              "Too many token mints for this demonstration",
              422,
            );
          const info = await mintInfo(token.mint);
          row = {
            mint,
            decimals: info.decimals,
            amountAtoms: "0",
            amount: "0",
            accounts: [],
          };
          grouped.set(mint, row);
        }
        row.amountAtoms = (BigInt(row.amountAtoms) + token.amount).toString();
        row.amount = atomsToDecimal(BigInt(row.amountAtoms), row.decimals);
        row.accounts.push({
          address: account.toBase58(),
          amountAtoms: token.amount.toString(),
          frozen: token.isFrozen,
        });
      }
      return {
        network: "devnet",
        rpcEndpoint: DEVNET_RPC,
        genesisHash: DEVNET_GENESIS,
        wallet: key.toBase58(),
        fetchedAt: instant(),
        sol: {
          lamports: lamports.toString(),
          amount: atomsToDecimal(lamports, 9),
          decimals: 9,
        },
        tokens: [...grouped.values()].sort((a, b) =>
          a.mint.localeCompare(b.mint),
        ),
      };
    },
    async prepare(
      owner: string,
      untrusted: PrepareTransfer,
      requestId?: string,
    ): Promise<SolanaDraft> {
      parsed(Owner, owner);
      const input = parsed(Prepare, untrusted);
      if (requestId) {
        parsed(Id, requestId);
        requireDevnet();
        const saved = await store.get(owner, requestId);
        if (saved) {
          const original = await load(owner, requestId);
          if (
            original.sender !== input.sender ||
            original.recipient !== input.recipient ||
            original.asset !== input.asset ||
            original.mint !== (input.mint ?? null) ||
            original.reference !== input.reference ||
            decimalToAtoms(input.amount, original.decimals).toString() !==
              original.amountAtoms
          )
            throw new SolanaError(
              "REQUEST_CONFLICT",
              "Request identity already used for different transfer instructions",
              409,
            );
          return original;
        }
      }
      const sender = address(input.sender, true),
        recipient = address(input.recipient, true);
      if (sender.equals(recipient))
        throw new SolanaError(
          "SAME_WALLET",
          "Choose a different recipient wallet",
        );
      if (
        (input.asset === "SOL" && input.mint) ||
        (input.asset === "SPL" && !input.mint)
      )
        throw new SolanaError(
          "INVALID_MINT",
          "SOL has no mint; SPL transfers require a mint",
        );
      await network();
      let decimals = 9,
        sourceTokenAccount: string | null = null,
        recipientTokenAccount: string | null = null;
      let createsRecipientTokenAccount = false,
        rent = 0n;
      const tx = new Transaction();
      let atoms: bigint;
      if (input.asset === "SOL") {
        atoms = decimalToAtoms(input.amount, decimals);
        const info = await rpcRead(() => rpc.getAccountInfo(recipient));
        if (
          info &&
          (info.executable ||
            !info.owner.equals(SystemProgram.programId) ||
            info.data.length)
        )
          throw new SolanaError(
            "INVALID_RECIPIENT",
            "Recipient must be a normal wallet account",
          );
        if (
          !info &&
          atoms <
            safeLamports(
              await rpcRead(() => rpc.getMinimumBalanceForRentExemption(0)),
            )
        )
          throw new SolanaError(
            "RECIPIENT_RENT",
            "Amount cannot fund the recipient wallet's minimum rent",
          );
        tx.add(
          SystemProgram.transfer({
            fromPubkey: sender,
            toPubkey: recipient,
            lamports: atoms,
          }),
        );
      } else {
        const mint = address(input.mint!);
        decimals = (await mintInfo(mint)).decimals;
        atoms = decimalToAtoms(input.amount, decimals);
        const sources = (await tokenAccounts(sender)).filter(
          ({ token }) =>
            token.mint.equals(mint) && !token.isFrozen && token.amount >= atoms,
        );
        sources.sort((a, b) =>
          a.key.toBase58().localeCompare(b.key.toBase58()),
        );
        if (!sources.length)
          throw new SolanaError(
            "INSUFFICIENT_TOKEN_BALANCE",
            "No unfrozen token account has the full transfer amount",
          );
        sourceTokenAccount = sources[0].key.toBase58();
        const destination = getAssociatedTokenAddressSync(
          mint,
          recipient,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        recipientTokenAccount = destination.toBase58();
        const destinationInfo = await rpcRead(() =>
          rpc.getAccountInfo(destination),
        );
        if (destinationInfo) {
          const account = checkedToken(destination, destinationInfo);
          if (
            !account.mint.equals(mint) ||
            !account.owner.equals(recipient) ||
            account.isFrozen
          )
            throw new SolanaError(
              "INVALID_RECIPIENT_TOKEN",
              "Recipient token account is invalid or frozen",
            );
        } else {
          createsRecipientTokenAccount = true;
          rent = safeLamports(
            await rpcRead(() =>
              rpc.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
            ),
          );
          tx.add(
            createAssociatedTokenAccountIdempotentInstruction(
              sender,
              destination,
              recipient,
              mint,
              TOKEN_PROGRAM_ID,
              ASSOCIATED_TOKEN_PROGRAM_ID,
            ),
          );
        }
        tx.add(
          createTransferCheckedInstruction(
            sources[0].key,
            mint,
            destination,
            sender,
            atoms,
            decimals,
            [],
            TOKEN_PROGRAM_ID,
          ),
        );
      }
      if (input.reference) {
        const reference = address(input.reference);
        if (
          tx.instructions.some(
            (ix) =>
              ix.programId.equals(reference) ||
              ix.keys.some((key) => key.pubkey.equals(reference)),
          )
        )
          throw new SolanaError(
            "REFERENCE_COLLISION",
            "The request reference must be a distinct read-only account",
          );
        // Solana Pay discovery reference, read-only and never a signer. It is
        // not an on-chain idempotency or settlement enforcement mechanism.
        tx.instructions
          .at(-1)!
          .keys.push({ pubkey: reference, isSigner: false, isWritable: false });
      }
      const latest = await rpcRead(() => rpc.getLatestBlockhash());
      address(latest.blockhash);
      integer(latest.lastValidBlockHeight);
      tx.feePayer = sender;
      tx.recentBlockhash = latest.blockhash;
      const message = tx.serializeMessage();
      const quote = await rpcRead(() =>
        rpc.getFeeForMessage(tx.compileMessage()),
      );
      if (quote === null)
        throw new SolanaError(
          "FEE_UNAVAILABLE",
          "Could not verify transaction fee; prepare again",
          503,
        );
      const fee = safeLamports(quote);
      const total = fee + rent + (input.asset === "SOL" ? atoms : 0n);
      if (safeLamports(await rpcRead(() => rpc.getBalance(sender))) < total)
        throw new SolanaError(
          "INSUFFICIENT_SOL",
          "Insufficient SOL for the amount, network fee and possible account rent",
        );
      const unsigned = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const simulation = await rpcRead(() => rpc.simulateTransaction(unsigned));
      if (simulation.err !== null)
        throw new SolanaError(
          "SIMULATION_FAILED",
          "Devnet simulation failed. Nothing was prepared, signed or submitted; review the balance, recipient and token account state.",
          409,
        );
      const simulationSlot = integer(simulation.slot);
      const simulationUnits =
        simulation.unitsConsumed === undefined
          ? null
          : integer(simulation.unitsConsumed);
      const at = now();
      const draft: SolanaDraft = {
        id: requestId ?? randomUUID(),
        owner,
        revision: 0,
        network: "devnet",
        rpcEndpoint: DEVNET_RPC,
        genesisHash: DEVNET_GENESIS,
        state: "prepared",
        sender: sender.toBase58(),
        recipient: recipient.toBase58(),
        asset: input.asset,
        mint: input.mint ?? null,
        ...(input.reference ? { reference: input.reference } : {}),
        decimals,
        amount: atomsToDecimal(atoms, decimals),
        amountAtoms: atoms.toString(),
        sourceTokenAccount,
        recipientTokenAccount,
        createsRecipientTokenAccount,
        feeLamports: fee.toString(),
        estimatedRentLamports: rent.toString(),
        totalSolRequiredLamports: total.toString(),
        blockhash: latest.blockhash,
        lastValidBlockHeight: latest.lastValidBlockHeight,
        preparedAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + 90_000).toISOString(),
        unsignedTransactionBase64: unsigned.toString("base64"),
        simulation: {
          at: at.toISOString(),
          slot: simulationSlot,
          unitsConsumed: simulationUnits,
          passed: true,
        },
        messageBase64: message.toString("base64"),
        messageDigest: sha256(message),
        digest: "",
        approval: null,
        submission: null,
        confirmation: null,
        failureCode: null,
      };
      draft.digest = draftDigest(draft);
      await store.create(draft, {
        action: "prepared",
        at: draft.preparedAt,
        details: { network: "devnet", messageDigest: draft.messageDigest },
      });
      return draft;
    },
    get: load,
    async list(owner: string) {
      requireDevnet();
      parsed(Owner, owner);
      const drafts = await store.list(owner);
      return drafts
        .filter((d) => d.owner === owner)
        .map((d) => {
          if (!exactDigest(d.digest, draftDigest(d)))
            throw new SolanaError(
              "DRAFT_INTEGRITY",
              "Draft integrity check failed",
              409,
            );
          return d;
        });
    },
    /** Only the password-reauthenticated human route may call this, never a model tool. */
    async approve(
      owner: string,
      id: string,
      input: { digest: string; acknowledged: true },
    ) {
      const request = parsed(Approval, input);
      await network();
      const d = await load(owner, id);
      if (!exactDigest(d.digest, request.digest))
        throw new SolanaError(
          "REVIEW_CHANGED",
          "Review the exact current transaction before approving",
          409,
        );
      if (d.state !== "prepared" || d.submission)
        throw new SolanaError(
          "INVALID_STATE",
          "Only an unsubmitted prepared draft can be approved",
          409,
        );
      if (!d.simulation?.passed)
        throw new SolanaError(
          "SIMULATION_REQUIRED",
          "Prepare a new draft with a verified simulation before approval or signing",
          409,
        );
      await current(d);
      return transition(
        d,
        {
          state: "approved",
          approval: { actor: owner, at: instant(), digest: d.digest },
        },
        "human_approved",
        { digest: d.digest },
      );
    },
    async submitSigned(
      owner: string,
      id: string,
      input: { digest: string; signedTransactionBase64: string },
    ) {
      const request = parsed(Signed, input);
      await network();
      const d = await load(owner, id);
      if (!d.simulation?.passed)
        throw new SolanaError(
          "SIMULATION_REQUIRED",
          "Prepare a new draft with a verified simulation before signing",
          409,
        );
      if (
        d.state !== "approved" ||
        d.submission ||
        d.approval?.actor !== owner ||
        !exactDigest(d.digest, request.digest) ||
        !exactDigest(d.approval.digest, d.digest)
      )
        throw new SolanaError(
          "APPROVAL_REQUIRED",
          "Exact human approval is required before submission",
          403,
        );
      await current(d);
      let raw: Buffer, transaction: Transaction;
      try {
        raw = Buffer.from(request.signedTransactionBase64, "base64");
        if (
          raw.length > 1232 ||
          raw.toString("base64") !== request.signedTransactionBase64
        )
          throw new Error();
        transaction = Transaction.from(raw);
        if (
          transaction.signatures.length !== 1 ||
          !transaction.signatures[0].publicKey.equals(address(d.sender)) ||
          !transaction.verifySignatures(true) ||
          !transaction.signature ||
          !transaction
            .serializeMessage()
            .equals(Buffer.from(d.messageBase64, "base64")) ||
          !raw.equals(transaction.serialize())
        )
          throw new Error();
      } catch {
        throw new SolanaError(
          "INVALID_SIGNED_TRANSACTION",
          "Wallet signature and every transaction instruction must match the approved draft",
          400,
        );
      }
      const signature = base58(transaction.signature!);
      // Persist the one-use claim AND exact signature before the outbound mutation.
      // If the process stops here, reconciliation is the only recovery path.
      const claimed = await transition(
        d,
        {
          state: "submitting",
          submission: {
            claimId: randomUUID(),
            claimedAt: instant(),
            signature,
          },
        },
        "submission_claimed",
        { signature, messageDigest: d.messageDigest },
      );
      try {
        requireDevnet();
        const returned = await rpc.sendRawTransaction(raw);
        if (returned !== signature) throw new Error("signature mismatch");
      } catch {
        return transition(
          claimed,
          { state: "unknown", failureCode: "SUBMISSION_UNCERTAIN" },
          "submission_uncertain",
          { signature },
        );
      }
      // An RPC send acknowledgement does not establish execution or finality.
      return transition(
        claimed,
        { state: "submitted", failureCode: null },
        "submitted",
        { signature },
      );
    },
    async reconcile(owner: string, id: string) {
      await network();
      const d = await load(owner, id);
      if (
        !d.submission ||
        ["finalized", "failed", "cancelled"].includes(d.state)
      )
        return d;
      const signature = d.submission.signature;
      const [status, transaction] = await rpcRead(() =>
        Promise.all([
          rpc.getSignatureStatus(signature),
          rpc.getTransaction(signature),
        ]),
      );
      if (!transaction) {
        // Absence may mean propagation delay or RPC pruning. Never infer failure or resend.
        return d;
      }
      if (
        (transaction.version !== undefined &&
          transaction.version !== "legacy") ||
        transaction.transaction.signatures[0] !== signature ||
        !Buffer.from(transaction.transaction.message.serialize()).equals(
          Buffer.from(d.messageBase64, "base64"),
        ) ||
        !transaction.meta
      ) {
        throw new SolanaError(
          "CONFIRMATION_MISMATCH",
          "RPC transaction does not match the approved transfer",
          502,
        );
      }
      integer(transaction.slot);
      const actualFee = safeLamports(transaction.meta.fee).toString();
      if (
        status &&
        JSON.stringify(status.err) !== JSON.stringify(transaction.meta.err)
      )
        throw new SolanaError(
          "CONFIRMATION_CONFLICT",
          "RPC confirmation evidence conflicts; verification remains unresolved",
          502,
        );
      if (transaction.meta.err !== null)
        return transition(
          d,
          {
            state: "failed",
            failureCode: "ON_CHAIN_FAILURE",
            confirmation: null,
          },
          "chain_failed",
          { signature, slot: transaction.slot },
        );
      const commitment =
        status?.confirmationStatus === "finalized" ? "finalized" : "confirmed";
      if (d.state === commitment && d.confirmation?.slot === transaction.slot)
        return d;
      return transition(
        d,
        {
          state: commitment,
          failureCode: null,
          confirmation: {
            slot: transaction.slot,
            at: instant(),
            commitment,
            feeLamports: actualFee,
            blockTime:
              Number.isSafeInteger(transaction.blockTime) &&
              transaction.blockTime! >= 0
                ? transaction.blockTime
                : null,
          },
        },
        "chain_verified",
        { signature, slot: transaction.slot, commitment },
      );
    },
    async cancel(owner: string, id: string) {
      const d = await load(owner, id);
      if (d.state === "cancelled") return d;
      if (d.submission || !["prepared", "approved"].includes(d.state))
        throw new SolanaError(
          "CANNOT_CANCEL",
          "Submission has started or this draft is no longer cancellable",
          409,
        );
      return transition(d, { state: "cancelled", approval: null }, "cancelled");
    },
  };
}
let singleton: ReturnType<typeof createSolanaService> | undefined;
export function service() {
  return (singleton ??= createSolanaService());
}
