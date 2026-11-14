/* global document, window, location, URL, URLSearchParams, setTimeout, clearTimeout, matchMedia */
(() => {
  let view = new URLSearchParams(location.search).get("screen") || "home";
  let hidden = false;
  let authorized = false;
  let authStage =
    new URLSearchParams(location.search).get("stage") === "authorize";
  let overlayFocus;
  let toastTimer;
  let obligationFilter = "owe";
  let activityFilter = "all";
  let selectedActivity = "kemi";
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10h-6v-7H9v7H3z"/>',
    chat: '<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z"/><path d="M8 10h8m-8 4h5"/>',
    accounts:
      '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 8V5a2 2 0 0 1 2-2h12M16 11h5v5h-5z"/>',
    obligations:
      '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 2v4m6-4v4M9 11h6m-6 5h4"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
    up: '<path d="m6 18 12-12M6 6h12v12"/>',
    back: '<path d="M20 12H5m6-6-6 6 6 6"/>',
    down: '<path d="m8 10 4 4 4-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    shield:
      '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    bank: '<path d="m3 8 9-5 9 5v2H3zM5 12v6m7-6v6m7-6v6M3 21h18"/>',
    history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v6l4 2"/>',
    attach:
      '<path d="m8 12 7-7a3 3 0 0 1 4 4L9 19a5 5 0 0 1-7-7L13 1m-7 14L16 5"/>',
    mic: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v12h5"/>',
    dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  };
  const icon = (name, size = 20) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.arrow}</svg>`;
  const mark = () =>
    `<svg class="wordmark" viewBox="0 0 186 64" fill="none" aria-label="agus." role="img"><g stroke="currentColor" stroke-width="7.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="22" cy="26" r="15"/><path d="M37 12v30"/><circle cx="68" cy="26" r="15"/><path d="M83 12v31c0 20-27 21-30 6M101 12v20c0 17 27 17 27 0V12M166 16c-9-9-28-5-27 5 1 12 29 4 29 16 0 11-20 14-30 3"/></g><circle cx="181" cy="40" r="4.5" fill="currentColor"/></svg>`;
  const ghost = (state = "idle") =>
    `<svg class="ghost ${state}" viewBox="0 0 300 285" role="img" aria-label="AGUS ${state}"><g class="orbit"><path d="M38 155C-5 105 254 163 270 199" fill="none" stroke="#fff" stroke-width="7"/></g><g class="body"><path d="M66 181C75 159 79 127 101 91 122 55 151 36 181 40 222 43 246 75 248 110 252 149 231 191 209 213 185 237 165 249 147 242 140 240 143 229 133 230 112 236 75 250 60 233 47 220 55 203 66 181Z" fill="#f6f6f4"/><g class="eyes" fill="#101010"><rect x="174" y="91" width="13" height="31" rx="6.5" transform="rotate(-29 174 91)"/><rect x="207" y="76" width="13" height="31" rx="6.5" transform="rotate(-29 207 76)"/></g><g class="closed" fill="none" stroke="#101010" stroke-width="6" stroke-linecap="round"><path d="M166 110q8 12 17-1M200 95q8 12 17-1"/></g></g><path d="M30 151C15 184 229 247 270 199" fill="none" stroke="#101010" stroke-width="16"/><path d="M30 151C15 184 229 247 270 199" fill="none" stroke="#f6f6f4" stroke-width="6"/></svg>`;
  const amount = (value) =>
    `<span class="money-value" data-value="${value}">${hidden ? "••••••" : value}</span>`;
  const labels = {
    home: "Home",
    conversation: "AGUS",
    accounts: "Money",
    obligations: "Obligations",
    activity: "Activity",
    review: "Payment review",
  };
  function navigation(mobile = false) {
    const items = [
      ["home", "home", "Home"],
      ["accounts", "accounts", "Money"],
      ["conversation", "chat", "AGUS"],
      ["obligations", "obligations", "Obligations"],
      ["activity", "activity", "Activity"],
    ];
    return `<nav class="${mobile ? "mobile-nav" : "rail-nav"}" aria-label="${mobile ? "Mobile" : "Main"} navigation">${items.map(([key, glyph, label]) => `<button data-screen="${key}" class="${key === view || (view === "review" && key === "conversation") ? "active" : ""} ${key === "conversation" ? "agent-nav" : ""}" ${key === view ? 'aria-current="page"' : ""}>${mobile && key === "conversation" ? ghost(hidden ? "privacy" : "idle") : icon(glyph, 21)}<span>${label}</span>${!mobile && key === "obligations" ? "<i>3</i>" : ""}</button>`).join("")}</nav>`;
  }
  function shell(content) {
    return `<div class="concept-label"><a href="./gallery.html">AGUS <span>/ COUNTERPART</span></a><span class="fiction-badge">Fictional data · Concept</span><a href="./README.md">About this concept ${icon("up", 12)}</a></div><aside class="rail"><a href="?screen=home" class="rail-brand" aria-label="AGUS home">${mark()}</a>${navigation()}<button class="rail-settings" data-action="profile" aria-label="Profile settings">TA</button></aside><div class="workspace"><header class="topbar"><a class="mobile-brand" href="?screen=home" aria-label="AGUS home">${mark()}</a><div class="breadcrumb">Personal space <span>/</span> <strong>${labels[view] || "Home"}</strong></div><p class="tagline">Your money, and what's next.</p><div class="top-actions"><button data-action="hide" class="icon-button" aria-label="${hidden ? "Show" : "Hide"} balances" aria-pressed="${hidden}">${icon("eye", 18)}</button><button class="profile" data-action="profile"><span class="avatar">TA</span><span>Tomi A.</span>${icon("down", 14)}</button></div></header>${content}<div class="agent-dock ${view === "conversation" ? "conversation-dock" : ""}"><form id="composer"><button class="dock-mascot" type="button" data-action="ask" aria-label="Open AGUS">${ghost(hidden ? "privacy" : "idle")}</button><button type="button" class="dock-attach" data-action="attach" aria-label="Attach a document">${icon("plus", 20)}</button><div class="dock-input"><input name="message" aria-label="Message AGUS" placeholder="${view === "conversation" ? "Message AGUS…" : view === "accounts" ? "Ask about an account…" : view === "review" ? "Ask about this payment…" : "Ask AGUS…"}" autocomplete="off"></div><button type="button" class="dock-mic" data-action="voice" aria-label="Voice preview">${icon("mic", 18)}</button><button class="dock-send" aria-label="Send message">${icon("arrow", 19)}</button></form></div>${navigation(true)}</div>`;
  }
  function graph() {
    return `<svg class="balance-chart" viewBox="0 0 440 150" fill="none" role="img" aria-label="Fictional balance increased from 4.415 million to 4.85 million naira this month"><defs><linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#ffffff" stop-opacity=".15"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient></defs><path d="M0 125H440M0 70H440M0 15H440" stroke="#fff" stroke-opacity=".08"/><path d="M0 123 44 106 88 118 132 83 176 92 220 48 264 67 308 38 352 49 420 13V150H0Z" fill="url(#chart-fill)"/><path d="M0 123 44 106 88 118 132 83 176 92 220 48 264 67 308 38 352 49 420 13" stroke="#e4e4de" stroke-width="2" stroke-linejoin="round"/><circle cx="420" cy="13" r="4" fill="#fff"/><circle cx="420" cy="13" r="9" stroke="#fff" stroke-opacity=".25"/></svg>`;
  }
  const obligationRows = () =>
    `<button class="obligation-row" data-screen="conversation"><span class="initials">SN</span><span class="row-title"><strong>Studio North</strong><small>Brand identity · INV-024</small></span><span class="due-date">16 Nov</span><span class="row-amount">₦180,000</span>${icon("up", 17)}</button><button class="obligation-row" data-action="workspace"><span class="initials pale">WS</span><span class="row-title"><strong>Workspace</strong><small>Monthly membership</small></span><span class="due-date">20 Nov</span><span class="row-amount">₦320,000</span>${icon("up", 17)}</button><button class="obligation-row" data-action="contractor"><span class="initials pale">AO</span><span class="row-title"><strong>Ayo Oladipo</strong><small>Development · Milestone 02</small></span><span class="due-date">25 Nov</span><span class="row-amount">₦140,000</span>${icon("up", 17)}</button>`;
  function home() {
    return `<main class="main home"><div class="page-heading"><div><p class="eyebrow">NOVEMBER 2026</p><h1>Overview</h1></div><button class="text-button" data-screen="accounts">All accounts ${icon("up", 16)}</button></div><section class="position-panel"><div class="position-main"><div class="position-label">Total balance <span class="unit-chip">NGN ${icon("down", 12)}</span></div><div class="total-amount"><span class="currency">₦</span>${amount("4,850,000")}<span class="decimals">.00</span></div><p class="position-change">${icon("up", 14)} ₦435,000 this month <span>across 4 accounts</span></p></div><div class="position-graph"><div class="chart-caption"><span>Balance over time</span><span class="mono">THIS MONTH</span></div>${graph()}<div class="chart-dates"><span>1 Nov</span><span>13 Nov</span></div></div><div class="position-breakdown"><button data-screen="accounts"><span class="legend-square"></span><span>Bank accounts</span><strong>${amount("₦3,250,000")}</strong>${icon("up", 15)}</button><button data-screen="accounts"><span class="legend-square hatched"></span><span>Crypto · estimated</span><strong>${amount("₦1,600,000")}</strong>${icon("up", 15)}</button></div></section><div class="home-details"><section class="upcoming"><div class="section-heading"><h2>Upcoming<span class="count">03</span></h2><button class="text-button" data-action="obligations">View all ${icon("arrow", 16)}</button></div><div class="obligation-list">${obligationRows()}</div><div class="committed-total"><span>Total upcoming</span><strong>₦640,000<span> before fees</span></strong></div></section><section class="next-move"><div class="agent-byline"><span class="small-mascot">${ghost()}</span><span>AGUS</span><span class="pill">Payment ready</span></div><h2>Studio North</h2><div class="next-amount">₦180,000<span>.00</span></div><p class="next-meta">INV-024 · Due 16 Nov</p><div class="next-source"><span>${icon("bank", 15)} Wema · Everyday</span><span>₦1,669,950 after payment</span></div><button class="primary" data-screen="conversation">Open in AGUS ${icon("arrow", 18)}</button></section></div></main>`;
  }
  function sourceAccount() {
    return `<div class="source-account"><span class="bank-mark">w.</span><span><strong>Wema · Everyday</strong><small>Account ending 4312</small></span><span class="source-balance">${amount("₦1,850,000")}<small>Available balance</small></span></div>`;
  }
  function invoice() {
    return `<section class="invoice"><div class="invoice-brand"><span class="initials">SN</span><span>STUDIO<br>NORTH</span></div><div class="invoice-topline"><span>INVOICE</span><span>INV-024</span></div><h3>Brand identity</h3><div class="invoice-value"><span>NGN</span>180,000<span>.00</span></div><div class="invoice-item"><span>Brand identity</span><span>Final milestone</span></div><div class="invoice-bottom"><span>Due 16 November</span>${icon("attach", 16)}</div></section>`;
  }
  function conversation() {
    return `<main class="main conversation"><div class="page-heading"><div><p class="eyebrow">CONVERSATION</p><h1>Studio North</h1></div><button class="icon-button" data-action="history" aria-label="Saved conversations">${icon("history", 22)}</button></div><div class="conversation-layout"><section class="conversation-body" aria-label="Sample conversation"><div class="user-turn"><span class="user-label">YOU <span>14:32</span></span><p>Pay Studio North ₦180,000<br>from my everyday account.</p></div><div class="agent-turn"><div class="message-byline"><span class="small-mascot">${ghost()}</span><strong>AGUS</strong></div><p class="agent-response">Ready for review.</p><section class="payment-proposal"><div class="proposal-top"><button class="mono" data-action="invoice">INV-024 ${icon("up", 11)}</button><span class="pill">Ready for review</span></div><div class="proposal-amount">₦180,000<span>.00</span></div><div class="proposal-recipient"><span class="initials">SN</span><div><strong>Studio North</strong><small>Adaeze Okafor · Access Bank · 9018</small></div></div><div class="proposal-route"><span>${icon("bank", 15)} Wema · Everyday</span><span>${icon("check", 14)} Name matched</span></div><button class="primary light" data-screen="review">Review payment ${icon("arrow", 19)}</button></section></div><div id="new-messages"></div><div class="conversation-tools"><button data-action="fees">How much are the fees? ${icon("plus", 13)}</button><button data-screen="accounts">Use a different account ${icon("up", 13)}</button></div></section><aside class="conversation-context"><div class="context-heading"><span class="eyebrow">THE CONTEXT</span><button class="icon-button" data-action="invoice" aria-label="View invoice">${icon("up", 16)}</button></div>${invoice()}<p class="context-label">PAYING FROM</p>${sourceAccount()}<div class="reserve-context"><span>${icon("shield", 17)} Reserve</span><strong>${amount("₦1,400,000")}</strong><p>Not used for this payment.</p></div></aside></div></main>`;
  }
  function bankRows() {
    return `<button class="account-row" data-action="wema"><span class="bank-mark">w.</span><span class="account-name"><strong>Everyday</strong><small>Wema Bank · 4312</small></span><span class="account-balance">${amount("₦1,850,000")}<small>Available for payments</small></span>${icon("up", 17)}</button><button class="account-row" data-action="reserve"><span class="bank-mark gt">GT</span><span class="account-name"><strong>Reserve</strong><small>GTBank · 0846</small></span><span class="account-balance">${amount("₦1,400,000")}<small>Set aside</small></span>${icon("up", 17)}</button>`;
  }
  function accounts() {
    return `<main class="main accounts"><div class="page-heading"><div><h1>Accounts & wallets</h1></div><button class="outline-button" data-action="connect">${icon("plus", 17)} Add an account</button></div><div class="accounts-summary"><div><span class="summary-label">Combined value <span class="mono">NGN</span></span><div class="account-total"><span>₦</span>${amount("4,850,000")}<small>.00</small></div></div><div class="allocation"><div class="allocation-bar"><i></i><i></i></div><span><i class="dot solid"></i>67% in banks</span><span><i class="dot striped"></i>33% in crypto</span><small>Estimated crypto value</small></div></div><div class="accounts-layout"><section class="bank-section"><div class="section-heading"><h2>Bank accounts <span class="count">02</span></h2><span class="section-total">₦3,250,000</span></div>${bankRows()}<button class="inline-link" data-screen="review">Pay Studio North from Everyday ${icon("arrow", 17)}</button></section><section class="wallet-section"><div class="section-heading"><h2>Crypto wallets <span class="count">02</span></h2><button class="text-button" data-action="wallet-info">Wallet details ${icon("up", 14)}</button></div><div class="wallet-grid"><button class="wallet-card usdc" data-action="usdc"><div class="wallet-top"><span class="coin-mark">$</span><span class="wallet-provider">Pollar<span>Demo wallet</span></span>${icon("up", 18)}</div><div class="wallet-amount">${amount("1,000")}<span>.00</span></div><span class="wallet-unit">USDC</span><div class="wallet-fiat">≈ ${amount("₦1,560,000")}</div><div class="wallet-network"><span class="network-dot"></span> Polygon <span>USDC</span></div><div class="wallet-address"><span>0xDEMO…4f2a</span>${icon("copy", 13)}</div></button><button class="wallet-card zec" data-action="zec"><div class="wallet-top"><span class="coin-mark zcash">Z</span><span class="wallet-provider">Zcash<span>Demo wallet</span></span>${icon("up", 18)}</div><div class="wallet-amount">${amount("0.25")}</div><span class="wallet-unit">ZEC</span><div class="wallet-fiat">≈ ${amount("₦40,000")}</div><div class="wallet-network">${icon("shield", 13)} Shielded pool</div><div class="wallet-address"><span>u1demo…7w9k</span>${icon("copy", 13)}</div></button></div><p class="wallet-disclosure">Proposed wallet connections · Illustrative rates</p></section></div><section class="money-movements"><div class="section-heading"><h2>Recent activity</h2><button class="text-button" data-action="activity">Full activity ${icon("arrow", 16)}</button></div><div class="movement-row"><span class="movement-icon">${icon("arrow", 16)}</span><span><strong>Kemi Adeyemi</strong><small>Bank transfer · 12 Nov</small></span><span>Wema · Everyday</span><span class="movement-value">−₦42,500.00</span><span class="status-text">${icon("check", 12)} Settled</span></div><div class="movement-row"><span class="movement-icon">${icon("back", 16)}</span><span><strong>Client payment</strong><small>USDC received · 11 Nov</small></span><span>Pollar · Polygon</span><span class="movement-value">+250.00 USDC</span><span class="status-text">${icon("check", 12)} Confirmed</span></div></section></main>`;
  }
  function review() {
    return `<main class="main review ${authStage ? "review-authorize" : ""}"><div class="page-heading"><div><button class="back-link" ${authStage ? 'data-action="review-stage"' : 'data-screen="conversation"'}>${icon("back", 14)} ${authStage ? "Payment details" : "Back to AGUS"}</button><h1>${authStage ? "Authorize payment" : "Review payment"}</h1></div><div class="review-steps"><span>${icon("check", 12)} Prepare</span><i></i><strong>02 Review & authorize</strong><i></i><span>03 Submit</span></div></div><div class="review-layout"><section class="payment-sheet"><div class="sheet-topline"><span class="mono">PAYMENT / INV-024</span><span class="pill">${authorized ? "Authorized · Not sent" : "Awaiting your authorization"}</span></div><div class="review-recipient"><span class="initials large">SN</span><div><h2>Studio North</h2><p>Adaeze Okafor <span class="match-status">${icon("check", 11)} Name matched</span></p></div><button class="icon-button" data-action="recipient" aria-label="Recipient details">${icon("dots", 20)}</button></div><div class="review-amount"><span>₦</span>180,000<small>.00</small></div><p class="payment-purpose">Brand identity · Final milestone</p><div class="transfer-route"><div><span class="route-dot"></span><span class="route-label">FROM</span><strong>Wema · Everyday</strong><small>Your account · •••• 4312</small></div><span class="route-arrow">${icon("arrow", 18)}</span><div><span class="route-dot hollow"></span><span class="route-label">TO</span><strong>Access Bank</strong><small>Adaeze Okafor · •••• 9018</small></div></div><div class="review-details"><div><span>Payment method</span><button data-action="methods">Bank transfer ${icon("down", 14)}</button></div><div><span>Network / provider</span><strong>NGN · Paystack</strong></div><div><span>Estimated fee</span><strong>₦50.00</strong></div><div class="debit-total"><span>Total to debit</span><strong>₦180,050.00</strong></div></div><div class="after-payment"><span>${icon("accounts", 17)} Everyday, after this payment</span><strong>${amount("₦1,669,950.00")}</strong></div></section><aside class="authorization-panel ${authorized ? "is-authorized" : ""}"><div class="auth-symbol">${icon(authorized ? "check" : "lock", 22)}</div><span class="eyebrow">${"AUTHORIZATION"}</span><h2>${authorized ? "Authorized. Not sent." : "Authorize payment"}</h2><p>${authorized ? "Ready for submission." : ""}</p>${authorized ? `<div class="authorized-summary"><span>Demo authorization</span><strong>${icon("check", 15)} Recorded in this preview</strong></div><button class="auth-button" data-action="submit-preview">Preview submission ${icon("arrow", 18)}</button><button class="auth-reset" data-action="reset-auth">Return to review</button>` : `<div class="auth-payment-summary"><span>STUDIO NORTH · INV-024</span><strong>₦180,000<span>.00</span></strong><small>Total debit with estimated fee: ₦180,050.00</small></div><form id="authorization"><label class="approval-check"><input type="checkbox" name="checked"><span>I confirm these payment details.</span></label><label class="code-label" for="auth-code">Demo authorization code</label><input id="auth-code" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="Enter 000000" aria-describedby="demo-code-help"><p id="demo-code-help" class="code-help">Use 000000. Don’t enter a real password.</p><button class="auth-button" id="authorize-button" disabled>Authorize demo payment ${icon("arrow", 18)}</button><p class="auth-footnote">${icon("shield", 13)} Authorization does not send funds.</p></form>`}</aside></div><div class="review-mobile-action"><button class="primary" data-action="authorize-stage">Continue to authorization ${icon("arrow", 18)}</button></div></main>`;
  }

  const activityItems = [
    {
      id: "studio",
      name: "Studio North",
      date: "14 Nov",
      type: "Bank transfer",
      source: "Wema · Everyday",
      value: "₦180,000.00",
      status: "Not submitted",
      reference: "INV-024",
      to: "Adaeze Okafor · Access Bank · 9018",
      network: "NGN · Paystack",
      icon: "lock",
    },
    {
      id: "kemi",
      name: "Kemi Adeyemi",
      date: "12 Nov",
      type: "Bank transfer",
      source: "Wema · Everyday",
      value: "−₦42,500.00",
      status: "Settled",
      reference: "AGS-20261112-08",
      to: "Kemi Adeyemi · GTBank · 2704",
      network: "NGN · Paystack",
      icon: "arrow",
    },
    {
      id: "client",
      name: "Client payment",
      date: "11 Nov",
      type: "USDC received",
      source: "Pollar · Polygon",
      value: "+250.00 USDC",
      status: "Confirmed",
      reference: "0xdemo…a87c",
      to: "Pollar · 0xDEMO…4f2a",
      network: "Polygon · USDC",
      icon: "back",
    },
  ];
  function obligations() {
    const owed = obligationFilter === "owed";
    return `<main class="main obligations"><div class="page-heading"><div><p class="eyebrow">NOVEMBER 2026</p><h1>Obligations</h1></div><button class="outline-button" data-action="add-obligation">${icon("plus", 17)} Add obligation</button></div><section class="obligation-summary"><div><span>You owe</span><strong>${amount("₦640,000")}<small>.00</small></strong><p>3 upcoming · Before fees</p></div><div><span>Owed to you</span><strong>${amount("₦225,000")}<small>.00</small></strong><p>Not included in account balances</p></div><div><span>Next due</span><strong>16 <small>Nov</small></strong><p>Studio North</p></div></section><div class="task-layout"><section class="obligations-register"><div class="filter-tabs"><button data-obligation-filter="owe" aria-pressed="${!owed}" class="${!owed ? "selected" : ""}">You owe <span>3</span></button><button data-obligation-filter="owed" aria-pressed="${owed}" class="${owed ? "selected" : ""}">Owed to you <span>1</span></button></div><div class="register-labels"><span>Recipient</span><span>Due</span><span>Amount</span><span></span></div>${owed ? `<button class="obligation-row" data-action="receivable"><span class="initials">KS</span><span class="row-title"><strong>Kora Studio</strong><small>INV-031 · Consulting</small></span><span class="due-date">19 Nov</span><span class="row-amount">₦225,000</span>${icon("up", 17)}</button>` : obligationRows()}<div class="register-total"><span>${owed ? "Expected" : "Total upcoming"}</span><strong>${owed ? "₦225,000" : "₦640,000"}</strong></div></section><aside class="follow-up-panel"><div class="section-heading"><h2>With AGUS</h2><span class="small-mascot">${ghost()}</span></div><button data-screen="conversation" class="assigned-task"><span class="task-indicator">${icon("check", 15)}</span><span><strong>Studio North</strong><small>Payment prepared · INV-024</small></span>${icon("arrow", 16)}</button><button data-action="reminder" class="assigned-task"><span class="task-indicator">${icon("history", 15)}</span><span><strong>Kora Studio</strong><small>Reminder · 18 Nov</small></span>${icon("up", 16)}</button></aside></div></main>`;
  }
  function activityReceipt(id) {
    const a = activityItems.find((x) => x.id === id) || activityItems[1];
    return `<section class="activity-receipt"><div class="receipt-status">${icon(a.id === "studio" ? "lock" : "check", 16)} ${a.status}</div><h2>${a.name}</h2><div class="receipt-value">${a.value}</div><dl><div><dt>From</dt><dd>${a.source}</dd></div><div><dt>${a.id === "client" ? "Wallet" : "Recipient"}</dt><dd>${a.to}</dd></div><div><dt>Network</dt><dd>${a.network}</dd></div><div><dt>Date</dt><dd>${a.date} 2026</dd></div><div><dt>Reference</dt><dd class="mono">${a.reference}</dd></div></dl>${a.id === "studio" ? `<button class="primary" data-screen="review">Review payment ${icon("arrow", 17)}</button>` : ""}</section>`;
  }
  function activity() {
    const items = activityItems.filter(
      (a) =>
        activityFilter === "all" ||
        (activityFilter === "wallets" ? a.id === "client" : a.id !== "client"),
    );
    return `<main class="main activity"><div class="page-heading"><div><h1>Activity</h1></div><label class="activity-search">${icon("search", 17)}<input id="activity-search" aria-label="Search activity" placeholder="Search activity"></label></div><div class="activity-layout"><section class="activity-register"><div class="filter-tabs"><button data-activity-filter="all" class="${activityFilter === "all" ? "selected" : ""}" aria-pressed="${activityFilter === "all"}">All activity</button><button data-activity-filter="payments" class="${activityFilter === "payments" ? "selected" : ""}" aria-pressed="${activityFilter === "payments"}">Payments</button><button data-activity-filter="wallets" class="${activityFilter === "wallets" ? "selected" : ""}" aria-pressed="${activityFilter === "wallets"}">Wallets</button></div><div class="activity-feed">${items.map((a) => `<button class="activity-feed-row ${selectedActivity === a.id ? "selected" : ""}" data-activity-id="${a.id}" data-search="${a.name.toLowerCase()} ${a.type.toLowerCase()}"><span class="feed-date">${a.date}</span><span class="movement-icon">${icon(a.icon, 18)}</span><span class="feed-title"><strong>${a.name}</strong><small>${a.type} · ${a.source}</small></span><span class="feed-value"><strong>${a.value}</strong><small>${a.status}</small></span>${icon("up", 15)}</button>`).join("")}</div><p class="activity-empty" hidden>No matching activity.</p></section><aside class="activity-detail">${activityReceipt(selectedActivity)}</aside></div></main>`;
  }

  function render() {
    if (
      ![
        "home",
        "conversation",
        "accounts",
        "obligations",
        "activity",
        "review",
      ].includes(view)
    )
      view = "home";
    document.body.dataset.screen = view;
    document.title = `AGUS · Counterpart · ${labels[view]}`;
    document.querySelector("#app").innerHTML = shell(
      { home, conversation, accounts, obligations, activity, review }[view](),
    );
    wire();
  }
  function go(screen) {
    closeModal();
    view = screen;
    authStage = false;
    const url = new URL(location.href);
    url.searchParams.delete("stage");
    url.searchParams.set("screen", view);
    window.history.replaceState(null, "", url);
    render();
    window.scrollTo(0, 0);
  }
  function toast(text) {
    const el = document.querySelector("#toast");
    clearTimeout(toastTimer);
    el.textContent = text;
    el.classList.add("visible");
    toastTimer = setTimeout(() => el.classList.remove("visible"), 3500);
  }
  function closeModal() {
    document.querySelector("#overlay").innerHTML = "";
    overlayFocus?.focus();
  }
  function modal(title, body) {
    overlayFocus = document.activeElement;
    const el = document.querySelector("#overlay");
    el.innerHTML = `<div class="backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${title}" tabindex="-1"><header><h2>${title}</h2><button class="icon-button" data-close aria-label="Close dialog">${icon("close")}</button></header>${body}</section></div>`;
    const dialog = el.querySelector(".modal");
    dialog.focus();
    el.querySelector("[data-close]").onclick = closeModal;
    el.querySelector(".backdrop").onclick = (e) => {
      if (e.target === e.currentTarget) closeModal();
    };
    dialog.onkeydown = (e) => {
      if (e.key === "Escape") closeModal();
      if (e.key === "Tab") {
        const nodes = [...dialog.querySelectorAll("button,input,a")];
        if (
          e.shiftKey &&
          (document.activeElement === nodes[0] ||
            document.activeElement === dialog)
        ) {
          e.preventDefault();
          nodes.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === nodes.at(-1)) {
          e.preventDefault();
          nodes[0]?.focus();
        }
      }
    };
    return el;
  }

  function methods() {
    const el = modal(
      "Choose a payment method",
      `<p class="modal-copy">Invoice currency: NGN. Crypto requires a new quote.</p><button class="method-option" data-bank><span>${icon("bank", 23)}</span><span><strong>Bank transfer</strong><small>NGN · Paystack · Selected</small></span>${icon("check", 18)}</button><div class="method-option"><span class="method-coin">$</span><span><strong>Pollar</strong><small>USDC · Polygon · Proposed</small></span><span class="unavailable">Not integrated</span></div><div class="method-option"><span class="method-coin">Z</span><span><strong>Zcash private payment</strong><small>ZEC · Shielded pool · Proposed</small></span><span class="unavailable">Not integrated</span></div><p class="modal-note">Proposed wallet connections. No transfers available.</p>`,
    );
    el.querySelector("[data-bank]").onclick = closeModal;
  }
  function wallet(which) {
    const zec = which === "zec";
    modal(
      zec ? "Zcash · Shielded wallet" : "Pollar · USDC wallet",
      `<div class="wallet-detail-balance"><span class="coin-mark">${zec ? "Z" : "$"}</span><strong>${zec ? "0.25 ZEC" : "1,000.00 USDC"}</strong><p>≈ ${zec ? "₦40,000" : "₦1,560,000"} · Fictional valuation</p></div><dl class="wallet-detail"><div><dt>Network</dt><dd>${zec ? "Zcash · Shielded pool" : "Polygon · USDC"}</dd></div><div><dt>Illustrative address</dt><dd class="mono">${zec ? "u1demo…7w9k" : "0xDEMO…4f2a"}</dd></div><div><dt>Demo rate</dt><dd>${zec ? "₦160,000 / ZEC" : "₦1,560 / USDC"}</dd></div></dl><p class="modal-note">Proposed connection. No transfers available.</p>`,
    );
  }
  function act(action) {
    if (action === "authorize-stage" || action === "review-stage") {
      authStage = action === "authorize-stage";
      const u = new URL(location.href);
      if (authStage) u.searchParams.set("stage", "authorize");
      else u.searchParams.delete("stage");
      window.history.replaceState(null, "", u);
      render();
      window.scrollTo(0, 0);
      return;
    }
    if (action === "ask") return go("conversation");
    if (action === "obligations" || action === "activity") return go(action);
    if (action === "methods") return methods();
    if (action === "usdc" || action === "zec") return wallet(action);
    if (action === "hide") {
      hidden = !hidden;
      document
        .querySelectorAll(".money-value")
        .forEach(
          (el) => (el.textContent = hidden ? "••••••" : el.dataset.value),
        );
      document
        .querySelectorAll(".ghost")
        .forEach((el) => el.classList.toggle("privacy", hidden));
      const b = document.querySelector('[data-action="hide"]');
      b.setAttribute("aria-pressed", hidden);
      b.setAttribute("aria-label", hidden ? "Show balances" : "Hide balances");
      return;
    }
    if (action === "reset-auth") {
      authorized = false;
      return render();
    }
    if (action === "submit-preview")
      return modal(
        "Submission",
        `<div class="submission-steps"><span>${icon("check", 17)} Reviewed</span><span>${icon("check", 17)} Demo authorized</span><span class="pending-step">Not submitted</span><span class="pending-step">Settlement not verified</span></div><p class="modal-note">Preview only. No funds moved.</p>`,
      );
    if (action === "history") {
      const el = modal(
        "Conversations",
        `<button class="history-entry" data-current><span>Studio North</span><small>14 Nov · Sample</small>${icon("arrow", 16)}</button><button class="history-entry" data-new>${icon("plus", 17)} New conversation</button>`,
      );
      el.querySelector("[data-current]").onclick = () => go("conversation");
      el.querySelector("[data-new]").onclick = () => {
        go("conversation");
        document.querySelector(".conversation-body").innerHTML =
          '<div class="new-conversation"><h2>New conversation</h2><p>Ask a question or prepare a payment.</p></div><div id="new-messages"></div>';
      };
      return;
    }
    if (action === "wema") {
      const el = modal(
        "Wema · Everyday",
        `${sourceAccount()}<div class="bank-preview"><span>Studio North payment</span><strong>₦180,050.00 <small>including estimated fee</small></strong><span>Remaining balance</span><strong>₦1,669,950.00</strong></div><button class="primary" data-use>Use this account ${icon("arrow", 17)}</button>`,
      );
      el.querySelector("[data-use]").onclick = () => go("review");
      return;
    }
    if (action === "invoice") return modal("Invoice · INV-024", invoice());
    const content = {
      fees: ["Estimated fee", "₦50.00 · Total debit ₦180,050.00."],
      reserve: [
        "GTBank · Reserve",
        "₦1,400,000 set aside. Not used for this payment.",
      ],
      connect: [
        "Add account",
        "Account connections are unavailable in this concept.",
      ],
      recipient: [
        "Recipient",
        "Studio North · Adaeze Okafor · Access Bank · 9018. Fictional name match.",
      ],
      attach: ["Attach document", "Uploads are unavailable in this concept."],
      voice: ["Voice input", "Microphone off in this concept."],
      profile: ["Tomi A.", "Fictional profile."],
      workspace: ["Workspace", "₦320,000 · Due 20 Nov · Not prepared."],
      contractor: ["Ayo Oladipo", "₦140,000 · Due 25 Nov · Not prepared."],
      "wallet-info": [
        "Wallet connections",
        "Pollar and Zcash are proposed connections. Rates are illustrative.",
      ],
      "add-obligation": [
        "Add obligation",
        "New obligations are unavailable in this concept.",
      ],
      receivable: ["Kora Studio", "₦225,000 · INV-031 · Due 19 Nov."],
      reminder: [
        "Kora Studio reminder",
        "18 Nov · INV-031. Fictional reminder; no notification is scheduled.",
      ],
    }[action];
    if (content) modal(content[0], `<p class="modal-copy">${content[1]}</p>`);
  }
  function wire() {
    document.querySelectorAll("[data-obligation-filter]").forEach(
      (b) =>
        (b.onclick = () => {
          obligationFilter = b.dataset.obligationFilter;
          render();
        }),
    );
    document.querySelectorAll("[data-activity-filter]").forEach(
      (b) =>
        (b.onclick = () => {
          activityFilter = b.dataset.activityFilter;
          const matching = activityItems.filter(
            (item) =>
              activityFilter === "all" ||
              (activityFilter === "wallets"
                ? item.id === "client"
                : item.id !== "client"),
          );
          if (!matching.some((item) => item.id === selectedActivity)) {
            selectedActivity = matching[0].id;
          }
          render();
        }),
    );
    document.querySelectorAll("[data-activity-id]").forEach(
      (b) =>
        (b.onclick = () => {
          selectedActivity = b.dataset.activityId;
          if (matchMedia("(max-width:700px)").matches) {
            const m = modal(
              "Payment details",
              activityReceipt(selectedActivity),
            );
            m.querySelectorAll("button[data-screen]").forEach(
              (x) => (x.onclick = () => go(x.dataset.screen)),
            );
          } else render();
        }),
    );
    const search = document.querySelector("#activity-search");
    if (search)
      search.oninput = () => {
        let visible = 0;
        document.querySelectorAll(".activity-feed-row").forEach((row) => {
          row.hidden = !row.dataset.search.includes(
            search.value.toLowerCase().trim(),
          );
          if (!row.hidden) visible++;
        });
        document.querySelector(".activity-empty").hidden = visible > 0;
      };
    document
      .querySelectorAll("button[data-screen]")
      .forEach((b) => (b.onclick = () => go(b.dataset.screen)));
    document
      .querySelectorAll("[data-action]")
      .forEach((b) => (b.onclick = () => act(b.dataset.action)));
    const authorization = document.querySelector("#authorization");
    if (authorization) {
      const code = authorization.querySelector("#auth-code");
      const checkbox = authorization.querySelector('[name="checked"]');
      const button = authorization.querySelector("#authorize-button");
      const validate = () => {
        button.disabled = !(checkbox.checked && code.value === "000000");
      };
      authorization.oninput = validate;
      authorization.onchange = validate;
      authorization.onsubmit = (e) => {
        e.preventDefault();
        validate();
        if (button.disabled) return;
        authorized = true;
        render();
        toast("Authorized · Not submitted");
      };
    }
    document.querySelector("#composer").onsubmit = (e) => {
      e.preventDefault();
      const input = e.currentTarget.querySelector("input");
      const text = input.value.trim();
      if (!text) return;
      if (view !== "conversation") go("conversation");
      const target = document.querySelector("#new-messages");
      const bubble = document.createElement("div");
      bubble.className = "user-turn extra-message";
      const p = document.createElement("p");
      p.textContent = text;
      bubble.append(p);
      target.append(bubble);
      document.querySelector("#composer input").value = "";
      document
        .querySelectorAll(".ghost")
        .forEach((g) => g.classList.add("thinking"));
      setTimeout(() => {
        document
          .querySelectorAll(".ghost")
          .forEach((g) => g.classList.remove("thinking"));
        const reply = document.createElement("div");
        reply.className = "scripted-response";
        reply.innerHTML =
          '<span class="eyebrow">AGUS · SCRIPTED PREVIEW</span><p>Preview only. Payment details unchanged.</p>';
        target.append(reply);
        reply.scrollIntoView({
          block: "nearest",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
      }, 800);
    };
  }
  render();
})();
