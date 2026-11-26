# Sponsor source audit and selected integration

Reviewed published heads: Pollar `f992b6f980cb3ee0adc538ba2d278164434b50c4`, Zcash `b9efe96b268444d5e55bb6a81251f82d7f5e77bc`. Both descend from the older `d82cbe3` foundation. Financial intelligence at `2031112` is already preserved in this branch. A whole-tree replacement would remove that engine.

The original handoffs are retained here as **upstream claims**, not acceptance reports.

## Pollar

Retained the working official `@pollar/core@0.12.0` browser integration and durable AGUS server domain. Incorporated the sponsor's testnet protocol constants and canonical issuer exclusion; this also rejects Circle's issuer when another issuer is configured. No hardcoded person-to-address alias was added.

The sponsor's `getOrCreateSession` synthesizes a wallet address. `getBalances` falls back to 150 USDC / 25 XLM after network failures. `submitPayment` generates a hash without credentials; with an SDK response it still assigns `state: confirmed` and ledger `12345678` without independent receipt verification. Its adapter's direct authorization accepts a nonempty password when no reauthenticator is supplied, although its HTTP route reauthenticates. These paths were not mounted or imported.

Our path requires actual SDK authentication, remote Testnet app verification, a parsed exact provider envelope, server password verification, bound digest and one-use authorization. A later SDK confirmation is displayed and matched against the approved operation. Independent Horizon evidence determines settlement. SDK success alone remains pending.

`acceptance/pollar-sdk-browser.json` documents the full real browser → actual official SDK → authenticated AGUS API → SQL path with explicitly mocked SDK/Horizon HTTP. It covers incorrect-password rejection, exact envelope, one signing call, nonce replay denial, pending state despite provider success, and obligation completion only after mocked independent evidence. **No genuine Pollar wallet or transfer was established:** application credentials and a funded authorized wallet were unavailable.

## Zcash

Integrated the upstream read-only HTTP/2 lightwalletd client and ZIP 321/types modules. Hardened HTTP/gRPC status/framing, response size, protobuf bounds, required chain metadata and block IDs. Removed synthesized Testnet identity on malformed replies. ZIP 321 now uses checksum-validated Sapling Testnet receivers, bounded positive atomic amounts, unpadded base64url memos and strict parsing. Prefix-only Unified Address recognition is excluded pending proper ZIP 316/F4Jumble/receiver validation.

The upstream `ZcashWalletService.getBalance` invents a default 50 ZEC. Its authorizer checks only credential length; its executor generates `txid_testnet_...` without signing/broadcasting. Its receiver verifier compares supplied observations with a public chain tip, which cannot independently establish a shielded recipient, amount or memo. Those routes and wallet/settlement adapters were not mounted.

The `zcash:acceptance` upstream command prints hardcoded data. Reported transaction `ab7f8db0323414980c8389977587bf43c42e13765616c090dbd1e1d3cf461323`, block 4616326, 0.05 ZEC and receiving note are **reported external execution**, not reproduced web acceptance. The wallet binary, authorized sender adapter and receiver database were not handed over. Public block metadata cannot prove shielded amount or recipient.

Our genuine public-node probe failed in this Cloud runtime; see `zcash-public-probe.json`. No positive network or settlement result was synthesized. Receiving verification remains the existing read-only synchronized Testnet wallet RPC boundary, requiring exact receiver/amount/memo and three confirmations. Shielded web sending stays blocked.

## Server-side agent

Configured chat uses the existing native Gemini engine on the Node server. The model can discover digital-payment capabilities, prepare validated structured terms, revise a conversation-bound review (invalidating quotes/approval) and read/check saved payment status. None of these tools can approve, sign or send. The browser only collects conversation/review/approval and hosts the trusted wallet SDK.

`genuine-language.json` contains actual Gemini inference with synthetic inputs. Standard Pidgin preparation, a prepare-only follow-up and missing-balance reasoning completed. Genuine model-selected tools also saved Chidi's private ZEC review and revised 0.05 to 0.02, before provider quota interrupted their final narration. Later language cases are recorded as interrupted; they are not language-quality passes. The runner now stops at a quota limit. Existing memory/durable-engine regressions remain separate automated evidence.
