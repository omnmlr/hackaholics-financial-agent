"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Transaction } from "@solana/web3.js";
import type {
  Asset,
  DraftState,
  SolanaDraft,
  WalletSnapshot,
} from "@/lib/solana/contracts";
import { BrandAsset } from "./brand-asset";
import styles from "./devnet-wallet.module.css";

type PublicWalletKey = { toBase58(): string };
type WalletProvider = {
  publicKey?: PublicWalletKey | null;
  connect(): Promise<{ publicKey?: PublicWalletKey }>;
  disconnect?(): Promise<void>;
  signTransaction(transaction: Transaction): Promise<Transaction>;
  on?(event: string, handler: () => void): void;
  removeListener?(event: string, handler: () => void): void;
};
type WalletName = "Phantom" | "Solflare";
type Connection = {
  name: WalletName;
  wallet: string;
  provider: WalletProvider;
};
type InjectedWindow = Window & {
  phantom?: { solana?: WalletProvider };
  solana?: WalletProvider;
  solflare?: WalletProvider;
};

const states: Record<DraftState, string> = {
  prepared: "Ready for your review",
  approved: "Approved · not submitted",
  submitting: "Submission started · check status",
  submitted: "Submitted · confirmation pending",
  unknown: "Outcome unknown · check status",
  confirmed: "Confirmed on devnet",
  finalized: "Finalized on devnet",
  failed: "Failed on devnet",
  expired: "Expired · prepare a new draft",
  cancelled: "Cancelled",
};
const unresolved = new Set<DraftState>(["submitting", "submitted", "unknown"]);
const settled = new Set<DraftState>([
  "confirmed",
  "finalized",
  "failed",
  "expired",
  "cancelled",
]);
const unsignedInteger = /^\d+$/;
const hash = /^[a-f0-9]{64}$/i;
const address = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const decimal = /^\d+(?:\.\d+)?$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function draftResult(value: unknown): SolanaDraft {
  if (
    !object(value) ||
    value.network !== "devnet" ||
    typeof value.id !== "string" ||
    typeof value.state !== "string" ||
    !Object.hasOwn(states, value.state) ||
    !["SOL", "SPL"].includes(String(value.asset)) ||
    !["sender", "recipient"].every(
      (key) => typeof value[key] === "string" && address.test(value[key]),
    ) ||
    !["digest", "messageDigest"].every(
      (key) => typeof value[key] === "string" && hash.test(value[key]),
    ) ||
    ![
      "amountAtoms",
      "feeLamports",
      "estimatedRentLamports",
      "totalSolRequiredLamports",
    ].every(
      (key) =>
        typeof value[key] === "string" && unsignedInteger.test(value[key]),
    ) ||
    typeof value.amount !== "string" ||
    !decimal.test(value.amount) ||
    typeof value.unsignedTransactionBase64 !== "string" ||
    typeof value.messageBase64 !== "string" ||
    typeof value.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(value.expiresAt)) ||
    (value.mint !== null && typeof value.mint !== "string") ||
    (value.approval !== null &&
      (!object(value.approval) || typeof value.approval.digest !== "string")) ||
    (value.submission !== null &&
      (!object(value.submission) ||
        typeof value.submission.signature !== "string"))
  ) {
    throw new Error(
      "The saved devnet draft could not be verified. Refresh the draft list.",
    );
  }
  return value as SolanaDraft;
}

function snapshotResult(value: unknown, wallet: string): WalletSnapshot {
  if (
    !object(value) ||
    value.network !== "devnet" ||
    value.wallet !== wallet ||
    typeof value.fetchedAt !== "string" ||
    !object(value.sol) ||
    typeof value.sol.amount !== "string" ||
    !decimal.test(value.sol.amount) ||
    typeof value.sol.lamports !== "string" ||
    !unsignedInteger.test(value.sol.lamports) ||
    !Array.isArray(value.tokens) ||
    !value.tokens.every(
      (token) =>
        object(token) &&
        typeof token.mint === "string" &&
        address.test(token.mint) &&
        typeof token.amount === "string" &&
        decimal.test(token.amount) &&
        typeof token.amountAtoms === "string" &&
        unsignedInteger.test(token.amountAtoms) &&
        Array.isArray(token.accounts) &&
        token.accounts.every(
          (account) => object(account) && typeof account.frozen === "boolean",
        ),
    )
  ) {
    throw new Error(
      "The wallet balance response could not be verified. Try a new balance check.",
    );
  }
  return value as WalletSnapshot;
}

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function api(
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 30000);
  try {
    const response = await fetch("/api/agent-workspace/solana", {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new ApiError(
        object(payload) && typeof payload.error === "string"
          ? payload.error
          : "The devnet request could not be completed.",
        response.status,
      );
    }
    if (!object(payload))
      throw new Error("The devnet response could not be read.");
    return Object.hasOwn(payload, "result") ? payload.result : payload;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function listResult(value: unknown) {
  if (!object(value) || !Array.isArray(value.drafts))
    throw new Error("The saved draft list could not be read.");
  return value.drafts.map(draftResult);
}

function sol(lamports: string) {
  if (!unsignedInteger.test(lamports)) return "Unavailable";
  const digits = lamports.padStart(10, "0");
  const fraction = digits.slice(-9).replace(/0+$/, "");
  return `${digits.slice(0, -9)}${fraction ? `.${fraction}` : ""} SOL`;
}

function decodeBase64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
}

function message(error: unknown) {
  if (error instanceof Error && error.name === "AbortError")
    return "The request timed out or was interrupted. Refresh saved drafts before trying another action.";
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return "The request could not be completed. No automatic retry was made.";
}

export function DevnetWallet() {
  const [drafts, setDrafts] = useState<SolanaDraft[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [walletName, setWalletName] = useState<WalletName>("Phantom");
  const [connection, setConnection] = useState<Connection | null>(null);
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [asset, setAsset] = useState<Asset>("SOL");
  const [mint, setMint] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [password, setPassword] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [operation, setOperation] = useState("Loading saved drafts…");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [uncertainIds, setUncertainIds] = useState<string[]>([]);
  const connectionRef = useRef<Connection | null>(null);
  const walletEpoch = useRef(0);
  const busy = useRef(false);
  const invalidateConnection = useCallback(() => {
    walletEpoch.current++;
    connectionRef.current = null;
  }, []);
  const active = drafts.find((draft) => draft.id === selectedId);
  const walletMatches = !!active && active.sender === connection?.wallet;
  const hasUnresolved = drafts.some(
    (draft) =>
      draft.sender === connection?.wallet &&
      (unresolved.has(draft.state) || uncertainIds.includes(draft.id)),
  );
  const canAct = authenticated === true && !operation;

  useEffect(() => {
    const controller = new AbortController();
    busy.current = true;
    api(undefined, controller.signal)
      .then((value) => {
        setDrafts(listResult(value));
        setAuthenticated(true);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401)
          setAuthenticated(false);
        setError(message(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          busy.current = false;
          setOperation("");
        }
      });
    return () => {
      controller.abort();
      invalidateConnection();
    };
  }, [invalidateConnection]);

  useEffect(() => {
    if (!connection) return;
    const invalidate = () => {
      walletEpoch.current++;
      connectionRef.current = null;
      setConnection(null);
      setSnapshot(null);
      setAcknowledged(false);
      setPassword("");
      setNotice("");
      setError(
        "Your wallet disconnected or changed accounts. Reconnect and review the draft again.",
      );
    };
    connection.provider.on?.("accountChanged", invalidate);
    connection.provider.on?.("disconnect", invalidate);
    return () => {
      connection.provider.removeListener?.("accountChanged", invalidate);
      connection.provider.removeListener?.("disconnect", invalidate);
    };
  }, [connection]);

  useEffect(() => {
    setAcknowledged(false);
    setPassword("");
  }, [active?.id, active?.digest]);

  function fail(cause: unknown) {
    if (cause instanceof ApiError && cause.status === 401)
      setAuthenticated(false);
    setError(message(cause));
  }

  async function perform(label: string, task: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    setOperation(label);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (cause) {
      fail(cause);
    } finally {
      busy.current = false;
      setOperation("");
    }
  }

  function saveDraft(draft: SolanaDraft) {
    setDrafts((previous) => [
      draft,
      ...previous.filter((item) => item.id !== draft.id),
    ]);
    setSelectedId(draft.id);
  }

  async function refreshDrafts() {
    await perform("Refreshing saved drafts…", async () => {
      setDrafts(listResult(await api()));
      setAuthenticated(true);
      setNotice(
        "Saved devnet drafts refreshed. Nothing was signed or submitted.",
      );
    });
  }

  async function connectWallet() {
    await perform("Waiting for wallet connection…", async () => {
      const injected = window as InjectedWindow;
      const provider =
        walletName === "Phantom"
          ? (injected.phantom?.solana ?? injected.solana)
          : injected.solflare;
      if (!provider || typeof provider.signTransaction !== "function")
        throw new Error(
          `Open AGUS in a browser with the ${walletName} wallet extension, then connect again.`,
        );
      const epoch = ++walletEpoch.current;
      const response = await provider.connect();
      const publicKey = provider.publicKey ?? response.publicKey;
      if (!publicKey)
        throw new Error("The wallet did not provide a public address.");
      const wallet = publicKey.toBase58();
      if (!address.test(wallet) || epoch !== walletEpoch.current)
        throw new Error(
          "Wallet connection changed. Connect again before continuing.",
        );
      const next = { name: walletName, wallet, provider };
      connectionRef.current = next;
      setConnection(next);
      setSnapshot(null);
      setAcknowledged(false);
      setNotice(
        "Wallet connected. Check its devnet balances before preparing a transfer.",
      );
    });
  }

  async function disconnectWallet() {
    await perform("Disconnecting wallet…", async () => {
      const current = connectionRef.current;
      walletEpoch.current++;
      connectionRef.current = null;
      setConnection(null);
      setSnapshot(null);
      setAcknowledged(false);
      setPassword("");
      await current?.provider.disconnect?.();
      setNotice(
        "Wallet disconnected. Saved drafts remain available for status checks.",
      );
    });
  }

  function requireWallet(sender?: string) {
    const current = connectionRef.current;
    if (
      !current ||
      current.provider.publicKey?.toBase58() !== current.wallet ||
      (sender !== undefined && current.wallet !== sender)
    )
      throw new Error(
        "Connect the draft's sender wallet and review the details again.",
      );
    return current;
  }

  async function discover() {
    await perform("Reading devnet balances…", async () => {
      const current = requireWallet();
      const epoch = walletEpoch.current;
      const result = snapshotResult(
        await api({ action: "discover", wallet: current.wallet }),
        current.wallet,
      );
      requireWallet(current.wallet);
      if (epoch !== walletEpoch.current)
        throw new Error(
          "Wallet changed during the balance check. Check again.",
        );
      setSnapshot(result);
      setNotice("Read current balances from Solana devnet.");
    });
  }

  async function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform("Preparing an unsigned devnet draft…", async () => {
      const current = requireWallet();
      if (hasUnresolved)
        throw new Error(
          "Check the unresolved transfer before preparing another for this wallet.",
        );
      const epoch = walletEpoch.current;
      const draft = draftResult(
        await api({
          action: "prepare",
          sender: current.wallet,
          recipient: recipient.trim(),
          asset,
          ...(asset === "SPL" ? { mint: mint.trim() } : {}),
          amount: amount.trim(),
        }),
      );
      requireWallet(current.wallet);
      if (epoch !== walletEpoch.current || draft.sender !== current.wallet)
        throw new Error(
          "Wallet changed while the draft was prepared. Refresh saved drafts and review it.",
        );
      saveDraft(draft);
      setAcknowledged(false);
      setPassword("");
      setNotice(
        "Unsigned draft saved. Review the full recipient, asset, amount and fees below.",
      );
    });
  }

  async function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    const draft = active;
    const secret = password;
    setPassword("");
    await perform("Checking your approval…", async () => {
      requireWallet(draft.sender);
      if (!acknowledged || draft.state !== "prepared")
        throw new Error("Review the prepared draft before approving it.");
      const result = draftResult(
        await api({
          action: "approve",
          id: draft.id,
          digest: draft.digest,
          acknowledged: true,
          password: secret,
        }),
      );
      if (result.state !== "approved" || result.digest !== draft.digest)
        throw new Error(
          "Approval was not established for this review. Refresh the saved draft before continuing.",
        );
      saveDraft(result);
      setNotice(
        "Approval recorded. Use the separate signing button to review the request in your wallet.",
      );
    });
  }

  async function signAndSubmit() {
    if (!active) return;
    const draft = active;
    let submissionStarted = false;
    await perform("Waiting for your wallet signature…", async () => {
      try {
        const current = requireWallet(draft.sender);
        const epoch = walletEpoch.current;
        if (
          !acknowledged ||
          draft.state !== "approved" ||
          draft.approval?.digest !== draft.digest ||
          Date.parse(draft.expiresAt) <= Date.now() ||
          uncertainIds.includes(draft.id)
        )
          throw new Error(
            "A current, reviewed server approval is required. Refresh or prepare a new draft.",
          );
        const { Transaction } = await import("@solana/web3.js");
        const transaction = Transaction.from(
          decodeBase64(draft.unsignedTransactionBase64),
        );
        const expected = decodeBase64(draft.messageBase64);
        const original = transaction.serializeMessage();
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(original)),
        );
        const actualHash = Array.from(digest, (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
        if (
          !sameBytes(original, expected) ||
          actualHash !== draft.messageDigest ||
          transaction.feePayer?.toBase58() !== current.wallet ||
          transaction.signatures.length !== 1 ||
          transaction.signatures.some(
            (entry) => entry.publicKey.toBase58() !== current.wallet,
          )
        )
          throw new Error(
            "The transaction does not match the reviewed draft. Nothing was signed or submitted.",
          );
        requireWallet(draft.sender);
        if (epoch !== walletEpoch.current)
          throw new Error("Wallet changed. Review the draft again.");
        const signed = await current.provider.signTransaction(transaction);
        requireWallet(draft.sender);
        if (
          epoch !== walletEpoch.current ||
          Date.parse(draft.expiresAt) <= Date.now()
        )
          throw new Error(
            "The wallet changed or this draft expired. AGUS did not submit the signature.",
          );
        if (!sameBytes(signed.serializeMessage(), expected))
          throw new Error(
            "The wallet changed the transaction. AGUS did not submit it.",
          );
        const signedTransactionBase64 = encodeBase64(
          signed.serialize({
            requireAllSignatures: true,
            verifySignatures: true,
          }),
        );
        setOperation("Submitting the signed transaction to devnet…");
        submissionStarted = true;
        setUncertainIds((previous) => [...new Set([...previous, draft.id])]);
        const result = draftResult(
          await api({
            action: "submit",
            id: draft.id,
            digest: draft.digest,
            signedTransactionBase64,
          }),
        );
        saveDraft(result);
        setAcknowledged(false);
        if (settled.has(result.state))
          setUncertainIds((previous) =>
            previous.filter((id) => id !== draft.id),
          );
        setNotice(
          `Saved status: ${states[result.state]}. Use Check status to reconcile; this button never resends.`,
        );
      } catch (cause) {
        if (submissionStarted)
          throw new Error(
            "The submission response was not established. Do not resend. Refresh drafts and use Check status to reconcile this transfer.",
          );
        throw cause;
      }
    });
  }

  async function draftAction(action: "reconcile" | "cancel") {
    if (!active) return;
    const draft = active;
    await perform(
      action === "reconcile"
        ? "Checking devnet status…"
        : "Cancelling the unsigned draft…",
      async () => {
        const result = draftResult(await api({ action, id: draft.id }));
        if (action === "cancel" && result.state !== "cancelled")
          throw new Error(
            "Cancellation was not established. Refresh the saved draft to check its state.",
          );
        saveDraft(result);
        if (settled.has(result.state))
          setUncertainIds((previous) =>
            previous.filter((id) => id !== draft.id),
          );
        setNotice(
          action === "cancel"
            ? "Draft cancelled. No transaction was submitted by this action."
            : `Status checked: ${states[result.state]}. No transaction was resent.`,
        );
      },
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="AGUS home">
          <BrandAsset />
        </Link>
        <Link className={styles.back} href="/">
          Back to your conversation
        </Link>
      </header>
      <div className={styles.intro}>
        <p className={styles.eyebrow}>SOLANA DEVNET</p>
        <h1>Your wallet. Your approval.</h1>
        <p>Your money, and what&apos;s next.</p>
        <p className={styles.muted}>
          Devnet test tokens only. Connect your own wallet, review an unsigned
          transfer, then approve and sign it yourself.
        </p>
      </div>

      <div className={styles.feedback} aria-live="polite" aria-atomic="true">
        {operation ? <p role="status">{operation}</p> : null}
        {notice ? <p role="status">{notice}</p> : null}
      </div>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {authenticated === false ? (
        <section className={styles.panel} aria-labelledby="devnet-sign-in">
          <h2 id="devnet-sign-in">Sign in to AGUS first</h2>
          <p>
            Use the existing operator sign-in on the home page, then return
            here. A wallet connection does not sign you in to AGUS.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primaryLink} href="/">
              Open AGUS sign-in
            </Link>
            <button
              className={styles.secondary}
              disabled={!!operation}
              onClick={() => void refreshDrafts()}
            >
              Check sign-in again
            </button>
          </div>
        </section>
      ) : null}

      <div className={styles.columns}>
        <section className={styles.panel} aria-labelledby="devnet-wallet-title">
          <h2 id="devnet-wallet-title">1. Connect and check balances</h2>
          <p className={styles.muted}>
            Set your wallet to Solana devnet. AGUS requests your public address
            and never asks for a recovery phrase or private key.
          </p>
          {connection ? (
            <>
              <p className={styles.label}>
                {connection.name} · connected public address
              </p>
              <code className={styles.address}>{connection.wallet}</code>
              <div className={styles.actions}>
                <button
                  className={styles.primary}
                  disabled={!canAct}
                  onClick={() => void discover()}
                >
                  Check devnet balances
                </button>
                <button
                  className={styles.secondary}
                  disabled={!!operation}
                  onClick={() => void disconnectWallet()}
                >
                  Disconnect
                </button>
              </div>
            </>
          ) : (
            <div className={styles.connect}>
              <label htmlFor="devnet-wallet-provider">Wallet</label>
              <select
                id="devnet-wallet-provider"
                value={walletName}
                disabled={!!operation}
                onChange={(event) =>
                  setWalletName(event.target.value as WalletName)
                }
              >
                <option>Phantom</option>
                <option>Solflare</option>
              </select>
              <button
                className={styles.primary}
                disabled={!canAct}
                onClick={() => void connectWallet()}
              >
                Connect wallet
              </button>
            </div>
          )}
          {snapshot ? (
            <div className={styles.balances}>
              <p className={styles.balance}>
                {snapshot.sol.amount} <span>SOL</span>
              </p>
              <p className={styles.muted}>
                Observed on devnet at{" "}
                {new Date(snapshot.fetchedAt).toLocaleString()}.
              </p>
              <h3>Classic SPL tokens</h3>
              {snapshot.tokens.length ? (
                <ul className={styles.tokens}>
                  {snapshot.tokens.map((token) => (
                    <li key={token.mint}>
                      <strong>{token.amount} token units</strong>
                      <code className={styles.address}>{token.mint}</code>
                      {token.accounts.some((account) => account.frozen) ? (
                        <p className={styles.muted}>
                          Includes a frozen token account. Transfer availability
                          is checked when preparing.
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>
                  No classic SPL token accounts were returned.
                </p>
              )}
            </div>
          ) : null}
        </section>

        <section
          className={styles.panel}
          aria-labelledby="devnet-prepare-title"
        >
          <h2 id="devnet-prepare-title">2. Prepare an unsigned transfer</h2>
          <form
            className={styles.form}
            onSubmit={(event) => void prepare(event)}
          >
            <label htmlFor="devnet-asset">Asset</label>
            <select
              id="devnet-asset"
              value={asset}
              disabled={!!operation}
              onChange={(event) => setAsset(event.target.value as Asset)}
            >
              <option value="SOL">SOL</option>
              <option value="SPL">Classic SPL token</option>
            </select>
            {asset === "SPL" ? (
              <>
                <label htmlFor="devnet-mint">Token mint address</label>
                <input
                  id="devnet-mint"
                  value={mint}
                  onChange={(event) => setMint(event.target.value)}
                  required
                  maxLength={44}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  list="devnet-known-mints"
                  disabled={!!operation}
                />
                <datalist id="devnet-known-mints">
                  {snapshot?.tokens.map((token) => (
                    <option key={token.mint} value={token.mint} />
                  ))}
                </datalist>
                <p className={styles.muted}>
                  Use the exact mint. Token names and symbols are not verified.
                </p>
              </>
            ) : null}
            <label htmlFor="devnet-recipient">Recipient wallet address</label>
            <input
              id="devnet-recipient"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              required
              maxLength={44}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={!!operation}
            />
            <label htmlFor="devnet-amount">
              Amount in {asset === "SOL" ? "SOL" : "token units"}
            </label>
            <input
              id="devnet-amount"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              type="text"
              inputMode="decimal"
              pattern="[0-9]+(\.[0-9]+)?"
              required
              maxLength={40}
              autoComplete="off"
              disabled={!!operation}
              placeholder="0.01"
            />
            <p className={styles.muted}>
              Preparing saves a draft and checks devnet fees. It does not
              request a signature or submit a transaction.
            </p>
            {hasUnresolved ? (
              <p className={styles.warning}>
                This wallet has an unresolved transfer. Check its saved status
                before preparing another.
              </p>
            ) : null}
            <button
              className={styles.primary}
              disabled={!canAct || !connection || hasUnresolved}
            >
              Prepare transfer
            </button>
          </form>
        </section>
      </div>

      <section className={styles.panel} aria-labelledby="devnet-drafts-title">
        <div className={styles.sectionHeading}>
          <h2 id="devnet-drafts-title">3. Review, approve and sign</h2>
          <button
            className={styles.secondary}
            disabled={!!operation}
            onClick={() => void refreshDrafts()}
          >
            Refresh saved drafts
          </button>
        </div>
        {!drafts.length ? (
          <p className={styles.muted}>
            Your saved devnet drafts will appear here.
          </p>
        ) : (
          <>
            <label className={styles.label} htmlFor="devnet-saved-draft">
              Saved draft
            </label>
            <select
              id="devnet-saved-draft"
              className={styles.draftSelect}
              value={selectedId}
              disabled={!!operation}
              onChange={(event) => {
                setSelectedId(event.target.value);
                setError("");
                setNotice("");
              }}
            >
              <option value="">Choose a draft to review</option>
              {drafts.map((draft) => (
                <option key={draft.id} value={draft.id}>
                  {draft.amount} {draft.asset === "SOL" ? "SOL" : "token units"}{" "}
                  · {states[draft.state]} · {draft.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </>
        )}
        {active ? (
          <div className={styles.review}>
            <p className={styles.status}>{states[active.state]}</p>
            <dl className={styles.details}>
              <dt>Network</dt>
              <dd>Solana devnet · test tokens</dd>
              <dt>Sender</dt>
              <dd>
                <code>{active.sender}</code>
              </dd>
              <dt>Recipient wallet</dt>
              <dd>
                <code>{active.recipient}</code>
              </dd>
              <dt>Amount</dt>
              <dd>
                {active.amount} {active.asset === "SOL" ? "SOL" : "token units"}
              </dd>
              {active.mint ? (
                <>
                  <dt>Token mint</dt>
                  <dd>
                    <code>{active.mint}</code>
                  </dd>
                </>
              ) : null}
              {active.sourceTokenAccount ? (
                <>
                  <dt>Source token account</dt>
                  <dd>
                    <code>{active.sourceTokenAccount}</code>
                  </dd>
                </>
              ) : null}
              {active.recipientTokenAccount ? (
                <>
                  <dt>Recipient token account</dt>
                  <dd>
                    <code>{active.recipientTokenAccount}</code>
                    {active.createsRecipientTokenAccount ? (
                      <span className={styles.muted}>
                        {" "}
                        Will be created by this transaction.
                      </span>
                    ) : null}
                  </dd>
                </>
              ) : null}
              <dt>Network fee estimate</dt>
              <dd>
                {sol(active.feeLamports)} ({active.feeLamports} lamports)
              </dd>
              <dt>Account rent estimate</dt>
              <dd>
                {sol(active.estimatedRentLamports)} (
                {active.estimatedRentLamports} lamports)
              </dd>
              <dt>Total SOL required</dt>
              <dd>
                {sol(active.totalSolRequiredLamports)}
                {active.asset === "SPL"
                  ? " plus the token amount above"
                  : " including the transfer amount"}
              </dd>
              <dt>Draft expires</dt>
              <dd>{new Date(active.expiresAt).toLocaleString()}</dd>
              <dt>Draft ID</dt>
              <dd>
                <code>{active.id}</code>
              </dd>
              {active.confirmation ? (
                <>
                  <dt>Recorded chain confirmation</dt>
                  <dd>
                    {active.confirmation.commitment} · slot{" "}
                    {active.confirmation.slot} · fee{" "}
                    {sol(active.confirmation.feeLamports)}
                  </dd>
                </>
              ) : null}
            </dl>
            <details className={styles.digest}>
              <summary>Review fingerprint</summary>
              <code>{active.digest}</code>
            </details>
            {active.failureCode ? (
              <p className={styles.warning}>
                Recorded reason: {active.failureCode}
              </p>
            ) : null}
            {active.submission?.signature ? (
              <p className={styles.signature}>
                Devnet transaction:{" "}
                <a
                  href={`https://explorer.solana.com/tx/${encodeURIComponent(active.submission.signature)}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View on Solana Explorer
                </a>
                <code className={styles.address}>
                  {active.submission.signature}
                </code>
              </p>
            ) : null}
            {active.state === "prepared" || active.state === "approved" ? (
              <>
                {!walletMatches ? (
                  <p className={styles.warning}>
                    Connect the sender wallet shown above before approving or
                    signing.
                  </p>
                ) : null}
                <label className={styles.acknowledgement}>
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    disabled={!canAct || !walletMatches}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                  />
                  <span>
                    I reviewed the devnet network, full recipient, asset,
                    amount, fee and rent above.
                  </span>
                </label>
                {active.state === "prepared" ? (
                  <form
                    className={styles.approval}
                    onSubmit={(event) => void approve(event)}
                  >
                    <label htmlFor="devnet-approval-password">
                      AGUS operator password
                    </label>
                    <input
                      id="devnet-approval-password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="current-password"
                      required
                      maxLength={256}
                      disabled={!canAct || !walletMatches}
                    />
                    <p className={styles.muted}>
                      This records approval for this exact draft. Your wallet
                      signature is a separate step.
                    </p>
                    <button
                      className={styles.primary}
                      disabled={
                        !canAct || !walletMatches || !acknowledged || !password
                      }
                    >
                      Approve this draft
                    </button>
                  </form>
                ) : (
                  <div className={styles.signing}>
                    <p className={styles.muted}>
                      Approval is recorded. Review the request in your wallet
                      next. Confirming there signs this exact transfer and lets
                      AGUS submit it to devnet once.
                    </p>
                    <button
                      className={styles.primary}
                      disabled={
                        !canAct ||
                        !walletMatches ||
                        !acknowledged ||
                        uncertainIds.includes(active.id)
                      }
                      onClick={() => void signAndSubmit()}
                    >
                      Sign in wallet and submit to devnet
                    </button>
                  </div>
                )}
              </>
            ) : null}
            {unresolved.has(active.state) ||
            uncertainIds.includes(active.id) ? (
              <p className={styles.warning}>
                The outcome is unresolved. Check status; do not resend or
                prepare a replacement for this transfer.
              </p>
            ) : null}
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                disabled={!canAct || active.state === "cancelled"}
                onClick={() => void draftAction("reconcile")}
              >
                Check status
              </button>
              {active.state === "prepared" || active.state === "approved" ? (
                <button
                  className={styles.secondary}
                  disabled={!canAct || uncertainIds.includes(active.id)}
                  onClick={() => void draftAction("cancel")}
                >
                  Cancel unsigned draft
                </button>
              ) : null}
            </div>
            <p className={styles.muted}>
              Status checks read chain evidence. They never sign, submit or
              resend a transaction.
            </p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
