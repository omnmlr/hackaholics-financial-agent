# AGUS — The living interface

Two isolated, browser-rendered creative explorations. This is visual exploration, not a production redesign. No application source, payment logic, environment files, credentials or deployment configuration was changed.

## Review the visuals

Open `review.html` for the complete gallery. It contains Home and Assistant for each direction, on desktop and mobile, and links to six companion states and full mobile home compositions.

- **01 / Orbit:** a deep black environment, broad sans-serif typography, subtle orbital geometry and a large white companion. Conversation is an uncluttered reading column with contextual payment preparation. Manrope supplies the main type system.
- **02 / Margin:** an asymmetric silver editorial surface paired with a black companion room. Instrument Serif headlines and Instrument Sans interface text create a different rhythm. Conversation reads on a light surface while the companion occupies a separate dark space on desktop. Mobile recomposes these into a compact vertical sequence.

Both use the official tagline: **Your money, and what’s next.**

For interactive review, from the repository root:

```sh
python -m http.server 4173 --directory docs/living-interface
```

Visit `http://localhost:4173/review.html`. No build, npm installation, server keys or account connections are needed to view the concepts. Fonts are bundled for offline use. Opening `review.html` directly also works for static and interactive review in a normal browser.

## What was inspected

Read the current source structure and project guidance: `AGENTS.md`, `package.json`, `README.md`, `src/app/page.tsx`, `src/app/globals.css`, `src/components/dashboard.tsx`, `src/lib/auth.ts`, `src/lib/config.ts`, and database initialization references.

Started the existing Next.js app on a separate local port, using a fresh temporary fixture database, a temporary generated operator password, `AI_PROVIDER=none`, and an empty Paystack key. Inspected login, the assistant welcome and the supplier-payment preparation interaction. Existing-app screenshots are included under `previews/existing-*.png`.

Findings:

- Current navigation is **Agent, Payment history, Activity, Insights**. It uses a permanent desktop sidebar and a mobile menu.
- The existing app stores conversation messages and payment outcomes. It has no separate saved-conversation list or five-destination architecture matching this brief.
- Payment preparation asks for missing recipient, amount, bank and account information. It keeps draft review, beneficiary verification, reauthentication, authorization, submission and provider settlement verification distinct.
- This checkout uses **Paystack**, not Pollar. No Pollar, Zcash or supported-wallet integration was found.
- Obligations are currently represented by a demonstration reminder in Insights, not a full obligations destination.
- Existing balance and insight fixtures are explicitly fictional. The concepts instead use an honest state with no connected financial records, no fabricated account balances and no invented transactions.
- There are no official standalone mascot or wordmark assets in this checkout. The attached raster brand reference was studied directly. The concepts contain reconstructed vector studies of the asymmetrical silhouette, angled eyes, orbit and rounded wordmark. They are not original brand masters; replace them with the official SVGs before production implementation.

The existing app was inspected in fixture mode only. No payment was authorized or submitted, and no provider, live credential or deployed application was used.

## Interaction model

- All five destinations are reachable. Money makes bank records, wallets and payment methods independently discoverable. Empty Obligations and Activity screens explain their purpose.
- Home accepts text and moves into the assistant, preserving the submitted words. A prepared sample conversation is shown by default and labeled in conversation navigation.
- Replies after additional input are scripted and explicitly marked **Design preview**. There is no LLM connection.
- Saved-conversation access is contextual to the assistant. On mobile it opens from the history control. A new conversation has a composed empty state.
- Payment preparation contains no made-up recipient or amount. Payment-method discovery identifies the current Paystack flow and marks Pollar and Zcash as proposed and unavailable.
- Attachments, voice, profile settings, record import and wallet connections show explanatory previews. They do not access files, the microphone, accounts or payment systems.
- The bottom-centered AGUS control uses the mascot rather than a generic orb. Mobile navigation gives Money and Obligations adjacent positions while retaining Home and Activity.
- The companion-state gallery previews idle, listening, thinking, analyzing, privacy and completed. Idle is still. Motion activates to communicate state. All animation is disabled under `prefers-reduced-motion`.
- Privacy closes the mascot’s eyes and changes the display-control label. There are no actual balance values in this exploration. This does not imply private voice processing, encrypted chat or anonymous payments.
- Completion is a companion-expression study, not a successful-payment confirmation.

## Scope for a later implementation

These are alternatives for founder review. Neither direction is selected for production. The wallet and network integrations, bank-record import, obligation management, saved conversation index and redesigned navigation require separately scoped product and engineering work. The existing financial safeguards must remain authoritative.

This exploration focuses on Home and Assistant, plus supporting navigation and companion states. It does not claim to implement a complete payment review, authorization, processing or settlement flow.

## Verification and reproduction

The repository's installed Playwright and system Chromium are used only to inspect and capture local pages.

```sh
node docs/living-interface/capture.mjs
node docs/living-interface/verify.mjs
```

`capture.mjs` writes the eight main desktop/mobile compositions, full mobile home pages and two state galleries. `verify.mjs` checks both directions, all five destinations and widths **320, 390, 768, 1440 and 1920**: 50 viewport/view combinations. It also checks navigation, composer placement, text preservation, escaped input, scripted replies, network labels, mobile conversation access, six states, dialog dismissal and reduced motion. It asserts zero external requests and zero financial API requests.

Evidence is in `previews/capture-results.json` and `previews/verification-results.json`. Desktop captures use a 1440 × 1000 viewport and include the full page; main phone captures use a 390 × 844 viewport. Phone full-page captures are supplemental and show fixed navigation at its original viewport position.

Screenshots were visually inspected and the phone composer was adjusted to avoid obscuring payment details. Real device software keyboards, physical touch devices and assistive technology were not tested. The production test suite was not rerun because this folder does not modify the production app.

## Bundled typography

Manrope, Instrument Sans and Instrument Serif are distributed under the SIL Open Font License. Font files are served locally; the corresponding license texts are included in `assets/`.
