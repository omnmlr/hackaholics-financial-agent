"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Mic,
  Square,
  Volume2,
  VolumeX,
  Check,
  CreditCard,
  LogOut,
  PanelLeft,
  SquarePen,
  MessageSquare,
  Plus,
  Wallet,
  ArrowUpRight,
  ChartNoAxesCombined,
  Search,
  ShieldCheck,
  ChevronDown,
  X,
} from "lucide-react";
import type { SavedChat, SavedTurn } from "@/lib/chat-history/store";
import { BrandAsset } from "./brand-asset";
import { AgusSignal } from "./agus-signal";
import { FinancialResponse } from "./financial-response";
import { CopyableMessage } from "./copyable-message";
import { conversationDrafts as drafts } from "@/lib/chat-history/drafts";
import {
  NativePayment,
  PaymentNotice,
  useConversationPayments,
} from "./conversation-payments";
import { useVoiceInput } from "./use-voice-input";
import { useResponseSpeech } from "./use-response-speech";
import { responseSpeechText } from "@/lib/response-speech";
import type { Mode } from "@/lib/domain";
import "./financial-conversation.css";

type Account = {
  accountId: string;
  displayName: string;
  maskedNumber: string | null;
};
type DraftSelection = {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
  scrollTop: number;
};
// Transient only. No transcripts, account selection or draft text enter browser storage.
const suggestions = [
  {
    title: "Analyze spending",
    description: "Find the story in your numbers",
    icon: ChartNoAxesCombined,
    text: "Show my spending for October 2026",
  },
  {
    title: "Track a payment",
    description: "Follow the facts, find clarity",
    icon: Search,
    text: "Find payments to Ada in October 2026",
  },
  {
    title: "Prepare a transfer",
    description: "A draft you can make your own",
    icon: ArrowUpRight,
    text: "Help me prepare a payment draft",
  },
];
export function FinancialConversation({
  paymentMode = "fixture",
}: {
  paymentMode?: Mode;
}) {
  const [id, setId] = useState("");
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<SavedTurn[]>([]);
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [operation, setOperation] = useState("");
  const [pendingText, setPendingText] = useState("");
  const [error, setError] = useState("");
  const [historyError, setHistoryError] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [account, setAccount] = useState("");
  const [accountQuestion, setAccountQuestion] = useState<{
    chat: string;
    text: string;
  } | null>(null);
  const [accountError, setAccountError] = useState("");
  const [accountLoading, setAccountLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [signinError, setSigninError] = useState("");
  const [showLatest, setShowLatest] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [longWait, setLongWait] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [unknown, setUnknown] = useState<{
    chat: string;
    count: number;
    payment?: boolean;
    original?: string;
    stopped?: boolean;
  } | null>(null);
  const pending = useRef(false);
  const activeRequest = useRef<{
    controller: AbortController;
    original: string;
    chat: string;
    count: number;
  } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLDialogElement>(null);
  const plans = useRef<HTMLDialogElement>(null);
  const signin = useRef<HTMLDialogElement>(null);
  const paymentHistory = useRef<HTMLDialogElement>(null);
  const accountDialog = useRef<HTMLDialogElement>(null);
  const voiceSettings = useRef<HTMLDialogElement>(null);
  const [voiceLanguage, setVoiceLanguage] = useState("en-NG");
  const [spokenReplies, setSpokenReplies] = useState(false);
  const spokenRepliesEnabled = useRef(false);
  const modalReturn = useRef<HTMLElement | null>(null);
  const modalSelection = useRef<DraftSelection | undefined>(undefined);
  const requestVersion = useRef(0);
  const privacyVersion = useRef(0);
  const follow = useRef(true);
  const editorId = useRef("");
  const selections = useRef(new Map<string, DraftSelection>());
  const rememberSelection = useCallback(() => {
    const input = composer.current;
    if (input)
      selections.current.set(editorId.current, {
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
        scrollTop: input.scrollTop,
      });
  }, []);
  const restoreSelection = useCallback((saved?: DraftSelection) => {
    const input = composer.current;
    const selection = saved ?? selections.current.get(editorId.current);
    if (input && selection) {
      input.setSelectionRange(
        selection.start,
        selection.end,
        selection.direction,
      );
      input.scrollTop = selection.scrollTop;
    }
  }, []);
  const resizeComposer = useCallback(() => {
    const input = composer.current;
    if (input) {
      input.style.height = "auto";
      const maximum =
        Number.parseFloat(getComputedStyle(input).maxHeight) || 160;
      input.style.height = `${Math.min(input.scrollHeight, maximum)}px`;
    }
  }, []);
  useLayoutEffect(() => {
    editorId.current = id;
    restoreSelection();
  }, [id, restoreSelection]);
  const busy = !!operation;
  const updateText = (value: string) => {
    if (voice.isVoiceLocked()) return;
    setText(value);
    drafts.set(id, value);
  };
  const speech = useResponseSpeech();
  const [aiEnabled, setAiEnabled] = useState(false);
  const voice = useVoiceInput({
    text,
    onText: (value) => {
      setText(value);
      drafts.set(id, value);
    },
    aiEnabled,
    disabled: busy || loading || !!unknown || !authenticated,
    language: voiceLanguage,
    focus: () => composer.current?.focus({ preventScroll: true }),
  });
  const { discardVoiceCapture } = voice;
  const { stop: stopSpeech } = speech;
  const voiceBusy =
    voice.listening || voice.requestingVoice || voice.transcribingVoice;
  const clearPrivate = useCallback(() => {
    discardVoiceCapture();
    stopSpeech();
    setSpokenReplies(false);
    spokenRepliesEnabled.current = false;
    ++privacyVersion.current;
    ++requestVersion.current;
    activeRequest.current?.controller.abort();
    activeRequest.current = null;
    drafts.clear();
    selections.current.clear();
    editorId.current = "";
    modalSelection.current = undefined;
    pending.current = false;
    setOperation("");
    setAccountLoading(false);
    setLoading(false);
    setAuthenticated(false);
    setTurns([]);
    setChats([]);
    setAccounts([]);
    setAccount("");
    setAccountQuestion(null);
    setId("");
    setPendingText("");
    setUnknown(null);
    setPassword("");
  }, [discardVoiceCapture, stopSpeech]);
  const payments = useConversationPayments(authenticated, clearPrivate);
  useEffect(() => {
    setAiEnabled(!!payments.snapshot?.aiEnabled);
  }, [payments.snapshot?.aiEnabled]);
  function openModal(target: HTMLDialogElement | null) {
    rememberSelection();
    modalSelection.current = selections.current.get(editorId.current);
    const active = document.activeElement as HTMLElement;
    modalReturn.current = active?.closest("dialog") ? menu.current : active;
    [
      drawer,
      plans,
      signin,
      accountDialog,
      paymentHistory,
      voiceSettings,
    ].forEach((r) => r.current?.close());
    target?.showModal();
  }
  function restoreFocus() {
    requestAnimationFrame(() => {
      if (!document.querySelector("dialog[open]")) {
        const selection = modalSelection.current;
        modalReturn.current?.focus({ preventScroll: true });
        if (modalReturn.current === composer.current)
          restoreSelection(selection);
      }
    });
  }
  function toggleSidebar(open: boolean) {
    setSidebarOpen(open);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          open ? ".agus-sidebar .agus-collapse" : ".agus-navigation-toggle",
        )
        ?.focus();
    });
  }
  const refresh = useCallback(async () => {
    const version = privacyVersion.current;
    const response = await fetch("/api/conversations", { cache: "no-store" });
    if (version !== privacyVersion.current) return false;
    if (response.status === 401) {
      clearPrivate();
      return false;
    }
    if (response.status === 503) {
      // Keep the existing fixture conversation gate. Test/live operators can
      // still recover historical payments through the same authenticated UI.
      const state = await fetch("/api/state", { cache: "no-store" });
      if (version !== privacyVersion.current) return false;
      if (state.ok) {
        setAuthenticated(true);
        setHistoryError(
          "Conversation demo is unavailable in this configuration. Saved payments remain accessible.",
        );
        return true;
      }
    }
    if (!response.ok)
      throw new Error("Saved chats couldn’t load. Retry the list.");
    const data = await response.json();
    if (version !== privacyVersion.current) return false;
    setAuthenticated(true);
    setChats(data.chats);
    setHistoryError("");
    return true;
  }, [clearPrivate]);
  const openChat = useCallback(
    async (next: string, push = true) => {
      activeRequest.current?.controller.abort();
      activeRequest.current = null;
      pending.current = false;
      setOperation("");
      discardVoiceCapture();
      stopSpeech();
      rememberSelection();
      const version = ++requestVersion.current;
      setLoading(!!next);
      setError("");
      setText(drafts.get(next) ?? "");
      setAccount("");
      setAccountQuestion(null);
      setAccounts([]);
      setTurns([]);
      setId(next);
      setUnknown(null);
      setPendingText("");
      follow.current = true;
      drawer.current?.close();
      if (push)
        window.history.pushState(
          null,
          "",
          next ? `?chat=${encodeURIComponent(next)}` : "/conversation",
        );
      if (!next) return;
      try {
        const response = await fetch(
          `/api/conversations?id=${encodeURIComponent(next)}`,
          { cache: "no-store" },
        );
        if (version !== requestVersion.current) return;
        if (response.status === 401) {
          clearPrivate();
          throw new Error("Your session expired. Sign in to open saved chats.");
        }
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "This chat is unavailable. Start a new chat."
              : "This chat couldn’t load. Select it again to retry.",
          );
        const data = await response.json();
        if (version === requestVersion.current) setTurns(data.turns);
      } catch (e) {
        if (version === requestVersion.current)
          setError(e instanceof Error ? e.message : "Chat unavailable.");
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [clearPrivate, rememberSelection, discardVoiceCapture, stopSpeech],
  );
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const ok = await refresh();
        const active = new URLSearchParams(window.location.search).get("chat");
        if (live && ok) await openChat(active ?? "", false);
      } catch (e) {
        if (live)
          setHistoryError(
            e instanceof Error ? e.message : "Saved chats unavailable.",
          );
      } finally {
        if (live) setLoading(false);
      }
    })();
    const pop = () =>
      void openChat(
        new URLSearchParams(window.location.search).get("chat") ?? "",
        false,
      );
    window.addEventListener("popstate", pop);
    const versions = requestVersion;
    const active = activeRequest;
    return () => {
      live = false;
      ++versions.current;
      active.current?.controller.abort();
      active.current = null;
      window.removeEventListener("popstate", pop);
    };
  }, [refresh, openChat]);
  useEffect(() => {
    if (follow.current) {
      if (scroll.current)
        scroll.current.scrollTop = scroll.current.scrollHeight;
      setShowLatest(false);
    } else if (turns.length) setShowLatest(true);
  }, [turns, pendingText]);
  useEffect(() => {
    resizeComposer();
  }, [text, resizeComposer]);
  useEffect(() => {
    if (!busy) {
      setLongWait(false);
      return;
    }
    const timer = setTimeout(() => setLongWait(true), 10000);
    return () => clearTimeout(timer);
  }, [busy]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const fit = () => {
      const el = document.querySelector<HTMLElement>(".agus-workspace");
      el?.style.setProperty(
        "--workspace-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      el?.style.setProperty("--workspace-top", `${viewport?.offsetTop ?? 0}px`);
      resizeComposer();
    };
    fit();
    viewport?.addEventListener("resize", fit);
    viewport?.addEventListener("scroll", fit);
    window.addEventListener("resize", fit);
    return () => {
      viewport?.removeEventListener("resize", fit);
      viewport?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [resizeComposer]);
  useEffect(() => {
    if (
      authenticated &&
      new URLSearchParams(window.location.search).get("payments") === "history"
    )
      paymentHistory.current?.showModal();
  }, [authenticated]);
  function choose(value: string) {
    if (voice.isVoiceLocked()) return;
    if (text.trim()) {
      setError(
        "Your draft is preserved. Clear it before choosing a suggestion.",
      );
      return;
    }
    updateText(value);
    composer.current?.focus();
  }
  async function loadAccounts() {
    const version = privacyVersion.current,
      request = requestVersion.current;
    setAccountLoading(true);
    setAccountError("");
    try {
      const response = await fetch("/api/financial-agent", {
        cache: "no-store",
      });
      if (
        version !== privacyVersion.current ||
        request !== requestVersion.current
      )
        return;
      if (response.status === 401) {
        clearPrivate();
        throw new Error("Sign in to load authorized accounts.");
      }
      if (!response.ok)
        throw new Error(
          "Accounts couldn’t load. General conversation remains available.",
        );
      const data = await response.json();
      if (
        version === privacyVersion.current &&
        request === requestVersion.current
      )
        setAccounts(data.accounts);
    } catch (e) {
      if (version === privacyVersion.current)
        setAccountError(
          e instanceof Error ? e.message : "Accounts unavailable.",
        );
    } finally {
      if (version === privacyVersion.current) setAccountLoading(false);
    }
  }
  async function send(question?: string) {
    // API refs lock synchronously, before React renders disabled controls.
    if (voice.isVoiceLocked()) return;
    if (
      pending.current ||
      loading ||
      unknown ||
      !(question ?? text).trim() ||
      voiceBusy
    )
      return;
    discardVoiceCapture();
    stopSpeech();
    if (!authenticated) {
      openModal(signin.current);
      return;
    }
    pending.current = true;
    setOperation("message");
    setError("");
    const original = question ?? text,
      chatId = id || crypto.randomUUID(),
      version = privacyVersion.current,
      request = requestVersion.current;
    setPendingText(original);
    setText("");
    drafts.set(id, "");
    const controller = new AbortController(),
      timeout = setTimeout(() => controller.abort(), 65000);
    activeRequest.current = {
      controller,
      original,
      chat: chatId,
      count: turns.length,
    };
    try {
      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: chatId,
          text: original,
          accountIds: account ? [account] : [],
        }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (
        version !== privacyVersion.current ||
        request !== requestVersion.current
      )
        return;
      if (response.status === 401) {
        clearPrivate();
        setText(original);
        drafts.set("", original);
        setError(
          "Your session expired. Sign in again; your unsent question is retained.",
        );
        return;
      }
      if (data.turn) {
        setId(chatId);
        const nextDraft = drafts.get(id) ?? "";
        drafts.delete(id);
        drafts.set(chatId, nextDraft);
        setText(nextDraft);
        if (!id)
          window.history.replaceState(
            null,
            "",
            `/conversation?chat=${encodeURIComponent(chatId)}`,
          );
        setTurns((previous) => [...previous, data.turn]);
        if (
          spokenRepliesEnabled.current &&
          ["general", "financial", "product"].includes(data.turn.reply.kind)
        )
          speech.speak(data.turn.id, responseSpeechText(data.turn.reply));
        setAnnouncement("Response saved. The answer is ready.");
        void refresh().catch(() => {
          if (version === privacyVersion.current)
            setHistoryError(
              "Reply saved; conversation list could not refresh.",
            );
        });
      } else {
        const retained = drafts.get(id) || original;
        setText(retained);
        drafts.set(id, retained);
        setError(
          response.status === 409
            ? "A response is already in progress. Check the saved conversation before trying again."
            : "Your message wasn’t completed. Review it and try again.",
        );
        if (response.status === 409 || response.status >= 500)
          setUnknown({ chat: chatId, count: turns.length, original });
      }
    } catch {
      if (
        version !== privacyVersion.current ||
        request !== requestVersion.current
      )
        return;
      const retained = drafts.get(id) || original;
      setText(retained);
      drafts.set(id, retained);
      setUnknown({ chat: chatId, count: turns.length, original });
      setError(
        "The response could not be confirmed. Check this conversation before trying again.",
      );
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current?.controller === controller)
        activeRequest.current = null;
      if (
        version === privacyVersion.current &&
        request === requestVersion.current
      ) {
        pending.current = false;
        setOperation("");
        setPendingText("");
      }
    }
  }
  function stopGeneration() {
    const active = activeRequest.current;
    if (!active) return;
    ++requestVersion.current;
    active.controller.abort();
    activeRequest.current = null;
    pending.current = false;
    setOperation("");
    setPendingText("");
    const retained = drafts.get(id) || active.original;
    setText(retained);
    drafts.set(id, retained);
    // A response may have committed just before the connection was aborted.
    // Reconcile that race before allowing another POST to the same chat.
    setUnknown({
      chat: active.chat,
      count: active.count,
      original: active.original,
      stopped: true,
    });
    setError(
      "Response stopped. Your draft is editable. Check saved state before sending again.",
    );
    setAnnouncement("Response stopped. Draft preserved.");
    composer.current?.focus({ preventScroll: true });
  }
  async function checkSaved() {
    if (!unknown || voice.isVoiceLocked()) return;
    const version = privacyVersion.current,
      request = requestVersion.current;
    setOperation("check");
    try {
      const response = await fetch(
        `/api/conversations?id=${encodeURIComponent(unknown.chat)}`,
        { cache: "no-store" },
      );
      if (response.status === 401) {
        clearPrivate();
        return;
      }
      const data = response.ok ? await response.json() : null;
      if (
        version !== privacyVersion.current ||
        request !== requestVersion.current
      )
        return;
      if (!response.ok && response.status !== 404) throw new Error();
      if (data?.turns.length > unknown.count) {
        setTurns(data.turns);
        setId(unknown.chat);
        const currentDraft = drafts.get(id) ?? "";
        const retained =
          !unknown.stopped && currentDraft === unknown.original
            ? ""
            : currentDraft;
        setText(retained);
        drafts.delete(id);
        drafts.set(unknown.chat, retained);
        window.history.replaceState(
          null,
          "",
          `/conversation?chat=${encodeURIComponent(unknown.chat)}`,
        );
        setError("");
        setUnknown(null);
        void refresh();
      } else if (data?.inProgress)
        setError(
          "The saved conversation is still processing. Check again before trying to send.",
        );
      else {
        setError(
          "No new saved response was found. Your draft is preserved. You can now explicitly retry.",
        );
        setUnknown(null);
      }
    } catch {
      setError(
        "Saved state couldn’t be checked. Check again before trying to send.",
      );
    } finally {
      if (version === privacyVersion.current) setOperation("");
    }
  }
  async function draft(turnId: string) {
    if (pending.current || unknown) return;
    pending.current = true;
    setOperation("draft");
    setError("");
    const version = privacyVersion.current;
    try {
      await payments.run(`turn:${turnId}:prepare`, async () => {
        const response = await fetch("/api/conversation/payment-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: id, turnId }),
        });
        if (response.status === 401) {
          clearPrivate();
          return;
        }
        if (!response.ok)
          throw new Error(
            "Draft response could not be confirmed. Open saved payments to recover the card.",
          );
      });
    } finally {
      pending.current = false;
      if (version === privacyVersion.current) setOperation("");
    }
  }
  async function signIn() {
    if (pending.current) return;
    pending.current = true;
    setOperation("signin");
    setSigninError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Too many attempts. Try again in 15 minutes."
            : "Sign-in failed. Check your operator password.",
        );
      setPassword("");
      signin.current?.close();
      await refresh();
    } catch (e) {
      setSigninError(
        e instanceof Error ? e.message : "Sign-in unavailable. Try again.",
      );
    } finally {
      pending.current = false;
      setOperation("");
    }
  }
  async function signOut() {
    discardVoiceCapture();
    stopSpeech();
    payments.reset();
    setOperation("signout");
    ++privacyVersion.current;
    ++requestVersion.current;
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) throw new Error();
      clearPrivate();
      setText("");
      setError("");
      window.history.replaceState(null, "", "/conversation");
      drawer.current?.close();
    } catch {
      setError("Sign-out couldn’t complete. Try again.");
    } finally {
      pending.current = false;
      setPendingText("");
      setOperation("");
    }
  }
  const selected = accounts.find((a) => a.accountId === account);
  const scope = selected
    ? `${selected.displayName}${selected.maskedNumber ? ` · •${selected.maskedNumber}` : ""}`
    : "No account selected";
  const empty = !loading && !turns.length && !pendingText;
  const sidebar = (
    <>
      <div className="agus-sidebar-brand">
        <span className="agus-brand-pair">
          <AgusSignal />
          <BrandAsset />
        </span>
        <button
          className="agus-icon-button agus-collapse"
          aria-label="Collapse navigation"
          onClick={() => toggleSidebar(false)}
        >
          <PanelLeft size={20} />
        </button>
      </div>
      <button
        className="agus-new"
        disabled={busy}
        onClick={() => void openChat("")}
      >
        <Plus size={18} /> New chat
      </button>
      <div className="agus-history-heading">Saved conversations</div>
      <nav aria-label="Saved chats" className="agus-history">
        {chats.map((chat) => (
          <button
            key={chat.id}
            className={id === chat.id ? "active" : ""}
            aria-current={id === chat.id ? "page" : undefined}
            disabled={busy}
            onClick={() => void openChat(chat.id)}
            title={chat.title}
          >
            <MessageSquare size={18} />
            <span>{chat.title}</span>
          </button>
        ))}
        {!chats.length && (
          <p className="agus-sidebar-empty">
            {loading
              ? "Loading conversations…"
              : authenticated
                ? "Your first saved chat will appear here."
                : "Sign in to save and revisit chats."}
          </p>
        )}
        {historyError && (
          <div className="agus-sidebar-empty" role="alert">
            <p>{historyError}</p>
            <button
              onClick={() =>
                void refresh().catch(() =>
                  setHistoryError("Saved chats are still unavailable."),
                )
              }
            >
              Retry saved chats
            </button>
          </div>
        )}
      </nav>
      <div className="agus-sidebar-bottom">
        <div className="agus-sidebar-note">
          <ShieldCheck size={16} />
          <span>
            Your next move.
            <br />
            <strong>Always in your hands.</strong>
          </span>
        </div>
        <button
          className="agus-sidebar-link"
          onClick={() => openModal(voiceSettings.current)}
        >
          <Mic size={18} /> Voice settings
        </button>
        <button
          className="agus-sidebar-link"
          onClick={() => {
            openModal(paymentHistory.current);
            void payments.refresh().catch(() => {});
          }}
        >
          <Wallet size={18} /> Saved payments
        </button>
        <button
          className="agus-plan-link"
          onClick={() => openModal(plans.current)}
        >
          <CreditCard size={18} /> Plans · Preview
        </button>
        {authenticated && (
          <button
            className="agus-account-trigger"
            aria-label={`Account: ${scope}`}
            onClick={() => {
              openModal(accountDialog.current);
              void loadAccounts();
            }}
          >
            {scope}
          </button>
        )}
        {authenticated ? (
          <div className="agus-profile">
            <span>
              Demo workspace
              <small>Shared operator identity</small>
            </span>
            <button aria-label="Sign out" onClick={() => void signOut()}>
              <LogOut size={18} />
            </button>
          </div>
        ) : (
          <button
            className="agus-sidebar-link agus-signin-trigger"
            onClick={() => openModal(signin.current)}
          >
            Sign in
          </button>
        )}
      </div>
    </>
  );
  return (
    <main className={`agus-workspace ${empty ? "agus-empty" : ""}`}>
      {!empty && <h1 className="agus-sr-only">Conversation</h1>}
      <a className="agus-skip" href="#financial-message">
        Skip to message
      </a>
      {sidebarOpen && (
        <aside
          id="agus-navigation"
          className="agus-sidebar"
          aria-label="Conversation sidebar"
        >
          {sidebar}
        </aside>
      )}
      <dialog
        ref={drawer}
        className="agus-dialog agus-drawer"
        aria-label="Conversations"
        onClose={restoreFocus}
      >
        <button
          className="agus-icon-button agus-drawer-close"
          aria-label="Close conversations"
          onClick={() => drawer.current?.close()}
        >
          <X size={20} />
        </button>
        {sidebar}
      </dialog>
      <section className="agus-main" aria-label="agus. conversation workspace">
        <header className="agus-header">
          <div>
            <button
              ref={menu}
              className="agus-icon-button agus-navigation-toggle"
              aria-label="Open conversations"
              onClick={() => {
                if (window.matchMedia("(min-width: 1024px)").matches)
                  toggleSidebar(!sidebarOpen);
                else openModal(drawer.current);
              }}
            >
              <PanelLeft size={20} />
            </button>
            <span
              className={
                sidebarOpen
                  ? "agus-header-brand sidebar-expanded"
                  : "agus-header-brand"
              }
            >
              <BrandAsset />
            </span>
            {empty && (
              <span className="agus-header-caption">
                A little clarity goes a long way.
              </span>
            )}
            {!empty && (
              <span
                className="agus-header-title"
                title={chats.find((c) => c.id === id)?.title}
              >
                {chats.find((c) => c.id === id)?.title ?? "New conversation"}
              </span>
            )}
          </div>
          <div className="agus-header-actions">
            {authenticated ? (
              <button
                className="agus-account-pill"
                aria-label={`Choose records account: ${scope}`}
                disabled={busy}
                onClick={() => {
                  openModal(accountDialog.current);
                  void loadAccounts();
                }}
              >
                <Wallet size={15} />
                <span>
                  {selected ? selected.displayName : "Choose account"}
                </span>
                <ChevronDown size={14} />
              </button>
            ) : (
              <button
                className="agus-header-signin"
                aria-label="Sign in to AGUS"
                onClick={() => openModal(signin.current)}
              >
                Sign in <ArrowUpRight size={15} />
              </button>
            )}
            <button
              className="agus-icon-button"
              aria-label="New chat"
              title="New chat"
              disabled={busy}
              onClick={() => void openChat("")}
            >
              <SquarePen size={20} />
            </button>
          </div>
        </header>
        {selected && (
          <p className="agus-active-scope">
            <span />
            {scope}
            <small>Fictional records</small>
          </p>
        )}
        <div
          className="agus-scroll"
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (el) {
              follow.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
              if (follow.current) setShowLatest(false);
            }
          }}
        >
          {loading ? (
            <p role="status">Opening conversation…</p>
          ) : empty ? (
            <section className="agus-welcome">
              <div className="agus-welcome-emblem">
                <AgusSignal />
              </div>
              <p className="agus-eyebrow">YOUR MONEY. A NEW PERSPECTIVE.</p>
              <h1 className="agus-welcome-question">Let's talk money.</h1>
              <p className="agus-welcome-description">
                Make sense of your spending.
                <br className="agus-mobile-break" /> Make room for what’s next.
              </p>
              <div className="agus-suggestions">
                {suggestions.map(
                  ({ title, description, text: prompt, icon: Icon }) => (
                    <button
                      key={title}
                      disabled={voiceBusy}
                      onClick={() => choose(prompt)}
                    >
                      <Icon size={20} className="agus-suggestion-icon" />
                      <span>
                        <strong>{title}</strong>
                        <small>{description}</small>
                      </span>
                      <ArrowUpRight
                        size={16}
                        className="agus-suggestion-arrow"
                      />
                    </button>
                  ),
                )}
              </div>
            </section>
          ) : (
            <section className="agus-thread" aria-label="Conversation replies">
              {turns.some((t) => t.reply.kind === "financial") && !account && (
                <p className="agus-history-note">
                  Saved results reflect the data available then. Choose an
                  account to check current records.
                </p>
              )}
              {turns.map((turn) => (
                <article key={turn.id} className="agus-turn">
                  <div className="agus-user-message">
                    <span className="agus-speaker">You</span>
                    <CopyableMessage label="user message">
                      <p>{turn.text}</p>
                    </CopyableMessage>
                  </div>
                  <div className="agus-assistant-message">
                    <h2 className="agus-response-heading">
                      <AgusSignal />
                      <span>agus.</span>
                      <small>
                        {turn.reply.kind === "financial"
                          ? "Financial insight"
                          : turn.reply.handoff
                            ? "Payment planning"
                            : ""}
                      </small>
                    </h2>
                    {turn.reply.kind === "conflict" && (
                      <p className="agus-reply-notice">
                        Your financial context changed. Choose an account and
                        check the records again.
                      </p>
                    )}
                    <CopyableMessage label="AGUS response">
                      <FinancialResponse reply={turn.reply} choose={choose} />
                    </CopyableMessage>
                    {turn.reply.accountAction === "choose_demo_account" && (
                      <button
                        className="agus-secondary"
                        disabled={busy || !!unknown}
                        onClick={() => {
                          setAccountQuestion({ chat: id, text: turn.text });
                          openModal(accountDialog.current);
                          void loadAccounts();
                        }}
                      >
                        Choose demo account
                      </button>
                    )}
                    {turn.reply.handoff &&
                      (() => {
                        const message = payments.snapshot?.messages.find(
                          (m) =>
                            m.turnId === turn.id &&
                            m.conversationId === id &&
                            (!!m.proposals?.length || !!m.batchId),
                        );
                        return message ? (
                          <NativePayment
                            controller={payments}
                            message={message}
                            recover={() => openModal(paymentHistory.current)}
                          />
                        ) : (
                          <div className="agus-handoff">
                            <PaymentNotice
                              controller={payments}
                              scope={`turn:${turn.id}`}
                              recover={() => openModal(paymentHistory.current)}
                            />
                            <button
                              className="agus-secondary"
                              disabled={
                                busy ||
                                payments.busy ||
                                !!unknown ||
                                !payments.snapshot
                              }
                              onClick={() => void draft(turn.id)}
                            >
                              Prepare payment draft
                            </button>
                          </div>
                        );
                      })()}
                    <button
                      className="agus-listen agus-icon-button"
                      aria-label={
                        speech.playing === turn.id
                          ? "Stop reading response"
                          : "Listen to response"
                      }
                      title={
                        speech.playing === turn.id ? "Stop reading" : "Listen"
                      }
                      aria-pressed={speech.playing === turn.id}
                      onClick={() =>
                        speech.speak(turn.id, responseSpeechText(turn.reply))
                      }
                    >
                      {speech.playing === turn.id ? (
                        <VolumeX size={16} />
                      ) : (
                        <Volume2 size={16} />
                      )}
                    </button>
                    <span className="agus-response-time">
                      Saved{" "}
                      {new Date(turn.createdAt).toLocaleString("en-NG", {
                        timeZone: "Africa/Lagos",
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      WAT
                    </span>
                  </div>
                </article>
              ))}
              {pendingText && (
                <article className="agus-turn">
                  <div className="agus-user-message">
                    <span className="agus-speaker">You</span>
                    <p>{pendingText}</p>
                  </div>
                  <div className="agus-thinking" role="status">
                    <AgusSignal />
                    <span>
                      {longWait
                        ? "Still working on your question…"
                        : "Thinking it through…"}
                      <small>
                        {longWait
                          ? "You can stop this response at any time."
                          : "Checking the next step"}
                      </small>
                    </span>
                  </div>
                </article>
              )}
            </section>
          )}
        </div>
        <div className="agus-composer-area">
          {showLatest && (
            <button
              className="agus-latest"
              onClick={() => {
                follow.current = true;
                if (scroll.current)
                  scroll.current.scrollTop = scroll.current.scrollHeight;
                setShowLatest(false);
              }}
            >
              Latest response
            </button>
          )}
          {speech.error && (
            <p className="agus-audio-status" role="status">
              {speech.error}
            </p>
          )}
          {voice.voiceStatus && (
            <div className="agus-audio-status" role="status">
              {voice.voiceStatus}
              {voiceBusy && (
                <button
                  type="button"
                  aria-label="Cancel recording"
                  onClick={discardVoiceCapture}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          {voice.liveTranscript && (
            <p
              className="agus-live-transcript"
              aria-live="polite"
              aria-label="Live transcript"
            >
              {voice.liveTranscript}
            </p>
          )}
          {error && (
            <div className="agus-error" role="alert">
              <p>{error}</p>
              {unknown &&
                (unknown.payment ? (
                  <button onClick={() => openModal(paymentHistory.current)}>
                    Check saved payments
                  </button>
                ) : (
                  <button disabled={busy} onClick={() => void checkSaved()}>
                    Check saved conversation
                  </button>
                ))}
            </div>
          )}
          {busy && operation !== "message" && (
            <p role="status">
              {operation === "draft"
                ? "Opening payment draft…"
                : operation === "check"
                  ? "Checking saved conversation…"
                  : "Updating session…"}
            </p>
          )}
          <form
            className="agus-composer"
            aria-busy={busy}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className="agus-sr-only" htmlFor="financial-message">
              Message AGUS
            </label>
            <textarea
              ref={composer}
              id="financial-message"
              placeholder="Ask agus anything…"
              value={text}
              rows={1}
              maxLength={4000}
              readOnly={
                (busy && operation !== "message") || loading || voiceBusy
              }
              onSelect={rememberSelection}
              onBlur={rememberSelection}
              onScroll={rememberSelection}
              onChange={(e) => updateText(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229 &&
                  !window.matchMedia("(pointer: coarse)").matches
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="agus-composer-toolbar">
              <span className="agus-character-count">
                {text.length >= 3500
                  ? `${text.length}/4000${text.length === 4000 ? " · Message limit reached" : ""}`
                  : ""}
              </span>
              {voice.listening &&
                (voice.waveform === null ? (
                  <span
                    className="agus-recording-pulse"
                    aria-label="Recording indicator"
                  >
                    Recording · level unavailable
                  </span>
                ) : (
                  <span
                    className="agus-recording-level"
                    role="img"
                    aria-label="Microphone sound level"
                    data-level={voice.audioLevel?.toFixed(2)}
                  >
                    {voice.waveform.map((level, index) => (
                      <i
                        key={index}
                        style={{
                          height: `${2 + level * 28}px`,
                        }}
                      />
                    ))}
                  </span>
                ))}
              <button
                className={`agus-icon-button agus-mic${voice.listening ? " is-recording" : ""}`}
                type="button"
                aria-label={
                  voice.listening ? "Stop recording" : "Start recording"
                }
                title={voice.listening ? "Stop recording" : "Record a message"}
                aria-pressed={voice.listening}
                disabled={
                  busy ||
                  loading ||
                  !authenticated ||
                  voice.requestingVoice ||
                  voice.transcribingVoice
                }
                onClick={() => {
                  stopSpeech();
                  void voice.toggleVoiceInput();
                }}
              >
                {voice.listening ? <Square size={17} /> : <Mic size={19} />}
              </button>
              {operation === "message" ? (
                <button
                  className="agus-send agus-stop"
                  type="button"
                  aria-label="Stop response"
                  title="Stop response"
                  onClick={stopGeneration}
                >
                  <Square size={16} fill="currentColor" />
                </button>
              ) : (
                <button
                  className="agus-send"
                  type="submit"
                  aria-label="Send message"
                  disabled={
                    busy || loading || voiceBusy || !!unknown || !text.trim()
                  }
                >
                  <ArrowUp size={20} />
                </button>
              )}
            </div>
          </form>
          <div className="agus-composer-hint">
            <span>
              <ShieldCheck size={12} />
              You stay in control of every payment.
            </span>
            <span>Shift + Enter for a new line</span>
          </div>
        </div>
        <details className="agus-demo-strip">
          <summary>
            {paymentMode === "fixture"
              ? "Demo · Fictional financial data"
              : `${paymentMode} payment environment`}
          </summary>
          <p>
            {paymentMode === "fixture"
              ? "Demo Access · Transactions use local fixture simulation. These are fictional source records. No real banking is connected and no real funds move."
              : paymentMode === "test"
                ? "Test Access · Transactions use Paystack test mode. No real funds move."
                : "Live Access · Transfers can move real funds only when all server safeguards permit them; operator review and authorization are required."}
          </p>
        </details>
      </section>
      <div className="agus-sr-only" role="status" aria-live="polite">
        {announcement}
      </div>
      <dialog
        ref={voiceSettings}
        className="agus-dialog"
        aria-labelledby="voice-settings-title"
        onClose={restoreFocus}
      >
        <div className="agus-dialog-heading">
          <h2 id="voice-settings-title">Voice settings</h2>
          <button
            className="agus-icon-button"
            aria-label="Close voice settings"
            onClick={() => voiceSettings.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <label className="agus-voice-setting">
          Recognition language
          <select
            value={voiceLanguage}
            disabled={voiceBusy}
            onChange={(event) => setVoiceLanguage(event.target.value)}
          >
            <option value="en-NG">English (Nigeria)</option>
            <option value="en-GB">English (UK)</option>
            <option value="en-US">English (US)</option>
          </select>
        </label>
        <p>
          Speak naturally, including Pidgin. Recognition quality and live text
          depend on your browser and speech provider. Always review names,
          amounts and account details.
        </p>
        <label className="agus-voice-setting">
          <span>Read new replies aloud</span>
          <input
            type="checkbox"
            checked={spokenReplies}
            onChange={(event) => {
              spokenRepliesEnabled.current = event.target.checked;
              setSpokenReplies(event.target.checked);
              if (!event.target.checked) stopSpeech();
            }}
          />
        </label>
        <p>
          This enables spoken turn-taking for this session. Press the
          microphone, stop, review and send. AGUS can read its answer aloud. It
          does not keep listening, send speech automatically or authorize a
          payment.
        </p>
        <details>
          <summary>Voice processing and privacy</summary>
          <p>
            Microphone access begins only when you press Record and requires
            HTTPS or localhost. The waveform measures real microphone samples
            locally. Native browser recognition may send audio to the browser’s
            speech service. Where unavailable, a recording is sent to the
            configured AI provider for transcription after Stop. The app does
            not save audio. Cancel discards pending input; leaving the page
            stops capture. Sent transcripts are saved with your conversation.
            Browser or operating-system speech services may process reply text
            for playback.
          </p>
        </details>
      </dialog>
      <dialog
        ref={paymentHistory}
        className="agus-dialog agus-payment-history"
        aria-label="Saved payments"
        onClose={restoreFocus}
      >
        <div className="agus-dialog-heading">
          <h2>Saved payments</h2>
          <button
            className="agus-icon-button"
            aria-label="Close saved payments"
            onClick={() => paymentHistory.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          Saved drafts and individual outcomes. Processing or unknown means
          unresolved; check the existing reference before taking further action.
        </p>
        <PaymentNotice controller={payments} scope="history" />
        <button
          className="agus-secondary"
          onClick={() => void payments.recover()}
        >
          Refresh saved payments
        </button>
        {payments.snapshot?.emergencyDisabled && (
          <p role="status">Submission is disabled by the emergency switch.</p>
        )}
        <button
          className="agus-secondary"
          disabled={payments.busy || !payments.snapshot}
          onClick={() =>
            void payments.run("stop", () =>
              fetch("/api/emergency", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ disabled: true }),
              }).then((r) => {
                if (!r.ok)
                  throw new Error("Emergency stop could not be confirmed.");
              }),
            )
          }
        >
          Stop payment submissions
        </button>
        <a href="/api/reports" download>
          Download payment history CSV
        </a>
        {payments.snapshot?.messages
          .filter((m) => m.proposals?.length && !m.batchId && !m.supersededBy)
          .map((m) => (
            <NativePayment key={m.id} controller={payments} message={m} />
          ))}
        {payments.snapshot?.batches.map((b) => (
          <NativePayment key={b.id} controller={payments} batch={b} />
        ))}
        {!payments.snapshot && <p role="status">Loading saved payments…</p>}
        {payments.snapshot &&
          !payments.snapshot.batches.length &&
          !payments.snapshot.messages.some(
            (m) => m.proposals?.length && !m.batchId,
          ) && (
            <p>No saved payments yet. Prepare a payment in the conversation.</p>
          )}
      </dialog>
      <dialog
        className="agus-dialog agus-account-dialog"
        ref={accountDialog}
        aria-labelledby="agus-account-title"
        onClose={restoreFocus}
      >
        <div className="agus-dialog-heading">
          <h2 id="agus-account-title">Account</h2>
          <button
            className="agus-icon-button"
            aria-label="Close account"
            onClick={() => accountDialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p>
          Choose fictional demo records for personal-record questions. General
          conversation needs no account.
        </p>
        {accountLoading && <p role="status">Loading authorized accounts…</p>}
        <label htmlFor="agus-account">Account (optional)</label>
        <select
          id="agus-account"
          value={account}
          disabled={busy || accountLoading}
          onChange={(e) => {
            setAccount(e.target.value);
            setAnnouncement(
              e.target.value
                ? `Selected ${accounts.find((a) => a.accountId === e.target.value)?.displayName}`
                : "General conversation selected",
            );
          }}
        >
          <option value="">General conversation · No account selected</option>
          {accounts.map((a) => (
            <option key={a.accountId} value={a.accountId}>
              {a.displayName}
              {a.maskedNumber ? ` · •${a.maskedNumber}` : ""}
            </option>
          ))}
        </select>
        {accountError && <p role="alert">{accountError}</p>}
        {accountQuestion?.chat === id && (
          <button
            className="agus-secondary"
            disabled={
              !account ||
              busy ||
              loading ||
              voiceBusy ||
              !!unknown ||
              !!text.trim()
            }
            onClick={() => {
              const question = accountQuestion.text;
              setAccountQuestion(null);
              accountDialog.current?.close();
              void send(question);
            }}
          >
            Continue question
          </button>
        )}
        {accountQuestion?.chat === id && !!text.trim() && (
          <p>
            Your unsent draft is preserved. Send or clear it before continuing
            the saved question.
          </p>
        )}
        {(accountError || authenticated === false) && (
          <button
            className="agus-secondary"
            disabled={accountLoading}
            onClick={() =>
              authenticated ? void loadAccounts() : openModal(signin.current)
            }
          >
            {authenticated ? "Retry authorized accounts" : "Sign in"}
          </button>
        )}
      </dialog>
      <dialog
        className="agus-dialog agus-plans"
        ref={plans}
        aria-labelledby="agus-plans-title"
        onClose={restoreFocus}
      >
        <div className="agus-dialog-heading">
          <h2 id="agus-plans-title">Plans</h2>
          <button
            className="agus-icon-button"
            aria-label="Close plans"
            onClick={() => plans.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <p>Preview · Subscriptions and billing are not active.</p>
        <p>Usage isn’t metered in this demo.</p>
        <div className="agus-plan-grid">
          {[
            {
              name: "Free",
              items: [
                "Everyday conversations",
                "Financial education",
                "Explore the demo workspace",
              ],
            },
            {
              name: "Personal Plus",
              items: [
                "Proposed expanded access",
                "Personal finance workflows",
                "Deeper record exploration",
              ],
            },
            {
              name: "Business",
              items: [
                "Proposed team workspace",
                "Business finance workflows",
                "Collaborative payment review",
              ],
            },
          ].map((tier) => (
            <section key={tier.name}>
              <h3>{tier.name}</h3>
              <span className="agus-preview">Proposed tier</span>
              <ul>
                {tier.items.map((item) => (
                  <li key={item}>
                    <Check size={14} /> {item}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </dialog>
      <dialog
        className="agus-dialog agus-signin"
        ref={signin}
        aria-labelledby="agus-signin-title"
        onClose={() => {
          setPassword("");
          restoreFocus();
        }}
      >
        <div className="agus-dialog-heading">
          <h2 id="agus-signin-title">Sign in</h2>
          <button
            className="agus-icon-button"
            aria-label="Close sign in"
            onClick={() => signin.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        <BrandAsset lockup />
        <p>
          This demo uses a shared operator identity. People using the same
          operator identity share its saved chats.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <label htmlFor="agus-password">Operator password</label>
          <input
            id="agus-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
          />
          <button className="agus-secondary" disabled={busy || !password}>
            {operation === "signin" ? "Signing in…" : "Continue"}
          </button>
        </form>
        {signinError && (
          <p className="agus-error" role="alert">
            {signinError}
          </p>
        )}
      </dialog>
    </main>
  );
}
