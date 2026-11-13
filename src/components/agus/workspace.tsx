"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
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
import { PollarWallet } from "./pollar-wallet";
import { PaymentReview } from "./payment-review";
import {
  looksLikePaymentIntent,
  type PaymentPlan,
} from "@/lib/web-product/payment-contracts";
import s from "./workspace.module.css";

type Tab =
  | "Overview"
  | "Assistant"
  | "Obligations"
  | "Accounts"
  | "Activity"
  | "Settings";
const navigation = [
  { name: "Overview", icon: Home },
  { name: "Assistant", icon: MessageCircle },
  { name: "Obligations", icon: Layers3 },
  { name: "Accounts", icon: Wallet },
  { name: "Activity", icon: Clock3 },
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

function Companion({ large = false }: { large?: boolean }) {
  return (
    <span
      className={`${s.companion} ${large ? s.companionLarge : ""}`}
      role="img"
      aria-label="AGUS companion"
    >
      <span />
      <span />
    </span>
  );
}
function Brand() {
  return (
    <span className={s.brand} aria-label="AGUS">
      agus<span>.</span>
    </span>
  );
}
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
      aria-labelledby="agus-dialog-title"
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className={s.dialogInner}>
        <header className={s.dialogHeader}>
          <div>
            {eyebrow && <p className={s.eyebrow}>{eyebrow}</p>}
            <h2 id="agus-dialog-title">{title}</h2>
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
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>
        <Icon size={24} strokeWidth={1.3} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
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
  const [privacyMode, setPrivacyMode] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [modal, setModal] = useState<"invoice" | "import" | "help" | null>(
    null,
  );
  const [selected, setSelected] = useState<string>();
  const [selectedPayment, setSelectedPayment] = useState<PaymentPlan>();
  const [filter, setFilter] = useState("all");
  const [tasks, setTasks] = useState<Responsibility[]>([]);
  const [sample, setSample] = useState(false);
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
    } catch (e) {
      if ((e as Error & { status?: number }).status === 401) {
        setPhase("out");
        setSnapshot(undefined);
        setTasks([]);
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
  const openInvoiceForm = (example = false) => {
    setSample(example);
    setModal("invoice");
  };

  return (
    <div className={s.root} data-privacy={privacyMode ? "true" : "false"}>
      <aside className={s.sidebar} aria-label="Main navigation">
        <button className={s.brandButton} onClick={() => navigate("Overview")}>
          <Brand />
        </button>
        <span className={s.workspaceLabel}>PERSONAL WORKSPACE</span>
        <nav>
          {navigation.map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`${s.navItem} ${tab === name ? s.navActive : ""}`}
              onClick={() => navigate(name)}
              aria-current={tab === name ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.6} />
              {name}
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
          <div className={s.sidebarNote}>
            <Companion />
            <p>
              A little context.
              <br />A clearer next step.
            </p>
          </div>
          <button
            className={`${s.navItem} ${tab === "Settings" ? s.navActive : ""}`}
            onClick={() => navigate("Settings")}
          >
            <Settings2 size={18} strokeWidth={1.6} /> Settings
          </button>
          <button className={s.navItem} onClick={() => setModal("help")}>
            <CircleHelp size={18} strokeWidth={1.6} /> About this workspace
          </button>
          <div className={s.profile}>
            <span className={s.avatar}>Y</span>
            <div>
              <strong>Your workspace</strong>
              <small>Private operator session</small>
            </div>
            <button
              aria-label="Sign out"
              className={s.iconButton}
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await productApi("session", undefined, "DELETE");
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
            <strong>{tab}</strong>
          </div>
          <div className={s.topActions}>
            <button
              className={`${s.privacyButton} ${privacyMode ? s.privacyActive : ""}`}
              aria-pressed={privacyMode}
              onClick={() => {
                setPrivacyMode(!privacyMode);
                notify(
                  privacyMode
                    ? "Standard mode. Existing private payment reviews stay private."
                    : "Privacy Mode on. Private wallet details stay out of the model’s tools.",
                );
              }}
              aria-label="Privacy Mode"
            >
              <ShieldCheck size={14} />
              <span>{privacyMode ? "Privacy on" : "Privacy"}</span>
            </button>
            <span className={s.testnet}>
              <span /> Testnet workspace
            </span>
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
        <main className={s.main}>
          {privacyMode && (
            <div className={s.privacyBanner}>
              <ShieldCheck size={15} />
              <span>
                Privacy Mode · wallet details stay in your trusted review. What
                you type in chat may still reach the AI provider.
              </span>
            </div>
          )}
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
                  <p className={s.eyebrow}>
                    {date(snapshot.asOf, true)} · YOUR MONEY, IN PERSPECTIVE
                  </p>
                  <h1>
                    Make room for <span>what’s next.</span>
                  </h1>
                  <p className={s.subtitle}>
                    Your money, responsibilities, and a clearer way forward.
                  </p>
                </div>
                <button
                  className={s.secondary}
                  onClick={() => openInvoiceForm()}
                >
                  <Plus size={16} /> New obligation
                </button>
              </div>
              <section className={s.summary} aria-label="Financial summary">
                <div className={s.summaryHeader}>
                  <span>
                    <Wallet size={15} /> Your financial picture
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
                    <div className={s.summaryAmounts}>
                      <div>
                        <span className={s.summaryLabel}>
                          Naira <small>NGN</small>
                        </span>
                        <strong>{amount(snapshot.intelligence.naira)}</strong>
                        <p>
                          {snapshot.intelligence.naira
                            ? "Imported statement balance"
                            : "No statement balance yet"}
                        </p>
                      </div>
                      <div>
                        <span className={s.summaryLabel}>
                          Digital assets <small>USD VALUE</small>
                        </span>
                        <strong>{amount(null)}</strong>
                        <p>No verified USD valuation</p>
                      </div>
                    </div>
                    <div className={s.summaryFooter}>
                      <span>
                        <span className={s.tinyDot} />
                        {snapshot.accounts.length
                          ? `${snapshot.accounts.length} imported ${snapshot.accounts.length === 1 ? "account" : "accounts"} · historical records`
                          : "Your accounts, when you’re ready"}
                      </span>
                      <button onClick={() => navigate("Accounts")}>
                        View accounts <ArrowUpRight size={14} />
                      </button>
                    </div>
                  </>
                )}
              </section>
              <section className={s.nextMove}>
                <Companion large />
                <div>
                  <p className={s.eyebrow}>A NOTE FROM AGUS</p>
                  <h2>
                    {outstanding.length
                      ? "Let’s keep the next step in sight."
                      : "Good decisions start with a little context."}
                  </h2>
                  <p>{snapshot.intelligence.nextAction}</p>
                  <button
                    className={s.textButton}
                    onClick={() => navigate("Assistant")}
                  >
                    Think it through with AGUS <ArrowRight size={15} />
                  </button>
                </div>
                <span className={s.noteDecoration} aria-hidden="true">
                  ✦
                </span>
              </section>
              <div className={s.overviewGrid}>
                <section className={s.panel}>
                  <div className={s.sectionHead}>
                    <div>
                      <p className={s.eyebrow}>KEEPING THINGS MOVING</p>
                      <h2>Your obligations</h2>
                    </div>
                    <button
                      className={s.textButton}
                      onClick={() => navigate("Obligations")}
                    >
                      View all <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {outstanding.length ? (
                    <div className={s.invoiceList}>
                      {outstanding.slice(0, 4).map((item) => (
                        <InvoiceRow
                          key={item.id}
                          invoice={item}
                          masked={masked}
                          onClick={() => setSelected(item.id)}
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Nothing left in the back of your mind."
                      text="Keep track of money owed, client invoices, and commitments in one place."
                    >
                      <button
                        className={s.secondary}
                        onClick={() => openInvoiceForm()}
                      >
                        <Plus size={15} /> Add your first obligation
                      </button>
                    </Empty>
                  )}
                  <div className={s.panelFoot}>
                    <ShieldCheck size={14} />
                    <span>
                      An invoice becomes settled only when receiving evidence is
                      verified.
                    </span>
                  </div>
                </section>
                <section className={s.pathways}>
                  <p className={s.eyebrow}>MORE WAYS FORWARD</p>
                  <h2>
                    Two pathways.
                    <br /> One clear record.
                  </h2>
                  <p className={s.muted}>
                    Request a payment in the asset that works for you.
                  </p>
                  <button
                    className={s.railCard}
                    onClick={() => navigate("Accounts")}
                  >
                    <span className={s.railSymbol}>p.</span>
                    <div>
                      <strong>Pollar</strong>
                      <span>USDC · Stellar testnet</span>
                    </div>
                    <ArrowUpRight size={18} />
                  </button>
                  <button
                    className={s.railCard}
                    onClick={() => {
                      navigate("Obligations");
                      notify(
                        "Choose a ZEC invoice to create a private payment request.",
                      );
                    }}
                  >
                    <span className={s.railSymbol}>Ƶ</span>
                    <div>
                      <strong>Zcash</strong>
                      <span>Private requests · ZEC testnet</span>
                    </div>
                    <ArrowUpRight size={18} />
                  </button>
                  <small className={s.railCaption}>
                    Separate payment pathways. Test assets have no cash value.
                  </small>
                </section>
              </div>
              <footer className={s.pageFooter}>
                <span>
                  <LockKeyhole size={12} /> Your context stays in your
                  workspace.
                </span>
                <span>Your money, and what&apos;s next.</span>
              </footer>
            </>
          )}
          {tab === "Obligations" && (
            <>
              <PageHeading
                eyebrow="MONEY HAS CONTEXT"
                title="Keep your commitments clear."
                subtitle="What’s owed, who it’s with, and what happens next."
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
                    {label}
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
                    title="A clear slate."
                    text="Add a client invoice or a commitment. AGUS will keep the amount, date and next action together."
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
                    <div className={s.taskRow} key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <small>
                          {date(task.dueAt)} · {task.state.replaceAll("_", " ")}
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
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {tab === "Accounts" && (
            <>
              <PageHeading
                eyebrow="THE WHOLE PICTURE"
                title="Every account. Clear context."
                subtitle="Imported Naira records and digital assets, kept in their own currencies."
                action={
                  <button
                    className={s.primary}
                    onClick={() => setModal("import")}
                  >
                    <Plus size={16} /> Import statement
                  </button>
                }
              />
              <div className={s.notice}>
                <ShieldCheck size={17} />
                <span>
                  Live Nigerian bank connections are{" "}
                  <strong>Coming Soon</strong>. Statement imports are
                  historical, user-provided records.
                </span>
              </div>
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
                    title="Your accounts belong here."
                    text="Import a CSV statement to see balances, spending and transfers across your accounts."
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
                <PollarWallet config={snapshot.capabilities.pollar} />
                <section className={s.walletPanel}>
                  <div className={s.sectionHead}>
                    <span className={s.railTitle}>
                      <ShieldCheck size={19} /> Zcash privacy
                    </span>
                    <span className={s.pill}>Testnet</span>
                  </div>
                  <p className={s.muted}>
                    Create a ZIP 321 request with a shielded Sapling receiving
                    address and a unique invoice memo.
                  </p>
                  <div className={s.notice}>
                    {snapshot.capabilities.zcash.verificationConfigured
                      ? "Receiving-wallet verification is configured. Settlement still requires a matching amount, memo and 3 confirmations."
                      : "Payment requests work without a wallet connection. Settlement verification needs an authorized, synchronized receiving wallet."}
                  </div>
                  <button
                    className={s.secondary}
                    onClick={() => {
                      navigate("Obligations");
                      notify(
                        "Create a ZEC receivable to prepare your Zcash request.",
                      );
                    }}
                  >
                    Create a ZEC invoice <ArrowUpRight size={15} />
                  </button>
                  <p className={s.fine}>
                    A public transaction ID cannot reveal a shielded recipient
                    or amount. Never share seeds or viewing keys with AGUS.
                  </p>
                </section>
              </div>
              <Link className={s.legacyLink} href="/devnet">
                Open existing Solana devnet workspace <ArrowUpRight size={14} />
              </Link>
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
              <PageHeading
                eyebrow="THE RECORD, WITH RECEIPTS"
                title="Nothing gets lost in the story."
                subtitle="Saved invoices, requests and verified outcomes. No guessed payment states."
              />
              <section className={s.panel}>
                <div className={s.sectionHead}>
                  <h2>Workspace activity</h2>
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
                  <Empty
                    icon={Clock3}
                    title="Your story starts here."
                    text="Create an obligation or import a statement. Its activity will be saved here."
                  />
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
              snapshot={snapshot}
              refresh={refresh}
              privacyMode={privacyMode}
              setPrivacyMode={setPrivacyMode}
            />
          )}
          {tab === "Settings" && (
            <>
              <PageHeading
                eyebrow="YOUR WORKSPACE, YOUR TERMS"
                title="A little more control."
                subtitle="Privacy, connections, and what’s actually available."
              />
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
                <h2>Connection status</h2>
                {[
                  ["Nigerian bank connectivity", "Coming Soon"],
                  [
                    "Pollar · official SDK 0.12.0",
                    snapshot.capabilities.pollar.configured
                      ? "Configured · testnet"
                      : "Testnet key / issuer required",
                  ],
                  ["Zcash · ZIP 321 requests", "Available · Sapling testnet"],
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
                      : "Model not configured",
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
              <Link className={s.legacyLink} href="/conversation">
                Open the existing full agent workspace{" "}
                <ArrowUpRight size={14} />
              </Link>
            </>
          )}
        </main>
      </div>
      <nav className={s.mobileNav} aria-label="Mobile navigation">
        {navigation.map(({ name, icon: Icon }) => (
          <button
            key={name}
            onClick={() => navigate(name)}
            className={tab === name ? s.mobileActive : ""}
            aria-current={tab === name ? "page" : undefined}
          >
            <Icon size={20} strokeWidth={1.6} />
            <span>
              {name === "Obligations"
                ? "Obligations"
                : name === "Overview"
                  ? "Home"
                  : name === "Assistant"
                    ? "AGUS"
                    : name}
            </span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className={s.toast} role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal === "invoice" && (
        <Dialog
          title={sample ? "Try a sample invoice" : "Give it a little context."}
          eyebrow="NEW OBLIGATION"
          close={() => setModal(null)}
        >
          <InvoiceForm
            sample={sample}
            onSave={async (input) => {
              const saved = await productApi<Invoice>(
                "product/invoices",
                input,
              );
              await refresh();
              setModal(null);
              setSelected(saved.id);
              notify("Obligation saved. Your reminder is ready for review.");
            }}
          />
        </Dialog>
      )}
      {modal === "import" && (
        <Dialog
          title="Bring your records together."
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
          title={
            selectedPayment.privacy
              ? "Private payment review"
              : "Payment review & receipt"
          }
          eyebrow="SAVED CONVERSATIONAL PAYMENT"
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
  eyebrow: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
}) {
  return (
    <div className={s.pageHeading}>
      <div>
        <p className={s.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={s.subtitle}>{subtitle}</p>
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
            <p>
              Money comes with people, plans, and promises.
              <br />
              Let’s make sense of it together.
            </p>
          </div>
          <footer>
            <span>AGUS 2.0</span>
            <span>Intelligence Without Borders</span>
          </footer>
        </section>
        <section className={s.signInForm}>
          <div>
            <span className={s.pill}>
              <LockKeyhole size={12} /> Private workspace
            </span>
            <h2>
              A clearer next step
              <br />
              starts here.
            </h2>
            <p className={s.muted}>Sign in to your AGUS workspace.</p>
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
            <p className={s.fine}>
              <ShieldCheck size={14} /> Testnet payments only. No real money
              moves.
            </p>
            <div className={s.loginDisclosure}>
              One operator identity · saved records are shared by anyone using
              this login. No live bank connection is claimed.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function InvoiceForm({
  sample,
  onSave,
}: {
  sample: boolean;
  onSave: (input: InvoiceInput) => Promise<void>;
}) {
  const [currency, setCurrency] = useState("USDC");
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
                  ? "Your Sapling testnet receiving address"
                  : "Your Stellar testnet receiving address"}
                <textarea
                  rows={3}
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value.trim())}
                  placeholder={
                    selectedRail === "zcash" ? "ztestsapling1…" : "G…"
                  }
                  required
                  maxLength={300}
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
          ? "Zcash · shielded Sapling request"
          : "Pollar · Stellar USDC"}{" "}
        · testnet only
      </p>
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
  snapshot,
  refresh,
  privacyMode,
  setPrivacyMode,
}: {
  snapshot: ProductSnapshot;
  refresh: () => Promise<void>;
  privacyMode: boolean;
  setPrivacyMode: (value: boolean) => void;
}) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [messages, setMessages] = useState<
    { role: string; text: string; source?: string; id?: string }[]
  >([]);
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<PaymentPlan>();
  const conversation = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const mode = useRef(privacyMode);
  useEffect(() => {
    if (mode.current !== privacyMode) {
      conversation.current = null;
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
    end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);
  async function guidance() {
    if (busy) return;
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
  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError("");
    conversation.current ??= crypto.randomUUID();
    setMessages((m) => [...m, { role: "user", text }]);
    setQuestion("");
    try {
      if (looksLikePaymentIntent(text)) {
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
            text: `Your ${plan.privacy ? "private" : "standard"} payment intent is saved for review. ${plan.state === "needs_details" ? "I need the exact recipient details before anything can be sent." : plan.state === "blocked" ? "A required capability is unavailable; the review explains the blocker." : "Connect the designated test wallet to obtain a genuine provider quote."} No payment has been approved or sent.`,
            source: "Local intent parser · saved payment proposal",
          },
        ]);
        return;
      }
      if (!snapshot.capabilities.ai.configured)
        throw new Error(
          "The language model is not configured. You can still describe a USDC or ZEC payment, complete its trusted review, or read the financial snapshot.",
        );
      const result = await productApi<{ reply: AgentReply }>("conversation", {
        conversationId: conversation.current,
        requestId: crypto.randomUUID(),
        text,
        accountIds: [],
        privacyMode,
      });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: result.reply.text,
          source: `${snapshot.capabilities.ai.provider} · ${result.reply.execution?.steps.filter((step) => step.state === "succeeded").length ?? 0} completed tool steps`,
          id: conversation.current!,
        },
      ]);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "The model could not respond. Your saved records are unchanged.",
      );
      setQuestion(text);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={s.assistantPage}>
      <PageHeading
        eyebrow="YOUR THINKING PARTNER"
        title="A little context goes a long way."
        subtitle="Ask about your records, commitments, or your next financial move."
      />
      <section className={s.assistantPanel}>
        <div className={s.chatScroll}>
          {!messages.length && (
            <div className={s.assistantWelcome}>
              <Companion large />
              <h2>What’s on your mind?</h2>
              <p>
                I can bring your imported records, open obligations
                <br className={s.desktopOnly} /> and payment evidence into the
                conversation.
              </p>
              <div className={s.promptGrid}>
                <button onClick={() => void guidance()}>
                  <FileText size={18} />
                  <span>
                    Show my financial picture
                    <small>Calculated from saved records</small>
                  </span>
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
                  <span>
                    Help me find my next step
                    <small>Ask the personal agent</small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </div>
          )}
          {!messages.length && (
            <div className={s.paymentExamples}>
              <span>OR PREPARE A PAYMENT</span>
              <button onClick={() => void ask("Send Daniel 10 USDC")}>
                “Send Daniel 10 USDC” <ArrowUpRight size={13} />
              </button>
              <button onClick={() => void ask("Send Daniel 0.2 ZEC privately")}>
                “Send Daniel 0.2 ZEC privately” <ShieldCheck size={13} />
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
                  <AssistantProse text={message.text} />
                ) : (
                  <p>{message.text}</p>
                )}
                {message.source && <small>{message.source}</small>}
                {message.id && (
                  <Link
                    className={s.textButton}
                    href={`/conversation?chat=${encodeURIComponent(message.id)}`}
                  >
                    Open full conversation & review actions{" "}
                    <ArrowUpRight size={13} />
                  </Link>
                )}
              </div>
            </div>
          ))}
          {!!plans.length && (
            <div className={s.savedPlans}>
              <p className={s.eyebrow}>SAVED PAYMENT REVIEWS</p>
              {plans.slice(0, 8).map((plan) => (
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
              <Companion />
              <Loader2 className={s.spin} size={15} />
              <span>Reading the context…</span>
            </div>
          )}
          <div ref={end} />
        </div>
        {error && (
          <div className={s.error} role="alert">
            {error}
          </div>
        )}
        {!snapshot.capabilities.ai.configured && (
          <div className={s.chatNotice}>
            Free-form AI chat needs a model connection. Payment intents use a
            labelled local parser; financial snapshots use saved data.
          </div>
        )}
        <form
          className={s.composer}
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <textarea
            aria-label="Message AGUS"
            placeholder="e.g. Send Daniel 10 USDC…"
            rows={1}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={4000}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(question);
              }
            }}
          />
          <button
            type="submit"
            className={s.sendButton}
            aria-label="Send message"
            disabled={busy || !question.trim()}
          >
            <ArrowUp size={19} />
          </button>
        </form>
        <div className={s.composerFooter}>
          <span>AGUS proposes. You decide.</span>
          <button
            className={s.textButton}
            disabled={busy}
            onClick={() => void guidance()}
          >
            Read financial snapshot <ArrowUpRight size={12} />
          </button>
        </div>
      </section>
      <Link className={s.legacyLink} href="/conversation">
        Open the full agent, memory and existing payment workflows{" "}
        <ArrowUpRight size={14} />
      </Link>
      {selectedPlan && (
        <Dialog
          title={
            selectedPlan.privacy
              ? "A private payment, with clear limits."
              : "Your payment. Your approval."
          }
          eyebrow="CONVERSATIONAL PAYMENT REVIEW"
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
