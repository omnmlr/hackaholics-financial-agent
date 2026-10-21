# AGUS intelligence, source narration and motion review

This is a follow-up to the exact deployed PR #41 release, `6ff095cd05b6d119c9275450f0caa1e9548e6e2f`. Review [PR #42](https://github.com/omnmlr/hackaholics-financial-agent/pull/42), branch `improve/agus-intelligence-motion-20261021`. Nothing was merged or deployed. No production database, schema, secrets, service configuration or records were changed.

Railway's read-only service description confirmed the approved branch/SHA, successful deployment `72907c01-1eaf-47c6-9b82-cf24ac3c304d`, domain and `node scripts/render-preview-start.mjs`. Public-site access from this environment returned a network-policy 403; the connected local-browser control tool was not available. Visual inspection therefore used actual Chromium renders of the same application and the committed approved-release captures. This is not a claim to have inspected the live site's current visual state or production conversation logs. The filtered production logs contained no diagnostic for the reported turns.

## Findings and repairs

| Finding | Evidence and implication | Repair |
| --- | --- | --- |
| Weekly units were missing, and the system prompt specifically preferred monthly deposit rounding. | Proven source defect. The reported fallback has no unit, consistent with a `number` result, but the original production tool arguments are unavailable. Unsupported weeks alone cannot be proved to have caused that turn. | Add weeks and a domain tool for simple savings goals. The server computes `ceil(max(target - startingAmount, 0) / contribution)` in the actual deposit cadence. |
| Correct calendar conversions could erase a useful explanation. | `composeVerified` rejects a whole paragraph when any explicit number is not grounded. The prior implementation did not compute years/months equivalents; a correct answer with a secondary conversion could therefore become the raw fallback. Regression reproduced locally. | Compute approximate calendar equivalents deterministically, using an average Gregorian year of 365.2425 days. Include their values in output validation. Exact deposit counts remain distinct from approximate calendar time. |
| The fallback exposed arithmetic internals. | Proven source: `Hypothetical result: … (expression)`. Several failures, including exhausted narration/review budgets, reached that function. | Human-readable values, units and savings assumptions. If interpretation review is unavailable or rejects the formula, identify the uncertainty and ask for the figures rather than presenting the plan as confirmed. Raw expressions are not the default explanation. |
| The native financial path omitted the older agent's flexible reviewed narration path. | Proven source comparison: native reads used only the finite sentence grammar. That grammar lacked date slots and rejected otherwise useful phrasing. | Keep the proven grammar, then permit flexible narration only after slot/reference/literal checks and independent semantic review. Append source qualifications on the server. |
| Genuine Gemini sometimes authored literal facts instead of slots. | Initial real-provider run: Ada search/detail returned `NARRATION_VALUE` despite successful HTTP responses. A later compact-prompt check reproduced literal rejection. This is validation failure, not evidence of a provider outage. | Compile only exact, unambiguous current-source values into slots; reject unknown amounts/dates and ambiguous mappings. Support common source date formats, dates without the year and a source-derived common month/year. Independent review still checks the meaning and direction of claims. Supply concise authoring examples rather than a large list of regex grammars. |
| Independent review can falsely reject a correct disambiguating list. | The final genuine trace listed both candidates and asked which one to inspect, but review returned `selected_ambiguous_candidate`. This establishes a reviewer false positive on the captured answer. | Prove common candidate-list clauses deterministically after exact source binding, including each name/amount/date role, source query, month, references and server-owned caveats. Unproved prose still requires independent semantic review. Replay the actual recorded response with fresh fixture sources; mutate amounts, dates and credit claims to ensure they still fail. |
| A read timeout wrapper could cut short narration review. | The native `present_financial` call had a 10-second read wrapper around a separately bounded 20-second model review. | Allow the model review and access checks their proper budget within the unchanged 60-second turn deadline. A regression verifies successful 12-second review. |
| Model call allowance could leave no room for review after repairs/secondary calculations. | Proven control-flow risk, not an established cause of the reported production turn. | Six model calls maximum, five tool calls and the original 60-second turn deadline. Savings/calendar derivations usually need one tool call. |
| Technical evidence dominated the presentation. | Proven renderer: source snapshots plus a duplicated full original response, with implementation-oriented fallback copy above the answer. | Answer first, caveats once, verified cards, collapsed source metadata and a further technical-reference disclosure. Remove the duplicated original response. Preserve source snapshots and IDs inside the disclosure. |

Provider failures, token exhaustion and production timeouts remain possible causes of other turns. They were not established for these two production examples. The genuine tests establish connectivity for their own requests, not continuous production health or equivalence of undisclosed production model settings.

## Observed conversation behavior

The exact reported savings prompt was `if i saved 10k every week, how long until i become a millionaire 👀🥲`.

Before, as reported:

> Hypothetical result: 100 (ceil(1000000 / 10000)).

A genuine Gemini response in the targeted campaign:

> If you save ₦10,000 every week with no interest or withdrawals, it will take you 100 weeks—which is roughly 1 year and 11 months—to hit your first million.

The same campaign stated zero starting savings, consistent weekly deposits, no interest, fees or withdrawals. A prior genuine run correctly continued with **80 weeks** after a ₦200,000 starting amount, then **54 weeks** after changing the deposit to ₦15,000 weekly. Independent review remains fallible; it does not replace deterministic arithmetic or establish actual balances.

Genuine multiplication returned `10 times 20 is 200.` Greeting and Nigerian-English/Pidgin turns were also exercised. Protocol tests cover all five requested casual/education examples and ensure they do not force account selection or read tools. Those protocol responses are scripted and do not establish that every genuine response will have the desired tone.

The Ada browser capture below is **scripted model transport through the actual application**, with current authorized fictional records:

> I found 2 possible matches for Ada in the selected records. Ada Obi (fictional): ₦7,500.00 on 7 October 2026. Ada Okafor (fictional): ₦5,000.00 on 5 October 2026. Which one would you like to inspect?

The UI retains partial-coverage and recipient-credit qualifications. Selecting the first candidate fills the composer; the user submits it deliberately. The backend rereads Ada Obi before presenting details. The source status is posted, and the app explicitly says this does not confirm recipient bank credit.

A deterministic fallback now gives the same useful names, amounts, dates and choice question. It remains labelled `Source summary · AI explanation unavailable`; the app does not disguise fallback text as an AI explanation.

The [initial genuine evidence](genuine-initial.json), [targeted evidence](genuine-repair.json) and [compact-authoring diagnostic](genuine-final.json) preserve successes and failures. The initial campaign used 21 HTTP requests, the targeted campaign 16, and the compact diagnostic two; all 39 received HTTP 200. The compact diagnostic still fell back. Common date variants and concise examples were repaired afterward. The [source-date run](genuine-dates.json) used six requests: Ada details were AI-narrated, but search was rejected by review. The [final review trace](genuine-review.json) used the remaining three requests and captured the false ambiguity rejection described above. **48 actual HTTP requests in total, all HTTP 200**, establish provider connectivity and distinguish model-review failures from network failures. The final deterministic proof repair passes a replay of that exact genuine answer with fresh authorized fixture data; this is a recorded-response regression, **not a fresh genuine run of the final repair**. The paid budget is exhausted. The aggregate budget was capped at 48 requests, including continuations, reviews and retries; each CI campaign rejects automatic reruns before exposing the existing provider secret. All provider data is synthetic and in memory, with no payment engine or application database.

## Actual rendered output

No generated mockups or replacement assets are used. The original wordmark, heading, typography, curves, bars, texture, colors and three suggestion labels remain. At 1672×941 the heading and wordmark crop comparisons have no changed pixels against the approved capture. This is a limited crop comparison, not a claim that the entire page is pixel-identical.

| Width | Welcome | Processing | Ada matches | Ada detail | Editable payment |
| --- | --- | --- | --- | --- | --- |
| 1440 | [Capture](screenshots/1440-welcome.png) | [Capture](screenshots/1440-processing.png) | [Capture](screenshots/1440-ada-matches.png) | [Capture](screenshots/1440-ada-detail.png) | [Capture](screenshots/1440-payment-draft.png) |
| 820 | [Capture](screenshots/820-welcome.png) | [Capture](screenshots/820-processing.png) | [Capture](screenshots/820-ada-matches.png) | [Capture](screenshots/820-ada-detail.png) | [Capture](screenshots/820-payment-draft.png) |
| 390 | [Capture](screenshots/390-welcome.png) | [Capture](screenshots/390-processing.png) | [Capture](screenshots/390-ada-matches.png) | [Capture](screenshots/390-ada-detail.png) | [Capture](screenshots/390-payment-draft.png) |
| 320 | [Capture](screenshots/320-welcome.png) | [Capture](screenshots/320-processing.png) | [Capture](screenshots/320-ada-matches.png) | [Capture](screenshots/320-ada-detail.png) | [Capture](screenshots/320-payment-draft.png) |

[Exact reference size, 1672×941](screenshots/1672-reference-welcome.png) · [Savings answer](screenshots/1440-savings.png) · [Evidence disclosure](screenshots/1440-evidence.png) · [Short viewport](screenshots/390-short-viewport.png) · [Stopped response](screenshots/390-stopped.png)

[Six-second recording of the actual welcome motion](screenshots/welcome-motion.mp4) · [Two-second processing recording](screenshots/processing-motion.mp4)

Visual review covered the welcome, actual message transitions, source results, evidence disclosure, pending/Stop states and editable payment forms. Capture timing was corrected to wait for finite entrance transitions; screenshots taken mid-fade were not used as finished visual evidence. The final motion harness also keeps encoder frames outside the disposable Postgres data directory, preserving clean database initialization.

The welcome composer shrank from approximately **84.8 to 74.7px at 1440**, **74 to 68px at 820**, and **70 to 62px at 390/320**. The heading placement is retained. Long drafts still expand within the existing limit. All four widths, suggestion wrapping and a 420px viewport with a focused composer were checked. This simulates limited keyboard space; it does not establish physical mobile keyboard behavior.

## Motion and performance

- Three existing blue points genuinely travel along the original SVG curves, on 34/46-second cycles. Their positions are sampled at two different times and verified to move at every width.
- Existing bars gently vary illumination. No new logo, orb, particle system, external service or asset was introduced.
- Welcome, messages, result cards and disclosures have short opacity/translation entrances. Buttons have small hover/press feedback and the composer settles into conversation mode.
- The pending indicator uses three restrained blue strokes. Its only claim is that the application is preparing a response; the architecture does not expose granular operation progress, so it does not fabricate bank checks or tool traces.
- SVG motion pauses when the document is hidden or welcome is no longer active. CSS motion pauses on page visibility changes. The reduced-motion preference removes SVG travel, freezes ambient work and removes CSS entrance/processing animations. Decorative SVG remains hidden from assistive technology.
- Existing microphone indicators remain connected to actual microphone state/PCM levels. Their lifecycle tests are synthetic Chromium audio tests, not real-device speech acceptance.

Native SVG motion and CSS were selected because the approved artwork already contains the paths and points. There is no animation library, continuous React rendering loop or new shipped dependency. SVG motion does perform browser layout/style work; it is not represented as a compositor-only animation.

The latest [performance samples](screenshots/motion-results.json) record 90 frame intervals per width. Observed p95 was approximately **16.7–16.8ms**, with **zero intervals above 50ms**, including Chromium's simulated 4× CPU slowdown at 390px. The throttled sample used about 0.15 seconds of browser task time and 0.92ms of script time across the sample. These are short shared-host observations, not physical Android frame/battery benchmarks or a guarantee under every load. Welcome and processing clips are about 28KB each.

## Verification and safeguards

The local full suite passed **1,214 tests in 49 files** on Node 24.19.0. Typecheck, lint and the production build passed. No final local automated failure remains.

| Check | Result | Evidence |
| --- | --- | --- |
| Full unit/integration/safety/persistence tests | 1,214 passed, 49 files | [Log](validation/unit.log) |
| Production build | Passed | [Log](validation/build.log) |
| HTTP payment safety | Passed: authentication, review, verification, separate approval/submission, duplicate rejection, reconciliation and persisted chat | [Log](validation/http.log) |
| Chat/payment browser suite | 54 groups, four widths | [Report](validation/chat-payments.json) |
| Voice submission locking | 36 groups, eight width/transport combinations | [Report](validation/voice-submit.json) |
| Chromium PCM/microphone lifecycle | Eight checks | [Report](validation/voice-meter.json) |
| Native-agent browser suite | 14 groups, desktop/mobile | [Report](validation/native-browser.json) |
| Approved visual/composer/recovery suite | 28 groups, four widths, 24 axe scans | [Report](screenshots/browser-results.json) |
| New motion/intelligence suite | 20 groups, four widths, 16 axe scans | [Report](screenshots/motion-results.json) |

Across the two visual suites: **40 axe scans, zero violations, zero browser page errors**. Accessibility scans wait for finite entrance transitions to complete while continuous motion remains active. The new motion suite checks reduced motion, simulated visibility changes, literal source disclosure, savings corrections, persistence, selected-candidate details and honest pending states. Existing suites exercise payment edits, approval boundaries, cancellation races, interrupted requests, draft recovery, permission and stale-context failures.

All browser model/speech transports are explicitly scripted. Genuine Gemini results are only the separately linked CI evidence. The GitHub workflow runs type/lint/unit/build/HTTP/browser checks on Node 22.16.0 and Node 24; consult the PR's current checks for the final source revision rather than assuming an earlier green run proves a later change.

Tenant/owner/session checks, consent and selected-account boundaries, source integrity checks, independent calculation interpretation review, source permission rechecks before/after persistence, CAS conflict handling, cancellation and recovery remain. Exact-value slot binding never grants permission or establishes truth on its own. Unknown values still fail; reviewed prose still cannot establish recipient bank credit. Source caveats are server-owned.

Financial data and payment execution stay fictional. No real-money transfer was attempted. Approval/execution requests in the new visual suites are zero; the existing HTTP/payment regression suites deliberately exercise **simulated** approvals and submissions. Startup is unchanged, with SHA-256 `74f29e366a0e9ac461a9beeee6d64a8ba55c18302f6800e34b5c44aadebf8cbf`. No migration or production reseed is needed.

## Reproduction and remaining limits

After installing the existing lockfile, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:http`, `npm run test:browser`, `npm run test:browser:native`, `PREMIUM_SCREENSHOTS=docs/intelligence-motion/screenshots npm run test:browser:premium` and `npm run test:browser:motion`. Build first and keep that build stable while browser suites run. Optional `CAPTURE_MOTION_VIDEO=1` uses local FFmpeg to encode actual browser frames; it adds no application dependency.

`npm run preview:fixture` starts a local persistent fictional preview with external fetch blocked. It prints the path of a private local sign-in password file, not the password. It never inherits a production database/provider/payment credential. The preview's model responses are scripted; do not use it to claim genuine-provider acceptance.

Before any eventual release, the owner should review genuine answers for the exact savings prompt and corrections, Ada search → first candidate → recipient credit, ordinary chat and education using a separately configured development Gemini connection and fictional in-memory records. Read the **narration flag and final wording**, not only HTTP status. Do not point these tests at production PostgreSQL, copy production secrets into logs or enable live transfers. The CI campaign guards intentionally prevent automatic paid reruns; any further campaign needs a new explicit bounded budget.

Physical Android/iOS keyboards, real-device voice behavior, battery use and sustained GPU performance remain untested. The actual production screen was not reachable under this environment's network policy. The final proof repair has recorded-provider replay and full regression coverage, but was not live-retested after exhausting the 48-request campaign budget. Model interpretation and semantic review use the configured model and remain fallible. Human-readable fallback remains necessary and is intentionally visible. None of the passing checks authorizes merge or deployment.
