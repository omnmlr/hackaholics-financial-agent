import { useEffect, useRef, useState } from "react";
import {
  AppState,
  Button,
  Linking,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";
import type { components } from "@agus/api-client";
import {
  api,
  auth,
  freshSignIn,
  lockSession,
  unlockSession,
} from "./src/session";
import { createCryptoSigner } from "./src/crypto-signer";
import {
  canRecover,
  parseSavedAttempt,
  solAtoms,
  type SavedAttempt,
} from "./src/crypto-device-state";
import type {
  WalletDiagnostic,
  WalletProvider,
} from "./src/crypto-wallet-policy";

type Schemas = components["schemas"];
type Route = Schemas["CryptoRoute"];
type Review = Schemas["CryptoReview"];
type Attempt = Schemas["CryptoAttempt"];
type Wallet = Schemas["CryptoWallet"];

const cluster = "devnet" as const;
const scope = { query: { cluster } };
const origin = process.env.EXPO_PUBLIC_MWA_ORIGIN;
const secure = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const attemptKey = (owner: string) => `agus.crypto.current.${owner}`;
const proofKey = (owner: string) => `agus.crypto.proof.${owner}`;
type PendingProof = {
  challengeId: string;
  signature: string;
  provider: WalletProvider;
  expiresAt: string;
};
const mutation = (id = randomUUID()) => ({ header: { "Idempotency-Key": id } });

function response<T>(result: {
  data?: T;
  error?: { error?: { code?: string } };
}): T {
  if (result.data === undefined)
    throw new Error(result.error?.error?.code ?? "REQUEST_FAILED");
  return result.data;
}

export default function CryptoDeviceHarness() {
  const active = useRef(false);
  const [owner, setOwner] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [notice, setNotice] = useState(
    "Sign in or unlock to open the Devnet API.",
  );
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [selected, setSelected] = useState<{ wallet: Wallet; route: Route }>();
  const [approval, setApproval] = useState<{ review: Review; route: Route }>();
  const [attempt, setAttempt] = useState<Attempt>();
  const [receipt, setReceipt] = useState<Schemas["CryptoReceipt"]>();
  const [diagnostics, setDiagnostics] = useState<WalletDiagnostic[]>([]);
  const [linked, setLinked] = useState<{
    owner: string;
    provider: WalletProvider;
    addresses: string[];
  }>();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [balance, setBalance] = useState<Schemas["CryptoPortfolio"]>();
  const [busy, setBusy] = useState(false);

  function signer(sessionOwner: string) {
    if (!origin) throw new Error("WALLET_IDENTITY_ORIGIN_REQUIRED");
    return createCryptoSigner(sessionOwner, origin, (event) => {
      setDiagnostics((rows) => [...rows.slice(-11), event]);
      // Fixed diagnostics only. Wallet RPC payloads and auth grants are private.
      console.info("AGUS_MWA", event.provider, event.stage, event.reason);
    });
  }

  async function run(action: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNotice(
        /^[A-Z_]{1,100}$/.test(message)
          ? message
          : "Check the API or unlock the session to recover the saved attempt.",
      );
    } finally {
      active.current = false;
      setBusy(false);
      setPassword("");
      setTotp("");
    }
  }

  async function loadWallets() {
    const page = response(
      await api.GET("/api/v1/crypto/wallets", { params: scope }),
    );
    setWallets(page.items);
  }

  async function showAttempt(next: Attempt) {
    setAttempt(next);
    setNotice(next.reason ? `${next.state} · ${next.reason}` : next.state);
    if (next.receiptId) {
      const result = response(
        await api.GET("/api/v1/crypto/receipts/{id}", {
          params: { path: { id: next.receiptId } },
        }),
      );
      setReceipt(result);
    }
  }

  async function recover(sessionOwner: string) {
    const key = attemptKey(sessionOwner);
    const saved = parseSavedAttempt(await SecureStore.getItemAsync(key));
    if (saved?.outcome) {
      await reportOutcome(saved);
      await SecureStore.setItemAsync(
        key,
        JSON.stringify({ id: saved.id }),
        secure,
      );
    }
    const prior = saved
      ? response(
          await api.GET("/api/v1/crypto/attempts/{id}", {
            params: { path: { id: saved.id } },
          }),
        )
      : response(await api.GET("/api/v1/crypto/attempts", { params: scope }))
          .items[0];
    if (!prior) return;
    const next = canRecover(prior.state)
      ? response(
          await api.POST("/api/v1/crypto/attempts/{id}/reconcile", {
            params: { path: { id: prior.id } },
          }),
        )
      : prior;
    await showAttempt(next);
  }

  async function finishAssociation(sessionOwner: string) {
    const key = proofKey(sessionOwner);
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return;
    const proof = JSON.parse(raw) as PendingProof;
    if (!(Date.parse(proof.expiresAt) > Date.now())) {
      await SecureStore.deleteItemAsync(key);
      setNotice(
        "Ownership proof expired. Reconnect and prove the selected account.",
      );
      return;
    }
    const result = await api.POST("/api/v1/crypto/wallets/association", {
      params: mutation(proof.challengeId),
      body: {
        challengeId: proof.challengeId,
        signature: proof.signature,
        label: proof.provider,
      },
    });
    if (result.error?.error?.code === "OWNERSHIP_PROOF_REQUIRED") {
      await SecureStore.deleteItemAsync(key);
    }
    response(result);
    await SecureStore.deleteItemAsync(key);
    setLinked(undefined);
    setNotice("Verified wallet is available for a Devnet review.");
  }

  async function restoreSession() {
    const me = response(await api.GET("/api/v1/me")) as {
      user: { id: string };
    };
    setLinked((current) =>
      current?.owner === me.user.id ? current : undefined,
    );
    setOwner(me.user.id);
    await finishAssociation(me.user.id);
    await loadWallets();
    await recover(me.user.id);
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        lockSession();
        setOwner("");
        setWallets([]);
        setBalance(undefined);
        setSelected(undefined);
        setLinked(undefined);
        setApproval(undefined);
        setAttempt(undefined);
        setReceipt(undefined);
        setNotice("Unlock AGUS to recover the saved Devnet attempt.");
      }
    });
    return () => subscription.remove();
  }, []);

  const pollingId = attempt && canRecover(attempt.state) ? attempt.id : null;
  useEffect(() => {
    if (!owner || !pollingId) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(id: string) {
      try {
        const next = response(
          await api.GET("/api/v1/crypto/attempts/{id}", {
            params: { path: { id } },
          }),
        );
        if (!current) return;
        if (next.receiptId) {
          const result = response(
            await api.GET("/api/v1/crypto/receipts/{id}", {
              params: { path: { id: next.receiptId } },
            }),
          );
          if (!current) return;
          setReceipt(result);
        }
        setAttempt(next);
        setNotice(next.reason ? `${next.state} · ${next.reason}` : next.state);
        if (!canRecover(next.state)) return;
      } catch {
        // Keep the stored attempt available for a fresh authenticated read.
      }
      if (current) timer = setTimeout(() => void poll(id), 3000);
    }
    timer = setTimeout(() => void poll(pollingId), 3000);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [owner, pollingId]);

  async function reportOutcome(saved: SavedAttempt) {
    if (!saved.outcome) return;
    response(
      await api.POST("/api/v1/crypto/attempts/{id}/wallet-outcome", {
        params: { ...mutation(saved.id), path: { id: saved.id } },
        body: saved.outcome,
      }),
    );
  }

  async function authorize(provider: WalletProvider) {
    const result = await signer(owner).authorize(provider, cluster);
    setLinked({ owner, provider, addresses: result.addresses });
    setNotice("Choose the exact disposable account to prove ownership.");
  }

  async function associate(provider: WalletProvider, address: string) {
    const sessionOwner = owner;
    const challenge = response(
      await api.POST("/api/v1/crypto/wallets/challenge", {
        params: mutation(),
        body: { cluster, provider, address },
      }),
    );
    const signature = await signer(sessionOwner).signProof(
      provider,
      cluster,
      address,
      challenge,
    );
    const pending: PendingProof = {
      challengeId: challenge.id,
      signature,
      provider,
      expiresAt: challenge.expiresAt,
    };
    await SecureStore.setItemAsync(
      proofKey(sessionOwner),
      JSON.stringify(pending),
      secure,
    );
    await finishAssociation(sessionOwner);
    await loadWallets();
  }

  async function prepare() {
    if (!selected) throw new Error("SELECT_DEVNET_WALLET");
    if (
      attempt &&
      ["ready", "handoff", "pending", "unknown"].includes(attempt.state)
    )
      throw new Error("RECOVER_PREVIOUS_ATTEMPT");
    const review = response(
      await api.POST("/api/v1/crypto/reviews", {
        params: mutation(),
        body: {
          kind: "transfer",
          sourceWalletId: selected.wallet.id,
          routeId: selected.route.id,
          amount: {
            asset: { cluster, kind: "sol" },
            atoms: solAtoms(amount),
            decimals: 9,
          },
          recipient: recipient.trim(),
        },
      }),
    );
    setApproval({ review, route: selected.route });
    setReceipt(undefined);
  }

  async function pay(review: Review, route: Route) {
    const paymentOwner = owner;
    const wallet = signer(paymentOwner);
    const current = response(
      await api.POST("/api/v1/crypto/reviews/{id}/begin", {
        params: { ...mutation(review.id), path: { id: review.id } },
        body: { revision: review.revision, reviewDigest: review.reviewDigest },
      }),
    );
    const localKey = attemptKey(paymentOwner);
    await SecureStore.setItemAsync(
      localKey,
      JSON.stringify({ id: current.id }),
      secure,
    );
    setApproval(undefined);
    const claim = response(
      await api.POST("/api/v1/crypto/attempts/{id}/handoff", {
        params: { ...mutation(current.id), path: { id: current.id } },
      }),
    );
    if (!claim.launchGranted) {
      await showAttempt(claim.attempt);
      return;
    }
    const outcome = await wallet.handoff(claim, route, review);
    if (outcome.kind === "signed")
      throw new Error("UNSUPPORTED_WALLET_OUTCOME");
    const saved = { id: current.id, outcome };
    // Persist the wallet return even when Android has already locked the API session.
    await SecureStore.setItemAsync(localKey, JSON.stringify(saved), secure);
    await recover(paymentOwner);
  }

  async function signIn() {
    const result = await freshSignIn(email, password);
    if (result.error) throw new Error("SIGN_IN_FAILED");
    if (
      result.data &&
      "twoFactorRedirect" in result.data &&
      result.data.twoFactorRedirect
    ) {
      setNeedsTotp(true);
      return;
    }
    await restoreSession();
  }

  const disable = busy || !owner;
  return (
    <ScrollView
      contentContainerStyle={{ padding: 20, paddingTop: 46, gap: 10 }}
    >
      <Text>AGUS Android signing diagnostics · Solana Devnet</Text>
      <Text selectable>{notice}</Text>
      {!owner && (
        <>
          <TextInput
            accessibilityLabel="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            placeholder="Email"
          />
          <TextInput
            accessibilityLabel="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="Password"
          />
          {needsTotp ? (
            <>
              <TextInput
                accessibilityLabel="Authenticator code"
                value={totp}
                onChangeText={setTotp}
                keyboardType="number-pad"
              />
              <Button
                title="Verify code"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    if ((await auth.twoFactor.verifyTotp({ code: totp })).error)
                      throw new Error("SIGN_IN_FAILED");
                    setNeedsTotp(false);
                    await restoreSession();
                  })
                }
              />
            </>
          ) : (
            <Button
              title="Sign in with email"
              disabled={busy}
              onPress={() => void run(signIn)}
            />
          )}
          <Button
            title="Unlock and resume"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                if (!(await unlockSession()))
                  throw new Error("SIGN_IN_REQUIRED");
                await restoreSession();
              })
            }
          />
        </>
      )}
      {!!owner && (
        <>
          <Button
            title="Connect Phantom"
            disabled={disable}
            onPress={() => void run(() => authorize("phantom"))}
          />
          <Button
            title="Connect Solflare"
            disabled={disable}
            onPress={() => void run(() => authorize("solflare"))}
          />
          {linked?.owner === owner &&
            linked.addresses.map((address) => (
              <Button
                key={address}
                title={`Prove ownership of ${address}`}
                disabled={disable}
                onPress={() =>
                  void run(() => associate(linked.provider, address))
                }
              />
            ))}
          <Button
            title="Refresh Devnet portfolio"
            disabled={disable}
            onPress={() =>
              void run(async () => {
                setBalance(
                  response(
                    await api.GET("/api/v1/crypto/portfolio", {
                      params: scope,
                    }),
                  ),
                );
              })
            }
          />
          {balance?.holdings
            .filter((row) => row.amount.asset.kind === "sol")
            .map((row) => (
              <Text key={row.walletId} selectable>
                {`${wallets.find((wallet) => wallet.id === row.walletId)?.label ?? row.walletId} · ${row.amount.atoms} lamports`}
              </Text>
            ))}
          {wallets.flatMap((wallet) =>
            wallet.routes
              .filter((route) => route.operations.includes("transfer"))
              .map((route) => (
                <Button
                  key={route.id}
                  title={`Use ${route.provider} · ${route.address}`}
                  disabled={disable}
                  onPress={() => {
                    setSelected({ wallet, route });
                    setApproval(undefined);
                  }}
                />
              )),
          )}
          <Text selectable>
            {selected
              ? `Pay from ${selected.route.provider} · ${selected.route.address}`
              : "Select a source wallet."}
          </Text>
          <TextInput
            accessibilityLabel="Recipient"
            editable={!busy}
            value={recipient}
            onChangeText={(value) => {
              setRecipient(value);
              setApproval(undefined);
            }}
            autoCapitalize="none"
            placeholder="Devnet recipient"
          />
          <TextInput
            accessibilityLabel="SOL amount"
            editable={!busy}
            value={amount}
            onChangeText={(value) => {
              setAmount(value);
              setApproval(undefined);
            }}
            keyboardType="decimal-pad"
          />
          <Button
            title="Prepare Devnet review"
            disabled={disable || !selected}
            onPress={() => void run(prepare)}
          />
          {approval && (
            <View>
              <Text
                selectable
              >{`Devnet · ${approval.review.amount?.atoms} lamports\nFrom ${approval.review.expectedSigner}\nTo ${approval.review.recipient}\nFee ${approval.review.estimatedFeeLamports} lamports\nMessage ${approval.review.messageDigest}\nExpires ${approval.review.expiresAt}`}</Text>
              <Button
                title={`Approve in ${approval.route.provider}`}
                disabled={disable}
                onPress={() =>
                  void run(() => pay(approval.review, approval.route))
                }
              />
            </View>
          )}
          <Button
            title="Check existing attempt"
            disabled={disable}
            onPress={() => void run(() => recover(owner))}
          />
          {attempt && (
            <Text
              selectable
            >{`Attempt ${attempt.id} · ${attempt.state}\n${attempt.signature ?? ""}`}</Text>
          )}
          {receipt && (
            <Text
              selectable
            >{`Receipt ${receipt.id} · Finalized at slot ${receipt.slot} · ${receipt.feeLamports} lamports fee`}</Text>
          )}
          {receipt?.explorerUrl && (
            <Button
              title="Open verified Devnet receipt"
              onPress={() => void Linking.openURL(receipt.explorerUrl!)}
            />
          )}
        </>
      )}
      {diagnostics.map((item, index) => (
        <Text
          key={index}
          selectable
        >{`${item.provider} / ${item.stage} / ${item.reason}`}</Text>
      ))}
    </ScrollView>
  );
}
