"use client";
import {
  useCallback,
  useId,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import Link from "next/link";
import { ZcashNetwork } from "./zcash-network";
import { existingReminderRequest } from "./reminder-request";
import { PersonalAction } from "../personal-action";
import { FinancialResponse } from "../financial-response";
import { useVoiceInput } from "../use-voice-input";
import { useResponseSpeech } from "../use-response-speech";
import {
  Mic,
  Square,
  Volume2,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ArrowUp,
  Bell,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  Eye,
  EyeOff,
  History,
  FileText,
  Home,
  Layers3,
  Loader2,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import type {
  Invoice,
  InvoiceInput,
  PaymentRequest,
  ProductSnapshot,
} from "@/lib/web-product/contracts";
import type { Responsibility } from "@/lib/agent-workspace/store";
import type { AgentReply } from "@/lib/financial-agent/agent";
import { productApi } from "./api";
import { AgusBrand as Brand, AgusCompanion as Companion } from "./identity";
import type { SavedChat, SavedTurn } from "@/lib/chat-history/store";
import { PollarWallet, clearPollarSession } from "./pollar-wallet";
import { PaymentReview } from "./payment-review";
import {
  looksLikePaymentIntent,
  type PaymentPlan,
} from "@/lib/web-product/payment-contracts";
import s from "./workspace.module.css";

type ChatLaunch = { id: string; text?: string; draft?: string };

type Tab =
  | "Overview"
  | "Assistant"
  | "Obligations"
  | "Accounts"
  | "Activity"
  | "Settings";
const navigation = [
  { name: "Overview", label: "Home", icon: Home },
  { name: "Accounts", label: "Money", icon: Wallet },
  { name: "Assistant", label: "AGUS", icon: MessageCircle },
  { name: "Obligations", label: "Obligations", icon: Layers3 },
  { name: "Activity", label: "Activity", icon: Clock3 },
] as const;
const date = (value: string, full = false) =>
  new Date(value).toLocaleDateString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: full ? "long" : "short",
    ...(full ? { year: "numeric" } : {}),
  });
const displayAmount = (invoice: Invoice) =>
  `${invoice.currency === "NGN" ? "₦" : ""}${Number(invoice.amount).toLocaleString("en-NG", { maximumFractionDigits: 8 })}${invoice.currency === "NGN" ? "" : ` ${invoice.currency}`}`;
const initial = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

function Dialog({
  title,
  eyebrow,
  children,
  close,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={s.dialog}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className={s.dialogInner}>
        <header className={s.dialogHeader}>
          <div>
            {eyebrow && <p className={s.eyebrow}>{eyebrow}</p>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className={s.iconButton}
            onClick={close}
            aria-label="Close dialog"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
function Empty({
  icon: Icon = Layers3,
  title,
  text,
  children,
}: {
  icon?: typeof Layers3;
  title: string;
  text?: string;
  children?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>
        <Icon size={24} strokeWidth={1.3} />
      </div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}

export function AgusWorkspace({
  paymentMode = "fixture",
}: {
  paymentMode?: "fixture" | "test";
}) {
  const [phase, setPhase] = useState<"loading" | "out" | "in" | "error">(
    "loading",
  );
  const [snapshot, setSnapshot] = useState<ProductSnapshot>();
  const [tab, setTab] = useState<Tab>("Overview");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [masked, setMasked] = useState(false);
  const [privacyMode, setPrivacyModeState] = useState(false);
  const setPrivacyMode = useCallback((value: boolean) => {
    setPrivacyModeState(value);
    try {
      sessionStorage.setItem("agus.privacyMode", String(value));
    } catch {
      /* Mode still applies without browser storage. */
    }
  }, []);
  const [collapsed, setCollapsed] = useState(false);
  const [modal, setModal] = useState<
    "invoice" | "import" | "help" | "account" | null
  >(null);
  const [selected, setSelected] = useState<string>();
  const [selectedPayment, setSelectedPayment] = useState<PaymentPlan>();
  const [filter, setFilter] = useState("all");
  const [cancelTask, setCancelTask] = useState<Responsibility>();
  const [cancelError, setCancelError] = useState("");
  const cancelling = useRef(false);
  const [tasks, setTasks] = useState<Responsibility[]>([]);
  const [paymentPlans, setPaymentPlans] = useState<PaymentPlan[]>([]);
  const [sample, setSample] = useState(false);
  const [invoiceCurrency, setInvoiceCurrency] =
    useState<InvoiceInput["currency"]>("USDC");
  const [walletFocus, setWalletFocus] = useState<"pollar" | "zcash" | null>(
    null,
  );
  const [contextOpen, setContextOpen] = useState(false);
  const [homeMessage, setHomeMessage] = useState("");
  const [chatLaunch, setChatLaunch] = useState<ChatLaunch>();
  const [replayOnboarding, setReplayOnboarding] = useState(false);
  const [networkStatus, setNetworkStatus] = useState("");
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [onboardingError, setOnboardingError] = useState("");
  useEffect(() => {
    try {
      setPrivacyModeState(
        sessionStorage.getItem("agus.privacyMode") === "true",
      );
    } catch {
      /* storage is optional */
    }
  }, []);
  useEffect(() => {
    if (tab !== "Accounts" || !walletFocus || phase !== "in") return;
    const panel = document.getElementById(`agus-${walletFocus}-wallet`);
    if (panel) {
      panel.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      panel.focus({ preventScroll: true });
      setWalletFocus(null);
    }
  }, [tab, walletFocus, phase]);
  const showWallet = (wallet: "pollar" | "zcash") => {
    setModal(null);
    setChatLaunch(undefined);
    setTab("Accounts");
    setWalletFocus(wallet);
  };
  const startChat = (draft = "", text?: string) => {
    setContextOpen(false);
    setChatLaunch({ id: crypto.randomUUID(), draft, text });
    setTab("Assistant");
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  async function finishOnboarding(next?: "chat" | "payment" | "obligation") {
    if (onboardingBusy) return;
    setOnboardingBusy(true);
    setOnboardingError("");
    try {
      await productApi("product/preferences", { onboardingCompleted: true });
      setSnapshot((old) =>
        old ? { ...old, preferences: { onboardingCompleted: true } } : old,
      );
      setReplayOnboarding(false);
      if (next === "chat") startChat();
      if (next === "payment") startChat("Send ");
      if (next === "obligation") {
        setSample(false);
        setModal("invoice");
      }
    } catch {
      setOnboardingError("Couldn’t save your choice. Please try again.");
    } finally {
      setOnboardingBusy(false);
    }
  }
  const refresh = useCallback(async () => {
    try {
      const data = await productApi<ProductSnapshot>("product");
      setSnapshot(data);
      setPhase("in");
      setError("");
      const workspace = await productApi<{ tasks: Responsibility[] }>(
        "agent-workspace",
      );
      setTasks(workspace.tasks);
      const savedPlans = await productApi<{ plans: PaymentPlan[] }>(
        "product/payment-plans",
      );
      setPaymentPlans(savedPlans.plans);
    } catch (e) {
      if ((e as Error & { status?: number }).status === 401) {
        setPhase("out");
        setSnapshot(undefined);
        setTasks([]);
        setPaymentPlans([]);
      } else {
        setError(e instanceof Error ? e.message : "Workspace unavailable");
        setPhase((p) => (p === "in" ? "in" : "error"));
      }
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (phase !== "in") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [phase, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const notify = (message: string) => setToast(message);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("Copied to clipboard");
    } catch {
      notify("Clipboard unavailable. Select and copy the text manually.");
    }
  }
  async function action(work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action unavailable");
    } finally {
      setBusy(false);
    }
  }
  async function openPayment(id: string) {
    await action(async () => {
      const payment = await productApi<PaymentPlan>(
        `product/payment-plans/${id}`,
      );
      setSelected(undefined);
      setSelectedPayment(payment);
    });
  }
  const navigate = (next: Tab) => {
    setChatLaunch(undefined);
    setContextOpen(false);
    setTab(next);
    setError("");
    window.scrollTo({ top: 0, behavior: "instant" });
  };

  if (phase === "loading")
    return (
      <div className={s.root}>
        <div className={s.loading}>
          <Companion />
          <p>Opening your workspace</p>
          <Loader2 size={18} className={s.spin} />
          <p className={s.fine}>
            {paymentMode === "fixture"
              ? "Demo Access · Legacy bank transactions use local fixture simulation. Digital payments are testnet only."
              : "Test Access · Legacy bank transactions use Paystack test mode. Digital payments are testnet only."}
          </p>
        </div>
      </div>
    );
  if (phase === "out") return <SignIn onSuccess={refresh} />;
  if (phase === "error" || !snapshot)
    return (
      <div className={s.root}>
        <div className={s.loading}>
          <Companion />
          <h2>Let’s reconnect.</h2>
          <p className={s.muted}>
            {error || "Your workspace could not be loaded."}
          </p>
          <button className={s.primary} onClick={() => void refresh()}>
            <RefreshCw size={16} /> Try again
          </button>
          <button className={s.textButton} onClick={() => setPhase("out")}>
            Return to sign in
          </button>
        </div>
      </div>
    );

  const invoice = snapshot.invoices.find((item) => item.id === selected);
  const outstanding = snapshot.invoices.filter((item) => item.state === "open");
  const pending = snapshot.requests.filter((item) => item.state === "pending");
  const visibleInvoices = snapshot.invoices.filter(
    (item) =>
      filter === "all" ||
      (filter === "settled"
        ? item.state === "settled"
        : item.direction === filter && item.state === "open"),
  );
  const amount = (text: string | null) => (masked ? "••••••" : (text ?? "—"));
  const openInvoiceForm = (
    example = false,
    currency: InvoiceInput["currency"] = "USDC",
  ) => {
    setSample(example);
    setInvoiceCurrency(currency);
    setModal("invoice");
  };

  return (
    <div
      className={s.root}
      data-counterpart="true"
      data-tab={tab}
      data-busy={busy}
      data-privacy={privacyMode ? "true" : "false"}
    >
      <aside className={s.sidebar} aria-label="Main navigation">
        <button className={s.brandButton} onClick={() => navigate("Overview")}>
          <Brand />
        </button>

        <nav>
          {navigation.map(({ name, label, icon: Icon }) => (
            <button
              key={name}
              className={`${s.navItem} ${tab === name ? s.navActive : ""}`}
              onClick={() => navigate(name)}
              aria-current={tab === name ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.6} />
              <span>{label}</span>
              {name === "Obligations" && outstanding.length > 0 && (
                <span className={s.navCount}>{outstanding.length}</span>
              )}
            </button>
          ))}
        </nav>
        <button className={s.newObligation} onClick={() => openInvoiceForm()}>
          <Plus size={16} /> New obligation
        </button>
        <div className={s.sidebarBottom}>
          <button
            className={`${s.navItem} ${tab === "Settings" ? s.navActive : ""}`}
            onClick={() => navigate("Settings")}
          >
            <Settings2 size={18} strokeWidth={1.6} /> Settings
          </button>
          <button className={s.navItem} onClick={() => setModal("help")}>
            <CircleHelp size={18} strokeWidth={1.6} /> About AGUS
          </button>
          <div className={s.profile}>
            <span className={s.avatar}>Y</span>
            <div>
              <strong>Your workspace</strong>
              <small>Personal space</small>
            </div>
            <button
              aria-label="Sign out"
              className={s.iconButton}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await productApi("session", undefined, "DELETE");
                  clearPollarSession();
                  setPhase("out");
                  setSnapshot(undefined);
                })
              }
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className={s.mainShell}>
        <header className={s.topbar}>
          <div className={s.mobileBrand}>
            <Brand />
          </div>
          <div className={s.breadcrumb}>
            Your workspace <ChevronRight size={13} />
            <strong>
              {navigation.find((item) => item.name === tab)?.label ?? tab}
            </strong>
          </div>
          <p className={s.officialTagline}>Your money, and what's next.</p>
          <div className={s.topActions}>
            <button
              className={`${s.privacyButton} ${privacyMode ? s.privacyActive : ""}`}
              aria-pressed={privacyMode}
              onClick={() => {
                setPrivacyMode(!privacyMode);
                notify(privacyMode ? "Privacy Mode off" : "Privacy Mode on");
              }}
              aria-label="Privacy Mode"
            >
              <ShieldCheck size={14} />
              <span>{privacyMode ? "Privacy on" : "Privacy"}</span>
            </button>

            <button
              className={s.iconButton}
              aria-label="Refresh workspace"
              onClick={() => void action(refresh)}
              disabled={busy}
            >
              <RefreshCw size={16} className={busy ? s.spin : ""} />
            </button>
            <button
              className={s.iconButton}
              aria-label="Open activity"
              onClick={() => navigate("Activity")}
            >
              <Bell size={18} />
              {pending.length > 0 && <span className={s.notificationDot} />}
            </button>
            <button
              className={`${s.iconButton} ${s.mobileSettings}`}
              aria-label="Open settings"
              onClick={() => navigate("Settings")}
            >
              <Settings2 size={18} />
            </button>
          </div>
        </header>
        <main className={s.main} key={tab}>
          {error && (
            <div className={s.errorBanner} role="alert">
              <span>{error}</span>
              <button
                className={s.iconButton}
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {tab === "Overview" && (
            <>
              <div className={s.pageHeading}>
                <div>
                  <p className={s.eyebrow}>{date(snapshot.asOf, true)}</p>
                  <h1>Overview</h1>
                </div>
                <button
                  className={s.textButton}
                  onClick={() => navigate("Accounts")}
                >
                  All accounts <ArrowUpRight size={16} />
                </button>
              </div>
              <section className={s.summary} aria-label="Financial summary">
                <div className={s.summaryHeader}>
                  <span>
                    <Wallet size={15} /> Statement balances
                  </span>
                  <div>
                    <button
                      className={s.iconButton}
                      onClick={() => setMasked(!masked)}
                      aria-label={masked ? "Show amounts" : "Hide amounts"}
                    >
                      {masked ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                    <button
                      className={s.iconButton}
                      onClick={() => setCollapsed(!collapsed)}
                      aria-label={
                        collapsed
                          ? "Expand financial summary"
                          : "Collapse financial summary"
                      }
                    >
                      <ChevronDown
                        size={17}
                        className={collapsed ? s.chevronClosed : ""}
                      />
                    </button>
                  </div>
                </div>
                {!collapsed && (
                  <>
                    {snapshot.accounts.length ? (
                      <div className={s.balanceGrid}>
                        {snapshot.intelligence.naira && (
                          <div>
                            <span className={s.summaryLabel}>Naira · NGN</span>
                            <strong>
                              {amount(snapshot.intelligence.naira)}
                            </strong>
                            <p>Imported statements</p>
                          </div>
                        )}
                        {snapshot.accounts
                          .filter(
                            (account) =>
                              account.currency !== "NGN" ||
                              !snapshot.intelligence.naira,
                          )
                          .map((account) => (
                            <div key={account.id}>
                              <span className={s.summaryLabel}>
                                {account.label} · {account.currency}
                              </span>
                              <strong>{amount(account.amount)}</strong>
                              <p>
                                Statement ·{" "}
                                {account.asOf
                                  ? date(account.asOf)
                                  : "Balance unavailable"}
                              </p>
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className={s.balanceEmpty}>
                        <span className={s.accountIcon}>
                          <Wallet size={23} strokeWidth={1.4} />
                        </span>
                        <div>
                          <h2>No statements yet</h2>
                          <p>Add a statement to see your money here.</p>
                        </div>
                        <button
                          className={s.secondary}
                          onClick={() => setModal("account")}
                        >
                          <Plus size={15} /> Add account
                        </button>
                      </div>
                    )}
                    <div className={s.summaryFooter}>
                      <span>
                        <span className={s.tinyDot} />
                        {snapshot.accounts.length
                          ? `${snapshot.accounts.length} imported ${snapshot.accounts.length === 1 ? "account" : "accounts"} · historical records`
                          : "Accounts"}
                      </span>
                      <button onClick={() => navigate("Accounts")}>
                        View accounts <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </>
                )}
              </section>
              <div className={s.overviewGrid}>
                <section className={s.homeAsk} aria-label="Ask AGUS">
                  <div className={s.askTitle}>
                    <Companion />
                    <h2>AGUS</h2>
                  </div>
                  {paymentPlans.find(
                    (plan) =>
                      !["confirmed", "cancelled", "failed"].includes(
                        plan.state,
                      ),
                  ) &&
                    (() => {
                      const plan = paymentPlans.find(
                        (p) =>
                          !["confirmed", "cancelled", "failed"].includes(
                            p.state,
                          ),
                      )!;
                      return (
                        <div className={s.nextPayment}>
                          <span className={s.pill}>
                            {plan.state.replaceAll("_", " ")}
                          </span>
                          <h3>{plan.recipientLabel || "Payment draft"}</h3>
                          <strong>
                            {masked
                              ? "••••••"
                              : `${plan.amount ?? "—"} ${plan.asset ?? ""}`}
                          </strong>
                          <button
                            className={s.primary}
                            onClick={() => setSelectedPayment(plan)}
                          >
                            Review payment <ArrowRight size={16} />
                          </button>
                        </div>
                      );
                    })()}
                  <form
                    className={s.homeComposer}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (homeMessage.trim()) {
                        startChat("", homeMessage.trim());
                        setHomeMessage("");
                      }
                    }}
                  >
                    <input
                      aria-label="Ask AGUS"
                      placeholder="Ask a question or describe a payment…"
                      value={homeMessage}
                      onChange={(e) => setHomeMessage(e.target.value)}
                      maxLength={4000}
                    />
                    <button
                      className={s.sendButton}
                      aria-label="Start conversation"
                      disabled={!homeMessage.trim()}
                    >
                      <ArrowUp size={20} />
                    </button>
                  </form>
                  <div className={s.quickActions}>
                    <button onClick={() => startChat("Send ")}>
                      <ArrowUpRight size={17} />
                      <span>Send money</span>
                    </button>
                    <button onClick={() => openInvoiceForm()}>
                      <ArrowDownLeft size={17} />
                      <span>Request payment</span>
                    </button>
                    <button
                      onClick={() => {
                        setPrivacyMode(true);
                        startChat("Send privately ");
                      }}
                    >
                      <ShieldCheck size={17} />
                      <span>Private payment</span>
                    </button>
                  </div>
                </section>
                {pending.length > 0 && (
                  <section
                    className={s.pendingBar}
                    aria-label="Pending payments"
                  >
                    <Clock3 size={18} />
                    <span>
                      {pending.length}{" "}
                      {pending.length === 1
                        ? "payment request"
                        : "payment requests"}{" "}
                      awaiting payment
                    </span>
                    <button
                      className={s.textButton}
                      onClick={() => setSelected(pending[0].invoiceId)}
                    >
                      View <ArrowRight size={14} />
                    </button>
                  </section>
                )}
                <section className={s.homeObligations}>
                  <div className={s.sectionHead}>
                    <h2>Upcoming</h2>
                    <button
                      className={s.textButton}
                      onClick={() => navigate("Obligations")}
                    >
                      View all <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {outstanding.length ? (
                    outstanding
                      .slice(0, 3)
                      .map((item) => (
                        <InvoiceRow
                          key={item.id}
                          invoice={item}
                          masked={masked}
                          onClick={() => setSelected(item.id)}
                        />
                      ))
                  ) : (
                    <button
                      className={s.addObligationRow}
                      onClick={() => openInvoiceForm()}
                    >
                      <span className={s.activityIcon}>
                        <Plus size={19} />
                      </span>
                      <span>
                        Add an obligation
                        <small>Keep track of what’s owed.</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  )}
                </section>
              </div>
            </>
          )}
          {tab === "Obligations" && (
            <>
              <PageHeading
                title="Obligations"
                action={
                  <button
                    className={s.primary}
                    onClick={() => openInvoiceForm()}
                  >
                    <Plus size={16} /> New obligation
                  </button>
                }
              />
              <div className={s.statStrip}>
                <div>
                  <span>Owed to you</span>
                  <strong>
                    {
                      snapshot.invoices.filter(
                        (i) =>
                          i.direction === "receivable" && i.state === "open",
                      ).length
                    }
                    <small>open invoices</small>
                  </strong>
                </div>
                <div>
                  <span>You owe</span>
                  <strong>
                    {
                      snapshot.invoices.filter(
                        (i) => i.direction === "payable" && i.state === "open",
                      ).length
                    }
                    <small>commitments</small>
                  </strong>
                </div>
                <div>
                  <span>Verified settlements</span>
                  <strong>
                    {
                      snapshot.invoices.filter((i) => i.state === "settled")
                        .length
                    }
                    <small>receiving evidence</small>
                  </strong>
                </div>
              </div>
              <div className={s.filters} aria-label="Filter obligations">
                {[
                  ["all", "All obligations"],
                  ["receivable", "Owed to you"],
                  ["payable", "You owe"],
                  ["settled", "Settled"],
                ].map(([key, label]) => (
                  <button
                    className={filter === key ? s.filterActive : ""}
                    key={key}
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                  >
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <section className={s.panel}>
                {visibleInvoices.length ? (
                  visibleInvoices.map((item) => (
                    <InvoiceRow
                      key={item.id}
                      invoice={item}
                      masked={masked}
                      onClick={() => setSelected(item.id)}
                    />
                  ))
                ) : (
                  <Empty
                    title="No obligations yet"
                    text="Track money owed to you or by you."
                  >
                    <button
                      className={s.primary}
                      onClick={() => openInvoiceForm()}
                    >
                      Create an obligation <Plus size={16} />
                    </button>
                    <button
                      className={s.textButton}
                      onClick={() => openInvoiceForm(true)}
                    >
                      Try a sample invoice <ArrowUpRight size={14} />
                    </button>
                  </Empty>
                )}
              </section>
              {!!tasks.length && (
                <section className={s.panel}>
                  <div className={s.sectionHead}>
                    <h2>Responsibility reminders</h2>
                    <span className={s.pill}>In-app only</span>
                  </div>
                  <p className={s.muted}>
                    Reminders are prepared with your invoice. Approve each one
                    to enable it.
                  </p>
                  {tasks.slice(0, 20).map((task) => (
                    <div
                      className={s.taskRow}
                      key={task.id}
                      data-reminder-id={task.id}
                    >
                      <div>
                        <strong>{task.title}</strong>
                        <small>
                          {date(task.dueAt)} · {task.state.replaceAll("_", " ")}
                          <br />
                          Created {date(task.createdAt, true)} ·{" "}
                          {task.id.slice(-8)}
                        </small>
                      </div>
                      {task.state === "awaiting_approval" && (
                        <button
                          disabled={busy}
                          className={s.secondary}
                          onClick={() =>
                            void action(() =>
                              productApi("agent-workspace", {
                                action: "approve",
                                id: task.id,
                                version: task.version,
                                acknowledged: true,
                              }),
                            )
                          }
                        >
                          Enable reminder
                        </button>
                      )}
                      {task.state === "active" && (
                        <button
                          disabled={busy}
                          className={s.textButton}
                          onClick={() =>
                            void action(() =>
                              productApi("agent-workspace", {
                                action: "pause",
                                id: task.id,
                                version: task.version,
                                acknowledged: true,
                              }),
                            )
                          }
                        >
                          Pause
                        </button>
                      )}
                      {task.state === "paused" && (
                        <button
                          disabled={busy}
                          className={s.textButton}
                          onClick={() =>
                            void action(() =>
                              productApi("agent-workspace", {
                                action: "resume",
                                id: task.id,
                                version: task.version,
                                acknowledged: true,
                              }),
                            )
                          }
                        >
                          Resume
                        </button>
                      )}
                      {["awaiting_approval", "active", "paused"].includes(
                        task.state,
                      ) && (
                        <button
                          className={s.textButton}
                          disabled={busy}
                          onClick={() => {
                            setCancelError("");
                            setCancelTask(task);
                          }}
                        >
                          Cancel reminder
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {tab === "Accounts" && (
            <>
              <PageHeading
                title="Accounts & wallets"
                action={
                  <button
                    className={s.primary}
                    onClick={() => setModal("account")}
                  >
                    <Plus size={16} /> Add account
                  </button>
                }
              />
              <button className={s.bankComingSoon} disabled>
                <LockKeyhole size={17} />
                <span>Link bank account</span>
                <small>Coming soon</small>
              </button>
              <section className={s.panel}>
                <div className={s.sectionHead}>
                  <h2>Imported accounts</h2>
                  <a href="/api/product/export" className={s.textButton}>
                    <Download size={15} /> Export transactions
                  </a>
                </div>
                {snapshot.accounts.length ? (
                  snapshot.accounts.map((account) => (
                    <div className={s.accountRow} key={account.id}>
                      <span className={s.accountIcon}>
                        <Wallet size={20} />
                      </span>
                      <div>
                        <strong>{account.label}</strong>
                        <small>
                          {account.institution} · {account.maskedNumber} ·{" "}
                          {account.currency}
                        </small>
                        <small>
                          {account.confidence} ·{" "}
                          {account.asOf
                            ? `as of ${date(account.asOf)}`
                            : "balance unavailable"}
                          {account.stale ? " · stale" : ""}
                        </small>
                      </div>
                      <strong>{amount(account.amount)}</strong>
                      <button
                        className={s.iconButton}
                        onClick={() => {
                          setModal("import");
                          notify(
                            "Choose this account in the import form to update it.",
                          );
                        }}
                        aria-label={`Update ${account.label}`}
                      >
                        <Plus size={17} />
                      </button>
                    </div>
                  ))
                ) : (
                  <Empty
                    icon={Wallet}
                    title="Add your first account"
                    text="Start with a statement."
                  >
                    <button
                      className={s.secondary}
                      onClick={() => setModal("import")}
                    >
                      <FileText size={15} /> Import a statement
                    </button>
                  </Empty>
                )}
              </section>
              <div className={s.twoColumns}>
                <div
                  id="agus-pollar-wallet"
                  role="region"
                  aria-label="Pollar wallet"
                  className={s.walletDestination}
                  tabIndex={-1}
                >
                  <PollarWallet config={snapshot.capabilities.pollar} />
                </div>
                <section
                  className={s.walletPanel}
                  id="agus-zcash-wallet"
                  aria-label="Zcash receiving"
                  tabIndex={-1}
                >
                  <div className={s.sectionHead}>
                    <span className={s.railTitle}>
                      <ShieldCheck size={19} /> Zcash
                    </span>
                    <span className={s.pill}>Testnet</span>
                  </div>
                  <p className={s.muted}>
                    Receive ZEC · Unified / Orchard or Sapling Testnet.
                  </p>
                  <ZcashNetwork />
                  <div className={s.notice}>
                    {snapshot.capabilities.zcash.verificationConfigured
                      ? "Receiving verification configured · 3 confirmations required."
                      : "Receiving requests available. Wallet verification is not configured."}
                  </div>
                  <button
                    className={s.secondary}
                    onClick={() => openInvoiceForm(false, "ZEC")}
                  >
                    Create a ZEC request <ArrowUpRight size={15} />
                  </button>
                  <button className={s.secondary} disabled>
                    <LockKeyhole size={14} /> Send ZEC · unavailable
                  </button>
                  <p className={s.fine}>
                    No sender adapter is connected. Receiving requests do not
                    authorize sending.
                  </p>
                </section>
              </div>

              {!!snapshot.intelligence.warnings.length && (
                <div className={s.notice}>
                  <div>
                    {snapshot.intelligence.warnings.map((warning) => (
                      <p key={warning}>{warning}</p>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {tab === "Activity" && (
            <>
              <PageHeading title="Activity" />
              <section className={s.panel}>
                <div className={s.sectionHead}>
                  <h2>Recent activity</h2>
                  <span className={s.pill}>
                    {snapshot.events.length} events
                  </span>
                </div>
                {snapshot.events.length ? (
                  snapshot.events.map((event) => (
                    <div className={s.activityRow} key={event.id}>
                      <span className={s.activityIcon}>
                        {event.kind === "payment.confirmed" ? (
                          <CheckCheck size={18} />
                        ) : event.kind.includes("statement") ? (
                          <FileText size={18} />
                        ) : (
                          <Clock3 size={18} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {event.kind.replaceAll(".", " ").replaceAll("_", " ")}
                        </strong>
                        <p>{event.text}</p>
                        <small>{date(event.at, true)}</small>
                      </div>
                      {event.invoiceId && (
                        <button
                          className={s.iconButton}
                          aria-label="View related invoice"
                          onClick={() => setSelected(event.invoiceId)}
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      )}
                      {event.paymentPlanId && (
                        <button
                          className={s.iconButton}
                          aria-label="View payment review"
                          onClick={() => void openPayment(event.paymentPlanId!)}
                        >
                          <ArrowUpRight size={17} />
                        </button>
                      )}
                    </div>
                  ))
                ) : (
                  <Empty icon={Clock3} title="No activity yet" />
                )}
              </section>
              {!!snapshot.transactions.length && (
                <section className={s.panel}>
                  <div className={s.sectionHead}>
                    <h2>Imported transactions</h2>
                    <a className={s.textButton} href="/api/product/export">
                      Export CSV <Download size={14} />
                    </a>
                  </div>
                  {snapshot.transactions.map((tx) => (
                    <div className={s.transactionRow} key={tx.id}>
                      <span className={s.activityIcon}>
                        {tx.amount.includes("-") ? (
                          <ArrowUpRight size={17} />
                        ) : (
                          <ArrowDownLeft size={17} />
                        )}
                      </span>
                      <div>
                        <strong>{tx.description}</strong>
                        <small>
                          {date(tx.postedAt)} · {tx.category}
                          {tx.internal
                            ? " · internal transfer excluded from spending"
                            : ""}
                        </small>
                      </div>
                      <strong>{amount(tx.amount)}</strong>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {tab === "Assistant" && (
            <Assistant
              launch={chatLaunch}
              snapshot={snapshot}
              refresh={refresh}
              privacyMode={privacyMode}
              setPrivacyMode={setPrivacyMode}
              onReceiveZcash={() => {
                setPrivacyMode(true);
                openInvoiceForm(false, "ZEC");
              }}
            />
          )}
          {tab === "Settings" && (
            <>
              <PageHeading title="Settings" />
              <section className={s.panel}>
                <h2>Privacy & session</h2>
                <div className={s.settingRow}>
                  <div>
                    <strong>Mask sensitive amounts</strong>
                    <p>Hide values across your financial picture.</p>
                  </div>
                  <button
                    className={s.toggle}
                    role="switch"
                    aria-checked={masked}
                    aria-label="Mask sensitive amounts"
                    onClick={() => setMasked(!masked)}
                  >
                    <span className={masked ? s.toggleOn : ""} />
                  </button>
                </div>
                <div className={s.settingRow}>
                  <div>
                    <strong>Private operator session</strong>
                    <p>
                      This prototype has one operator identity. People using the
                      same login share saved records. Sessions expire after one
                      hour.
                    </p>
                  </div>
                  <LockKeyhole size={20} />
                </div>
                <div className={s.settingRow}>
                  <div>
                    <strong>Sign out</strong>
                    <p>Revoke this session on the server.</p>
                  </div>
                  <button
                    className={s.secondary}
                    onClick={() =>
                      void action(async () => {
                        await productApi("session", undefined, "DELETE");
                        clearPollarSession();
                        setPhase("out");
                        setSnapshot(undefined);
                      })
                    }
                  >
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              </section>
              <section className={s.panel}>
                <div className={s.settingRow}>
                  <div>
                    <strong>Getting started</strong>
                    <p>Choose your first action.</p>
                  </div>
                  <button
                    className={s.secondary}
                    onClick={() => setReplayOnboarding(true)}
                  >
                    Explore AGUS
                  </button>
                </div>
              </section>
              <section className={s.panel}>
                <h2>Connection status</h2>
                {[
                  ["Nigerian bank connectivity", "Coming Soon"],
                  [
                    "Pollar · official SDK 0.12.0",
                    snapshot.capabilities.pollar.configured
                      ? "Configured · testnet"
                      : "Testnet key / issuer required",
                  ],
                  [
                    "Zcash · ZIP 321 requests",
                    "Available · Unified / Sapling testnet",
                  ],
                  [
                    "Zcash receiving evidence",
                    snapshot.capabilities.zcash.verificationConfigured
                      ? "Configured · not yet verified"
                      : "Receiving-wallet RPC required",
                  ],
                  [
                    "Personal agent",
                    snapshot.capabilities.ai.configured
                      ? `${snapshot.capabilities.ai.provider} configured · calls can fail`
                      : `Unavailable · ${snapshot.capabilities.ai.unavailableReason ?? "Check server configuration"}`,
                  ],
                  ["Mainnet payments", "Disabled in this workspace"],
                ].map(([label, status]) => (
                  <div className={s.settingRow} key={label}>
                    <strong>{label}</strong>
                    <span className={s.muted}>{status}</span>
                  </div>
                ))}
              </section>
              <div className={s.notice}>
                <span>
                  Configure sponsor credentials through the server environment.
                  The app never asks for a wallet seed or viewing key. Pollar
                  and Zcash are independent pathways.
                </span>
              </div>
              <details className={s.networkDetails}>
                <summary>Network details</summary>
                <p className={s.fine}>
                  Zcash Testnet · public network connection only.
                </p>
                <button
                  className={s.textButton}
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      const health = await productApi<{
                        live: boolean;
                        tipHeight: number;
                      }>("product/zcash-network");
                      setNetworkStatus(
                        health.live
                          ? `Connected · block ${health.tipHeight.toLocaleString("en-NG")}`
                          : "Network unavailable",
                      );
                    })
                  }
                >
                  Check Zcash connection <RefreshCw size={13} />
                </button>
                {networkStatus && <p role="status">{networkStatus}</p>}
              </details>
              <Link className={s.legacyLink} href="/devnet">
                Solana Devnet <ArrowUpRight size={14} />
              </Link>
              <Link className={s.legacyLink} href="/conversation">
                Open the existing full agent workspace{" "}
                <ArrowUpRight size={14} />
              </Link>
            </>
          )}
        </main>
      </div>
      {tab !== "Assistant" && (
        <button
          className={s.companionDock}
          onClick={() => setContextOpen(true)}
          aria-label="Open AGUS"
        >
          <Companion
            state={privacyMode ? "privacy" : busy ? "analyzing" : "idle"}
          />
          <span>Ask AGUS</span>
          <ArrowRight size={16} />
        </button>
      )}
      <nav className={s.mobileNav} aria-label="Mobile navigation">
        {navigation.map(({ name, label, icon: Icon }) => (
          <button
            key={name}
            onClick={() => navigate(name)}
            className={`${tab === name ? s.mobileActive : ""} ${name === "Assistant" ? s.mobileAgent : ""}`}
            aria-label={label}
            aria-current={tab === name ? "page" : undefined}
          >
            {name === "Assistant" ? (
              <Companion state={privacyMode ? "privacy" : "idle"} />
            ) : (
              <Icon size={20} strokeWidth={1.6} />
            )}
            <span>{name === "Assistant" ? "AGUS" : label}</span>
          </button>
        ))}
      </nav>
      {cancelTask && (
        <Dialog
          title="Cancel reminder?"
          close={() => {
            if (!cancelling.current) setCancelTask(undefined);
          }}
        >
          <p>
            <strong>{cancelTask.title}</strong>
          </p>
          <p className={s.muted}>{cancelTask.objective}</p>
          <p className={s.fine}>
            Due{" "}
            {new Date(cancelTask.dueAt).toLocaleString("en-NG", {
              timeZone: "Africa/Lagos",
            })}{" "}
            WAT · {cancelTask.id.slice(-8)}
          </p>
          <p>This stops this reminder. The saved record remains.</p>
          {cancelError && (
            <p className={s.error} role="alert">
              {cancelError}
            </p>
          )}
          <div className={s.buttonRow}>
            <button
              className={s.secondary}
              disabled={busy}
              onClick={() => setCancelTask(undefined)}
            >
              Keep reminder
            </button>
            <button
              className={s.primary}
              disabled={busy}
              onClick={async () => {
                if (cancelling.current) return;
                cancelling.current = true;
                setBusy(true);
                setCancelError("");
                try {
                  const saved = await productApi<{ result: Responsibility }>(
                    "agent-workspace",
                    {
                      action: "cancel",
                      id: cancelTask.id,
                      version: cancelTask.version,
                      acknowledged: true,
                    },
                  );
                  setTasks((old) =>
                    old.map((t) =>
                      t.id === saved.result.id ? saved.result : t,
                    ),
                  );
                  setCancelTask(undefined);
                  notify("Reminder cancelled");
                  await refresh();
                } catch (e) {
                  setCancelError(
                    e instanceof Error
                      ? e.message
                      : "Cancellation could not be confirmed. Refresh and review the record.",
                  );
                } finally {
                  cancelling.current = false;
                  setBusy(false);
                }
              }}
            >
              Cancel reminder
            </button>
          </div>
        </Dialog>
      )}
      {contextOpen && tab !== "Assistant" && (
        <Dialog
          title={`AGUS · ${navigation.find((item) => item.name === tab)?.label ?? tab}`}
          close={() => setContextOpen(false)}
        >
          <div className={s.contextAssistant}>
            <button
              className={s.textButton}
              onClick={() => {
                setContextOpen(false);
                startChat();
              }}
            >
              Open full conversation <ArrowUpRight size={16} />
            </button>
            <Assistant
              snapshot={snapshot}
              refresh={refresh}
              privacyMode={privacyMode}
              setPrivacyMode={setPrivacyMode}
              onReceiveZcash={() => {
                setContextOpen(false);
                setPrivacyMode(true);
                openInvoiceForm(false, "ZEC");
              }}
            />
          </div>
        </Dialog>
      )}
      {toast && (
        <div className={s.toast} role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {(!snapshot.preferences.onboardingCompleted || replayOnboarding) && (
        <Dialog title="Welcome to AGUS" close={() => void finishOnboarding()}>
          <div className={s.onboarding}>
            <Companion large />
            <p>Where would you like to start?</p>
            <div className={s.onboardingActions}>
              <button
                disabled={onboardingBusy}
                onClick={() => void finishOnboarding("chat")}
              >
                <MessageCircle size={22} />
                <span>
                  Talk to AGUS<small>Ask about your money.</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <button
                disabled={onboardingBusy}
                onClick={() => void finishOnboarding("payment")}
              >
                <ArrowUpRight size={22} />
                <span>
                  Make a payment<small>Start with a name and amount.</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
              <button
                disabled={onboardingBusy}
                onClick={() => void finishOnboarding("obligation")}
              >
                <Layers3 size={22} />
                <span>
                  Keep track of what’s owed
                  <small>Add your first obligation.</small>
                </span>
                <ArrowUpRight size={18} />
              </button>
            </div>
            {onboardingError && (
              <p className={s.error} role="alert">
                {onboardingError}
              </p>
            )}
            <button
              className={s.textButton}
              disabled={onboardingBusy}
              onClick={() => void finishOnboarding()}
            >
              Skip for now <ArrowRight size={14} />
            </button>
          </div>
        </Dialog>
      )}
      {modal === "account" && (
        <Dialog title="Add account" close={() => setModal(null)}>
          <div className={s.accountChoices}>
            <button onClick={() => showWallet("pollar")}>
              <Wallet size={22} />
              <span>
                <strong>Connect crypto wallet</strong>
                <small>Pollar · Stellar testnet</small>
              </span>
              <ArrowUpRight size={18} />
            </button>
            <button onClick={() => setModal("import")}>
              <FileText size={22} />
              <span>
                <strong>Import bank statement</strong>
                <small>CSV · Historical records</small>
              </span>
              <ArrowRight size={18} />
            </button>
            <button disabled>
              <LockKeyhole size={22} />
              <span>
                <strong>Link Nigerian bank</strong>
                <small>Coming soon · No live bank connection</small>
              </span>
            </button>
            <button onClick={() => showWallet("zcash")}>
              <ShieldCheck size={22} />
              <span>
                <strong>Zcash receiving options</strong>
                <small>Testnet requests · No wallet import</small>
              </span>
              <ArrowUpRight size={18} />
            </button>
          </div>
        </Dialog>
      )}
      {modal === "invoice" && (
        <Dialog
          title={sample ? "Try a sample invoice" : "New obligation"}
          eyebrow="NEW OBLIGATION"
          close={() => setModal(null)}
        >
          <InvoiceForm
            sample={sample}
            initialCurrency={invoiceCurrency}
            onSave={async (input) => {
              const saved = await productApi<Invoice>(
                "product/invoices",
                input,
              );
              await refresh();
              setModal(null);
              setSelected(saved.id);
              notify("Obligation saved");
            }}
          />
        </Dialog>
      )}
      {modal === "import" && (
        <Dialog
          title="Import statement"
          eyebrow="STATEMENT IMPORT"
          close={() => setModal(null)}
        >
          <StatementForm
            snapshot={snapshot}
            onSaved={async (message) => {
              await refresh();
              setModal(null);
              notify(message);
            }}
          />
        </Dialog>
      )}
      {modal === "help" && (
        <Dialog
          title="Your money, and what's next."
          eyebrow="AGUS 2.0"
          close={() => setModal(null)}
        >
          <div className={s.about}>
            <Companion large />
            <p>
              AGUS brings financial records, responsibilities and authorized
              actions into one conversation.
            </p>
            <p>
              This web prototype saves your data in the existing AGUS database.
              Imported balances retain their source. Payment settlement needs
              independent evidence.
            </p>
            <div className={s.notice}>
              BlockchainUNN · Intelligence Without Borders
              <br />
              Pollar: Stellar wallet onboarding and testnet payments.
              <br />
              Zcash: shielded payment requests and receiving-wallet
              verification.
            </div>
            <p className={s.fine}>
              No live Nigerian bank connection or real-money mainnet payment is
              available here.
            </p>
          </div>
        </Dialog>
      )}
      {invoice && (
        <Dialog
          title={invoice.title}
          eyebrow={
            invoice.state === "settled"
              ? "VERIFIED SETTLEMENT"
              : invoice.direction === "receivable"
                ? "OWED TO YOU"
                : "YOUR COMMITMENT"
          }
          close={() => setSelected(undefined)}
        >
          <InvoiceDetails
            invoice={invoice}
            snapshot={snapshot}
            masked={masked}
            refresh={refresh}
            copy={copy}
            tasks={tasks}
            openPayment={openPayment}
          />
        </Dialog>
      )}
      {selectedPayment && (
        <Dialog
          title={selectedPayment.privacy ? "Private payment" : "Review payment"}
          close={() => setSelectedPayment(undefined)}
        >
          <PaymentReview
            key={selectedPayment.id}
            plan={selectedPayment}
            snapshot={snapshot}
            onChange={(plan) => {
              setSelectedPayment(plan);
              void refresh();
            }}
          />
        </Dialog>
      )}
    </div>
  );
}

function PageHeading({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className={s.pageHeading}>
      <div>
        {eyebrow && <p className={s.eyebrow}>{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className={s.subtitle}>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
function InvoiceRow({
  invoice,
  masked,
  onClick,
}: {
  invoice: Invoice;
  masked: boolean;
  onClick: () => void;
}) {
  const overdue =
    invoice.state === "open" && Date.parse(invoice.dueAt) < Date.now();
  return (
    <button className={s.invoiceRow} onClick={onClick}>
      <span className={s.invoiceAvatar}>{initial(invoice.counterparty)}</span>
      <span className={s.invoiceInfo}>
        <strong>{invoice.title}</strong>
        <small>
          {invoice.counterparty} ·{" "}
          {invoice.direction === "receivable" ? "Owed to you" : "You owe"}
        </small>
      </span>
      <span className={s.invoiceAmount}>
        <strong>{masked ? "••••••" : displayAmount(invoice)}</strong>
        <small>
          {invoice.state === "settled"
            ? "Verified · testnet"
            : `${overdue ? "Overdue" : "Due"} ${date(invoice.dueAt)}`}
        </small>
      </span>
      <ChevronRight size={16} />
    </button>
  );
}

function SignIn({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className={s.root}>
      <div className={s.signIn}>
        <section className={s.signInStory}>
          <Brand />
          <div>
            <Companion large />
            <p className={s.eyebrow}>YOUR PERSONAL FINANCIAL AGENT</p>
            <h1>
              Your money,
              <br />
              and <span>what&apos;s next.</span>
            </h1>
          </div>
          <footer>
            <span>AGUS</span>
          </footer>
        </section>
        <section className={s.signInForm}>
          <div>
            <span className={s.pill}>
              <LockKeyhole size={12} /> Private workspace
            </span>
            <h2>Welcome back.</h2>
            <form
              className={s.form}
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                setBusy(true);
                setError("");
                try {
                  await productApi("session", { password });
                  setPassword("");
                  await onSuccess();
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "Sign-in unavailable",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Operator password
                <div className={s.passwordInput}>
                  <input
                    type={visible ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    maxLength={256}
                  />
                  <button
                    className={s.iconButton}
                    type="button"
                    aria-label={visible ? "Hide password" : "Show password"}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>
              {error && (
                <p role="alert" className={s.error}>
                  {error}
                </p>
              )}
              <button className={s.primary} disabled={busy}>
                {busy ? <Loader2 className={s.spin} size={17} /> : null} Sign in
                securely <ArrowRight size={16} />
              </button>
            </form>

            <div className={s.loginDisclosure}>
              Shared preview login. Anyone using this password can see saved
              records.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function InvoiceForm({
  sample,
  initialCurrency = "USDC",
  onSave,
}: {
  sample: boolean;
  initialCurrency?: InvoiceInput["currency"];
  onSave: (input: InvoiceInput) => Promise<void>;
}) {
  const [currency, setCurrency] = useState<string>(initialCurrency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const values = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    requestId.current ??= crypto.randomUUID();
    try {
      await onSave({
        id: requestId.current,
        title: String(values.get("title")),
        counterparty: String(values.get("counterparty")),
        direction: values.get("direction") as InvoiceInput["direction"],
        currency: currency as InvoiceInput["currency"],
        amount: String(values.get("amount")),
        dueAt: new Date(`${values.get("due")}T12:00:00+01:00`).toISOString(),
        note: String(values.get("note")),
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save this obligation.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className={s.form} onSubmit={(e) => void submit(e)}>
      {sample && (
        <div className={s.notice}>
          Fictional example for the demo. Review and save it yourself; no
          payment has happened.
        </div>
      )}
      <label>
        What’s it for?
        <input
          name="title"
          placeholder="e.g. Brand identity project"
          required
          maxLength={120}
          defaultValue={sample ? "Brand identity · demo invoice" : ""}
        />
      </label>
      <label>
        Who’s it with?
        <input
          name="counterparty"
          placeholder="Client or person’s name"
          required
          maxLength={100}
          defaultValue={sample ? "Example Studio (fictional)" : ""}
        />
      </label>
      <label>
        Direction
        <select
          aria-label="Direction"
          name="direction"
          defaultValue="receivable"
        >
          <option value="receivable">Owed to you · receivable</option>
          <option value="payable">You owe · commitment</option>
        </select>
      </label>
      <div className={s.formGrid}>
        <label>
          Amount
          <input
            name="amount"
            inputMode="decimal"
            placeholder="0.00"
            required
            pattern="[0-9]+(\.[0-9]{1,8})?"
            defaultValue={sample ? "5" : ""}
          />
        </label>
        <label>
          Asset
          <select
            aria-label="Asset"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            <option value="USDC">USDC · Pollar testnet</option>
            <option value="ZEC">ZEC · Zcash testnet</option>
            <option value="NGN">NGN · record only</option>
          </select>
        </label>
      </div>
      <label>
        Due date · Lagos time
        <input
          type="date"
          name="due"
          required
          defaultValue={new Date(Date.now() + 7 * 86400000)
            .toISOString()
            .slice(0, 10)}
        />
      </label>
      <label>
        Anything to remember? <small>Optional</small>
        <textarea
          name="note"
          rows={3}
          maxLength={500}
          placeholder="The agreement, a milestone, or useful context."
        />
      </label>
      <div className={s.notice}>
        <LockKeyhole size={16} />
        <span>
          Saving creates a record and prepares an in-app reminder for your
          review. It does not authorize a payment.
        </span>
      </div>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <button className={s.primary} disabled={busy}>
        {busy ? <Loader2 className={s.spin} size={17} /> : <Plus size={16} />}{" "}
        Save obligation
      </button>
    </form>
  );
}

function StatementForm({
  snapshot,
  onSaved,
}: {
  snapshot: ProductSnapshot;
  onSaved: (message: string) => Promise<void>;
}) {
  const [existing, setExisting] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const account = snapshot.accounts.find((a) => a.id === existing);
  return (
    <form
      className={s.form}
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        const form = new FormData(e.currentTarget);
        const file = form.get("file");
        if (!(file instanceof File) || !file.size || file.size > 500000) {
          setError("Choose a CSV file up to 500 KB.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          const result = await productApi<{
            imported: number;
            duplicates: number;
            warnings: string[];
          }>("product/statements", {
            ...(existing ? { accountId: existing } : {}),
            institution: account?.institution ?? form.get("institution"),
            label: account?.label ?? form.get("label"),
            lastFour: account?.maskedNumber.slice(-4) ?? form.get("lastFour"),
            currency: account?.currency ?? form.get("currency"),
            fileName: file.name,
            content: await file.text(),
          });
          await onSaved(
            `${result.imported} transactions imported; ${result.duplicates} duplicates skipped.${result.warnings.length ? ` ${result.warnings.length} import warnings; review your account records.` : ""}`,
          );
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Statement import failed.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className={s.notice}>
        Use CSV statements you are authorized to import. These files are parsed
        locally on the AGUS server; they are not sent to an AI model.
      </div>
      <label>
        Account
        <select value={existing} onChange={(e) => setExisting(e.target.value)}>
          <option value="">Add a new imported account</option>
          {snapshot.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} · {a.maskedNumber}
            </option>
          ))}
        </select>
      </label>
      {!existing && (
        <>
          <label>
            Account label
            <input
              name="label"
              placeholder="e.g. Main spending account"
              required
              maxLength={100}
            />
          </label>
          <label>
            Institution
            <input
              name="institution"
              placeholder="e.g. GTBank"
              required
              maxLength={100}
            />
          </label>
          <div className={s.formGrid}>
            <label>
              Last four digits
              <input
                name="lastFour"
                inputMode="numeric"
                required
                pattern="[0-9]{4}"
                maxLength={4}
                placeholder="1234"
              />
            </label>
            <label>
              Currency
              <select aria-label="Currency" name="currency">
                <option>NGN</option>
                <option>USD</option>
                <option>USDC</option>
                <option>EUR</option>
                <option>GBP</option>
              </select>
            </label>
          </div>
        </>
      )}
      <label>
        CSV statement
        <input type="file" name="file" accept=".csv,text/csv" required />
      </label>
      <p className={s.fine}>
        Supported columns include date, description, debit/credit or amount, and
        balance. Import to the same account to deduplicate overlapping
        statements.
      </p>
      <a className={s.textButton} href="/demo/sample-statement.csv" download>
        <Download size={15} /> Download a fictional sample CSV
      </a>
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <button className={s.primary} disabled={busy}>
        {busy ? (
          <Loader2 className={s.spin} size={16} />
        ) : (
          <FileText size={16} />
        )}{" "}
        Import statement
      </button>
    </form>
  );
}

function InvoiceDetails({
  invoice,
  snapshot,
  masked,
  refresh,
  copy,
  tasks,
  openPayment,
}: {
  invoice: Invoice;
  snapshot: ProductSnapshot;
  masked: boolean;
  refresh: () => Promise<void>;
  copy: (text: string) => Promise<void>;
  tasks: Responsibility[];
  openPayment: (id: string) => Promise<void>;
}) {
  const task = tasks.find((item) => item.id === invoice.responsibilityId);
  const requests = snapshot.requests.filter((r) => r.invoiceId === invoice.id);
  const active = requests.find(
    (r) => r.state === "pending" || r.state === "confirmed",
  );
  const [showCreate, setShowCreate] = useState(false);
  const [recipient, setRecipient] = useState(
    invoice.currency === "ZEC"
      ? (snapshot.capabilities.zcash.receivingAddress ?? "")
      : "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef<string | null>(null);
  const [selectedRail, setSelectedRail] = useState<"pollar-stellar" | "zcash">(
    invoice.currency === "ZEC" ? "zcash" : "pollar-stellar",
  );
  return (
    <div className={s.detail}>
      <div className={s.detailAmount}>
        <span>{invoice.counterparty}</span>
        <strong>{masked ? "••••••" : displayAmount(invoice)}</strong>
        <span className={s.pill}>
          {invoice.state === "settled" ? "Verified · testnet" : "Outstanding"}
        </span>
      </div>
      <dl className={s.definition}>
        <div>
          <dt>Due date</dt>
          <dd>{date(invoice.dueAt, true)}</dd>
        </div>
        <div>
          <dt>Direction</dt>
          <dd>
            {invoice.direction === "receivable" ? "Owed to you" : "You owe"}
          </dd>
        </div>
        <div>
          <dt>Responsibility</dt>
          <dd>
            {invoice.state === "settled"
              ? "Completed with verified settlement evidence"
              : task?.state === "active"
                ? "In-app reminder enabled"
                : task?.state === "paused"
                  ? "In-app reminder paused"
                  : "Saved · reminder needs approval"}
          </dd>
        </div>
        {invoice.note && (
          <div>
            <dt>Context</dt>
            <dd>{invoice.note}</dd>
          </div>
        )}
      </dl>
      {active ? (
        <RequestDetails
          request={active}
          snapshot={snapshot}
          refresh={refresh}
          copy={copy}
        />
      ) : invoice.state === "settled" &&
        invoice.direction === "payable" &&
        invoice.settlementRequestId ? (
        <button
          className={s.primary}
          onClick={() => void openPayment(invoice.settlementRequestId!)}
        >
          View verified payment receipt <ArrowUpRight size={16} />
        </button>
      ) : invoice.state === "open" &&
        invoice.direction === "receivable" &&
        invoice.currency !== "NGN" ? (
        <>
          {!showCreate ? (
            <button className={s.primary} onClick={() => setShowCreate(true)}>
              Prepare payment request <ArrowUpRight size={16} />
            </button>
          ) : (
            <form
              className={s.form}
              onSubmit={async (e) => {
                e.preventDefault();
                if (busy) return;
                requestId.current ??= crypto.randomUUID();
                setBusy(true);
                setError("");
                try {
                  await productApi("product/requests", {
                    id: requestId.current,
                    invoiceId: invoice.id,
                    rail: selectedRail,
                    recipient,
                  });
                  await refresh();
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : "Request could not be created.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              <h3>Choose a payment pathway</h3>
              <div className={s.railChoices}>
                {[
                  ["pollar-stellar", "Pollar", "USDC · Stellar testnet"],
                  ["zcash", "Zcash", "ZEC · shielded testnet"],
                ].map(([rail, label, description]) => (
                  <label
                    className={`${s.railChoice} ${selectedRail === rail ? s.railSelected : ""}`}
                    key={rail}
                  >
                    <input
                      type="radio"
                      name="rail"
                      value={rail}
                      checked={selectedRail === rail}
                      disabled={
                        (rail === "zcash") !== (invoice.currency === "ZEC")
                      }
                      onChange={() =>
                        setSelectedRail(rail as "pollar-stellar" | "zcash")
                      }
                    />
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </label>
                ))}
              </div>
              <p className={s.fine}>
                The invoice asset selects the pathway. To request a different
                asset, create a separate invoice. No currency conversion or
                bridge is performed.
              </p>
              {selectedRail === "pollar-stellar" && (
                <PollarWallet
                  config={snapshot.capabilities.pollar}
                  onAddress={setRecipient}
                />
              )}
              <label>
                {selectedRail === "zcash"
                  ? "Your shielded testnet receiving address"
                  : "Your Stellar testnet receiving address"}
                <textarea
                  rows={3}
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                  placeholder={
                    selectedRail === "zcash"
                      ? "utest1… or ztestsapling1…"
                      : "G…"
                  }
                  required
                  maxLength={2048}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className={s.checkbox}>
                <input type="checkbox" required /> I control this receiving
                address and have selected testnet in my wallet.
              </label>
              <div className={s.notice}>
                {selectedRail === "zcash"
                  ? "The request includes a unique memo. ZIP 321 does not itself confirm receipt. Receiving-wallet evidence is required to settle the invoice."
                  : "Request creation does not send funds. The client must pay the exact asset, issuer, amount and memo."}
              </div>
              {error && (
                <p className={s.error} role="alert">
                  {error}
                </p>
              )}
              <button className={s.primary} disabled={busy}>
                {busy ? (
                  <Loader2 className={s.spin} size={16} />
                ) : (
                  <ArrowUpRight size={16} />
                )}{" "}
                Create testnet payment request
              </button>
            </form>
          )}
        </>
      ) : (
        <div className={s.notice}>
          {invoice.currency === "NGN"
            ? "This Naira obligation is a saved record. Live bank payments are Coming Soon."
            : "This commitment is saved. Payment execution still requires a supported, explicitly authorized workflow."}
        </div>
      )}
      {requests
        .filter((r) => r.id !== active?.id)
        .map((request) => (
          <div className={s.closedRequest} key={request.id}>
            <Clock3 size={16} />
            <span>Previous request · {request.state}</span>
            <small>{date(request.createdAt)}</small>
          </div>
        ))}
    </div>
  );
}

function RequestDetails({
  request,
  snapshot,
  refresh,
  copy,
}: {
  request: PaymentRequest;
  launch?: ChatLaunch;
  snapshot: ProductSnapshot;
  refresh: () => Promise<void>;
  copy: (text: string) => Promise<void>;
}) {
  const [qr, setQr] = useState("");
  const [txid, setTxid] = useState(request.candidateTransactionId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pay, setPay] = useState(false);
  const [cancelReview, setCancelReview] = useState(false);
  useEffect(() => {
    let alive = true;
    if (request.state === "pending")
      productApi<{ dataUrl: string }>(`product/requests/${request.id}/qr`)
        .then((r) => {
          if (alive) setQr(r.dataUrl);
        })
        .catch(() => {
          if (alive)
            setError(
              "QR unavailable. You can still copy the complete payment request.",
            );
        });
    return () => {
      alive = false;
    };
  }, [request.id, request.state]);
  async function verify(hash: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setTxid(hash);
    try {
      await productApi(`product/requests/${request.id}/verify`, {
        transactionId: hash,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification unavailable.");
    } finally {
      await refresh();
      setBusy(false);
    }
  }
  function download() {
    const receipt = {
      product: "AGUS",
      testnet: true,
      cashValue: "none",
      ...request,
      owner: undefined,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(receipt, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `agus-${request.state === "confirmed" ? "receipt" : "request"}-${request.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className={s.requestDetail}>
      <div className={s.sectionHead}>
        <h3>
          {request.state === "confirmed"
            ? "Receiving evidence verified"
            : "Awaiting your client’s payment"}
        </h3>
        <span className={s.pill}>
          {request.state === "confirmed" ? (
            <CheckCheck size={13} />
          ) : (
            <Clock3 size={13} />
          )}
          {request.state}
        </span>
      </div>
      <p className={s.muted}>
        {request.rail === "zcash"
          ? "Zcash · shielded testnet request"
          : "Pollar · Stellar USDC"}{" "}
        · testnet only
      </p>
      {request.rail === "zcash" && (
        <p className={s.fine}>
          Privacy depends on the paying wallet. This request is not a receipt;
          public chain data cannot verify the received amount.
        </p>
      )}
      {request.state === "pending" && (
        <>
          <div className={s.qrWrap}>
            {qr ? (
              <img
                src={qr}
                alt="Testnet payment request QR code"
                width={212}
                height={212}
              />
            ) : (
              <Loader2 size={24} className={s.spin} />
            )}
            <p>
              Scan with a compatible wallet.
              <br />
              Select the correct test network before paying.
            </p>
          </div>
          <button
            className={s.secondary}
            onClick={() => void copy(request.uri)}
          >
            <Copy size={15} /> Copy payment request
          </button>
          {request.rail === "zcash" && (
            <a className={s.textButton} href={request.uri}>
              Open in a compatible Zcash wallet <ArrowUpRight size={15} />
            </a>
          )}
        </>
      )}
      <dl className={s.definition}>
        <div>
          <dt>Receiving address</dt>
          <dd>
            <code>{request.recipient}</code>
            <button
              className={s.iconButton}
              onClick={() => void copy(request.recipient)}
              aria-label="Copy receiving address"
            >
              <Copy size={14} />
            </button>
          </dd>
        </div>
        <div>
          <dt>Exact memo</dt>
          <dd>
            <code>{request.memo}</code>
          </dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>
            {new Date(request.expiresAt).toLocaleString("en-NG", {
              timeZone: "Africa/Lagos",
            })}{" "}
            WAT
          </dd>
        </div>
        {request.issuer && (
          <div>
            <dt>USDC issuer</dt>
            <dd>
              <code>{request.issuer}</code>
            </dd>
          </div>
        )}
      </dl>
      <div className={s.timeline}>
        <div>
          <Check size={14} />
          <span>Payment request saved</span>
        </div>
        <div>
          {request.submissionStartedAt || request.candidateTransactionId ? (
            <Check size={14} />
          ) : (
            <span className={s.timelineDot} />
          )}
          <span>
            {request.submissionStartedAt
              ? "SDK send started · outcome checked separately"
              : request.candidateTransactionId
                ? "Transaction submitted for verification"
                : "Awaiting payment evidence"}
          </span>
        </div>
        <div>
          {request.evidence ? (
            <CheckCheck size={14} />
          ) : (
            <span className={s.timelineDot} />
          )}
          <span>
            {request.evidence
              ? "Receiving evidence verified · responsibility completed"
              : "Responsibility stays outstanding until verified"}
          </span>
        </div>
      </div>
      {request.evidence ? (
        <div className={s.receipt}>
          <ShieldCheck size={22} />
          <h3>
            {request.evidence.amount} {request.asset} received on testnet
          </h3>
          <p>Verified using {request.evidence.source}.</p>
          <code>{request.evidence.transactionId}</code>
          <p>
            {request.evidence.ledger
              ? `Stellar ledger ${request.evidence.ledger}`
              : `${request.evidence.confirmations} confirmations`}{" "}
            · {date(request.evidence.confirmedAt, true)}
          </p>
          <button className={s.secondary} onClick={download}>
            <Download size={15} /> Download verified receipt
          </button>
        </div>
      ) : (
        request.state === "pending" && (
          <>
            {request.rail === "pollar-stellar" && (
              <>
                <button className={s.secondary} onClick={() => setPay(!pay)}>
                  {pay ? "Close payer wallet" : "Pay with a Pollar test wallet"}
                  <Wallet size={15} />
                </button>
                {pay && (
                  <PollarWallet
                    config={snapshot.capabilities.pollar}
                    request={request}
                    onSubmitted={verify}
                  />
                )}
              </>
            )}
            <form
              className={s.form}
              onSubmit={(e) => {
                e.preventDefault();
                void verify(txid);
              }}
            >
              <label>
                Transaction ID to check
                <input
                  value={txid}
                  onChange={(e) => setTxid(e.target.value.trim())}
                  required
                  pattern="[a-fA-F0-9]{64}"
                  maxLength={64}
                  placeholder="Paste the transaction ID"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <p className={s.fine}>
                {request.rail === "zcash"
                  ? "A public ID alone cannot confirm a shielded payment. AGUS checks the authorized receiving wallet for the amount, address, memo and at least 3 confirmations."
                  : "AGUS independently checks Stellar testnet for a successful payment with the exact recipient, amount, issuer and memo."}
              </p>
              <button className={s.primary} disabled={busy}>
                {busy ? (
                  <Loader2 size={16} className={s.spin} />
                ) : (
                  <ShieldCheck size={16} />
                )}{" "}
                Check receiving evidence
              </button>
            </form>
            {request.lastCheckedAt && (
              <p className={s.fine}>
                Last check: {request.lastCheck} · {date(request.lastCheckedAt)}
              </p>
            )}
            <div className={s.detailActions}>
              <button className={s.textButton} onClick={download}>
                <Download size={14} /> Download request
              </button>
              <button
                className={s.textButton}
                onClick={() => setCancelReview(true)}
              >
                Cancel request
              </button>
            </div>
            {cancelReview && (
              <div className={s.notice}>
                <div>
                  <p>
                    Cancel this payment request? The obligation remains
                    outstanding. A client may already have its address; review
                    any late payment separately.
                  </p>
                  <button
                    className={s.secondary}
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await productApi(
                          `product/requests/${request.id}/cancel`,
                          { acknowledged: true },
                        );
                        await refresh();
                      } catch (e) {
                        setError(
                          e instanceof Error ? e.message : "Could not cancel.",
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Confirm cancellation
                  </button>
                  <button
                    className={s.textButton}
                    onClick={() => setCancelReview(false)}
                  >
                    Keep request
                  </button>
                </div>
              </div>
            )}
          </>
        )
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

function AssistantProse({ text }: { text: string }) {
  const inline = (value: string) =>
    value
      .split(/(\*\*[^*\n]+\*\*)/g)
      .map((part, index) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={index}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      );
  return (
    <div className={s.assistantProse}>
      {text.split(/\n\n+/).map((block, index) => {
        if (/^#{1,3}\s/.test(block)) {
          const [heading, ...remaining] = block.split("\n");
          return (
            <div key={index}>
              <h3>{inline(heading.replace(/^#{1,3}\s+/, ""))}</h3>
              {remaining.length > 0 && (
                <p>{inline(remaining.join("\n").replace(/^\* /gm, "• "))}</p>
              )}
            </div>
          );
        }
        const lines = block.split("\n");
        return lines.every((line) => /^[-*]\s/.test(line)) ? (
          <ul key={index}>
            {lines.map((line, item) => (
              <li key={item}>{inline(line.replace(/^[-*]\s+/, ""))}</li>
            ))}
          </ul>
        ) : (
          <p key={index}>{inline(block)}</p>
        );
      })}
    </div>
  );
}

function Assistant({
  launch,
  snapshot,
  refresh,
  privacyMode,
  setPrivacyMode,
  onReceiveZcash,
}: {
  launch?: ChatLaunch;
  snapshot: ProductSnapshot;
  refresh: () => Promise<void>;
  privacyMode: boolean;
  setPrivacyMode: (value: boolean) => void;
  onReceiveZcash?: () => void;
}) {
  const [question, setQuestion] = useState(launch?.draft ?? "");
  const launched = useRef<string | undefined>(undefined);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<
    {
      role: string;
      text: string;
      source?: string;
      id?: string;
      planId?: string;
      reply?: AgentReply;
      createdAt?: string;
    }[]
  >([]);
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlan>();
  const conversation = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const [savedChats, setSavedChats] = useState<SavedChat[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(!privacyMode);
  const [historyError, setHistoryError] = useState("");
  const [spokenReplies, setSpokenReplies] = useState(false);
  const speech = useResponseSpeech();
  const voice = useVoiceInput({
    text: question,
    onText: setQuestion,
    aiEnabled: snapshot.capabilities.ai.configured,
    disabled: busy || historyLoading,
    language: "en-NG",
    focus: () => composer.current?.focus(),
  });
  const voiceBusy =
    voice.listening || voice.requestingVoice || voice.transcribingVoice;
  const discardVoice = voice.discardVoiceCapture;
  const stopSpeech = speech.stop;
  useEffect(() => {
    discardVoice();
    stopSpeech();
  }, [privacyMode, discardVoice, stopSpeech]);
  const retryIdentity = useRef<{
    conversationId: string;
    text: string;
    id: string;
  } | null>(null);
  const inFlight = useRef(false);
  const activeChatKey = `agus.activeConversation:${snapshot.owner}`;
  const rememberChat = useCallback(
    (id: string | null) => {
      try {
        if (id) sessionStorage.setItem(activeChatKey, id);
        else sessionStorage.removeItem(activeChatKey);
      } catch {
        /* SQL history remains available when browser storage is disabled. */
      }
    },
    [activeChatKey],
  );
  const showTurns = useCallback((id: string, turns: SavedTurn[]) => {
    conversation.current = id;
    setMessages(
      turns.flatMap((turn) => [
        { role: "user", text: turn.text, createdAt: turn.createdAt },
        {
          role: "assistant",
          text: turn.reply.text,
          source: "Saved conversation",
          id,
          planId: turn.reply.digitalPaymentPlanId,
          reply: turn.reply,
        },
      ]),
    );
  }, []);
  useEffect(() => {
    let alive = true;
    if (privacyMode) {
      conversation.current = null;
      setMessages([]);
      setHistoryOpen(false);
      setHistoryLoading(false);
      setHistoryError("");
      return;
    }
    setHistoryLoading(true);
    setHistoryError("");
    void (async () => {
      try {
        const list = await productApi<{ chats: SavedChat[] }>("conversations");
        if (!alive) return;
        setSavedChats(list.chats);
        let active: string | null = null;
        try {
          active = sessionStorage.getItem(activeChatKey);
        } catch {
          /* list still works */
        }
        if (active && list.chats.some((chat) => chat.id === active)) {
          const stored = await productApi<{
            turns: SavedTurn[];
            inProgress: boolean;
          }>(`conversations?id=${encodeURIComponent(active)}`);
          if (!alive) return;
          showTurns(active, stored.turns);
          if (stored.inProgress)
            setHistoryError(
              "A saved response is still in progress. Reopen this conversation shortly.",
            );
        }
      } catch {
        if (alive)
          setHistoryError(
            "Conversations could not be loaded. Retry from the history menu.",
          );
      } finally {
        if (alive) setHistoryLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [privacyMode, activeChatKey, showTurns]);
  async function openHistory() {
    setHistoryOpen(true);
    setHistoryError("");
    try {
      const result = await productApi<{ chats: SavedChat[] }>("conversations");
      setSavedChats(result.chats);
    } catch {
      setHistoryError("Conversations could not be loaded. Try again.");
    }
  }
  async function selectChat(id: string) {
    if (busy || inFlight.current || historyLoading || voice.isVoiceLocked())
      return;
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const stored = await productApi<{
        turns: SavedTurn[];
        inProgress: boolean;
      }>(`conversations?id=${encodeURIComponent(id)}`);
      showTurns(id, stored.turns);
      rememberChat(id);
      setHistoryOpen(false);
      setQuestion("");
      setError("");
      if (stored.inProgress)
        setHistoryError(
          "A saved response is still in progress. Reopen this conversation shortly.",
        );
    } catch {
      setHistoryError(
        "This conversation could not be opened. Your current conversation is unchanged.",
      );
    } finally {
      setHistoryLoading(false);
    }
  }
  function newChat() {
    if (busy || historyLoading || voice.isVoiceLocked()) return;
    speech.stop();
    conversation.current = null;
    rememberChat(null);
    setMessages([]);
    setQuestion("");
    setError("");
    setHistoryOpen(false);
    composer.current?.focus();
  }
  const mode = useRef(privacyMode);
  useEffect(() => {
    if (mode.current !== privacyMode) {
      conversation.current = null;
      setMessages([]);
      mode.current = privacyMode;
    }
  }, [privacyMode]);
  useEffect(() => {
    let alive = true;
    productApi<{ plans: PaymentPlan[] }>("product/payment-plans")
      .then((result) => {
        if (alive) setPlans(result.plans);
      })
      .catch(() => {
        if (alive)
          setError(
            "Saved payment reviews could not be loaded. Retry by reopening the assistant.",
          );
      });
    return () => {
      alive = false;
    };
  }, [snapshot.asOf]);
  useEffect(() => {
    end.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "nearest",
    });
  }, [messages, busy]);
  async function guidance() {
    if (busy || voice.isVoiceLocked()) return;
    setBusy(true);
    setError("");
    try {
      const result = await productApi<{ text: string; source: string }>(
        "product/guidance",
      );
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: result.text,
          source: "Grounded financial snapshot · calculated from saved records",
        },
      ]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Your snapshot is unavailable.",
      );
    } finally {
      setBusy(false);
    }
  }
  const ask = useCallback(
    async (text: string) => {
      if (
        !text.trim() ||
        busy ||
        inFlight.current ||
        historyLoading ||
        voice.isVoiceLocked()
      )
        return;
      if (existingReminderRequest(messages, text)) {
        setError(
          "This request already has a saved reminder in this conversation. Review it below. To create a separate reminder, ask explicitly for another.",
        );
        return;
      }
      // A new chat must not silently duplicate an identical saved reminder.
      if (!conversation.current) {
        const normalize = (value: string) =>
          value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-NG");
        const candidates = savedChats
          .filter(
            (chat) => normalize(chat.title) === normalize(text).slice(0, 72),
          )
          .slice(0, 5);
        if (candidates.length) {
          inFlight.current = true;
          setBusy(true);
          try {
            for (const candidate of candidates) {
              const stored = await productApi<{ turns: SavedTurn[] }>(
                `conversations?id=${encodeURIComponent(candidate.id)}`,
              );
              const previous = stored.turns.flatMap((turn) => [
                { role: "user", text: turn.text, createdAt: turn.createdAt },
                { role: "assistant", text: turn.reply.text, reply: turn.reply },
              ]);
              if (existingReminderRequest(previous, text)) {
                showTurns(candidate.id, stored.turns);
                rememberChat(candidate.id);
                setError(
                  "This request already has a saved reminder. Its conversation is restored below. Ask explicitly for another to create a separate reminder.",
                );
                return;
              }
            }
          } catch {
            setError(
              "Saved reminders could not be checked. Reopen the saved conversation before repeating this request.",
            );
            return;
          } finally {
            inFlight.current = false;
            setBusy(false);
          }
        }
      }
      speech.stop();
      inFlight.current = true;
      setBusy(true);
      setError("");
      conversation.current ??= crypto.randomUUID();
      if (!privacyMode) rememberChat(conversation.current);
      setMessages((m) => [
        ...m,
        { role: "user", text, createdAt: new Date().toISOString() },
      ]);
      setQuestion("");
      try {
        if (
          !snapshot.capabilities.ai.configured &&
          looksLikePaymentIntent(text)
        ) {
          const plan = await productApi<PaymentPlan>("product/payment-plans", {
            id: crypto.randomUUID(),
            text,
            privacyMode,
          });
          setPlans((old) => [plan, ...old]);
          setSelectedPlan(plan);
          if (plan.privacy) setPrivacyMode(true);
          setMessages((old) => [
            ...old,
            {
              role: "assistant",
              text:
                plan.state === "needs_details"
                  ? "Who should receive this? Add their payment details."
                  : plan.state === "blocked"
                    ? "This payment isn’t available yet. See the review for details."
                    : "Review your payment details to continue.",
              planId: plan.id,
            },
          ]);
          return;
        }
        if (!snapshot.capabilities.ai.configured)
          throw new Error(
            "Gemini chat is not configured. Check the server connection in Settings; payment preparation and statement summaries remain available.",
          );
        if (
          retryIdentity.current?.conversationId !== conversation.current ||
          retryIdentity.current?.text !== text
        )
          retryIdentity.current = {
            conversationId: conversation.current,
            text,
            id: crypto.randomUUID(),
          };
        const result = await productApi<{ reply: AgentReply }>("conversation", {
          conversationId: conversation.current,
          requestId: retryIdentity.current.id,
          text,
          accountIds: [],
          privacyMode,
        });
        retryIdentity.current = null;
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text: result.reply.text,
            source: snapshot.capabilities.ai.provider,
            planId: result.reply.digitalPaymentPlanId,
            reply: result.reply,
            id: conversation.current!,
          },
        ]);
        if (spokenReplies)
          speech.speak(conversation.current!, result.reply.text);
        if (result.reply.digitalPaymentPlanId) {
          const plan = await productApi<PaymentPlan>(
            `product/payment-plans/${result.reply.digitalPaymentPlanId}`,
          );
          setSelectedPlan(plan);
          if (plan.privacy) setPrivacyMode(true);
        }
        if (!privacyMode)
          void productApi<{ chats: SavedChat[] }>("conversations")
            .then((result) => setSavedChats(result.chats))
            .catch(() =>
              setHistoryError(
                "Your reply is saved. Conversation navigation could not refresh.",
              ),
            );
        await refresh();
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "AGUS could not respond. Your message is preserved.",
        );
        setQuestion(text);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [
      busy,
      historyLoading,
      privacyMode,
      refresh,
      setPrivacyMode,
      snapshot.capabilities.ai,
      rememberChat,
      voice,
      speech,
      spokenReplies,
      messages,
      savedChats,
      showTurns,
    ],
  );
  useEffect(() => {
    if (!launch || launched.current === launch.id || busy || historyLoading)
      return;
    launched.current = launch.id;
    if (launch.text) void ask(launch.text);
    else {
      setQuestion(launch.draft ?? "");
      composer.current?.focus();
    }
  }, [launch, busy, historyLoading, ask]);
  return (
    <div className={s.assistantPage}>
      <PageHeading
        title="AGUS"
        action={
          <div className={s.historyActions}>
            <button
              className={s.textButton}
              onClick={newChat}
              disabled={busy || historyLoading}
            >
              <Plus size={16} /> New conversation
            </button>
            <button
              className={s.iconButton}
              onClick={() => void openHistory()}
              disabled={privacyMode || busy || historyLoading}
              aria-label="Saved conversations"
            >
              <History size={20} />
            </button>
          </div>
        }
      />
      {historyError && (
        <p className={s.error} role="status">
          {historyError}
        </p>
      )}
      {historyLoading && (
        <p className={s.fine} role="status">
          Loading conversations…
        </p>
      )}
      {historyOpen && (
        <Dialog title="Conversations" close={() => setHistoryOpen(false)}>
          <button
            className={s.secondary}
            onClick={newChat}
            disabled={busy || historyLoading}
          >
            <Plus size={16} /> New conversation
          </button>
          {historyError && (
            <p className={s.error} role="alert">
              {historyError}
            </p>
          )}
          {!savedChats.length && !historyError && (
            <p className={s.muted}>No saved conversations yet.</p>
          )}
          <div className={s.historyList}>
            {savedChats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => void selectChat(chat.id)}
                disabled={historyLoading || busy}
                aria-current={
                  conversation.current === chat.id ? "true" : undefined
                }
              >
                <span>{chat.title || "Conversation"}</span>
                <small>{date(chat.updatedAt)}</small>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
        </Dialog>
      )}
      <section className={s.assistantPanel}>
        <div className={s.chatScroll}>
          {!messages.length && !historyLoading && (
            <div className={s.assistantWelcome}>
              <Companion />
              <h2>New conversation</h2>

              <div className={s.promptGrid}>
                <button onClick={() => void guidance()}>
                  <FileText size={18} />
                  <span>My financial summary</span>
                  <ArrowUpRight size={16} />
                </button>
                <button
                  disabled={!snapshot.capabilities.ai.configured}
                  onClick={() =>
                    void ask(
                      "Read my AGUS financial snapshot. What obligations remain and what should I do next?",
                    )
                  }
                >
                  <MessageCircle size={18} />
                  <span>What’s due next?</span>
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </div>
          )}
          {!messages.length && !historyLoading && (
            <div className={s.paymentExamples}>
              <button
                onClick={() => {
                  setQuestion("Send ");
                  composer.current?.focus();
                }}
              >
                Send money <ArrowUpRight size={14} />
              </button>
              <button
                onClick={() => {
                  setPrivacyMode(true);
                  setQuestion("Send privately ");
                  composer.current?.focus();
                }}
              >
                Private payment <ShieldCheck size={14} />
              </button>
            </div>
          )}
          {messages.map((message, index) => (
            <div
              key={index}
              className={`${s.chatMessage} ${message.role === "user" ? s.userMessage : ""}`}
            >
              {message.role === "assistant" && <Companion />}
              <div>
                <span className={s.chatName}>
                  {message.role === "assistant" ? "AGUS" : "You"}
                </span>
                {message.role === "assistant" ? (
                  message.reply &&
                  (message.reply.presentation ||
                    message.reply.savings ||
                    message.reply.payments) ? (
                    <FinancialResponse
                      reply={message.reply}
                      choose={(text) => {
                        if (!voice.isVoiceLocked()) {
                          setQuestion(text);
                          composer.current?.focus();
                        }
                      }}
                    />
                  ) : (
                    <AssistantProse text={message.text} />
                  )
                ) : (
                  <p>{message.text}</p>
                )}
                {message.source && (
                  <details className={s.messageDetails}>
                    <summary>Sources</summary>
                    <small>{message.source}</small>
                  </details>
                )}
                {message.reply && (
                  <>
                    {(
                      message.reply.workspaceActions ??
                      (message.reply.workspace ? [message.reply.workspace] : [])
                    ).map((action, i) => (
                      <PersonalAction
                        key={`${action.kind}-${"id" in action ? action.id : i}`}
                        action={action}
                        inline
                        onChanged={refresh}
                      />
                    ))}
                    <button
                      className={s.textButton}
                      onClick={() => speech.speak(`${index}`, message.text)}
                      aria-label={
                        speech.playing === `${index}`
                          ? "Stop spoken reply"
                          : "Read reply aloud"
                      }
                    >
                      <Volume2 size={14} />{" "}
                      {speech.playing === `${index}` ? "Stop" : "Listen"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
          {!!plans.filter((plan) =>
            messages.some((message) => message.planId === plan.id),
          ).length && (
            <div className={s.savedPlans}>
              <p className={s.eyebrow}>PAYMENTS</p>
              {plans
                .filter((plan) =>
                  messages.some((message) => message.planId === plan.id),
                )
                .slice(0, 8)
                .map((plan) => (
                  <button
                    className={s.paymentCard}
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan)}
                  >
                    <span className={s.activityIcon}>
                      {plan.privacy ? (
                        <ShieldCheck size={18} />
                      ) : (
                        <ArrowUpRight size={18} />
                      )}
                    </span>
                    <span>
                      <strong>
                        {plan.amount ?? "Amount needed"} {plan.asset ?? ""} ·{" "}
                        {plan.recipientLabel || "Recipient needed"}
                      </strong>
                      <small>
                        {plan.privacy ? "Private" : "Standard"} ·{" "}
                        {plan.state.replaceAll("_", " ")} · testnet
                      </small>
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
            </div>
          )}
          {busy && (
            <div className={s.thinking} role="status">
              <Companion state="thinking" />
              <Loader2 className={s.spin} size={15} />
              <span>Thinking…</span>
            </div>
          )}
          <div ref={end} />
        </div>
        {error && (
          <div className={s.error} role="alert">
            {error}
          </div>
        )}

        {voice.voiceStatus && (
          <div role="status" className={s.voiceStatus}>
            {voice.voiceStatus}
            {voiceBusy && (
              <button className={s.textButton} onClick={discardVoice}>
                Cancel recording
              </button>
            )}
          </div>
        )}
        {voice.liveTranscript && (
          <p className={s.voiceStatus} aria-live="polite">
            {voice.liveTranscript}
          </p>
        )}
        {speech.error && (
          <p role="status" className={s.fine}>
            {speech.error}
          </p>
        )}
        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <Companion
            state={
              privacyMode
                ? "privacy"
                : voice.listening
                  ? "analyzing"
                  : busy
                    ? "thinking"
                    : "idle"
            }
          />
          <textarea
            ref={composer}
            aria-label="Message AGUS"
            readOnly={voiceBusy}
            placeholder="Message AGUS…"
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={4000}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                window.matchMedia("(pointer: fine)").matches
              ) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
          <button
            type="button"
            className={s.iconButton}
            aria-label={voice.listening ? "Stop recording" : "Start recording"}
            disabled={
              busy ||
              historyLoading ||
              voice.requestingVoice ||
              voice.transcribingVoice
            }
            onClick={() => {
              speech.stop();
              void voice.toggleVoiceInput();
            }}
          >
            {voice.listening ? <Square size={18} /> : <Mic size={18} />}
          </button>
          <button
            type="submit"
            className={s.sendButton}
            aria-label="Send message"
            disabled={busy || historyLoading || voiceBusy || !question.trim()}
          >
            <ArrowUp size={19} />
          </button>
        </form>
        <div className={s.composerFooter}>
          <label>
            <input
              type="checkbox"
              checked={spokenReplies}
              onChange={(e) => {
                setSpokenReplies(e.target.checked);
                if (!e.target.checked) speech.stop();
              }}
            />{" "}
            Speak replies
          </label>
          {voice.listening && (
            <span aria-label="Microphone level">
              {voice.audioLevel === null
                ? "Listening…"
                : `Listening · ${Math.round(voice.audioLevel * 100)}%`}
            </span>
          )}
          <span>{privacyMode ? "Privacy Mode on" : ""}</span>
          {onReceiveZcash && (
            <button
              type="button"
              className={s.textButton}
              disabled={busy || voiceBusy}
              onClick={onReceiveZcash}
            >
              Receive ZEC <ShieldCheck size={12} />
            </button>
          )}
          <button
            className={s.textButton}
            disabled={busy}
            onClick={() => void guidance()}
          >
            Financial summary <ArrowUpRight size={12} />
          </button>
        </div>
      </section>

      {selectedPlan && (
        <Dialog
          title={selectedPlan.privacy ? "Private payment" : "Review payment"}
          close={() => {
            setSelectedPlan(undefined);
            void refresh();
          }}
        >
          <PaymentReview
            key={selectedPlan.id}
            plan={selectedPlan}
            snapshot={snapshot}
            onChange={(plan) => {
              setSelectedPlan(plan);
              setPlans((old) => old.map((p) => (p.id === plan.id ? plan : p)));
            }}
          />
        </Dialog>
      )}
    </div>
  );
}
