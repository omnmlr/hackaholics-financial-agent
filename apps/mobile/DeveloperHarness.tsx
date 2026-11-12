import { useEffect, useState, useRef } from "react";
import {
  AppState,
  Button,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as Notifications from "expo-notifications";
import { DevnetDraft, decimalToAtomic } from "@agus/contracts";
import type { DevnetDraft as Draft } from "@agus/contracts";
import {
  auth,
  api,
  apiRequest,
  freshSignIn,
  lockSession,
  unlockSession,
} from "./src/session";
import { connectAndroidWallet, signExactDraft } from "./src/wallet";
import {
  canPrepareNewDraft,
  parseNotificationLink,
  shouldLockOnBackground,
} from "./src/policy";
import { registerNotifications } from "./src/notifications";
export default function DeveloperHarness() {
  const busyRef = useRef(false),
    ownerRef = useRef(""),
    readyRef = useRef(false),
    needsCodeRef = useRef(false);
  const pendingKey = () => `agus_pending_devnet_${ownerRef.current}`;
  const signedKey = () => `agus_signed_devnet_${ownerRef.current}`;
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true),
    [notice, setNotice] = useState(
      "Unlock or sign in to retrieve server state.",
    );
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [needsCode, setNeedsCode] = useState(false);
  readyRef.current = ready;
  needsCodeRef.current = needsCode;
  const [enrollment, setEnrollment] = useState<{
    uri: string;
    backupCodes: string[];
  } | null>(null);
  const [wallet, setWallet] = useState(""),
    [recipient, setRecipient] = useState(""),
    [amount, setAmount] = useState("0.001"),
    [mint, setMint] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null),
    [hasSigned, setHasSigned] = useState(false),
    [accountState, setAccountState] = useState<unknown>(null),
    [accounts, setAccounts] = useState<{ id: string }[]>([]),
    [pendingLink, setPendingLink] =
      useState<ReturnType<typeof parseNotificationLink>>(null);
  useEffect(() => {
    const state = AppState.addEventListener("change", (value) => {
      if (
        value === "background" &&
        shouldLockOnBackground({
          ready: readyRef.current,
          awaitingTwoFactor: needsCodeRef.current,
        })
      ) {
        lockSession();
        setReady(false);
        setPassword("");
        setCode("");
        setEnrollment(null);
        setAccountState(null);
        setAccounts([]);
        setDraft(null);
      }
    });
    const network = NetInfo.addEventListener((value) =>
      setOnline(value.isConnected === true),
    );
    const links = Linking.addEventListener("url", (event) =>
      setPendingLink(parseNotificationLink(event.url)),
    );
    void Linking.getInitialURL().then((value) => {
      if (value) setPendingLink(parseNotificationLink(value));
    });
    const notifications = Notifications.addNotificationResponseReceivedListener(
      (event) => {
        const data = event.notification.request.content.data;
        if (
          data &&
          typeof data.resourceType === "string" &&
          typeof data.resourceId === "string"
        )
          setPendingLink(
            parseNotificationLink(
              `agus://open/${data.resourceType}/${data.resourceId}`,
            ),
          );
      },
    );
    return () => {
      state.remove();
      network();
      links.remove();
      notifications.remove();
    };
  }, []);
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setNotice(
        /^[A-Z_]{1,100}$/.test(message)
          ? message
          : "Operation unavailable. Recover server state before a new financial action.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
      setPassword("");
      setCode("");
    }
  }
  async function refresh() {
    setAccounts([]);
    setDraft(null);
    setAccountState(null);
    await auth.getSession();
    const result = await api.GET("/api/v1/me");
    if (result.error) {
      setReady(false);
      throw new Error(result.error.error.code);
    }
    ownerRef.current = (result.data as { user: { id: string } }).user.id;
    setReady(true);
    setNotice("Authenticated server session verified.");
  }
  async function recover() {
    const value = await SecureStore.getItemAsync(pendingKey());
    if (!value) {
      setNotice("No saved Devnet instruction.");
      return;
    }
    const pending = JSON.parse(value) as { draftId: string };
    setDraft(DevnetDraft.parse(await apiRequest(`solana/${pending.draftId}`)));
    const signed = await SecureStore.getItemAsync(signedKey());
    setHasSigned(
      Boolean(signed && JSON.parse(signed).draftId === pending.draftId),
    );
    setNotice("Recovered existing instruction. No transfer was sent.");
  }
  const disabled = busy || !ready || !online;
  return (
    <ScrollView
      contentContainerStyle={styles.page}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>AGUS Android engineering prototype</Text>
      <Text>
        Banking is simulated. Wallet operations use Devnet. Physical-device and
        genuine wallet acceptance remain pending.
      </Text>
      <Text accessibilityLiveRegion="polite">
        {online ? "Online" : "Offline — financial actions unavailable"} ·{" "}
        {ready ? "Session verified" : "Session locked"}
      </Text>
      <Text accessibilityLiveRegion="polite">{notice}</Text>
      <Button
        title="Unlock local session"
        disabled={busy || !online}
        onPress={() =>
          void run(async () => {
            if (!(await unlockSession()))
              throw new Error("FRESH_SIGN_IN_REQUIRED");
            await refresh();
            await recover();
          })
        }
      />
      {!ready && (
        <View style={styles.group}>
          <TextInput
            accessibilityLabel="Email"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            accessibilityLabel="Password"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
          />
          <TextInput
            accessibilityLabel="TOTP code"
            style={styles.input}
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            maxLength={6}
          />
          <Button
            title={
              needsCode ? "Verify sign-in TOTP" : "Sign in with invited account"
            }
            disabled={busy || !online}
            onPress={() =>
              void run(async () => {
                if (needsCode) {
                  const r = await auth.twoFactor.verifyTotp({
                    code: code.trim(),
                  });
                  if (r.error) throw new Error("SIGN_IN_REJECTED");
                  setNeedsCode(false);
                  await refresh();
                  await recover();
                } else {
                  const r = await freshSignIn(email, password);
                  if (r.error) throw new Error("SIGN_IN_REJECTED");
                  if (r.data && "twoFactorRedirect" in r.data) {
                    setNeedsCode(true);
                    setNotice("Enter your authenticator code.");
                  } else {
                    await refresh();
                    await recover();
                  }
                }
              })
            }
          />
        </View>
      )}
      {ready && (
        <>
          <Text style={styles.heading}>Financial step-up setup</Text>
          <TextInput
            accessibilityLabel="TOTP enrollment password"
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          <Button
            title="Set up authenticator privately"
            disabled={disabled}
            onPress={() =>
              void run(async () => {
                const r = await auth.twoFactor.enable({ password });
                if (r.error || !r.data || r.data.method !== "totp")
                  throw new Error("TOTP_SETUP_UNAVAILABLE");
                setEnrollment({
                  uri: r.data.totpURI,
                  backupCodes: r.data.backupCodes,
                });
                setNotice(
                  "Add this private setup to your authenticator. Record recovery codes privately; none are logged or saved to ordinary storage.",
                );
              })
            }
          />
          {enrollment && (
            <View style={styles.group}>
              <Text selectable>{enrollment.uri}</Text>
              <Text selectable>
                Private recovery codes: {enrollment.backupCodes.join(" · ")}
              </Text>
              <TextInput
                accessibilityLabel="Authenticator enrollment code"
                style={styles.input}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={6}
              />
              <Button
                title="Verify authenticator enrollment"
                disabled={disabled}
                onPress={() =>
                  void run(async () => {
                    const r = await auth.twoFactor.verifyTotp({
                    code: code.trim(),
                  });
                    if (r.error) throw new Error("TOTP_VERIFICATION_FAILED");
                    setEnrollment(null);
                    await refresh();
                  })
                }
              />
            </View>
          )}
          <Button
            title="Refresh authenticated state"
            disabled={disabled}
            onPress={() => void run(refresh)}
          />
          <Button
            title="Read source accounts"
            disabled={disabled}
            onPress={() =>
              void run(async () => {
                const r = await api.GET("/api/v1/banking/accounts");
                if (r.error) throw new Error(r.error.error.code);
                const value = r.data as { data: { id: string }[] };
                setAccounts(value.data);
                setAccountState(value);
              })
            }
          />
          <Button
            title="Link simulated Wema accounts"
            disabled={disabled}
            onPress={() =>
              void run(async () => {
                const r = await api.POST("/api/v1/banking/connections", {
                  params: {
                    header: { "Idempotency-Key": Crypto.randomUUID() },
                  },
                  body: { institutionId: "wema", provider: "fixture" },
                });
                if (r.error) throw new Error(r.error.error.code);
                const v = r.data as { id: string; state: string };
                const consent = await api.POST(
                  "/api/v1/banking/connections/callback",
                  {
                    body: {
                      connectionId: v.id,
                      state: v.state,
                      code: "fixture-consent-approved",
                    },
                  },
                );
                if (consent.error) throw new Error(consent.error.error.code);
                setAccountState(consent.data);
              })
            }
          />
          {accounts.map((a) => (
            <View key={a.id} style={styles.group}>
              <Text>Simulated source {a.id}</Text>
              <Button
                title="Read balance"
                disabled={disabled}
                onPress={() =>
                  void run(async () => {
                    const r = await api.POST(
                      "/api/v1/banking/accounts/{id}/balance",
                      { params: { path: { id: a.id } }, body: {} },
                    );
                    if (r.error) throw new Error(r.error.error.code);
                    setAccountState(r.data);
                  })
                }
              />
              <Button
                title="Synchronize transactions"
                disabled={disabled}
                onPress={() =>
                  void run(async () => {
                    const r = await api.POST(
                      "/api/v1/banking/accounts/{id}/sync",
                      { params: { path: { id: a.id } }, body: {} },
                    );
                    if (r.error) throw new Error(r.error.error.code);
                    setAccountState(r.data);
                  })
                }
              />
              <Button
                title="Read transaction history"
                disabled={disabled}
                onPress={() =>
                  void run(async () => {
                    const r = await api.GET(
                      "/api/v1/banking/accounts/{id}/transactions",
                      { params: { path: { id: a.id }, query: { limit: 25 } } },
                    );
                    if (r.error) throw new Error(r.error.error.code);
                    setAccountState(r.data);
                  })
                }
              />
            </View>
          ))}
          {accountState !== null && (
            <Text selectable>{JSON.stringify(accountState, null, 2)}</Text>
          )}
          <Button
            title="Notification permission and registration"
            disabled={disabled}
            onPress={() =>
              void run(async () => {
                const r = await registerNotifications();
                setNotice(
                  `Push state: ${r.pushState}. Real delivery remains unverified.`,
                );
              })
            }
          />
          <Button
            title="Read notification inbox"
            disabled={disabled}
            onPress={() =>
              void run(async () => {
                const r = await api.GET("/api/v1/notifications");
                if (r.error) throw new Error(r.error.error.code);
                setAccountState(r.data);
              })
            }
          />
          {pendingLink && (
            <Button
              title="Read authenticated notification resource"
              disabled={disabled}
              onPress={() =>
                void run(async () => {
                  const path =
                    pendingLink.resourceType === "payment"
                      ? "payments"
                      : pendingLink.resourceType === "solana"
                        ? "solana"
                        : pendingLink.resourceType === "p2p"
                          ? "p2p/orders"
                          : pendingLink.resourceType === "request"
                            ? "requests"
                            : "responsibilities";
                  setAccountState(
                    await apiRequest(`${path}/${pendingLink.resourceId}`),
                  );
                  setPendingLink(null);
                })
              }
            />
          )}
          <Text style={styles.heading}>Owner-controlled Devnet wallet</Text>
          <Button
            title="Connect Android Devnet wallet"
            disabled={disabled}
            onPress={() =>
              void run(async () => {
                setWallet(await connectAndroidWallet());
                setNotice(
                  "Wallet selected. Signing remains a separate owner action.",
                );
              })
            }
          />
          <Text selectable>{wallet || "No wallet selected"}</Text>
          <TextInput
            accessibilityLabel="Recipient public address"
            style={styles.input}
            value={recipient}
            onChangeText={setRecipient}
            autoCapitalize="none"
          />
          <TextInput
            accessibilityLabel="Decimal transfer amount"
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          <TextInput
            accessibilityLabel="SPL mint, blank for SOL"
            style={styles.input}
            value={mint}
            onChangeText={setMint}
            autoCapitalize="none"
          />
          <Button
            title="Prepare and simulate new Devnet instruction"
            disabled={disabled || !wallet}
            onPress={() =>
              void run(async () => {
                const prior = await SecureStore.getItemAsync(pendingKey());
                if (
                  !canPrepareNewDraft(
                    draft,
                    prior ? JSON.parse(prior) : null,
                  )
                )
                  throw new Error("RECOVER_EXISTING_SUBMISSION");
                const id = Crypto.randomUUID();
                setHasSigned(false);
                await SecureStore.deleteItemAsync(signedKey());
                await SecureStore.setItemAsync(
                  pendingKey(),
                  JSON.stringify({
                    draftId: id,
                    idempotencyKey: id,
                    submitted: false,
                  }),
                );
                setDraft(
                  DevnetDraft.parse(
                    await apiRequest(
                      "solana/prepare",
                      {
                        sender: wallet,
                        recipient: recipient.trim(),
                        asset: mint.trim() ? "SPL" : "SOL",
                        amount: {
                          atoms: decimalToAtomic(amount.trim(), mint.trim() ? 6 : 9),
                          currency: mint.trim() ? "USDC" : "SOL",
                          scale: mint.trim() ? 6 : 9,
                        },
                        ...(mint.trim() ? { mint: mint.trim() } : {}),
                      },
                      id,
                    ),
                  ),
                );
              })
            }
          />
          <Button
            title="Recover existing Devnet instruction"
            disabled={disabled}
            onPress={() => void run(recover)}
          />
          {draft && (
            <View style={styles.group}>
              <Text selectable>
                Devnet · {draft.state}
                {"\n"}Sender: {draft.sender}
                {"\n"}Recipient: {draft.recipient}
                {"\n"}Amount: {draft.displayAmount} {draft.asset}
                {"\n"}Mint: {draft.mint ?? "SOL"}
                {"\n"}Fee lamports: {draft.feeLamports}
                {"\n"}Rent lamports: {draft.estimatedRentLamports}
                {"\n"}Digest: {draft.digest}
              </Text>
              {draft.state === "prepared" && (
                <>
                  <TextInput
                    accessibilityLabel="Financial step-up password"
                    style={styles.input}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                  />
                  <TextInput
                    accessibilityLabel="Financial step-up TOTP"
                    style={styles.input}
                    value={code}
                    onChangeText={setCode}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                  <Button
                    title="I reviewed this instruction — approve with password and TOTP"
                    disabled={disabled}
                    onPress={() =>
                      void run(async () => {
                        const challenge = await apiRequest("step-up", {
                          action: "solana.approve",
                          digest: draft.digest,
                          password,
                          code: code.trim(),
                        });
                        setDraft(
                          DevnetDraft.parse(
                            await apiRequest(
                              `solana/${draft.id}/approve`,
                              {
                                revision: draft.revision,
                                challengeId: challenge.id,
                              },
                              challenge.id,
                            ),
                          ),
                        );
                      })
                    }
                  />
                </>
              )}
              {draft.state === "approved" && !hasSigned && (
                <Button
                  title="Sign exact instruction in Android wallet"
                  disabled={disabled}
                  onPress={() =>
                    void run(async () => {
                      const signedTransactionBase64 =
                        await signExactDraft(draft);
                      await SecureStore.setItemAsync(
                        signedKey(),
                        JSON.stringify({
                          draftId: draft.id,
                          digest: draft.digest,
                          signedTransactionBase64,
                        }),
                      );
                      setHasSigned(true);
                      setNotice(
                        "Signed instruction saved securely. Unlock locally, then explicitly submit it.",
                      );
                    })
                  }
                />
              )}
              {draft.state === "approved" && hasSigned && (
                <Button
                  title="Submit saved signed instruction once"
                  disabled={disabled}
                  onPress={() =>
                    void run(async () => {
                      const raw = await SecureStore.getItemAsync(signedKey());
                      if (!raw) throw new Error("SIGNED_INSTRUCTION_MISSING");
                      const saved = JSON.parse(raw);
                      if (
                        saved.draftId !== draft.id ||
                        saved.digest !== draft.digest
                      )
                        throw new Error("SIGNED_INSTRUCTION_MISMATCH");
                      await SecureStore.setItemAsync(
                        pendingKey(),
                        JSON.stringify({
                          draftId: draft.id,
                          idempotencyKey: draft.id,
                          submitted: true,
                        }),
                      );
                      setDraft(
                        DevnetDraft.parse(
                          await apiRequest(
                            `solana/${draft.id}/submit`,
                            {
                              digest: draft.digest,
                              signedTransactionBase64:
                                saved.signedTransactionBase64,
                            },
                            draft.id,
                          ),
                        ),
                      );
                    })
                  }
                />
              )}
              {draft.submission && (
                <Button
                  title="Read chain status for existing signature"
                  disabled={disabled}
                  onPress={() =>
                    void run(async () => {
                      setDraft(
                        DevnetDraft.parse(
                          await apiRequest(`solana/${draft.id}/reconcile`, {}),
                        ),
                      );
                    })
                  }
                />
              )}
            </View>
          )}
          <Button
            title="Sign out and lock"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                const result = await auth.signOut();
                lockSession();
                await SecureStore.deleteItemAsync("agus_cookie");
                await SecureStore.deleteItemAsync("agus_session_data");
                setReady(false);
                setDraft(null);
                setAccounts([]);
                setWallet("");
                setAccountState(null);
                if (result.error)
                  throw new Error("LOCAL_SIGN_OUT_REMOTE_UNCONFIRMED");
                setNotice("Signed out.");
              })
            }
          />
        </>
      )}
      <Text>
        Network recovery and app resume never send financial operations.
        Notifications contain opaque resource IDs.
      </Text>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: { padding: 24, paddingTop: 56, gap: 14 },
  title: { fontSize: 24, fontWeight: "600" },
  heading: { fontSize: 20, fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#888", padding: 12, borderRadius: 6 },
  group: { gap: 10, paddingVertical: 10 },
});
