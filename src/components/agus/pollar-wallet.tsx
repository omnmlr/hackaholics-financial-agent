"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2, RefreshCw, Wallet } from "lucide-react";
import type { PollarClient, AuthState, WalletBalanceContent } from "@pollar/core";
import type { PaymentRequest, ProductSnapshot } from "@/lib/web-product/contracts";
import { productApi } from "./api";
import { isStellarTestnetApp } from "./pollar-safety";
import s from "./workspace.module.css";

export function PollarWallet({ config, request, onAddress, onSubmitted }: {
  config: ProductSnapshot["capabilities"]["pollar"];
  request?: PaymentRequest;
  onAddress?: (address: string) => void;
  onSubmitted?: (hash: string) => Promise<void>;
}) {
  const client = useRef<PollarClient | null>(null);
  const subscriptions = useRef<(() => void)[]>([]);
  const alive = useRef(true);
  const [auth, setAuth] = useState<AuthState>({ step: "idle" });
  const [balances, setBalances] = useState<WalletBalanceContent | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const sending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      subscriptions.current.forEach((stop) => stop());
      client.current?.destroy();
      client.current = null;
    };
  }, []);

  async function connect() {
    if (busy || client.current || !config.configured || !config.publicKey) return;
    setBusy(true); setError("");
    try {
      const { PollarClient, createMemoryAdapter } = await import("@pollar/core");
      const sdk = new PollarClient({ apiKey: config.publicKey, stellarNetwork: "testnet", storage: createMemoryAdapter(), logLevel: "silent", confirmation: "auto" });
      await sdk.ready();
      const app = await sdk.getAppConfig();
      if (!isStellarTestnetApp(app)) {
        sdk.destroy();
        throw new Error("Pollar must verify a Stellar testnet application before onboarding or payment is enabled.");
      }
      if (!alive.current) { sdk.destroy(); return; }
      client.current = sdk;
      subscriptions.current = [
        sdk.onAuthStateChange((state) => {
          if (!alive.current) return;
          setAuth(state);
          if (state.step === "error") setError(`Pollar sign-in could not finish (${state.errorCode}). Try again in the wallet panel.`);
        }),
        sdk.onWalletBalanceStateChange((state) => {
          if (!alive.current) return;
          if (state.step === "loaded") setBalances(state.data);
          if (state.step === "error") { setBalances(null); setError("Pollar could not read this wallet’s balances. No zero balance is assumed."); }
        }),
      ];
      setAuth(sdk.getAuthState()); setReady(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Pollar could not initialize."); }
    finally { if (alive.current) setBusy(false); }
  }
  const verified = auth.step === "authenticated" && auth.verified;
  const wallet = verified ? client.current?.getWallet() : null;
  const working = !["idle", "error", "authenticated", "entering_code", "entering_email", "wallet_not_installed"].includes(auth.step);
  async function refresh() {
    if (!client.current || busy) return;
    setBusy(true); setError("");
    try { await client.current.refreshBalance(); }
    catch { setBalances(null); setError("Wallet balance unavailable. Try refreshing again."); }
    finally { setBusy(false); }
  }
  async function send() {
    const sdk = client.current;
    if (!sdk || !request || !verified || !reviewed || sending.current || request.submissionStartedAt || !request.issuer) return;
    sending.current = true; setBusy(true); setError("");
    try {
      // Recheck the actual remote application, not just our requested SDK network.
      const app = await sdk.getAppConfig();
      if (!isStellarTestnetApp(app)) throw new Error("Testnet application verification failed. Nothing was submitted.");
      await productApi(`product/requests/${request.id}/submit-intent`, { acknowledged: true });
      const result = await sdk.sendPayment({ chain: "STELLAR", destination: request.recipient, amount: request.amount,
        asset: { type: "credit_alphanum4", code: "USDC", issuer: request.issuer }, options: { memo: { type: "text", value: request.memo } } });
      if (result.status === "success" || result.status === "pending") {
        setOutcome(`SDK ${result.status}. Transaction: ${result.hash}. Receiving evidence is checked separately.`);
        await onSubmitted?.(result.hash);
      } else {
        setOutcome(result.status === "cosign_pending" ? "Pollar requires a co-signature. Inspect your wallet; this invoice is still pending." : "The SDK did not confirm a successful send. Inspect wallet history before any further action; no automatic retry is allowed.");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "The send outcome is uncertain. Check wallet history; do not retry automatically."); }
    finally { setBusy(false); sending.current = false; }
  }

  return <section className={s.walletPanel} aria-label="Pollar wallet">
    <div className={s.sectionHead}><span className={s.railTitle}><Wallet size={19} /> Pollar wallet</span><span className={s.pill}>Stellar testnet</span></div>
    <p className={s.muted}>Email or wallet onboarding, balances and explicit test payments through the official Pollar SDK.</p>
    {!config.configured ? <div className={s.notice}>Wallet setup required. Add a Pollar publishable testnet key and its USDC issuer in the server environment. No wallet or balance is fabricated.</div> : !ready ?
      <button className={s.primary} onClick={() => void connect()} disabled={busy}>{busy ? <Loader2 className={s.spin} size={16} /> : <Wallet size={16} />} Connect with Pollar</button> : verified ? <>
      <div className={s.address}><span>Connected receiving address</span><code>{wallet?.address ?? "Wallet provisioning in progress"}</code></div>
      {wallet && onAddress && <button type="button" className={s.secondary} onClick={() => onAddress(wallet.address)}><Check size={15} /> Use this receiving address</button>}
      <button type="button" className={s.textButton} disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} className={busy ? s.spin : ""} /> Read wallet balances</button>
      {balances && <div className={s.balanceList}><small>Live SDK response · test assets have no cash value</small>{balances.balances.filter((b) => !b.chain || b.chain === "STELLAR").map((b) => <div key={`${b.code}-${b.issuer}`}><span>{b.code}</span><strong>{b.balance ?? "Unavailable"}</strong></div>)}</div>}
      {request && request.state === "pending" && <div className={s.sendReview}>
        <p><strong>{request.amount} USDC</strong> · Stellar testnet</p><code>{request.recipient}</code><p>Memo: {request.memo}</p>
        {request.submissionStartedAt ? <p className={s.notice}>A send was already started. Check wallet history and verify the transaction below.</p> : wallet?.address === request.recipient ? <p className={s.notice}>Connect a different test wallet to pay this receiving address.</p> : <>
          <label className={s.checkbox}><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} /> I reviewed the address, asset, amount and memo. Send test assets once.</label>
          <button type="button" disabled={!reviewed || busy} className={s.primary} onClick={() => void send()}>{busy ? <Loader2 size={16} className={s.spin} /> : <ArrowUpRight size={16} />} Authorize testnet payment</button>
        </>}
      </div>}
      <button className={s.textButton} type="button" disabled={busy} onClick={async () => { await client.current?.logout(); setBalances(null); }}>Disconnect wallet</button>
    </> : <>
      <form onSubmit={(e) => { e.preventDefault(); setError(""); if (auth.step === "entering_code") client.current?.verifyEmailCode(code); else client.current?.login({ provider: "email", email }); }} className={s.form}>
        {auth.step === "entering_code" ? <label>Email verification code<input value={code} onChange={(e) => setCode(e.target.value)} required autoComplete="one-time-code" inputMode="numeric" /></label> : <label>Your email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>}
        <button className={s.primary} disabled={working || busy}>{working ? <Loader2 size={16} className={s.spin} /> : null}{auth.step === "entering_code" ? "Verify Pollar code" : "Continue with email"}</button>
      </form>
      <button className={s.secondary} type="button" disabled={working || busy} onClick={() => client.current?.login({ provider: "freighter" })}>Connect Freighter</button>
      {auth.step === "wallet_not_installed" && <p className={s.notice}>Install Freighter to use this option, or continue with email.</p>}
    </>}
    {error && <p className={s.error} role="alert">{error}</p>}
    {outcome && <p className={s.notice} role="status">{outcome}</p>}
  </section>;
}
