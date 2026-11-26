# AGUS · Counterpart

Isolated visual exploration. The production app, credentials, payment logic and deployment configuration are unchanged.

## Review

- `AGUS-Counterpart.pdf`: six desktop/mobile composition boards.
- `gallery.html`: complete visual review, with links to interactive screens.
- `index.html`: interactive prototype.
- `previews/`: full-resolution screenshots, overview boards and verification results.

From this directory, run:

```sh
python -m http.server 4190
```

Open `http://localhost:4190/gallery.html`. No account, build, credentials or backend is required. Fonts are bundled locally.

## Current refinement

Counterpart retains its financial hierarchy, compact desktop rail, account and wallet composition, invoice context, and bottom-centered AGUS control. The updated system uses deep black, layered black surfaces, white typography and silver support text.

The six screens are Home, AGUS conversation, Accounts & wallets, Obligations, Activity, and Payment review. Mobile authorization is a separate state of payment review. Obligations and Activity are full destinations with local filters; Activity also has search and a selected-record detail view.

Product copy is limited to headings, financial labels, actions and necessary helper text. The official tagline appears in the desktop header. The mascot remains confined to the AGUS control, message identity, thinking state, hidden-balance state and task handoffs.

## Fictional data

All people, balances, accounts, addresses, rates, verification results, reminders and payment outcomes are fictional. No account or wallet is connected.

| Item                               |                   Value |
| ---------------------------------- | ----------------------: |
| Wema Everyday                      |              ₦1,850,000 |
| GTBank Reserve                     |              ₦1,400,000 |
| Pollar wallet                      | 1,000 USDC ≈ ₦1,560,000 |
| Zcash wallet                       |      0.25 ZEC ≈ ₦40,000 |
| Combined balance                   |              ₦4,850,000 |
| Upcoming obligations               |    ₦640,000 before fees |
| Receivable, excluded from balances |                ₦225,000 |
| Studio North payment               |                ₦180,000 |
| Estimated payment fee              |                     ₦50 |
| Total debit                        |                ₦180,050 |
| Everyday after payment             |              ₦1,669,950 |

The existing application uses Paystack. Pollar, Zcash, wallet connections, bank-account connections, receivables and reminders shown here are proposed product interfaces. They are not integrations or automations. The prototype makes no financial API requests.

Demo authorization requires an explicit review checkbox and the published code `000000`. It never accepts authorization from code alone. Authorization shows **Authorized. Not sent.** Submission remains separate, and the submission preview states that settlement is unverified. No real credential should be entered.

Chat replies are scripted and labeled as previews. Uploads, voice, adding accounts and creating obligations do not invoke external services. Filters, search, wallet details, account selection, invoice context, conversation navigation and the connected payment review can be explored locally.

## Verification

From the repository root, with the static server running:

```sh
node docs/agus-counterpart/verify.mjs
node docs/agus-counterpart/capture.mjs
```

Verification covers all six screens at 320, 390, 768, 1024 and 1440 pixels: 30 viewport/screen combinations. Checks include dark canvas and white headings, horizontal overflow, unclipped primary balances, navigation, wallet networks, obligation filters, activity search and filters, payment authorization gates, distinct submission/settlement state, message escaping, reduced motion and zero external or financial API requests.

Financial consistency checks read the rendered balances, obligations, fee, total debit and remaining balance. Captures use a 1440 × 1040 desktop viewport and 390 × 900 mobile viewport. The PDF and captured outputs were visually inspected. Physical devices, assistive technology and software keyboards were not tested.

No production test suite was rerun because production source is unchanged.

## References and identity

Public product references were inspected in the browser: [Mercury](https://mercury.com/), [Family](https://family.co/), [Linear](https://linear.app/) and [Wise](https://wise.com/gb/send-money/). Research captures and source metadata are under `research/`.

Typography uses [General Sans](https://www.fontshare.com/fonts/general-sans) and IBM Plex Mono. Their license files are included in `assets/`.

The mascot and wordmark are vector studies reconstructed from the supplied raster reference. The silhouette, expressive eyes, orbit and recognizable wordmark have been preserved. Production implementation should use the official master assets.
