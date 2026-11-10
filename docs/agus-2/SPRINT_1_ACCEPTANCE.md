# Sprint 1 — owner-wallet acceptance

Status: implementation and read-only readiness prepared; genuine wallet-signed
transfers **not yet accepted**. Sprint 0 is complete at `424f4f4`.

## Ready implementation

- Existing wallet-controlled simulation → exact review → password approval →
  wallet signing → durable single broadcast → reconciliation pipeline preserved.
- Canonical Circle Devnet mint
  `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` is identified explicitly as
  **Circle test USDC (Devnet; no cash value)**. Classic SPL ownership,
  initialization and six decimals are checked before using this identity.
  Arbitrary tokens, mainnet USDC, or matching symbols cannot acquire the label.
- Authenticated owners can download a saved draft by ID. Downloads retain
  private/no-store response headers; unknown/other-owner drafts remain hidden.
- `npm run solana:acceptance` independently retrieves public RPC evidence and
  validates the saved signature, exact approved transaction, expected program
  instructions, sender, recipient, atomic amount, finalized slot, successful
  metadata, balance changes, actual fee and associated-account rent.
  It never signs, submits, retries a write, or treats missing evidence as failure.
- The runner bounds each read to 12 seconds/512 KB, rejects redirects, pins
  Devnet genesis, and writes evidence only after successful validation. Existing
  evidence files cannot be overwritten. The output excludes session credentials
  and operator identity. It explicitly leaves wallet-interaction and restart
  acceptance unverified until those separate observations are recorded.

[Current read-only evidence](evidence/devnet-read-only-20261110.json) was obtained
from the genuine public RPC on 10 November 2026. It proves genesis/mint reads,
**not a transfer, wallet ownership or a bank integration**. Transfer verification
uses an independent read of the pinned RPC, not a second RPC provider.

## Owner interaction

The isolated development acceptance application runs at
`http://127.0.0.1:3000/devnet`. Its persistent database and private application
password file are under `.data/agus2-devnet-acceptance/` (gitignored). The password
file is `operator-password`; this is an AGUS application password, never a wallet
credential. No wallet key, seed phrase, or bank password is needed by the server.

To restart this isolated app, stop its current process cleanly and run:

```sh
npm run preview:devnet
```

If the owner accesses a forwarded HTTPS URL, set `DEVNET_PREVIEW_ORIGIN` to that
exact origin before starting it. `DEVNET_PREVIEW_PORT` defaults to 3000. The
runner creates its own isolated environment: banking is fixture-only, model
access is disabled, and live payment flags/credentials are absent. The public
Devnet network is genuine. No automatic responsibility worker runs here.

1. Use two owner-controlled Devnet wallets and faucet assets. The owner connects
   the sender wallet in the app. Record public sender/recipient addresses only.
2. Prepare **0.001 Devnet SOL**. Review the full recipient, amount, fee and network,
   approve the exact draft, and explicitly sign in the real wallet.
3. Reconcile the saved submission. Download its saved draft using the link below
   its signature. Do not recreate or resend an unresolved transfer.
4. Independently verify the downloaded draft (command below).
5. Repeat with **1 Circle test USDC** using the canonical mint above. Select a
   recipient without that mint's token account so account creation and rent are
   exercised. Review SOL fee/rent separately. All assets remain Devnet assets.
6. Restart the server cleanly, sign in again, recover each existing draft, and
   verify that the saved IDs, signatures, approvals, outcomes and audits survive.
   Record this observation separately; the verifier cannot infer a server restart.

```sh
AGUS_ENVIRONMENT=devnet PAYMENT_MODE=fixture \
AGUS_SOLANA_DEVNET_ENABLED=true PAYSTACK_SECRET_KEY= NODE_USE_ENV_PROXY=1 \
npm run solana:acceptance -- \
  --draft-file /path/to/downloaded-devnet-draft.json \
  --output .data/agus2-devnet-acceptance/sol-finalized-evidence.json
```

Use a different evidence output file for USDC. The managed environment may require
execution permission for network access. The verifier has no signing or broadcast
path and no automatic retry loop. A non-finalized/missing result leaves acceptance
pending; repeat a **read**, never the transfer, when appropriate.

## Acceptance ledger

| Requirement | Current evidence |
| --- | --- |
| Genuine Devnet genesis and canonical mint read | Passed; separate read-only artifact |
| Exact approval, wrong-owner/stale/expired approval rejection, single broadcast, uncertainty and restart persistence | Automated fixture regressions passed |
| Independent evidence checks reject wrong network, signature, amount, recipient, token owner/mint, fees/rent, unsafe balances and non-finality | Synthetic signed-transaction regressions passed |
| Real wallet connection and explicit SOL signature | **Awaiting owner** |
| SOL finalized transaction and balance/fee evidence | **Awaiting real signature** |
| Real canonical test-USDC transfer and destination account creation | **Awaiting owner** |
| Genuine result survives server restart | **Awaiting signed transactions** |
| Wallet rejection/account change/app switching with actual wallet | **Awaiting owner** |
| Android-originated transfer and physical Android acceptance | Later Sprint 4 external device gate |

Keep fixture reports and public-chain artifacts separately labeled. Neither
this readiness work nor its tests establishes live personal-bank connectivity.
Escrow and advanced swap work remain deferred until genuine Sprint 1 proof.

## Verification checkpoint — 10 November 2026

- Full suite: **74 files, 1,432 tests passed**, including all baseline tests.
- Final Solana core/acceptance/asset/export route checks: **60 tests passed**.
- Typecheck, lint and production build passed.
- Production payment HTTP and workspace Chromium smokes passed again after the
  application changes. Sprint 0 follow-up and reminder-runner smokes also passed.
- The actual isolated Devnet acceptance server passed authenticated HTTP and
  Chromium readiness. Its draft list was empty, missing-draft exports returned
  404 with no-store headers, and the wallet-connect control rendered without
  page errors. No wallet connection, approval, signing or submission was automated.
- Public RPC probe passed with `transferProven: false`.

Logs: `/tmp/agus2-final-{tests,solana,lint,http,workspace}.log`,
`/tmp/agus2-{typecheck,build,devnet-probe,devnet-preview}.log`.
Readiness screenshot: `/tmp/agus2-devnet-readiness.png`.

Sprint 1 remains incomplete pending the owner interactions above. Sprints 2–4
have not started; no shared-identity, live-bank, native-device or escrow acceptance
is implied by this checkpoint. The acceptance server is left running for the
owner interaction. The integration branch remains local; hosted CI is pending
publication, and no merge or deployment has occurred.
