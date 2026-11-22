import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Button,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import { atomsToDecimal } from "../../src/lib/solana/money";
import { mwaSigner } from "./src/mwa-control";
import { marketPrices, SolanaControl } from "./src/solana-control";
import { apiOrigin } from "./src/session";
import {
  portfolioValue,
  WalletControl,
  walletProviders,
  type Payment,
  type PreparedTransfer,
  type Price,
  type WalletAccount,
  type WalletBalance,
  type WalletNetwork,
  type WalletProvider,
} from "./src/wallet-control";

const chain = new SolanaControl(() => Crypto.getRandomBytesAsync(32));
const control = new WalletControl(
  {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) =>
      SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
  },
  chain,
  mwaSigner(transact, {
    name: "AGUS Wallet Control",
    uri: apiOrigin,
    icon: "favicon.ico",
  }),
);
const providers = Object.keys(walletProviders) as WalletProvider[];
const rowKey = ({ network, address }: WalletAccount) => `${network}:${address}`;
const states = {
  pending: "Awaiting on-chain verification. Check status before sending again.",
  finalized: "Finalized on Devnet",
  rejected: "Wallet declined or cancelled the request",
  failed: "Transaction finalized with an on-chain error",
  expired:
    "Blockhash expired. No matching transaction found by the Devnet RPC.",
  mismatch:
    "The wallet reported a different on-chain transaction. Review in the wallet.",
} satisfies Record<Payment["state"], string>;

export default function WalletControlPanel() {
  const lock = useRef(false);
  const checkIndex = useRef(0);
  const [busy, setBusy] = useState(false);
  const [freshnessTick, setFreshnessTick] = useState(0);
  const [notice, setNotice] = useState("");
  const [accounts, setAccounts] = useState<WalletAccount[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [balances, setBalances] = useState<Record<string, WalletBalance>>({});
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, Price>>({});
  const [priceIssue, setPriceIssue] = useState(false);
  const [watch, setWatch] = useState("");
  const [watchNetwork, setWatchNetwork] = useState<WalletNetwork>("devnet");
  const [selected, setSelected] = useState<{
    address: string;
    provider: WalletProvider;
  } | null>(null);
  const [recipient, setRecipient] = useState("");
  const [asset, setAsset] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState<{
    provider: WalletProvider;
    transfer: PreparedTransfer;
  } | null>(null);

  const readBalances = useCallback(async (rows: WalletAccount[]) => {
    const quotes = rows.some((row) => row.network === "mainnet")
      ? marketPrices()
      : Promise.resolve({});
    const readings = Promise.allSettled(
      rows.map((row) => chain.balances(row.network, row.address)),
    );
    const [settled, [price]] = await Promise.all([
      readings,
      Promise.allSettled([quotes]),
    ]);
    setBalances((previous) => {
      const next = { ...previous };
      settled.forEach((result, i) => {
        if (result.status === "fulfilled") next[rowKey(rows[i])] = result.value;
      });
      return next;
    });
    setUnavailable(
      rows.filter((_, i) => settled[i].status === "rejected").map(rowKey),
    );
    setPrices(price.status === "fulfilled" ? price.value : {});
    setPriceIssue(price.status === "rejected");
  }, []);

  useEffect(() => {
    async function restore() {
      lock.current = true;
      setBusy(true);
      try {
        const [saved, recent] = await Promise.all([
          control.accounts(),
          control.payments(),
        ]);
        setAccounts(saved);
        setPayments(recent);
        await readBalances(saved);
      } catch {
        setNotice("Saved wallet control data could not be loaded.");
      } finally {
        lock.current = false;
        setBusy(false);
      }
    }
    void restore();
  }, [readBalances]);

  const run = useCallback((task: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    void task()
      .catch((error: unknown) => {
        setNotice(
          error instanceof Error
            ? error.message
            : "Wallet operation unavailable.",
        );
      })
      .finally(() => {
        lock.current = false;
        setBusy(false);
      });
  }, []);

  const check = useCallback(
    async (payment: Payment) => {
      const result = await control.check(payment.transfer.reference);
      setPayments(await control.payments());
      setNotice(states[result.state]);
      if (result.state === "finalized") await readBalances(accounts);
    },
    [accounts, readBalances],
  );

  useEffect(() => {
    const pending = payments.filter((payment) => payment.state === "pending");
    if (!pending.length) return;
    const timer = setInterval(() => {
      if (lock.current || AppState.currentState !== "active") return;
      const payment = pending[checkIndex.current++ % pending.length];
      run(() => check(payment));
    }, 12_000);
    return () => clearInterval(timer);
  }, [payments, check, run]);

  useEffect(() => {
    const timer = setInterval(() => setFreshnessTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const now = Math.max(Date.now(), freshnessTick);
  const mainnet = accounts.filter((row) => row.network === "mainnet");
  const fresh = (row: WalletAccount) => {
    const key = rowKey(row);
    const balance = balances[key];
    return (
      balance &&
      !unavailable.includes(key) &&
      now - balance.fetchedAt <= 5 * 60_000
    );
  };
  const total = portfolioValue(
    mainnet.map((row) => (fresh(row) ? balances[rowKey(row)] : undefined)),
    prices,
    now,
  );
  const missing = mainnet.filter((row) => !fresh(row)).length;
  const devnet = accounts.filter((row) => row.network === "devnet");
  const recentDevnet = devnet.filter(fresh);
  const devnetSol = recentDevnet.reduce(
    (sum, row) =>
      sum +
      (balances[rowKey(row)].holdings.find((holding) => holding.id === "SOL")
        ?.atoms ?? 0n),
    0n,
  );
  const usd = (value: number) => `US$${value.toFixed(2)}`;

  return (
    <View style={styles.group}>
      <Text style={styles.heading}>Solana wallet control</Text>
      <Text>
        Devnet payments only. Mainnet addresses can be watched on this device.
      </Text>
      <Text accessibilityLiveRegion="polite">{notice}</Text>
      <TextInput
        accessibilityLabel="Watch address"
        placeholder="Solana wallet address"
        value={watch}
        onChangeText={setWatch}
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <View style={styles.row}>
        <Button
          title={watchNetwork === "devnet" ? "✓ Devnet" : "Devnet"}
          disabled={busy}
          onPress={() => setWatchNetwork("devnet")}
        />
        <Button
          title={watchNetwork === "mainnet" ? "✓ Mainnet" : "Mainnet"}
          disabled={busy}
          onPress={() => setWatchNetwork("mainnet")}
        />
        <Button
          title="Add watch address"
          disabled={busy || !watch.trim()}
          onPress={() =>
            run(async () => {
              await control.addWatch(watchNetwork, watch);
              const rows = await control.accounts();
              setAccounts(rows);
              setWatch("");
              await readBalances(rows);
            })
          }
        />
      </View>
      {Platform.OS === "android" && (
        <View style={styles.row}>
          {providers.map((provider) => (
            <Button
              key={provider}
              title={`Link ${walletProviders[provider].name}`}
              disabled={busy}
              onPress={() =>
                run(async () => {
                  await control.link(provider);
                  const rows = await control.accounts();
                  setAccounts(rows);
                  setNotice(
                    `${walletProviders[provider].name} Devnet authorization saved.`,
                  );
                  await readBalances(rows);
                })
              }
            />
          ))}
        </View>
      )}
      <Button
        title="Refresh balances and prices"
        disabled={busy || !accounts.length}
        onPress={() => run(() => readBalances(accounts))}
      />
      {devnet.length > 1 && (
        <Text>
          Combined Devnet SOL:{" "}
          {recentDevnet.length ? atomsToDecimal(devnetSol, 9) : "unavailable"}
          {recentDevnet.length > 0 && recentDevnet.length < devnet.length
            ? " (partial)"
            : ""}
        </Text>
      )}
      {mainnet.length > 0 && (
        <Text>
          Combined mainnet value:{" "}
          {total.usd === null ? "unavailable" : usd(total.usd)}
          {total.usd !== null && (missing > 0 || total.unpriced > 0)
            ? " (partial)"
            : ""}
          {missing > 0 ? ` · ${missing} wallet(s) unavailable or stale` : ""}
          {total.unpriced > 0 ? ` · ${total.unpriced} unpriced holding(s)` : ""}
          {priceIssue
            ? " · CoinGecko price feed unavailable"
            : " · CoinGecko USD estimates"}
        </Text>
      )}
      {accounts.map((row) => {
        const key = rowKey(row);
        const balance = balances[key];
        const value =
          row.network === "mainnet" &&
          fresh(row) &&
          portfolioValue([balance], prices, now);
        return (
          <View key={key} style={styles.card}>
            <Text>
              {row.network === "devnet" ? "Devnet · test assets" : "Mainnet"}
            </Text>
            <Text selectable>{row.address}</Text>
            <Text>
              {row.connections.length
                ? "Wallet authorization saved"
                : "Watch only"}
            </Text>
            <Text>
              {balance
                ? `${new Date(balance.fetchedAt).toLocaleString()}${fresh(row) ? "" : " · stale balance"}`
                : "Balance unavailable"}
            </Text>
            {value && value.usd !== null && (
              <Text>
                {usd(value.usd)}
                {value.unpriced ? " (partial)" : ""}
              </Text>
            )}
            {balance?.holdings.map((holding) => (
              <Text selectable key={holding.id}>
                {atomsToDecimal(holding.atoms, holding.decimals)}{" "}
                {holding.label}
                {holding.id === "SOL" ? "" : ` · ${holding.id}`}
              </Text>
            ))}
            {row.connections.map(({ provider, label }) => (
              <Button
                key={provider}
                title={`Pay from ${walletProviders[provider].name}${label ? ` · ${label}` : ""}`}
                disabled={busy || Platform.OS !== "android"}
                onPress={() => {
                  setSelected({ address: row.address, provider });
                  setReview(null);
                }}
              />
            ))}
          </View>
        );
      })}
      {selected && (
        <View style={styles.card}>
          <Text>Devnet · {walletProviders[selected.provider].name}</Text>
          <Text selectable>{selected.address}</Text>
          <TextInput
            accessibilityLabel="Recipient wallet"
            placeholder="Recipient wallet address"
            value={recipient}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={styles.input}
            onChangeText={(text) => {
              setRecipient(text);
              setReview(null);
            }}
          />
          <TextInput
            accessibilityLabel="Token mint"
            placeholder="Classic SPL mint or leave blank for SOL"
            value={asset}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            style={styles.input}
            onChangeText={(text) => {
              setAsset(text);
              setReview(null);
            }}
          />
          <TextInput
            accessibilityLabel="Amount"
            placeholder="Amount"
            value={amount}
            keyboardType="decimal-pad"
            editable={!busy}
            style={styles.input}
            onChangeText={(text) => {
              setAmount(text);
              setReview(null);
            }}
          />
          <Button
            title="Review Devnet payment"
            disabled={busy || !recipient.trim() || !amount.trim()}
            onPress={() =>
              run(async () => {
                setReview(null);
                const transfer = await chain.prepare(
                  "devnet",
                  selected.address,
                  { recipient, asset: asset.trim() || "SOL", amount },
                );
                setReview({ provider: selected.provider, transfer });
              })
            }
          />
        </View>
      )}
      {review && (
        <View style={styles.card}>
          <Text>
            Devnet · {review.transfer.amount} {review.transfer.assetLabel} via{" "}
            {walletProviders[review.provider].name}
          </Text>
          {review.transfer.asset !== "SOL" && (
            <Text selectable>Mint {review.transfer.asset}</Text>
          )}
          <Text selectable>From {review.transfer.sender}</Text>
          <Text selectable>To {review.transfer.recipient}</Text>
          {review.transfer.recipientTokenAccount && (
            <Text selectable>
              Recipient token account {review.transfer.recipientTokenAccount}
            </Text>
          )}
          <Text>
            Network fee {review.transfer.fee} SOL · account rent{" "}
            {review.transfer.rent} SOL
          </Text>
          <Button
            title="Authorize and send with wallet"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const payment = await control.submit(
                  review.provider,
                  review.transfer,
                );
                setReview(null);
                setPayments(await control.payments());
                if (payment.state === "pending") {
                  setNotice(states[payment.state]);
                  await check(payment);
                } else {
                  setNotice(states[payment.state]);
                }
              })
            }
          />
        </View>
      )}
      {payments.map((payment) => (
        <View style={styles.card} key={payment.transfer.reference}>
          <Text>
            {walletProviders[payment.provider].name} · {payment.transfer.amount}{" "}
            {payment.transfer.assetLabel} · {states[payment.state]}
          </Text>
          <Text selectable>To {payment.transfer.recipient}</Text>
          <Text selectable>Reference {payment.transfer.reference}</Text>
          {payment.signature && (
            <Text selectable>Signature {payment.signature}</Text>
          )}
          {payment.state === "pending" && (
            <Button
              title="Check on-chain status"
              disabled={busy}
              onPress={() => run(() => check(payment))}
            />
          )}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 8, borderWidth: 1, borderColor: "#cbd5e1", padding: 12 },
  heading: { fontSize: 18, fontWeight: "700" },
  input: { borderWidth: 1, borderColor: "#94a3b8", padding: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  card: { borderTopWidth: 1, borderColor: "#cbd5e1", paddingTop: 8, gap: 6 },
});
