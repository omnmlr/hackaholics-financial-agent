# AGUS Crypto API, agent and fixture contract

**Companion to the [Product Requirements Document](PRD.md) · v1 implementation specification · 23 November 2026**

Use `packages/contracts` for strict Zod schemas and OpenAPI, and `packages/api-client` for generated client types. The types below define wire semantics and the native handoff. Reuse the existing user session, provenance, revision and failure primitives. Add schemas and adapters around the existing Solana execution, requests and notification services. During the contract checkpoint, map compatible operations to existing `/api/v1` routes first. The `/api/v1/crypto` paths below are the logical client-facing contract for new or adapted operations. Existing routes stay compatible through the same service. Generate the OpenAPI/client and make the mocks implement the exact agreed generated paths. Backend functions and agent tools share financial logic.

## Common types

Use branded types and parse at the boundary. Validate the exact 32-byte Solana addresses and 64-byte signatures after base58 decoding. Use the transaction version and asset's on-chain scale to validate reviewed bytes and quantities. Amounts use integer decimal strings and explicit decimals. UTC ISO 8601 timestamps and half-open `[from, to)` windows are mandatory, with IANA timezone for calendar queries. Cursor and snapshot IDs are opaque and scoped to the actor, cluster, filters and stable pagination position. Client-supplied IDs never grant access.

```ts
type Id = string;        // UUID, except stable derived event IDs and opaque cursors
type Utc = string;
type Address = string;
type Signature = string;
type Atoms = string;     // ^(0|[1-9][0-9]*)$; validate range per asset/protocol
type SignedAtoms = string;
type Digest = string;    // SHA-256 hex
type Cluster = "devnet" | "mainnet-beta";
type Provider = "phantom" | "solflare" | "backpack" | "swig-device";
type Operation =
  | "transfer" | "swap" | "pocket_create" | "pocket_fund"
  | "pocket_spend" | "pocket_grant" | "pocket_revoke" | "pocket_withdraw";
type AssetId =
  | { cluster: Cluster; kind: "sol" }
  | { cluster: Cluster; kind: "token"; program: Address; mint: Address };
type Amount = { asset: AssetId; atoms: Atoms; decimals: number };
type Window = { from: Utc; to: Utc; timeZone: string };
type Source = {
  mode: "fixture" | "local" | "public-rpc";
  cluster: Cluster;
  provider: string;
  observedAt: Utc;
  slot: number | null;
};
type Coverage = {
  walletId: Id;
  kind: "balances" | "activity" | "positions" | "prices";
  state: "ready" | "partial" | "stale" | "unavailable";
  reason: "bounded_window" | "rpc_lag" | "pruned" | "missing_token_accounts"
        | "unsupported" | "unpriced" | "provider_failure" | null;
  observedAt: Utc | null;
  coveredWindow: Window | null;
  throughSlot: number | null;
};
type Page<T> = { items: T[]; nextCursor: string | null; source: Source };
type Wallet = {
  id: Id; cluster: Cluster; address: Address; label: string;
  group: "linked_owned" | "own_watch" | "third_party_watch" | "pocket";
  ownership: "verified" | "declared" | "none";
  lastSyncAt: Utc | null; routes: SigningRoute[];
};
type SigningRoute = {
  id: Id; provider: Provider; address: Address; cluster: Cluster;
  operations: Operation[];
  status: "available" | "reconnect" | "unavailable" | "disabled";
  reason: string | null;
};
type Price = {
  usdPerUnit: string; valueUsd: string; provider: string; observedAt: Utc;
};
type Holding = {
  walletId: Id; tokenAccount: Address | null; amount: Amount;
  symbol: string | null; valuation: Price | null; spendable: boolean;
};
type Position = {
  id: Id; walletId: Id; protocol: string;
  state: "supported" | "unsupported"; amounts: Amount[];
  replacesHoldingAccountIds: Address[]; valueUsd: string | null;
};
type Portfolio = {
  id: Id; walletIds: Id[]; source: Source; holdings: Holding[];
  positions: Position[]; coverage: Coverage[]; pricedSubtotalUsd: string | null;
};
type ActivityLeg = {
  id: Id; kind: "transfer" | "swap" | "fee" | "rent" | "unknown";
  from: Address | null; to: Address | null;
  fromWalletId: Id | null; toWalletId: Id | null;
  amount: Amount | null;
  walletDeltas: { walletId: Id; atoms: SignedAtoms }[];
  instructionPath: string;
};
type ActivityEvent = {
  id: Id; signature: Signature; slot: number; blockTime: Utc | null;
  source: Source; finality: "confirmed" | "finalized";
  status: "success" | "failed"; classification: "internal" | "incoming"
    | "outgoing" | "swap" | "unknown"; reason: string;
  legs: ActivityLeg[]; explorerUrl: string | null;
};
type ActivityPage = Page<ActivityEvent> & { coverage: Coverage[] };
type Scope = { cluster: Cluster; walletIds?: Id[] };
type Capabilities = {
  source: Source; features: {
    portfolio: boolean; assistant: boolean; monitoring: boolean;
    requests: boolean; invoices: boolean;
    swap: boolean; pocketCreate: boolean; pocketFund: boolean;
    pocketSpend: boolean; pocketManage: boolean;
  };
  approvedRoutes: { provider: Provider; operations: Operation[] }[];
};
```

Default owned portfolio includes verified linked wallets and enabled owned Pocket once each. User-declared watches are visible as a separate group and may be explicitly added to a read scope. They never enter verified owned flow attribution. Default activity page size is 25, capped at 25 for the hackathon, and the first sync covers at most seven days. A wider requested time range returns known coverage and an explicit limitation. Devnet valuation fields are null. Amount scale reuse from `AtomicMoney` is permitted when mint identity and exact token precision are preserved.

## Execution, review and payment types

```ts
type TransferIntent = {
  kind: "transfer"; sourceWalletId: Id; routeId: Id; amount: Amount;
  recipient: Address; requestId?: Id;
};
type SwapIntent = {
  kind: "swap"; sourceWalletId: Id; routeId: Id; quoteId: Id;
};
type PocketIntent = (
  | { kind: "pocket_create" }
  | { kind: "pocket_fund" | "pocket_spend" | "pocket_withdraw";
      pocketId: Id; amount: Amount; recipient: Address }
  | { kind: "pocket_grant"; pocketId: Id; role: RoleSpec }
  | { kind: "pocket_revoke"; pocketId: Id; roleId: Id }
) & { sourceWalletId: Id; routeId: Id };
type Intent = TransferIntent | SwapIntent | PocketIntent;
type Quote = {
  id: Id; sourceWalletId: Id; routeId: Id; venue: "jupiter";
  adapterVersion: string; input: Amount; expectedOut: Amount; minOut: Amount;
  slippageBps: number; priceImpactBps: number | null; fees: Amount[];
  expiresAt: Utc;
};
type Review = {
  id: Id; revision: number; operation: Operation; cluster: Cluster;
  sourceWalletId: Id; routeId: Id; expectedSigner: Address; feePayer: Address;
  recipient: Address | null; sourceTokenAccount: Address | null;
  destinationTokenAccount: Address | null; amount: Amount | null;
  estimatedFeeLamports: Atoms; estimatedRentLamports: Atoms;
  quote: Quote | null; expiresAt: Utc; blockhash: string;
  lastValidBlockHeight: number; reference: Address | null;
  minContextSlot: number; messageDigest: Digest; reviewDigest: Digest;
  transactionVersion: "legacy" | "v0";
  unsignedTransactionBase64: string;
  simulation: { passed: true; slot: number; observedAt: Utc };
  source: Source;
};
type Begin = { revision: number; reviewDigest: Digest; challengeId?: Id };
type AttemptState = "ready" | "handoff" | "declined" | "pending"
  | "unknown" | "failed" | "expired" | "finalized";
type Attempt = {
  id: Id; reviewId: Id; revision: number; reviewDigest: Digest; state: AttemptState;
  cluster: Cluster; routeId: Id; expectedSigner: Address; reference: Address | null;
  signature: Signature | null; createdAt: Utc; updatedAt: Utc;
  reason: string | null; receiptId: Id | null;
};
type HandoffClaim = { attempt: Attempt; launchGranted: boolean };
type WalletOutcome =
  | { kind: "declined" }
  | { kind: "unavailable"; reason: string }
  | { kind: "unknown" }
  | { kind: "signature"; signature: Signature }
  | { kind: "signed"; signedTransactionBase64: string };
type Receipt = {
  id: Id; attemptId: Id | null; requestId: Id | null; source: Source;
  signature: Signature; messageDigest: Digest; walletIds: Id[]; slot: number;
  time: Utc | null; verifiedAt: Utc; finality: "finalized";
  execution: "success"; feeLamports: Atoms; legs: ActivityLeg[];
  eventId: Id; explorerUrl: string | null;
};
type RoleSpec = {
  authority: Address; asset: AssetId; budgetAtoms: Atoms;
  destination: Address; programs: Address[]; expirySlot: number;
  policy: "lifetime" | "slot_window"; windowSlots: number | null;
};
type Pocket = {
  id: Id; cluster: Cluster; walletId: Id; rootWalletId: Id;
  config: Address; vault: Address; program: Address; programDigest: Digest;
  recoveryVerified: boolean; status: "active" | "paused" | "blocked";
  spendable: Amount[]; pending: Amount[]; reserveLamports: Atoms;
  roles: (RoleSpec & { id: Id; remainingAtoms: Atoms; state:
    "pending" | "active" | "paused" | "revocation_pending" | "revoked" | "expired" })[];
};
type NewRequest = {
  walletId: Id; amount: Amount; expiresAt?: Utc;
  invoice?: { title: string; notes?: string; dueAt?: Utc };
};
type Request = NewRequest & {
  id: Id; recipient: Address; reference: Address; solanaPayUri: string;
  shareUrl: string; qrPath: string; qrMode: "share_url" | "solana_pay";
  revision: number;
  state: "open" | "cancelled" | "expired" | "needs_review" | "settled";
  receiptId: Id | null;
};
```

Accept only protocol-supported funding destinations derived from the verified Pocket record, regardless of client input. Require a defensible unique chain search strategy for each attempt. If a route has no observable reference, reconcile using signature and scoped account history plus exact reviewed bytes, report uncertainty where that evidence is insufficient, and keep the route off live unless the recovery gate passes. A fixture receipt uses fixture provenance and no public Explorer link. Receipt publication always comes from the verifier. A receipt claims successful finality only in its declared provenance environment.

**Native signer seam.** `authorize(provider, cluster) → { addresses, capabilities }`, `signProof(routeId, expectedSigner, challengeBytes) → signature`, and `handoff({ attemptId, route, expectedSigner, unsignedTransactionBase64, messageDigest, minContextSlot }) → WalletOutcome`. Capability detection and exact-account verification happen in the adapter. Where a wallet cannot safely prove ownership or return the needed signing method, surface that limitation and keep the route read-only. Store provider tokens per app/account/cluster only in SecureStore. Distinguish sign-only and sign-and-send before handoff and reject the wrong result kind for the attempt. A cancel before vendor submission and an indeterminate response after the wallet opens have different states. Begin always returns the same attempt on replay. Before launching, obtain a one-time server handoff claim and persist the local launch marker. A lost claim acknowledgement or process interruption stays unresolved for reconciliation. Replays return current status without another launch grant. An optional step-up challenge uses the existing action-bound identity contract, distinct from external wallet consent.

## Conversation, alert and tool contracts

```ts
type Evidence =
  | { kind: "portfolio"; id: Id; scope: Scope; observedAt: Utc }
  | { kind: "activity" | "receipt"; id: Id; walletIds: Id[]; cluster: Cluster }
  | { kind: "coverage"; coverage: Coverage[] };
type EligibilityInput = { scope: Scope; operation: "transfer" | "swap";
  amount: Amount; recipient?: Address };
type Eligibility = { walletId: Id; routeId: Id | null; amountAvailable: Amount;
  feeLamports: Atoms | null; rentLamports: Atoms | null; eligible: boolean;
  reason: string | null };
type ObservedFlow = { scope: Scope; window: Window; received: Amount[];
  sent: Amount[]; internal: Amount[]; fees: Amount[]; evidence: Evidence[];
  coverage: Coverage[] };
type ActionSuggestion =
  | { kind: "transfer"; amount: Amount; recipient: Address;
      suggestedWalletIds: Id[] }
  | { kind: "swap"; input: Amount; output: AssetId; suggestedWalletIds: Id[] };
type Ask = {
  conversationId?: Id; clientTurnId: Id; text: string; scope: Scope;
  reportingTimeZone: string;
};
type Answer = {
  turnId: Id; conversationId: Id; source: Source;
  kind: "answer" | "clarify" | "draft_suggestion" | "degraded";
  text: string; scope: Scope; window: Window | null; facts: Amount[];
  evidence: Evidence[]; coverage: Coverage[]; suggestion: ActionSuggestion | null;
};
type NewAlertRule = { walletId: Id; kind: "external_inflow"; min?: Amount };
type AlertRule = NewAlertRule & { id: Id; enabled: boolean; checkedAt: Utc | null };
type Alert = { id: Id; ruleId: Id; eventId: Id; walletId: Id; source: Source;
  dedupeKey: string; createdAt: Utc; readAt: Utc | null };
```

| Agent tool | Typed input → output | Behavior |
| --- | --- | --- |
| `portfolio` | `Scope → Portfolio` | Exact asset aggregation and coverage. The model receives only authorized views. |
| `flows` | `{scope, window, asset?: AssetId} → ObservedFlow` | Deterministic ISO bounds, finalized decoded flows, fees separate, internal attribution and bounded evidence. |
| `get_activity` | `{scope, eventId?: Id, signature?: Signature, cursor?: string} → ActivityEvent or ActivityPage` | Verify scope and at most one selector. Unparsed legs are unknown. |
| `eligible_wallets` | `EligibilityInput → {items: Eligibility[], coverage: Coverage[]}` | Compute amount, fees, balance/rent buffer and supported route. Never select a wallet on the user's behalf. |
| `propose_action` | `{scope, suggestion: ActionSuggestion} → {suggestion, evidence: Evidence[]}` | Return only a validated suggestion. Ask for missing or ambiguous fields. The reviewed action begins after explicit source selection through the same prepare API that the form uses. |
| `receipt` | `{id: Id} → Receipt` | Read an owned verifier-produced receipt. Unverified outcomes remain in attempt state. |

Server validates all tool arguments and outputs with strict schema and scoped auth, independently of model output. If a tool read fails, omit unsupported values and expose coverage/error. The model cannot access approval, signing, broadcasting, grants or scheduling actions. One bounded LLM job per `clientTurnId` per user. Use existing narration/evaluation tests where compatible and add coverage for evidence deep links and tool failure.

## Endpoint map and mock behaviors

Authenticated paths are relative to `/api/v1/crypto`. In the table `id` denotes a resource ID, braces name parameters, and query filters are validated. New action mutations require an `Idempotency-Key` header bound to actor and canonical request. An existing key/body returns the original outcome, except that a handoff replay cannot grant a launch. A changed body with the same key returns conflict. Resource reads are side-effect free.

| Method and path | Request → response | Default mock behavior |
| --- | --- | --- |
| GET `/capabilities` | `{cluster} → Capabilities` | Core reads and the demo signer seam on. Stretch and invoice off unless scenario enables them. |
| GET `/wallets` | `Scope → Page<Wallet>` | Two distinct linked wallets, one duplicate route to A, one watch. |
| POST `/wallets/watch` | `{cluster, address, label, ownDeclared} → Wallet` | Watches are read-only. An already-linked address stays a single logical wallet. |
| POST `/wallets/challenge` | `{cluster, address, provider} → {id, messageBase64, expiresAt}` | Issue expiring single-use challenge. |
| POST `/wallets/association` | `{challengeId, signature, label?} → Wallet` | Persist one route after proof. Wrong address or used proof fails. |
| PATCH `/wallets/{id}` and DELETE `/wallets/{id}/routes/{routeId}` | `{label} → Wallet` and no body `→ Wallet` or empty when removed | Relabel in place. An unlink changes eligibility while preserving unresolved attempts. |
| GET `/portfolio` | `Scope → Portfolio` | Snapshot variants reflect before/after positions, partial data and freshness. |
| GET `/activity` and GET `/activity/{id}` | `Scope & {cursor?, from?, to?} → ActivityPage` and `→ ActivityEvent` | Internal event exposed once and includes both owned sides. |
| POST `/assistant/turns` | `Ask → Answer` | Return grounded, clarify, degraded and suggestion variants keyed to safe fixture prompts. |
| POST `/eligibility` | `EligibilityInput → {items: Eligibility[], coverage: Coverage[]}` | Return the same source-wallet choices used by the agent tool, with eligible and ineligible examples. |
| POST `/swaps/quote` | `{sourceWalletId, routeId, input, output, slippageBps} → Quote` | Return one fixture route or gated error. |
| POST `/reviews` | `Intent → Review` | Return immutable reviewed bytes for the fake signer. Re-preparation after change requires a fresh revision or review ID. |
| POST `/reviews/{id}/begin` | `Begin → Attempt` | Claims one ready attempt after review approval, including optional action-bound challenge. |
| POST `/attempts/{id}/handoff` | No body `→ HandoffClaim` | Atomic ready → handoff. Only the first successful claim returns a launch grant. |
| POST `/attempts/{id}/wallet-outcome` | `WalletOutcome → Attempt` | Transition to pending, declined or unknown. A signature alone never finalizes. |
| GET `/attempts` | `Scope & {cursor?, unresolvedOnly?} → Page<Attempt>` | List unresolved owned attempts after device restart or local-state loss. |
| GET `/attempts/{id}` and POST `/attempts/{id}/reconcile` | No body `→ Attempt` | Read state or trigger bounded status check without broadcasting. Finalize only when the verified scenario advances. |
| GET `/receipts/{id}` | No body `→ Receipt` | Fixture receipt appears only after the verifier scenario returns finalized. |
| POST `/alert-rules`, PATCH `/alert-rules/{id}`, GET `/alert-rules` | `NewAlertRule → AlertRule`, `{enabled} → AlertRule`, `Scope → Page<AlertRule>` | Persist rule, retain checked time and seed one finalized event observation. |
| GET `/alerts` and POST `/alerts/{id}/read` | `Scope & {cursor?} → Page<Alert>`, no body `→ Alert` | Duplicate deliveries create one unread alert, then marking read stays idempotent. |
| GET `/pocket` | `{cluster} → Pocket or null` | Switch between disabled, active and recovery-blocked through a fixture. Pocket mutations use reviews/attempts. |
| POST `/requests`; GET `/requests/{id}`; GET `/requests/{id}/qr`; POST `/requests/{id}/cancel` | `NewRequest → Request`; `→ Request`; `→ image/png`; `{revision} → Request` | Open, needs-review, cancelled, and finalized settlement cases. QR decodes to the declared share URL or Solana Pay URI. |

The existing public request lookup, if enabled, uses an opaque reference and only the minimum share data. It cannot act as the user or expose personal invoice notes. A standard Solana Pay transfer URI does not select a cluster. For Devnet use a share-link QR that resolves to a network-labeled view with explicit network confirmation before opening a compatible wallet. Reuse an authenticated poll for attempt and alert status. Server reconciliation runs even when the Android app is closed. Keep mock/debug endpoints out of the deployed API and build artifact.

## Errors and recovery states

```ts
type ApiError = { error: {
  code: string; retryable: boolean; correlationId: Id;
  fields?: Record<string, string>; retryAfterSeconds?: number;
} };
```

| HTTP / code | Client recovery |
| --- | --- |
| 400 `INVALID_INPUT`, `INVALID_AMOUNT`, `INVALID_CURSOR` | Keep entered context, identify field and ask for correction. Reset invalid pagination without losing scope. |
| 401 `SESSION_REQUIRED`; 403 `WATCH_ONLY`, `OWNERSHIP_PROOF_REQUIRED`; 404 `NOT_FOUND` | Reauthenticate, show watch/read-only or reconnect as appropriate, and reveal no cross-user resource details. |
| 409 `REVISION_CHANGED`, `IDEMPOTENCY_CONFLICT`, `ATTEMPT_IN_PROGRESS`, `ROUTE_CHANGED` | Refresh review or route. Open the existing attempt when applicable. Affected approvals must be renewed. |
| 410 `REVIEW_EXPIRED`, `QUOTE_EXPIRED`, `CHALLENGE_EXPIRED` | Reprepare or reauthorize explicitly after resolving any previous submission. |
| 422 `INSUFFICIENT_FUNDS`, `UNSUPPORTED_ASSET`, `SIMULATION_FAILED`, `INELIGIBLE_ROUTE` | Show exact action to fix balance, asset or provider where available. Use the same review for a manual journey only if still valid. |
| 429 `AI_LIMIT`, `RATE_LIMITED` | Show retry/reset when provided and keep non-AI tools usable. |
| 503 `FEATURE_DISABLED`, `PROVIDER_UNAVAILABLE`, `CHAIN_IDENTITY_MISMATCH` | Show reason/capability state, cached reads and retry or Check status. No failed payment claim from transport errors. |

`declined`, `pending` and `unknown` are normal attempt outcomes. Unknown and pending show Check status and restore after restart. Only verified finalization exposes a receipt. Never infer server state solely from Android activity result. Use the attempt reason and current capabilities to decide whether to show reconnect, manual check or a new review.

## Shared fixtures and launch checklist

Founder publishes a versioned fixture package by Nov 24 with deterministic time and scenario transitions. Use valid disposable-format address fixtures and a seeded keypair generator, placeholder explorer URLs absent, and fixture-only signer/transport. Chisom wires the mock base URL and fake signer separately. The mock reset/advance mechanism is local test tooling only. Both lanes run the same scenario IDs through the generated client and compare the same financial outcomes.

| Scenario ID | Initial data or transition | Observable result |
| --- | --- | --- |
| `owned_duplicate_watch` | A has Phantom plus duplicate view/route, B has Solflare, W is third-party watch. A/B have 100/25 test USDC with six decimals. W is outside default totals. | Exactly two owned wallets and 125 units, distinct route choices, W cannot sign. |
| `internal_transfer` | A sends 10,000,000 atoms to B, fee 5,000 lamports. Owner and ATA feeds repeat the event. | A/B show 90/35 units, combined 125, no external token flow, one fee and both wallet attributions. |
| `outside_inflow_replay` | After the internal transfer A receives 5,000,000 atoms from an outsider, initially detected on its ATA only. Reprocess the same finalized event twice and restart the worker. | Combined 130 and one alert. Evidence opens the event. |
| `partial_and_stale` | Unpriced token, unsupported position, pruned history, stale balance and eventual provider outage. | Exact token quantities persist, known subtotal/coverage is explicit, no invented valuation or history. |
| `decline_and_wrong_wallet` | Fake provider declines, or returns another address. | Declined or route mismatch, no receipt or alternate wallet launch. |
| `lost_callback_then_finalized` | Handoff appears lost, app and worker restarted, then chain fixture finds reviewed bytes by reference. | Unknown survives restart, then one verified fixture receipt and one activity event. Duplicate outcome/arbitrary signature cannot submit or create another receipt. |
| `expired_or_mismatch` | Blockhash expires, initially with incomplete history. Alternate fixture observes another message or failed program. | Remain unknown until coverage permits expiry, withhold verified receipt from altered or failed transactions. |
| `ai_limit_and_recovery` | AI responds 429 and later provider outage. | Chat shows the recovery state. Balance reads, transfer review and verification continue via direct APIs. |
| `quote_and_pocket_gates` | Use fixture-only swap, expired quote and Pocket roles that are active/revoked. | Unavailable live modes stay visible as disabled where shown. UX can render approved, rejected and recovery states. |
| `request_verified_match` | Exact URI/QR and unique reference, wrong-amount observation, then eligible finalized match. | Wrong amount gives review, correct unambiguous evidence creates one receipt. |

To integrate, run `npm run contracts:generate`, commit the generated types with the source schemas, and make API/fixture tests fail on drift. Run `npm run typecheck`, `npm run test:platform` and `npm run mobile:typecheck`. Validate every response variant at the mock and HTTP boundaries, inspect zero/missing and loading/pending rendering, and then move the app to the live Devnet API with the real adapter. The [PRD schedule and acceptance table](PRD.md#10-critical-acceptance-tests) define the owner and evidence required for each live flag.
