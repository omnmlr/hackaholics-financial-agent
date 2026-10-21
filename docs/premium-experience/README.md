> Historical visual direction, superseded by the user’s final approved screenshot on October 21, 2026. The current candidate and continuation status are in [the approved release record](../approved-release/README.md). Its engineering is retained; its rejected styling is replaced.

# AGUS — your money, in focus

A working redesign of the AGUS conversation product, based on PR #40 at `c2117ed643790950b6f4af7210e707831fab54db`. Work lives on `ui/agus-premium-experience-20261020`. No deployment or production branch change is part of this work.

## Design language

AGUS now uses midnight blue surfaces, soft iris interactions and restrained mint evidence labels. A woven signal gives the assistant a recognizable presence alongside the founder’s original wordmark. Locally hosted DM Sans supplies a warmer, clearer reading texture without a third-party font request; its license is in `public/fonts`.

The welcome screen introduces three useful starting points. In conversation, the content takes priority: a consistent 800px reading column, compact user messages, quiet response controls and structured source results. Financial cards distinguish spending, income and difference, show relative movement from those same displayed values, and retain the underlying scope, limits and source snapshots. Difference is never represented as an account balance. Transaction rows use direction, amount, date and source status; payment proposals remain explicitly unverified and editable.

| Role               | Value         |
| ------------------ | ------------- |
| Canvas             | `#090d16`     |
| Surface            | `#111824`     |
| Raised surface     | `#182334`     |
| Boundary           | `#283448`     |
| Primary text       | `#f0f3fc`     |
| Secondary text     | `#98a8bc`     |
| Interaction        | `#a5afff`     |
| Source evidence    | `#8bdbc0`     |
| Reading column     | 800px maximum |
| Interaction target | 44px minimum  |

Motion is limited to a short response entrance and an opacity pulse during genuine pending requests. Reduced motion disables these effects. The decorative grid is CSS, the signal is a small SVG, and there is no idle JavaScript animation loop. The microphone waveform continues to measure actual audio samples.

## Problems discovered and repaired

- The empty composer occupied about 145px. It now starts near 60px, grows with the draft and caps its input height to preserve the conversation viewport.
- The welcome state offered little context in a large empty canvas. The new visual identity, editorial hierarchy and three descriptive entry points create a clear first visit on desktop and mobile.
- A long mobile placeholder expanded the empty composer. A short universal prompt keeps it compact even at 320px.
- The conversation used detached alignment, repetitive user labels and a reserved copy column. User messages and assistant responses now share a coherent rhythm; response copy controls occupy the heading row.
- Financial totals had little hierarchy. Source results now have named headers, distinct primary values, accurate relative movement bars, readable transaction rows and evidence disclosures.
- Account selection was buried in navigation. A header control makes fictional record selection directly accessible, without suggesting a real bank connection.
- Opening an inline payment card could leave the first fields below the visible area. Opening the card now brings its beginning into view. Drafts, verified recipients, approvals and unresolved outcomes keep their existing safeguards.
- Generation had no Stop control. Stop now replaces Send, aborts the client request, invalidates late responses and propagates cancellation into model calls. A saved-state check handles the race where a response committed just before Stop. The editable draft survives.
- Normal lost-response recovery could leave an already-saved question ready to resend. Recovery clears only that restored original question, retaining a new draft or a draft preserved by an explicit Stop.
- Tall payment cards could also make the application shell scroll and hide its header. Shell clipping and explicit conversation/dialog scrolling now keep the header and composer fixed; geometry checks guard both. The Latest response control follows the composer when its height changes.
- Existing tests assumed an old focus-ring color. Their focus/border/shadow assertions now use the implemented accessible iris focus color.

## Running and verifying

```sh
npm ci --cache /tmp/agus-npm-cache
npm run build
npm run preview:fixture
```

The isolated preview logs the **path** of its private local password file. It uses only fictional records, an isolated persistent PGlite database and scripted Gemini transport, with an outbound-fetch guard. Do not paste its password into documentation or reuse a production database.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run test:http
npm run test:browser
npm run test:browser:native
npm run test:browser:premium
```

`test:browser:premium` starts its own isolated production server on an available loopback port. It tests 1440px, 820px, 390px and 320px, writes actual application screenshots to `after/` and records functional and axe accessibility results in `after/browser-results.json`. It covers a compact and expanded composer, short viewport, financial results, transaction matches, account selection, editable proposals, generation, Stop, response-loss recovery, long conversations, navigation, persistence and reduced motion. It checks that no approval or execution request is issued by conversation or voice.

Validation results and the final completion state are recorded in [HANDOFF.md](HANDOFF.md).

## Visual evidence

`before/` contains screenshots of the actual PR #40 application run before editing. `after/` contains the redesigned running production build with clearly fictional source data and a scripted model. These are browser captures, not design mockups. File names begin with viewport width and describe the actual state.

| Width | Welcome                               | Financial result                           | Payment draft                                     |
| ----- | ------------------------------------- | ------------------------------------------ | ------------------------------------------------- |
| 1440  | [Desktop](after/1440-welcome.png)     | [Financial card](after/1440-financial.png) | [Editable proposal](after/1440-payment-draft.png) |
| 820   | [Tablet](after/820-welcome.png)       | [Financial card](after/820-financial.png)  | [Editable proposal](after/820-payment-draft.png)  |
| 390   | [Mobile](after/390-welcome.png)       | [Financial card](after/390-financial.png)  | [Editable proposal](after/390-payment-draft.png)  |
| 320   | [Small mobile](after/320-welcome.png) | [Financial card](after/320-financial.png)  | [Editable proposal](after/320-payment-draft.png)  |

Additional captures show transaction searches, account selection, expanded drafts, short viewports, generation, cancellation, network errors, navigation and long conversations.

## Performance smoke check

The final local production build was inspected at 390 × 844 with Chromium CPU throttled 4×. The welcome screen and self-hosted font were ready in 1,262ms; DOM content loaded in 847ms. Recorded JavaScript heap use was approximately 5.6 MiB, resource transfers were approximately 351 KiB, and there were zero external resource requests. See [the recorded metrics](after/performance.json). This is a local smoke measurement, not a physical-device or network benchmark. The visual system has no idle JavaScript animation loop or remote font dependency.

## Practical limits

Live Gemini responses, real banks and real transfers were not exercised. Voice regression uses synthetic browser/microphone fixtures; physical-device speech recognition and iOS/Android keyboard behavior still deserve a manual check. The short-viewport test verifies layout resizing, not a physical keyboard. These limits do not authorize changing provider settings, spending model credits, merging or deploying.
