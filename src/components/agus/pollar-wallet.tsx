"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Loader2, RefreshCw, Wallet } from "lucide-react";
import type {
  PollarClient,
  AuthState,
  WalletBalanceContent,
  PendingConfirmation,
} from "@pollar/core";
import type {
  PaymentRequest,
  ProductSnapshot,
} from "@/lib/web-product/contracts";
import type { PaymentPlan } from "@/lib/web-product/payment-contracts";
import { productApi } from "./api";
import { isStellarTestnetApp } from "./pollar-safety";
import s from "./workspace.module.css";

export function PollarWallet({
  config,
  request,
  onAddress,
  onSubmitted,
  paymentPlan,
  approvalNonce,
  onPlanChange,
  onError,
}: {
  config: ProductSnapshot["capabilities"]["pollar"];
  request?: PaymentRequest;
  onAddress?: (address: string) => void;
  onSubmitted?: (hash: string) => Promise<void>;
  paymentPlan?: PaymentPlan;
  approvalNonce?: string;
  onPlanChange?: (plan: PaymentPlan) => void;
  onError?: (message: string) => void;
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
  const [requestPassword, setRequestPassword] = useState("");
  const sending = useRef(false);
  const approvedXdr = useRef<string | undefined>(undefined);
  const approvedRequest = useRef<PaymentRequest | undefined>(undefined);
  const [confirmations, setConfirmations] = useState<PendingConfirmation[]>([]);
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
    if (busy || client.current || !config.configured || !config.publicKey)
      return;
    setBusy(true);
    setError("");
    try {
      const { PollarClient, createMemoryAdapter } =
        await import("@pollar/core");
      const sdk = new PollarClient({
        apiKey: config.publicKey,
        stellarNetwork: "testnet",
        storage: createMemoryAdapter(),
        logLevel: "silent",
        confirmation: "auto",
      });
      await sdk.ready();
      const app = await sdk.getAppConfig();
      if (!isStellarTestnetApp(app)) {
        sdk.destroy();
        throw new Error(
          "Pollar must verify a Stellar testnet application before onboarding or payment is enabled.",
        );
      }
      if (!alive.current) {
        sdk.destroy();
        return;
      }
      client.current = sdk;
      subscriptions.current = [
        sdk.onConfirmationRequest((pending) => {
          const matched = pending.filter((confirmation) => {
            const expected = approvedRequest.current;
            const asset = confirmation.details?.asset as
              { code?: string; issuer?: string } | undefined;
            const valid =
              sending.current &&
              confirmation.network === "STELLAR" &&
              ((confirmation.kind === "sign_and_send" &&
                confirmation.unsignedXdr === approvedXdr.current &&
                !!approvedXdr.current) ||
                (confirmation.kind === "build_sign_submit" &&
                  confirmation.operation === "payment" &&
                  !!expected &&
                  confirmation.details?.destination === expected.recipient &&
                  confirmation.details?.amount === expected.amount &&
                  asset?.code === "USDC" &&
                  asset?.issuer === expected.issuer));
            if (!valid) confirmation.reject();
            return valid;
          });
          if (alive.current) setConfirmations(matched);
        }),
        sdk.onAuthStateChange((state) => {
          if (!alive.current) return;
          setAuth(state);
          if (state.step === "error")
            setError(
              `Pollar sign-in could not finish (${state.errorCode}). Try again in the wallet panel.`,
            );
        }),
        sdk.onWalletBalanceStateChange((state) => {
          if (!alive.current) return;
          if (state.step === "loaded") setBalances(state.data);
          if (state.step === "error") {
            setBalances(null);
            setError(
              "Pollar could not read this wallet’s balances. No zero balance is assumed.",
            );
          }
        }),
      ];
      setAuth(sdk.getAuthState());
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pollar could not initialize.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const verified = auth.step === "authenticated" && auth.verified;
  const wallet = verified ? client.current?.getWallet() : null;
  const working = ![
    "idle",
    "error",
    "authenticated",
    "entering_code",
    "entering_email",
    "wallet_not_installed",
  ].includes(auth.step);
  async function refresh() {
    if (!client.current || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.current.refreshBalance();
    } catch {
      setBalances(null);
      setError("Wallet balance unavailable. Try refreshing again.");
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    const sdk = client.current;
    if (
      !sdk ||
      !request ||
      !verified ||
      !reviewed ||
      !requestPassword ||
      sending.current ||
      request.submissionStartedAt ||
      !request.issuer
    )
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      const selectedSource = sdk.getWallet()?.address;
      // Recheck the actual remote application, not just our requested SDK network.
      const app = await sdk.getAppConfig();
      if (!isStellarTestnetApp(app))
        throw new Error(
          "Testnet application verification failed. Nothing was submitted.",
        );
      await productApi(`product/requests/${request.id}/submit-intent`, {
        acknowledged: true,
        password: requestPassword,
        reviewDigest: request.reviewDigest,
      });
      setRequestPassword("");
      approvedRequest.current = request;
      if (!selectedSource || sdk.getWallet()?.address !== selectedSource)
        throw new Error(
          "The selected wallet changed after review. Check the saved request; no automatic send retry is authorized.",
        );
      const result = await sdk.sendPayment({
        chain: "STELLAR",
        destination: request.recipient,
        amount: request.amount,
        asset: {
          type: "credit_alphanum4",
          code: "USDC",
          issuer: request.issuer,
        },
        options: {
          memo: { type: "text", value: request.memo },
          maxFeeStroops: 100000,
        },
      });
      if (result.status === "success" || result.status === "pending") {
        setOutcome(
          `SDK ${result.status}. Transaction: ${result.hash}. Receiving evidence is checked separately.`,
        );
        await onSubmitted?.(result.hash);
      } else {
        setOutcome(
          result.status === "cosign_pending"
            ? "Pollar requires a co-signature. Inspect your wallet; this invoice is still pending."
            : "The SDK did not confirm a successful send. Inspect wallet history before any further action; no automatic retry is allowed.",
        );
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The send outcome is uncertain. Check wallet history; do not retry automatically.",
      );
    } finally {
      setBusy(false);
      sending.current = false;
      approvedXdr.current = undefined;
      approvedRequest.current = undefined;
    }
  }

  async function buildPlan() {
    const sdk = client.current,
      plan = paymentPlan;
    if (
      !sdk ||
      !plan ||
      !verified ||
      busy ||
      !wallet ||
      !plan.recipientAddress ||
      !plan.amount ||
      !config.issuer
    )
      return;
    setBusy(true);
    setError("");
    try {
      if (!isStellarTestnetApp(await sdk.getAppConfig()))
        throw new Error("The Pollar app is not verified on Stellar testnet.");
      const built = await sdk.buildTx(
        "payment",
        {
          destination: plan.recipientAddress,
          amount: plan.amount,
          asset: {
            type: "credit_alphanum4",
            code: "USDC",
            issuer: config.issuer,
          },
        },
        {
          memo: { type: "text", value: plan.memo },
          timeoutSec: 180,
          maxFeeStroops: Number(plan.maxFeeStroops),
        },
      );
      if (
        built.status !== "built" ||
        !built.buildData.unsignedXdr ||
        built.buildData.networkPassphrase !==
          "Test SDF Network ; September 2015"
      )
        throw new Error(
          "Pollar could not build a supported testnet quote. Check funding, the recipient’s USDC trustline and network access.",
        );
      const updated = await productApi<PaymentPlan>(
        `product/payment-plans/${plan.id}/quote`,
        {
          unsignedXdr: built.buildData.unsignedXdr,
          sourceAddress: wallet.address,
        },
      );
      onPlanChange?.(updated);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The provider quote is unavailable. Nothing has been signed.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submitPlan() {
    const sdk = client.current,
      plan = paymentPlan;
    if (
      !sdk ||
      !plan ||
      !approvalNonce ||
      !verified ||
      busy ||
      sending.current ||
      plan.quote?.sourceAddress !== wallet?.address
    )
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    let claimed = false;
    try {
      if (!isStellarTestnetApp(await sdk.getAppConfig()))
        throw new Error(
          "Testnet application verification failed before signing.",
        );
      const send = await productApi<{
        unsignedXdr: string;
        sourceAddress: string;
        transactionHash: string;
      }>(`product/payment-plans/${plan.id}/submit`, { nonce: approvalNonce });
      claimed = true;
      if (send.sourceAddress !== sdk.getWallet()?.address)
        throw new Error(
          "The selected wallet changed. No further signing attempt is authorized.",
        );
      approvedXdr.current = send.unsignedXdr;
      const result = await sdk.signAndSubmitTx(send.unsignedXdr);
      const hash =
        result.status === "success" || result.status === "pending"
          ? result.hash
          : undefined;
      if (!hash)
        onError?.(
          "The wallet did not return a submitted transaction. Check settlement before trying another payment.",
        );
      const outcome = await productApi<PaymentPlan>(
        `product/payment-plans/${plan.id}/outcome`,
        {
          status: hash ? "pending" : "unknown",
          ...(hash ? { transactionId: hash } : {}),
        },
      );
      onPlanChange?.(outcome);
      if (hash) {
        try {
          onPlanChange?.(
            await productApi<PaymentPlan>(
              `product/payment-plans/${plan.id}/verify`,
              { acknowledged: true },
            ),
          );
        } catch {
          setError(
            "The wallet submitted the transaction. Independent network confirmation is still pending; use Check settlement. Do not send again.",
          );
        }
      }
    } catch (e) {
      if (claimed) {
        try {
          onPlanChange?.(
            await productApi<PaymentPlan>(
              `product/payment-plans/${plan.id}/outcome`,
              { status: "unknown" },
            ),
          );
        } catch {
          /* reservation remains consumed */
        }
      }
      onError?.(
        "The wallet outcome is uncertain. Check settlement before trying another payment.",
      );
      setError(
        e instanceof Error
          ? e.message
          : "The wallet outcome is uncertain. Check settlement without retrying the send.",
      );
    } finally {
      setBusy(false);
      sending.current = false;
      approvedXdr.current = undefined;
      approvedRequest.current = undefined;
    }
  }

  return (
    <section className={s.walletPanel} aria-label="Pollar wallet">
      <div className={s.sectionHead}>
        <span className={s.railTitle}>
          <Wallet size={19} /> Pollar wallet
        </span>
        <span className={s.pill}>Stellar testnet</span>
      </div>
      <p className={s.muted}>USDC payments · Connect by email or wallet.</p>
      {confirmations.map((confirmation) => (
        <div className={s.notice} key={confirmation.id}>
          <div>
            <strong>Confirm in your wallet</strong>
            <p>Send the Testnet payment you just approved?</p>
            <div className={s.buttonRow}>
              <button
                type="button"
                className={s.primary}
                onClick={confirmation.confirm}
              >
                Confirm wallet signing
              </button>
              <button
                type="button"
                className={s.secondary}
                onClick={confirmation.reject}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ))}
      {!config.configured ? (
        <div className={s.notice}>Wallet connection unavailable.</div>
      ) : !ready ? (
        <button
          className={s.primary}
          onClick={() => void connect()}
          disabled={busy}
        >
          {busy ? (
            <Loader2 className={s.spin} size={16} />
          ) : (
            <Wallet size={16} />
          )}{" "}
          Connect with Pollar
        </button>
      ) : verified ? (
        <>
          <div className={s.address}>
            <span>Connected receiving address</span>
            <code>{wallet?.address ?? "Wallet provisioning in progress"}</code>
          </div>
          {wallet && onAddress && (
            <button
              type="button"
              className={s.secondary}
              onClick={() => onAddress(wallet.address)}
            >
              <Check size={15} /> Use this receiving address
            </button>
          )}
          <button
            type="button"
            className={s.textButton}
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} className={busy ? s.spin : ""} /> Read wallet
            balances
          </button>
          <div className={s.walletFunding}>
            <span>Stellar account</span>
            <strong>
              {wallet?.existsOnStellar === false
                ? "Activation needed"
                : wallet?.existsOnStellar === true
                  ? "Active on testnet"
                  : "Funding status unavailable"}
            </strong>
          </div>
          {wallet?.existsOnStellar === false && (
            <p className={s.fine}>
              Activate and fund this testnet account in your wallet, then
              refresh balances. Test assets have no cash value.
            </p>
          )}
          {!balances && (
            <p className={s.fine}>
              Balances have not been returned by Pollar. No zero balance is
              assumed.
            </p>
          )}
          {balances && (
            <div className={s.balanceList}>
              <small>Live SDK response · test assets have no cash value</small>
              {balances.balances
                .filter((b) => !b.chain || b.chain === "STELLAR")
                .map((b) => (
                  <div key={`${b.code}-${b.issuer}`}>
                    <span>{b.code}</span>
                    <strong>{b.balance ?? "Unavailable"}</strong>
                  </div>
                ))}
            </div>
          )}
          {paymentPlan &&
            ["ready_for_quote", "review", "approved"].includes(
              paymentPlan.state,
            ) && (
              <div className={s.sendReview}>
                <p>
                  Build the exact payment through Pollar. AGUS independently
                  parses the envelope before approval. Fee cap: 0.01 XLM.
                </p>
                {paymentPlan.state !== "approved" ? (
                  <button
                    type="button"
                    className={s.secondary}
                    disabled={busy}
                    onClick={() => void buildPlan()}
                  >
                    {busy ? (
                      <Loader2 className={s.spin} size={15} />
                    ) : (
                      <RefreshCw size={15} />
                    )}{" "}
                    {paymentPlan.quote
                      ? "Refresh provider quote"
                      : "Get provider quote"}
                  </button>
                ) : approvalNonce ? (
                  <button
                    type="button"
                    className={s.primary}
                    disabled={
                      busy ||
                      paymentPlan.quote?.sourceAddress !== wallet?.address
                    }
                    onClick={() => void submitPlan()}
                  >
                    {busy ? (
                      <Loader2 className={s.spin} size={15} />
                    ) : (
                      <ArrowUpRight size={15} />
                    )}{" "}
                    Sign & send approved test payment
                  </button>
                ) : (
                  <p className={s.notice}>
                    Re-enter your password in the review to authorize this
                    session’s signing attempt.
                  </p>
                )}
              </div>
            )}
          {request && request.state === "pending" && (
            <div className={s.sendReview}>
              <p>
                <strong>{request.amount} USDC</strong> · Stellar testnet
              </p>
              <code>{request.recipient}</code>
              <p>Memo: {request.memo}</p>
              {request.submissionStartedAt ? (
                <p className={s.notice}>
                  A send was already started. Check wallet history and verify
                  the transaction below.
                </p>
              ) : wallet?.address === request.recipient ? (
                <p className={s.notice}>
                  Connect a different test wallet to pay this receiving address.
                </p>
              ) : (
                <>
                  <label className={s.checkbox}>
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />{" "}
                    I reviewed the address, asset, amount, memo and maximum 0.01
                    XLM network fee. Send test assets once.
                  </label>
                  <label className={s.form}>
                    Re-enter operator password
                    <input
                      type="password"
                      value={requestPassword}
                      onChange={(e) => setRequestPassword(e.target.value)}
                      maxLength={256}
                      autoComplete="current-password"
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!reviewed || !requestPassword || busy}
                    className={s.primary}
                    onClick={() => void send()}
                  >
                    {busy ? (
                      <Loader2 size={16} className={s.spin} />
                    ) : (
                      <ArrowUpRight size={16} />
                    )}{" "}
                    Authorize testnet payment
                  </button>
                </>
              )}
            </div>
          )}
          <button
            className={s.textButton}
            type="button"
            disabled={busy}
            onClick={async () => {
              await client.current?.logout();
              setBalances(null);
            }}
          >
            Disconnect wallet
          </button>
        </>
      ) : (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              if (auth.step === "entering_code")
                client.current?.verifyEmailCode(code);
              else client.current?.login({ provider: "email", email });
            }}
            className={s.form}
          >
            {auth.step === "entering_code" ? (
              <label>
                Email verification code
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                />
              </label>
            ) : (
              <label>
                Your email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                />
              </label>
            )}
            <button className={s.primary} disabled={working || busy}>
              {working ? <Loader2 size={16} className={s.spin} /> : null}
              {auth.step === "entering_code"
                ? "Verify Pollar code"
                : "Continue with email"}
            </button>
          </form>
          <button
            className={s.secondary}
            type="button"
            disabled={working || busy}
            onClick={() => client.current?.login({ provider: "freighter" })}
          >
            Connect Freighter
          </button>
          {auth.step === "wallet_not_installed" && (
            <p className={s.notice}>
              Install Freighter to use this option, or continue with email.
            </p>
          )}
        </>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {outcome && (
        <p className={s.notice} role="status">
          {outcome}
        </p>
      )}
    </section>
  );
}
