export type WalletNetwork = "devnet" | "mainnet";
export type WalletProvider = "phantom" | "solflare" | "backpack";

export const walletProviders = {
  phantom: { name: "Phantom", androidPackage: "app.phantom" },
  solflare: { name: "Solflare", androidPackage: "com.solflare.mobile" },
  backpack: { name: "Backpack", androidPackage: "app.backpack.mobile" },
} satisfies Record<WalletProvider, { name: string; androidPackage: string }>;

export type WalletAccount = {
  network: WalletNetwork;
  address: string;
  connections: { provider: WalletProvider; label?: string }[];
};

export type Holding = {
  id: string;
  label: string;
  decimals: number;
  atoms: bigint;
  priceId?: string;
};
export type WalletBalance = { holdings: Holding[]; fetchedAt: number };
export type Price = { usd: number; updatedAt: number };
export type TransferInput = {
  recipient: string;
  asset: string;
  amount: string;
};
export type PreparedTransfer = TransferInput & {
  sender: string;
  network: WalletNetwork;
  assetLabel: string;
  recipientTokenAccount?: string;
  sourceTokenAccount?: string;
  fee: string;
  rent: string;
  reference: string;
  message: string;
  unsignedTransaction: string;
  slot: number;
  lastValidBlockHeight: number;
};
export type PaymentState =
  "pending" | "finalized" | "rejected" | "failed" | "expired" | "mismatch";
export type Payment = {
  transfer: PreparedTransfer;
  provider: WalletProvider;
  state: PaymentState;
  signature?: string;
};

export interface ChainAdapter {
  readonly chain: string;
  readonly signingNetwork: WalletNetwork;
  address(value: string): string;
  balances(network: WalletNetwork, address: string): Promise<WalletBalance>;
  prepare(
    network: WalletNetwork,
    sender: string,
    input: TransferInput,
  ): Promise<PreparedTransfer>;
  assertLive(transfer: PreparedTransfer): Promise<void>;
  confirm(payment: Payment): Promise<Payment>;
}

export interface WalletSigner {
  connect(
    provider: WalletProvider,
  ): Promise<{ address: string; label?: string; token: string }[]>;
  send(
    provider: WalletProvider,
    token: string,
    transfer: PreparedTransfer,
    onAuthorized: (nextToken: string) => Promise<void>,
    beforeSubmit: () => Promise<void>,
  ): Promise<string>;
}

export interface WalletStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export class ControlError extends Error {
  constructor(
    readonly reason:
      | "reject"
      | "relink"
      | "wrong-account"
      | "wallet-missing"
      | "expired"
      | "failed",
    message: string,
  ) {
    super(message);
  }
}

const authKey = (provider: WalletProvider, address: string) =>
  `auth.${provider}.${address}`;

const accountKey = (network: WalletNetwork, address: string) =>
  `${network}:${address}`;

export function portfolioValue(
  balances: (WalletBalance | undefined)[],
  prices: Record<string, Price>,
  now: number,
) {
  let usd = 0;
  let priced = 0;
  let unpriced = 0;
  for (const balance of balances) {
    for (const holding of balance?.holdings ?? []) {
      if (!holding.atoms) continue;
      const price = holding.priceId && prices[holding.priceId];
      if (
        price &&
        Number.isFinite(price.usd) &&
        price.usd > 0 &&
        price.updatedAt > 0 &&
        price.updatedAt <= now + 60_000 &&
        now - price.updatedAt <= 15 * 60_000
      ) {
        usd += (Number(holding.atoms) / 10 ** holding.decimals) * price.usd;
        priced++;
      } else {
        unpriced++;
      }
    }
  }
  return {
    usd: priced || (!unpriced && balances.some(Boolean)) ? usd : null,
    unpriced,
  };
}

function fingerprint(transfer: PreparedTransfer) {
  return JSON.stringify([
    transfer.network,
    transfer.sender,
    transfer.asset,
    transfer.amount,
    transfer.recipient,
  ]);
}

export class WalletControl {
  private busy = false;

  constructor(
    private readonly storage: WalletStorage,
    readonly chain: ChainAdapter,
    private readonly signer: WalletSigner,
  ) {}

  private async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.busy)
      throw new Error("A wallet operation is already in progress.");
    this.busy = true;
    try {
      return await task();
    } finally {
      this.busy = false;
    }
  }

  private key(suffix: string) {
    return `agus_wallet_control_v1.${this.chain.chain}.${suffix}`;
  }

  async accounts(): Promise<WalletAccount[]> {
    return JSON.parse((await this.storage.get(this.key("accounts"))) ?? "[]");
  }

  async payments(): Promise<Payment[]> {
    return JSON.parse((await this.storage.get(this.key("payments"))) ?? "[]");
  }

  private async saveAccount(
    network: WalletNetwork,
    address: string,
    connection?: WalletAccount["connections"][number],
  ) {
    const accounts = await this.accounts();
    const existing = accounts.find(
      (row) =>
        accountKey(row.network, row.address) === accountKey(network, address),
    );
    if (existing) {
      if (!connection) return;
      existing.connections = existing.connections.filter(
        (row) => row.provider !== connection.provider,
      );
      existing.connections.push(connection);
    } else {
      accounts.push({
        network,
        address,
        connections: connection ? [connection] : [],
      });
    }
    await this.storage.set(this.key("accounts"), JSON.stringify(accounts));
  }

  addWatch(network: WalletNetwork, address: string) {
    return this.run(() =>
      this.saveAccount(network, this.chain.address(address)),
    );
  }

  link(provider: WalletProvider) {
    return this.run(async () => {
      const accounts = await this.signer.connect(provider);
      for (const { address, label, token } of accounts) {
        await this.storage.set(this.key(authKey(provider, address)), token);
        await this.saveAccount(this.chain.signingNetwork, address, {
          provider,
          label,
        });
      }
    });
  }

  private async savePayment(payment: Payment) {
    const rows = (await this.payments()).filter(
      (row) => row.transfer.reference !== payment.transfer.reference,
    );
    const unresolved = rows.filter(
      (row) => row.state === "pending" || row.state === "mismatch",
    );
    const closed = rows.filter(
      (row) => row.state !== "pending" && row.state !== "mismatch",
    );
    await this.storage.set(
      this.key("payments"),
      JSON.stringify([payment, ...unresolved, ...closed.slice(0, 11)]),
    );
  }

  submit(provider: WalletProvider, transfer: PreparedTransfer) {
    return this.run(async () => {
      if (transfer.network !== this.chain.signingNetwork)
        throw new Error("Transfers are unavailable on the selected network.");
      const accounts = await this.accounts();
      const account = accounts.find(
        (row) =>
          row.network === transfer.network && row.address === transfer.sender,
      );
      const token = account?.connections.some(
        (row) => row.provider === provider,
      )
        ? await this.storage.get(this.key(authKey(provider, transfer.sender)))
        : null;
      if (!token)
        throw new Error(
          "Link this account in the selected app before signing.",
        );
      const existing = await this.payments();
      if (existing.some((row) => row.transfer.reference === transfer.reference))
        throw new Error(
          "This review was already used. Check the saved result.",
        );
      if (
        existing.some(
          (row) =>
            (row.state === "pending" || row.state === "mismatch") &&
            fingerprint(row.transfer) === fingerprint(transfer),
        )
      ) {
        throw new Error(
          "An identical payment is unresolved. Check its status before paying again.",
        );
      }
      await this.chain.assertLive(transfer);
      let payment: Payment = { transfer, provider, state: "pending" };
      let mayHaveSubmitted = false;
      try {
        const signature = await this.signer.send(
          provider,
          token,
          transfer,
          (nextToken) =>
            this.storage.set(
              this.key(authKey(provider, transfer.sender)),
              nextToken,
            ),
          async () => {
            await this.chain.assertLive(transfer);
            await this.savePayment(payment);
            mayHaveSubmitted = true;
          },
        );
        payment = { ...payment, signature };
      } catch (error) {
        if (error instanceof ControlError && error.reason === "reject") {
          payment = { ...payment, state: "rejected" };
        } else if (mayHaveSubmitted) {
          // Losing a response gives no evidence about whether the wallet sent.
          return payment;
        } else {
          throw error;
        }
      }
      await this.savePayment(payment);
      return payment;
    });
  }

  check(reference: string) {
    return this.run(async () => {
      const payment = (await this.payments()).find(
        (row) => row.transfer.reference === reference,
      );
      if (!payment) throw new Error("Payment record unavailable.");
      if (payment.state !== "pending") return payment;
      const result = await this.chain.confirm(payment);
      await this.savePayment(result);
      return result;
    });
  }
}
