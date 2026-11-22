import { Buffer } from "buffer";
import { base58 } from "@scure/base";
import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { CIRCLE_DEVNET_USDC_MINT } from "../../../src/lib/solana/assets";
import {
  ACCOUNT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  unpackAccount,
  unpackMint,
} from "../../../src/lib/solana/classic-spl";
import { DEVNET_GENESIS, DEVNET_RPC } from "../../../src/lib/solana/primitives";
import {
  atomsToDecimal,
  decimalToAtoms,
  safeLamports,
} from "../../../src/lib/solana/money";
import {
  ControlError,
  type ChainAdapter,
  type Holding,
  type Payment,
  type PreparedTransfer,
  type Price,
  type TransferInput,
  type WalletNetwork,
} from "./wallet-control";

const networks = {
  devnet: { endpoint: DEVNET_RPC, genesis: DEVNET_GENESIS },
  mainnet: {
    endpoint: "https://api.mainnet-beta.solana.com",
    genesis: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  },
};
const mainnetMints: Record<string, { label: string; priceId: string }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: {
    label: "USDC",
    priceId: "usd-coin",
  },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: {
    label: "USDT",
    priceId: "tether",
  },
  So11111111111111111111111111111111111111112: {
    label: "Wrapped SOL",
    priceId: "solana",
  },
};
const token2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

async function boundedFetch(input: RequestInfo | URL, init?: RequestInit) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 12_000);
  try {
    return await fetch(input, { ...init, signal: abort.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function marketPrices(): Promise<Record<string, Price>> {
  const response = await boundedFetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana,usd-coin,tether&vs_currencies=usd&include_last_updated_at=true",
  );
  if (!response.ok) throw new Error("Market prices unavailable.");
  const data = await response.json();
  return Object.fromEntries(
    Object.entries(
      data as Record<string, { usd: number; last_updated_at: number }>,
    ).map(([id, value]) => [
      id,
      { usd: value.usd, updatedAt: value.last_updated_at * 1000 },
    ]),
  );
}

export function validSignature(value: string | undefined): value is string {
  try {
    return !!value && value.length <= 88 && base58.decode(value).length === 64;
  } catch {
    return false;
  }
}

function tokenLabel(network: WalletNetwork, mint: string) {
  if (network === "mainnet")
    return mainnetMints[mint] ?? { label: "SPL token" };
  if (mint === CIRCLE_DEVNET_USDC_MINT) return { label: "Circle test USDC" };
  return { label: "Devnet SPL token" };
}

type SolanaRpc = Pick<
  Connection,
  | "getGenesisHash"
  | "getBalance"
  | "getAccountInfo"
  | "getParsedTokenAccountsByOwner"
  | "getMinimumBalanceForRentExemption"
  | "getLatestBlockhashAndContext"
  | "getFeeForMessage"
  | "simulateTransaction"
  | "getBlockHeight"
  | "getSignaturesForAddress"
  | "getTransaction"
>;

export class SolanaControl implements ChainAdapter {
  readonly chain = "solana";
  readonly signingNetwork = "devnet";
  constructor(
    private readonly randomBytes: () => Uint8Array | Promise<Uint8Array>,
    private readonly rpc: Record<WalletNetwork, SolanaRpc> = {
      devnet: new Connection(networks.devnet.endpoint, {
        commitment: "confirmed",
        disableRetryOnRateLimit: true,
        fetch: boundedFetch,
      }),
      mainnet: new Connection(networks.mainnet.endpoint, {
        commitment: "confirmed",
        disableRetryOnRateLimit: true,
        fetch: boundedFetch,
      }),
    },
  ) {}

  address(value: string) {
    return new PublicKey(value.trim()).toBase58();
  }

  private async verified(network: WalletNetwork) {
    const rpc = this.rpc[network];
    if (!rpc || (await rpc.getGenesisHash()) !== networks[network].genesis)
      throw new Error("RPC does not match the selected Solana network.");
    return rpc;
  }

  async balances(network: WalletNetwork, address: string) {
    const rpc = await this.verified(network);
    const owner = new PublicKey(address);
    const [balance, classic, extensions] = await Promise.all([
      rpc.getBalance(owner),
      rpc.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      rpc.getParsedTokenAccountsByOwner(owner, { programId: token2022 }),
    ]);
    const holdings = new Map<string, Holding>();
    holdings.set("SOL", {
      id: "SOL",
      label: "SOL",
      atoms: safeLamports(balance),
      decimals: 9,
      priceId: network === "mainnet" ? "solana" : undefined,
    });
    for (const row of [...classic.value, ...extensions.value]) {
      const account = row.account.data.parsed.info;
      if (
        account.owner !== address ||
        !/^\d+$/.test(account.tokenAmount.amount)
      )
        throw new Error("RPC returned invalid token account data.");
      const mint = this.address(account.mint);
      const { decimals, amount } = account.tokenAmount;
      const existing = holdings.get(mint);
      if (
        !Number.isInteger(decimals) ||
        decimals < 0 ||
        decimals > 255 ||
        (existing && existing.decimals !== decimals)
      )
        throw new Error("RPC returned inconsistent token decimals.");
      holdings.set(mint, {
        id: mint,
        ...tokenLabel(network, mint),
        atoms: (existing?.atoms ?? 0n) + BigInt(amount),
        decimals,
      });
    }
    return {
      fetchedAt: Date.now(),
      holdings: [...holdings.values()].filter(
        (holding) => holding.id === "SOL" || holding.atoms > 0n,
      ),
    };
  }

  async prepare(
    network: WalletNetwork,
    senderAddress: string,
    input: TransferInput,
  ): Promise<PreparedTransfer> {
    if (network !== "devnet")
      throw new Error("Only Devnet transfers are enabled.");
    const sender = new PublicKey(this.address(senderAddress));
    const recipient = new PublicKey(this.address(input.recipient));
    if (
      !PublicKey.isOnCurve(sender.toBytes()) ||
      !PublicKey.isOnCurve(recipient.toBytes())
    )
      throw new Error("Use a Solana wallet address for both accounts.");
    if (sender.equals(recipient))
      throw new Error("Choose a different recipient wallet.");
    const asset = input.asset === "SOL" ? "SOL" : this.address(input.asset);
    const rpc = await this.verified(network);
    const recipientInfo = await rpc.getAccountInfo(recipient);
    if (
      recipientInfo &&
      (recipientInfo.executable ||
        recipientInfo.data.length ||
        !recipientInfo.owner.equals(SystemProgram.programId))
    )
      throw new Error(
        "Recipient is an existing program or data account. Use a wallet address.",
      );
    const instructions: TransactionInstruction[] = [];
    let rent = 0n;
    let decimals = 9;
    let atoms: bigint;
    let sourceTokenAccount: string | undefined;
    let recipientTokenAccount: string | undefined;
    if (asset === "SOL") {
      atoms = decimalToAtoms(input.amount.trim(), decimals);
      instructions.push(
        SystemProgram.transfer({
          fromPubkey: sender,
          toPubkey: recipient,
          lamports: atoms,
        }),
      );
    } else {
      const mint = new PublicKey(asset);
      const source = getAssociatedTokenAddressSync(mint, sender);
      const destination = getAssociatedTokenAddressSync(mint, recipient);
      const [mintInfo, sourceInfo, destinationInfo] = await Promise.all([
        rpc.getAccountInfo(mint),
        rpc.getAccountInfo(source),
        rpc.getAccountInfo(destination),
      ]);
      const decodedMint = unpackMint(mint, mintInfo);
      if (!decodedMint.isInitialized)
        throw new Error("Choose an initialized classic SPL mint.");
      decimals = decodedMint.decimals;
      atoms = decimalToAtoms(input.amount.trim(), decimals);
      if (!sourceInfo)
        throw new Error(
          "Source associated token account has insufficient funds.",
        );
      const from = unpackAccount(source, sourceInfo);
      if (
        !from.isInitialized ||
        from.isFrozen ||
        !from.owner.equals(sender) ||
        !from.mint.equals(mint)
      )
        throw new Error(
          "Source associated token account is unavailable for transfers.",
        );
      if (from.amount < atoms)
        throw new Error(
          "Insufficient token funds in the source associated token account.",
        );
      if (destinationInfo) {
        const to = unpackAccount(destination, destinationInfo);
        if (
          !to.isInitialized ||
          to.isFrozen ||
          !to.owner.equals(recipient) ||
          !to.mint.equals(mint)
        )
          throw new Error(
            "Recipient associated token account is unavailable for transfers.",
          );
      } else {
        rent = safeLamports(
          await rpc.getMinimumBalanceForRentExemption(ACCOUNT_SIZE),
        );
        instructions.push(
          createAssociatedTokenAccountIdempotentInstruction(
            sender,
            destination,
            recipient,
            mint,
          ),
        );
      }
      instructions.push(
        createTransferCheckedInstruction(
          source,
          mint,
          destination,
          sender,
          atoms,
          decimals,
        ),
      );
      sourceTokenAccount = source.toBase58();
      recipientTokenAccount = destination.toBase58();
    }
    // Unique readonly key for finding a wallet broadcast if its response is lost.
    const reference = new PublicKey(await this.randomBytes());
    if (
      instructions.some(
        (ix) =>
          ix.programId.equals(reference) ||
          ix.keys.some((key) => key.pubkey.equals(reference)),
      )
    )
      throw new Error(
        "Could not create a distinct payment reference. Review again.",
      );
    instructions
      .at(-1)!
      .keys.push({ pubkey: reference, isSigner: false, isWritable: false });
    const { value: block, context } = await rpc.getLatestBlockhashAndContext();
    const message = new TransactionMessage({
      payerKey: sender,
      recentBlockhash: block.blockhash,
      instructions,
    }).compileToLegacyMessage();
    const transaction = new VersionedTransaction(message);
    const [fee, balance] = await Promise.all([
      rpc.getFeeForMessage(message),
      rpc.getBalance(sender),
    ]);
    if (fee.value === null)
      throw new Error("Network fee unavailable. Review again.");
    const lamports = safeLamports(fee.value);
    if (
      safeLamports(balance) <
      lamports + rent + (asset === "SOL" ? atoms : 0n)
    )
      throw new Error(
        "Insufficient SOL for the transfer, network fee or recipient account rent.",
      );
    const simulation = await rpc.simulateTransaction(transaction, {
      sigVerify: false,
      commitment: "confirmed",
      minContextSlot: context.slot,
    });
    if (simulation.value.err)
      throw new Error(
        `Devnet simulation failed. ${JSON.stringify(simulation.value.err)}`,
      );
    return {
      network,
      sender: sender.toBase58(),
      recipient: recipient.toBase58(),
      asset,
      amount: atomsToDecimal(atoms, decimals),
      assetLabel: asset === "SOL" ? "SOL" : tokenLabel(network, asset).label,
      fee: atomsToDecimal(lamports, 9),
      rent: atomsToDecimal(rent, 9),
      reference: reference.toBase58(),
      sourceTokenAccount,
      recipientTokenAccount,
      message: Buffer.from(message.serialize()).toString("base64"),
      unsignedTransaction: Buffer.from(transaction.serialize()).toString(
        "base64",
      ),
      slot: context.slot,
      lastValidBlockHeight: block.lastValidBlockHeight,
    };
  }

  async assertLive(transfer: PreparedTransfer) {
    if (transfer.network !== "devnet")
      throw new Error("Only Devnet transfers are enabled.");
    const rpc = await this.verified(transfer.network);
    if ((await rpc.getBlockHeight("confirmed")) > transfer.lastValidBlockHeight)
      throw new ControlError(
        "expired",
        "The review's blockhash expired. Prepare and review again.",
      );
  }

  async confirm(payment: Payment): Promise<Payment> {
    const { transfer } = payment;
    if (transfer.network !== "devnet")
      throw new Error("Only Devnet transfers are enabled.");
    const rpc = await this.verified(transfer.network);
    const candidates = await rpc.getSignaturesForAddress(
      new PublicKey(transfer.reference),
      { limit: 8, minContextSlot: transfer.slot },
      "confirmed",
    );
    const signatures = [
      ...new Set([
        payment.signature,
        ...candidates.map((row) => row.signature),
      ]),
    ].filter(validSignature);
    let mismatch: string | undefined;
    let unresolved = false;
    for (const signature of signatures) {
      const tx = await rpc.getTransaction(signature, {
        commitment: "finalized",
        maxSupportedTransactionVersion: 0,
      });
      if (!tx?.meta) {
        unresolved = true;
        continue;
      }
      if (
        tx.transaction.signatures[0] !== signature ||
        Buffer.from(tx.transaction.message.serialize()).toString("base64") !==
          transfer.message
      ) {
        if (
          signature === payment.signature ||
          tx.transaction.message.staticAccountKeys[0]?.toBase58() ===
            transfer.sender
        )
          mismatch = signature;
        continue;
      }
      return {
        ...payment,
        signature,
        state: tx.meta.err ? "failed" : "finalized",
      };
    }
    if (mismatch) return { ...payment, signature: mismatch, state: "mismatch" };
    if (
      unresolved ||
      candidates.some((row) => row.confirmationStatus !== "finalized")
    )
      return payment;
    // A missing receipt can also mean RPC history is incomplete. Only retire an
    // intent with no wallet signature once finalized block height passes expiry.
    if (
      !payment.signature &&
      (await rpc.getBlockHeight("finalized")) > transfer.lastValidBlockHeight
    )
      return { ...payment, state: "expired" };
    return payment;
  }
}
