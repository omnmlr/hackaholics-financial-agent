/* global document, location, URL, URLSearchParams, setTimeout, clearTimeout, matchMedia, window */
(() => {
  const query = new URLSearchParams(location.search);
  let direction = query.get("direction") === "margin" ? "margin" : "orbit";
  let view = query.get("view") || "home";
  let companionState = "idle";
  let privacy = false;
  let timer;
  const icons = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    diagonal: '<path d="M6 18 18 6M6 6h12v12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    home: '<path d="m3 10 9-7 9 7v10H3zM9 20v-7h6v7"/>',
    money:
      '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 8V5a2 2 0 0 1 2-2h12M16 11h5v5h-5z"/>',
    obligations:
      '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2v4m6-4v4M9 11h6m-6 5h4"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z"/><path d="M8 10h8m-8 4h5"/>',
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
    bank: '<path d="m3 8 9-5 9 5v2H3zM5 12v6m7-6v6m7-6v6M3 21h18"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    shield:
      '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  };
  function icon(name, size = 20) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.arrow}</svg>`;
  }
  function wordmark() {
    return `<svg class="wordmark" viewBox="0 0 186 64" fill="none" aria-label="agus." role="img"><g stroke="currentColor" stroke-width="7.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="22" cy="26" r="15"/><path d="M37 12v30"/><circle cx="68" cy="26" r="15"/><path d="M83 12v31c0 20-27 21-30 6M101 12v20c0 17 27 17 27 0V12M166 16c-9-9-28-5-27 5 1 12 29 4 29 16 0 11-20 14-30 3"/></g><circle cx="181" cy="40" r="4.5" fill="currentColor"/></svg>`;
  }
  function mascot(state = "idle", extra = "") {
    return `<svg class="mascot ${state} ${extra}" viewBox="0 0 300 285" role="img" aria-label="AGUS, ${state}"><defs><linearGradient id="silver-${state}-${extra}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#fafafa"/><stop offset="1" stop-color="#bdbdbd"/></linearGradient></defs><g class="ghost-orbit"><ellipse cx="151" cy="183" rx="126" ry="33" transform="rotate(15 151 183)" fill="none" stroke="#f4f4f4" stroke-width="7"/></g><g class="ghost-body"><path d="M66 181C75 159 79 127 101 91 122 55 151 36 181 40 222 43 246 75 248 110 252 149 231 191 209 213 185 237 165 249 147 242 140 240 143 229 133 230 112 236 75 250 60 233 47 220 55 203 66 181Z" fill="url(#silver-${state}-${extra})"/><g class="open-eyes" fill="#080808"><rect x="174" y="91" width="13" height="31" rx="6.5" transform="rotate(-29 174 91)"/><rect x="207" y="76" width="13" height="31" rx="6.5" transform="rotate(-29 207 76)"/></g><g class="closed-eyes" fill="none" stroke="#080808" stroke-width="6" stroke-linecap="round"><path d="M166 110q8 12 17-1M200 95q8 12 17-1"/></g><g class="happy-eyes" fill="none" stroke="#080808" stroke-width="6" stroke-linecap="round"><path d="M166 113q0-17 15-12m18-4q0-17 15-12"/></g></g><path class="front-orbit" d="M30 151C15 184 229 247 270 199" fill="none" stroke="#090909" stroke-width="16"/><path class="front-orbit" d="M30 151C15 184 229 247 270 199" fill="none" stroke="#f5f5f5" stroke-width="6"/><path class="twinkle" d="M252 25q0 20-18 20 18 0 18 20 0-20 18-20-18 0-18-20Z" fill="#fff"/></svg>`;
  }
  const navItems = [
    ["home", "Home"],
    ["assistant", "AGUS"],
    ["money", "Money"],
    ["obligations", "Obligations"],
    ["activity", "Activity"],
  ];
  function nav(mobile = false) {
    return `<nav class="${mobile ? "mobile-nav" : "main-nav"}" aria-label="${mobile ? "Mobile" : "Main"} navigation">${navItems.map(([key, label]) => `<button class="nav-link ${view === key ? "selected" : ""} ${key === "assistant" ? "agus-nav" : ""}" data-view="${key}" ${view === key ? 'aria-current="page"' : ""}>${mobile ? (key === "assistant" ? mascot(companionState, "nav-ghost") : icon(key === "assistant" ? "chat" : key)) : ""}<span>${label}</span></button>`).join("")}</nav>`;
  }
  function composer(home = false) {
    return `<div class="composer-wrap"><form class="composer ${home ? "home-composer" : ""}"><button type="button" class="icon-button attach" data-action="attach" aria-label="Attach a document">${icon("plus")}</button><input name="message" aria-label="Message AGUS" placeholder="${home ? "What’s on your mind?" : "Keep the conversation going…"}" autocomplete="off"><button type="button" class="icon-button" data-action="listen" aria-label="Preview listening state">${icon("mic")}</button><button class="send" aria-label="Send message">${icon("arrow")}</button></form><p class="composer-note">${icon("shield", 13)} You review. You authorize. Always.</p></div>`;
  }
  function privacyButton() {
    return `<button class="privacy-control ${privacy ? "on" : ""}" data-action="privacy" aria-pressed="${privacy}">${icon("lock", 14)} ${privacy ? "Balances hidden" : "Hide balances"}</button>`;
  }
  function homeOrbit() {
    return `<main class="orbit-home"><div class="home-intro"><p class="eyebrow"><span class="small-dot"></span> A little space for what’s next</p><h1>Your money.<br>More possibility.</h1><p class="intro-copy">A clearer picture. A thoughtful next step.<br>And a little company along the way.</p>${composer(true)}<div class="suggestions"><button data-prompt="Help me prepare a payment">Prepare a payment ${icon("diagonal", 14)}</button><button data-view="money">Find my starting point ${icon("diagonal", 14)}</button></div></div><div class="orbit-stage"><div class="orbit-track track-one"></div><div class="orbit-track track-two"></div><div class="stage-cross cross-one">+</div><div class="stage-cross cross-two">+</div><span class="coordinate">01 / YOUR FINANCIAL COMPANION</span><div class="hero-ghost">${mascot(companionState, "hero")}</div><div class="companion-caption"><span class="small-dot"></span> Here, when you need me.</div></div><section class="starting-point"><div class="section-index">01 <span>YOUR STARTING POINT</span></div><div><h2>A clearer picture starts here.</h2><p>Add your financial records when you’re ready.</p></div><button class="white-button" data-view="money">Explore your money ${icon("arrow", 17)}</button><span class="no-data">No records added yet</span></section></main>`;
  }
  function homeMargin() {
    return `<main class="margin-home"><section class="paper"><div class="paper-top"><span>THE EVERYDAY, CONSIDERED.</span><span>01 — HOME</span></div><h1>Your money.<br>In good<br> <em>company.</em></h1><p class="paper-copy">For the things you need to do.<br>And the things you’re working towards.</p><button class="ink-button" data-view="assistant">Let’s figure it out ${icon("arrow", 18)}</button><div class="paper-rule"></div><section class="margin-start"><span class="section-index">A PLACE TO BEGIN</span><button data-view="money"><span><strong>Bring your money into view.</strong><small>Add bank records. Discover your wallet options.</small></span>${icon("diagonal", 23)}</button><p>No records added. Your story starts with you.</p></section><div class="paper-bottom"><span>Your money, and what’s next.</span><span>AGUS®</span></div></section><section class="companion-room"><div class="room-heading"><span>A little intelligence.<br>A little intuition.</span>${privacyButton()}</div><div class="room-art"><div class="vertical-orbit"></div><div class="hero-ghost">${mascot(companionState, "margin-hero")}</div><span class="room-star">✦</span></div><div class="room-bottom"><p class="room-message">Big plans.<br>Small questions.<br><span>I’m here for both.</span></p>${composer(true)}</div></section></main>`;
  }
  function draft() {
    return `<section class="draft-card"><div class="draft-top"><span>${icon("bank", 16)} Payment preparation</span><span class="status-pill">Details needed</span></div><h3>Let’s start with the essentials.</h3><dl><div><dt>Recipient</dt><dd>Who are you paying?</dd></div><div><dt>Amount</dt><dd class="draft-amount">— <small>NGN</small></dd></div></dl><button class="draft-action" data-action="methods">Choose a payment method ${icon("arrow", 17)}</button><p>${icon("lock", 12)} Nothing moves without your authorization.</p></section>`;
  }
  function thread() {
    return `<div class="thread"><div class="thread-date">A new conversation</div><div class="user-message"><span>You</span><p>Help me prepare a payment.</p></div><div class="assistant-message"><div class="message-author">${mascot("idle", "message-ghost")}<strong>AGUS</strong><span>A thoughtful next step</span></div><p>Of course. Who would you like to pay,<br class="desktop-br"> and how much?</p><p class="secondary-message">We’ll check the recipient’s details together<br class="desktop-br"> before you review anything.</p>${draft()}</div><div id="extra-messages"></div></div>`;
  }
  function historyPanel() {
    return `<aside class="history-panel"><button class="new-conversation" data-action="new">${icon("plus", 16)} New conversation</button><p class="section-index">CONVERSATIONS</p><button class="history-item active" data-action="sample"><span>Preparing a payment</span><small>Sample conversation</small></button><div class="history-footer">Your conversations live here.<br>Payment outcomes live in Activity.</div></aside>`;
  }
  function assistant() {
    return `<main class="assistant-layout">${historyPanel()}<section class="conversation-panel"><header class="conversation-header"><div><span class="section-index">YOU + AGUS</span><h1>A little clarity, together.</h1></div><button class="icon-button history-toggle" data-action="history" aria-label="Saved conversations">${icon("history")}</button>${privacyButton()}</header>${thread()}${composer()}</section>${direction === "margin" ? `<aside class="assistant-presence"><p>ONE THING AT A TIME.</p><div class="presence-art">${mascot(companionState, "presence")}</div><h2>Your next move.<br><em>Considered.</em></h2><div class="presence-foot">${icon("shield", 18)}<p>I help you prepare.<br>You decide what happens next.</p></div></aside>` : ""}</main>`;
  }
  function emptyView() {
    const data =
      {
        money: [
          "Your money, in view.",
          "A place for every part of your financial life.",
          "bank",
          "Bank records",
          "Start with a statement.",
          "Your records stay separate from your payment methods.",
        ],
        obligations: [
          "Nothing left hanging.",
          "A clearer view of what you owe and what you’re owed.",
          "obligations",
          "A place for what’s due.",
          "No obligations added yet.",
          "Reminder and follow-up tools are a proposed part of this experience.",
        ],
        activity: [
          "Every move, accounted for.",
          "Payment requests, verifications and confirmed outcomes.",
          "activity",
          "Your activity starts here.",
          "No financial operations yet.",
          "Conversations are saved separately in AGUS.",
        ],
      }[view] || [];
    return `<main class="empty-view"><p class="eyebrow">${view.toUpperCase()}</p><h1>${data[0]}</h1><p class="empty-sub">${data[1]}</p><div class="empty-body">${icon(data[2], 38)}<h2>${data[3]}</h2><p>${data[4]}<br>${data[5]}</p><button class="white-button" data-action="${view === "money" ? "records" : "talk"}">${view === "money" ? "Explore bank records" : "Talk to AGUS"} ${icon("arrow", 17)}</button></div>${view === "money" ? `<div class="money-categories"><button data-action="records">${icon("bank")}<span>Bank records<small>No records added</small></span>${icon("diagonal", 17)}</button><button data-action="wallets">${icon("money")}<span>Wallets<small>Explore proposed connections</small></span>${icon("diagonal", 17)}</button><button data-action="methods">${icon("shield")}<span>Payment methods<small>Bank transfer and proposed networks</small></span>${icon("diagonal", 17)}</button></div>` : ""}</main>`;
  }
  function render() {
    document.body.className = direction;
    document.title = `AGUS · ${direction === "orbit" ? "Orbit" : "Margin"} · ${view}`;
    document.querySelector("#app").innerHTML =
      `<div class="exploration-bar"><a href="./review.html">THE LIVING INTERFACE <span>/ VISUAL EXPLORATION</span></a><div class="direction-switch"><button data-direction="orbit" class="${direction === "orbit" ? "active" : ""}">01 Orbit</button><button data-direction="margin" class="${direction === "margin" ? "active" : ""}">02 Margin</button></div><button class="state-link" data-action="states">Companion states ${icon("diagonal", 12)}</button></div><div class="app-shell"><header class="app-header"><a href="?direction=${direction}" class="brand" aria-label="AGUS home">${wordmark()}</a>${nav()}<div class="header-end"><span class="local-label">Your personal space</span><button class="profile-button" data-action="profile" aria-label="Your profile">Y</button></div></header>${view === "home" ? (direction === "orbit" ? homeOrbit() : homeMargin()) : view === "assistant" ? assistant() : emptyView()}<footer class="desktop-footer"><span>Your money, and what’s next.</span><button class="desktop-companion" data-action="companion" aria-label="Talk to AGUS">${mascot(companionState, "dock-ghost")}<span>${companionState === "idle" ? "Talk to AGUS" : stateLabels[companionState]}</span></button><button data-action="states">${icon("dots", 17)} <span>Meet your companion</span></button></footer>${nav(true)}</div>`;
    wire();
  }
  const stateLabels = {
    idle: "Here with you",
    listening: "Listening",
    thinking: "Thinking it through",
    analyzing: "Looking closer",
    privacy: "Balances hidden",
    completed: "All set",
  };
  function setState(state) {
    companionState = state;
    document.querySelectorAll(".mascot:not(.state-demo)").forEach((el) => {
      el.classList.remove(
        "idle",
        "listening",
        "thinking",
        "analyzing",
        "privacy",
        "completed",
      );
      el.classList.add(state);
      el.setAttribute("aria-label", `AGUS, ${state}`);
    });
    const label = document.querySelector(".desktop-companion span");
    if (label) label.textContent = stateLabels[state];
  }
  function go(next) {
    clearTimeout(timer);
    view = next;
    companionState = privacy ? "privacy" : "idle";
    document.querySelector("#overlay").innerHTML = "";
    const u = new URL(location.href);
    u.searchParams.set("view", next);
    u.searchParams.set("direction", direction);
    historyReplace(u);
    render();
    window.scrollTo(0, 0);
  }
  function historyReplace(url) {
    window.history.replaceState(null, "", url);
  }
  function modal(title, body) {
    const overlay = document.querySelector("#overlay");
    overlay.innerHTML = `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1"><header><h2>${title}</h2><button class="icon-button" data-close aria-label="Close dialog">${icon("close")}</button></header>${body}</section></div>`;
    const previous = document.activeElement;
    const close = () => {
      overlay.innerHTML = "";
      previous?.focus();
    };
    overlay.querySelector("[data-close]").onclick = close;
    overlay.querySelector(".modal-backdrop").onclick = (e) => {
      if (e.target === e.currentTarget) close();
    };
    const dialog = overlay.querySelector(".modal");
    dialog.focus();
    dialog.onkeydown = (e) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab") {
        const controls = [...dialog.querySelectorAll("button,a,input")];
        if (e.shiftKey && document.activeElement === controls[0]) {
          e.preventDefault();
          controls.at(-1).focus();
        } else if (!e.shiftKey && document.activeElement === controls.at(-1)) {
          e.preventDefault();
          controls[0].focus();
        }
      }
    };
    return overlay;
  }
  function showStates() {
    const descriptions = {
      idle: "A quiet, steady presence.",
      listening: "Eyes focus. The orbit opens.",
      thinking: "A measured tilt while considering.",
      analyzing: "A tighter, more focused orbit.",
      privacy: "Eyes close; displayed balances hide.",
      completed: "A small moment of accomplishment.",
    };
    const el = modal(
      "A companion, with presence.",
      `<p class="modal-copy">Movement with meaning. Select a state to preview it.</p><div class="states-grid">${Object.keys(
        stateLabels,
      )
        .map(
          (s) =>
            `<button data-state="${s}">${mascot(s, "state-demo")}<strong>${s[0].toUpperCase() + s.slice(1)}</strong><small>${descriptions[s]}</small></button>`,
        )
        .join(
          "",
        )}</div><p class="modal-footnote">Listening is a visual preview. Privacy hides displayed balances; it does not imply private audio or payment processing.</p>`,
    );
    el.querySelectorAll("[data-state]").forEach(
      (b) =>
        (b.onclick = () => {
          setState(b.dataset.state);
          el.querySelectorAll("[data-state]").forEach((x) =>
            x.classList.toggle("state-selected", x === b),
          );
        }),
    );
  }
  function methods() {
    modal(
      "Choose how to pay.",
      `<p class="modal-copy">One place to understand your options.</p><div class="method-row"><span>${icon("bank", 25)}</span><div><strong>Bank transfer</strong><p>Paystack · Existing guarded payment flow</p></div><span class="method-tag">Current prototype</span></div><div class="method-row"><span>◎</span><div><strong>Pollar</strong><p>Proposed connection · Not integrated</p></div><span class="method-tag">Unavailable</span></div><div class="method-row"><span>ⓩ</span><div><strong>Zcash private payment</strong><p>Proposed connection · Not integrated</p></div><span class="method-tag">Unavailable</span></div><p class="modal-footnote">Visual exploration only. No payment can be authorized or sent here. Production review, reauthentication, submission and settlement checks must remain separate.</p>`,
    );
  }
  function act(action) {
    if (action === "states") return showStates();
    if (action === "methods") return methods();
    if (action === "companion" || action === "talk") return go("assistant");
    if (action === "privacy") {
      privacy = !privacy;
      setState(privacy ? "privacy" : "idle");
      document.querySelectorAll(".privacy-control").forEach((b) => {
        b.classList.toggle("on", privacy);
        b.setAttribute("aria-pressed", privacy);
        b.innerHTML = `${icon("lock", 14)} ${privacy ? "Balances hidden" : "Hide balances"}`;
      });
      return;
    }
    if (action === "listen") {
      setState("listening");
      return modal(
        "I’m listening. A visual preview.",
        `<div class="listening-preview">${mascot("listening", "listen-demo")}<h3>Take your time.</h3><div class="voice-bars">${Array.from({ length: 17 }, (_, i) => `<i style="--i:${i}"></i>`).join("")}</div><p>Microphone is off in this exploration.<br>In the app, review your words before sending.</p></div>`,
      );
    }
    if (action === "history") {
      const p = modal(
        "Your conversations",
        `<button class="new-conversation" id="fresh-chat">${icon("plus", 18)} New conversation</button><div class="method-row"><div><strong>Preparing a payment</strong><p>Sample conversation · Design preview</p></div></div><p class="modal-footnote">Financial outcomes are separate in Activity.</p>`,
      );
      p.querySelector("#fresh-chat").onclick = () => {
        go("assistant");
        document.querySelector(".thread").innerHTML =
          '<div class="new-thread">' +
          mascot("idle", "new-thread-ghost") +
          "<h2>What shall we figure out?</h2><p>Start with a thought. We’ll take it from there.</p></div>";
      };
      return;
    }
    if (action === "new") {
      go("assistant");
      document.querySelector(".thread").innerHTML =
        '<div class="new-thread">' +
        mascot("idle", "new-thread-ghost") +
        "<h2>What shall we figure out?</h2><p>Start with a thought. We’ll take it from there.</p></div>";
      return;
    }
    if (action === "sample") {
      go("assistant");
      return;
    }
    const copy = {
      attach: [
        "A little context helps.",
        "In the current app, attach a payment screenshot to extract editable details. Uploading is disabled in this visual exploration.",
      ],
      records: [
        "Start with what you have.",
        "Bank-record import is a proposed flow. No financial records are connected to this exploration.",
      ],
      wallets: [
        "A place for your wallets.",
        "Wallet connections are proposed. Pollar and Zcash are not integrated in the current checkout.",
      ],
      profile: [
        "Your personal space.",
        "Profile settings are a visual placeholder in this exploration.",
      ],
    }[action];
    if (copy) modal(copy[0], `<p class="modal-copy">${copy[1]}</p>`);
  }
  function wire() {
    document
      .querySelectorAll("[data-view]")
      .forEach((b) => (b.onclick = () => go(b.dataset.view)));
    document.querySelectorAll("[data-direction]").forEach(
      (b) =>
        (b.onclick = () => {
          direction = b.dataset.direction;
          go(view);
        }),
    );
    document
      .querySelectorAll("[data-action]")
      .forEach((b) => (b.onclick = () => act(b.dataset.action)));
    document
      .querySelectorAll("[data-prompt]")
      .forEach((b) => (b.onclick = () => go("assistant")));
    document.querySelectorAll(".composer").forEach(
      (form) =>
        (form.onsubmit = (e) => {
          e.preventDefault();
          const input = form.querySelector("input");
          const text = input.value.trim();
          if (!text) return;
          if (view !== "assistant") {
            go("assistant");
            const first = document.querySelector(".user-message>p");
            if (first) first.textContent = text;
            return;
          }
          const container =
            document.querySelector("#extra-messages") ||
            document.querySelector(".thread");
          const msg = document.createElement("div");
          msg.className = "user-message";
          const label = document.createElement("span");
          label.textContent = "You";
          const p = document.createElement("p");
          p.textContent = text;
          msg.append(label, p);
          container.append(msg);
          input.value = "";
          setState("thinking");
          timer = setTimeout(() => {
            setState(privacy ? "privacy" : "idle");
            const reply = document.createElement("div");
            reply.className = "assistant-message preview-reply";
            reply.innerHTML =
              '<div class="message-author"><strong>AGUS</strong><span>Design preview</span></div><p>This is a scripted visual exploration. In the app, I’ll ask for the details I need before preparing anything for your review.</p>';
            container.append(reply);
            reply.scrollIntoView({
              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
              block: "nearest",
            });
          }, 1000);
        }),
    );
  }
  render();
})();
