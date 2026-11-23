import { base58 } from "@scure/base";
import { z } from "zod";

const base58Bytes = (bytes: number) =>
  z
    .string()
    .min(32)
    .max(bytes === 32 ? 44 : 88)
    .refine((value) => {
      try {
        return base58.decode(value).length === bytes;
      } catch {
        return false;
      }
    });

export const CryptoId = z.uuid();
export const CryptoAddress = base58Bytes(32);
export const CryptoSignature = base58Bytes(64);
export const CryptoCluster = z.enum(["devnet", "mainnet-beta"]);
export const CryptoProvider = z.enum([
  "phantom",
  "solflare",
  "backpack",
  "swig-device",
]);
export const CryptoOperation = z.enum([
  "transfer",
  "swap",
  "pocket_create",
  "pocket_fund",
  "pocket_spend",
  "pocket_grant",
  "pocket_revoke",
  "pocket_withdraw",
]);
export const CryptoUtc = z.iso.datetime();
export const CryptoAtoms = z.string().regex(/^(0|[1-9][0-9]{0,77})$/);
const Slot = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Label = z.string().trim().min(1).max(80);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Cursor = z.string().min(1).max(512);
const EventId = z.string().min(1).max(160);
const TimeZone = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });

export const CryptoScope = z.strictObject({
  cluster: CryptoCluster,
  walletIds: z.array(CryptoId).min(1).max(12).optional(),
});
export const CryptoWindow = z
  .strictObject({
    from: CryptoUtc,
    to: CryptoUtc,
    timeZone: TimeZone,
  })
  .refine(({ from, to }) => Date.parse(from) < Date.parse(to));
export const CryptoAsset = z.discriminatedUnion("kind", [
  z.strictObject({ cluster: CryptoCluster, kind: z.literal("sol") }),
  z.strictObject({
    cluster: CryptoCluster,
    kind: z.literal("token"),
    program: CryptoAddress,
    mint: CryptoAddress,
  }),
]);
export const CryptoAmount = z.strictObject({
  asset: CryptoAsset,
  atoms: CryptoAtoms,
  decimals: z.number().int().min(0).max(255),
});
export const CryptoSource = z.strictObject({
  mode: z.enum(["fixture", "local", "public-rpc"]),
  cluster: CryptoCluster,
  provider: z.string(),
  observedAt: CryptoUtc,
  slot: Slot.nullable(),
});
export const CryptoCoverage = z.strictObject({
  walletId: CryptoId,
  kind: z.enum(["balances", "activity", "positions", "prices"]),
  state: z.enum(["ready", "partial", "stale", "unavailable"]),
  reason: z
    .enum([
      "bounded_window",
      "rpc_lag",
      "pruned",
      "missing_token_accounts",
      "unsupported",
      "unpriced",
      "provider_failure",
    ])
    .nullable(),
  observedAt: CryptoUtc.nullable(),
  coveredWindow: CryptoWindow.nullable(),
  throughSlot: Slot.nullable(),
});
export const CryptoRoute = z.strictObject({
  id: CryptoId,
  provider: CryptoProvider,
  address: CryptoAddress,
  cluster: CryptoCluster,
  operations: z.array(CryptoOperation),
  status: z.enum(["available", "reconnect", "unavailable", "disabled"]),
  reason: z.string().nullable(),
});
export const CryptoWallet = z.strictObject({
  id: CryptoId,
  cluster: CryptoCluster,
  address: CryptoAddress,
  label: Label,
  group: z.enum(["linked_owned", "own_watch", "third_party_watch", "pocket"]),
  ownership: z.enum(["verified", "declared", "none"]),
  lastSyncAt: CryptoUtc.nullable(),
  routes: z.array(CryptoRoute),
});
const Price = z.strictObject({
  usdPerUnit: z.string(),
  valueUsd: z.string(),
  provider: z.string(),
  observedAt: CryptoUtc,
});
export const CryptoHolding = z.strictObject({
  walletId: CryptoId,
  tokenAccount: CryptoAddress.nullable(),
  amount: CryptoAmount,
  symbol: z.string().nullable(),
  valuation: Price.nullable(),
  spendable: z.boolean(),
});
const Position = z.strictObject({
  id: CryptoId,
  walletId: CryptoId,
  protocol: z.string(),
  state: z.enum(["supported", "unsupported"]),
  amounts: z.array(CryptoAmount),
  replacesHoldingAccountIds: z.array(CryptoAddress),
  valueUsd: z.string().nullable(),
});
export const CryptoPortfolio = z.strictObject({
  id: CryptoId,
  walletIds: z.array(CryptoId),
  source: CryptoSource,
  holdings: z.array(CryptoHolding),
  positions: z.array(Position),
  coverage: z.array(CryptoCoverage),
  pricedSubtotalUsd: z.string().nullable(),
});
export const CryptoActivityLeg = z.strictObject({
  id: EventId,
  kind: z.enum(["transfer", "swap", "fee", "rent", "unknown"]),
  from: CryptoAddress.nullable(),
  to: CryptoAddress.nullable(),
  fromWalletId: CryptoId.nullable(),
  toWalletId: CryptoId.nullable(),
  amount: CryptoAmount.nullable(),
  walletDeltas: z.array(
    z.strictObject({
      walletId: CryptoId,
      atoms: z.string().regex(/^-?(0|[1-9][0-9]{0,77})$/),
    }),
  ),
  instructionPath: z.string(),
});
export const CryptoActivityEvent = z.strictObject({
  id: EventId,
  signature: CryptoSignature,
  slot: Slot,
  blockTime: CryptoUtc.nullable(),
  source: CryptoSource,
  finality: z.enum(["confirmed", "finalized"]),
  status: z.enum(["success", "failed"]),
  classification: z.enum([
    "internal",
    "incoming",
    "outgoing",
    "swap",
    "unknown",
  ]),
  reason: z.string(),
  legs: z.array(CryptoActivityLeg),
  explorerUrl: z.url().nullable(),
});
const page = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    nextCursor: Cursor.nullable(),
    source: CryptoSource,
  });
export const CryptoWalletPage = page(CryptoWallet);
export const CryptoActivityPage = page(CryptoActivityEvent).extend({
  coverage: z.array(CryptoCoverage),
});
export const CryptoActivityQuery = CryptoScope.extend({
  cursor: Cursor.optional(),
  from: CryptoUtc.optional(),
  to: CryptoUtc.optional(),
});
export const CryptoFeatures = z.strictObject({
  portfolio: z.boolean(),
  assistant: z.boolean(),
  monitoring: z.boolean(),
  requests: z.boolean(),
  invoices: z.boolean(),
  swap: z.boolean(),
  pocketCreate: z.boolean(),
  pocketFund: z.boolean(),
  pocketSpend: z.boolean(),
  pocketManage: z.boolean(),
});
export const CryptoCapabilities = z.strictObject({
  source: CryptoSource,
  features: CryptoFeatures,
  approvedRoutes: z.array(
    z.strictObject({
      provider: CryptoProvider,
      operations: z.array(CryptoOperation),
    }),
  ),
});
export const CryptoWatch = z.strictObject({
  cluster: CryptoCluster,
  address: CryptoAddress,
  label: Label,
  ownDeclared: z.boolean(),
});
export const CryptoChallengeInput = z.strictObject({
  cluster: CryptoCluster,
  address: CryptoAddress,
  provider: CryptoProvider,
});
export const CryptoChallenge = z.strictObject({
  id: CryptoId,
  messageBase64: z.base64(),
  expiresAt: CryptoUtc,
});
export const CryptoAssociation = z.strictObject({
  challengeId: CryptoId,
  signature: CryptoSignature,
  label: Label.optional(),
});
export const CryptoRelabel = z.strictObject({ label: Label });

export const CryptoAlertRuleInput = z.strictObject({
  walletId: CryptoId,
  kind: z.literal("external_inflow"),
  min: CryptoAmount.optional(),
});
export const CryptoAlertRule = CryptoAlertRuleInput.extend({
  id: CryptoId,
  enabled: z.boolean(),
  checkedAt: CryptoUtc.nullable(),
});
export const CryptoAlertRuleUpdate = z.strictObject({ enabled: z.boolean() });
export const CryptoAlert = z.strictObject({
  id: CryptoId,
  ruleId: CryptoId,
  eventId: EventId,
  walletId: CryptoId,
  source: CryptoSource,
  dedupeKey: z.string(),
  createdAt: CryptoUtc,
  readAt: CryptoUtc.nullable(),
});
export const CryptoAlertRulePage = page(CryptoAlertRule);
export const CryptoAlertPage = page(CryptoAlert);
export const CryptoPageQuery = CryptoScope.extend({
  cursor: Cursor.optional(),
});

export const CryptoEvidence = z.union([
  z.strictObject({
    kind: z.literal("portfolio"),
    id: CryptoId,
    scope: CryptoScope,
    observedAt: CryptoUtc,
  }),
  z.strictObject({
    kind: z.enum(["activity", "receipt"]),
    id: EventId,
    walletIds: z.array(CryptoId),
    cluster: CryptoCluster,
  }),
  z.strictObject({
    kind: z.literal("coverage"),
    coverage: z.array(CryptoCoverage),
  }),
]);
export const CryptoAsk = z.strictObject({
  conversationId: CryptoId.optional(),
  clientTurnId: CryptoId,
  text: z.string().trim().min(1).max(1000),
  scope: CryptoScope,
  reportingTimeZone: TimeZone,
});
export const CryptoSuggestion = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("transfer"),
    amount: CryptoAmount,
    recipient: CryptoAddress,
    suggestedWalletIds: z.array(CryptoId),
  }),
  z.strictObject({
    kind: z.literal("swap"),
    input: CryptoAmount,
    output: CryptoAsset,
    suggestedWalletIds: z.array(CryptoId),
  }),
]);
export const CryptoAnswer = z.strictObject({
  turnId: CryptoId,
  conversationId: CryptoId,
  source: CryptoSource,
  kind: z.enum(["answer", "clarify", "draft_suggestion", "degraded"]),
  text: z.string(),
  scope: CryptoScope,
  window: CryptoWindow.nullable(),
  facts: z.array(CryptoAmount),
  evidence: z.array(CryptoEvidence),
  coverage: z.array(CryptoCoverage),
  suggestion: CryptoSuggestion.nullable(),
});
export const CryptoEligibilityInput = z.strictObject({
  scope: CryptoScope,
  operation: z.enum(["transfer", "swap"]),
  amount: CryptoAmount,
  recipient: CryptoAddress.optional(),
});
export const CryptoEligibility = z.strictObject({
  items: z.array(
    z.strictObject({
      walletId: CryptoId,
      routeId: CryptoId.nullable(),
      amountAvailable: CryptoAmount,
      feeLamports: CryptoAtoms.nullable(),
      rentLamports: CryptoAtoms.nullable(),
      eligible: z.boolean(),
      reason: z.string().nullable(),
    }),
  ),
  coverage: z.array(CryptoCoverage),
});

const sourceRoute = { sourceWalletId: CryptoId, routeId: CryptoId };
export const CryptoTransferIntent = z.strictObject({
  ...sourceRoute,
  kind: z.literal("transfer"),
  amount: CryptoAmount,
  recipient: CryptoAddress,
  requestId: CryptoId.optional(),
});
export const CryptoQuoteInput = z.strictObject({
  ...sourceRoute,
  input: CryptoAmount,
  output: CryptoAsset,
  slippageBps: z.number().int().min(1).max(10000),
});
export const CryptoQuote = z.strictObject({
  ...sourceRoute,
  id: CryptoId,
  venue: z.literal("jupiter"),
  adapterVersion: z.string(),
  input: CryptoAmount,
  expectedOut: CryptoAmount,
  minOut: CryptoAmount,
  slippageBps: z.number().int(),
  priceImpactBps: z.number().int().nullable(),
  fees: z.array(CryptoAmount),
  expiresAt: CryptoUtc,
});
const RoleSpec = z.strictObject({
  authority: CryptoAddress,
  asset: CryptoAsset,
  budgetAtoms: CryptoAtoms,
  destination: CryptoAddress,
  programs: z.array(CryptoAddress),
  expirySlot: Slot,
  policy: z.enum(["lifetime", "slot_window"]),
  windowSlots: Slot.nullable(),
});
export const CryptoIntent = z.discriminatedUnion("kind", [
  CryptoTransferIntent,
  z.strictObject({
    ...sourceRoute,
    kind: z.literal("swap"),
    quoteId: CryptoId,
  }),
  z.strictObject({ ...sourceRoute, kind: z.literal("pocket_create") }),
  z.strictObject({
    ...sourceRoute,
    kind: z.enum(["pocket_fund", "pocket_spend", "pocket_withdraw"]),
    pocketId: CryptoId,
    amount: CryptoAmount,
    recipient: CryptoAddress,
  }),
  z.strictObject({
    ...sourceRoute,
    kind: z.literal("pocket_grant"),
    pocketId: CryptoId,
    role: RoleSpec,
  }),
  z.strictObject({
    ...sourceRoute,
    kind: z.literal("pocket_revoke"),
    pocketId: CryptoId,
    roleId: CryptoId,
  }),
]);
export const CryptoReview = z.strictObject({
  id: CryptoId,
  revision: Slot,
  operation: CryptoOperation,
  cluster: CryptoCluster,
  ...sourceRoute,
  expectedSigner: CryptoAddress,
  feePayer: CryptoAddress,
  recipient: CryptoAddress.nullable(),
  sourceTokenAccount: CryptoAddress.nullable(),
  destinationTokenAccount: CryptoAddress.nullable(),
  amount: CryptoAmount.nullable(),
  estimatedFeeLamports: CryptoAtoms,
  estimatedRentLamports: CryptoAtoms,
  quote: CryptoQuote.nullable(),
  expiresAt: CryptoUtc,
  blockhash: CryptoAddress,
  lastValidBlockHeight: Slot,
  reference: CryptoAddress.nullable(),
  minContextSlot: Slot,
  messageDigest: Digest,
  reviewDigest: Digest,
  transactionVersion: z.enum(["legacy", "v0"]),
  unsignedTransactionBase64: z.base64(),
  simulation: z.strictObject({
    passed: z.literal(true),
    slot: Slot,
    observedAt: CryptoUtc,
  }),
  source: CryptoSource,
});
export const CryptoBegin = z.strictObject({
  revision: Slot,
  reviewDigest: Digest,
  challengeId: CryptoId.optional(),
});
export const CryptoAttempt = z.strictObject({
  id: CryptoId,
  reviewId: CryptoId,
  revision: Slot,
  reviewDigest: Digest,
  state: z.enum([
    "ready",
    "handoff",
    "declined",
    "pending",
    "unknown",
    "failed",
    "expired",
    "finalized",
  ]),
  cluster: CryptoCluster,
  routeId: CryptoId,
  expectedSigner: CryptoAddress,
  reference: CryptoAddress.nullable(),
  signature: CryptoSignature.nullable(),
  createdAt: CryptoUtc,
  updatedAt: CryptoUtc,
  reason: z.string().nullable(),
  receiptId: CryptoId.nullable(),
});
export const CryptoAttemptPage = page(CryptoAttempt);
export const CryptoAttemptQuery = CryptoPageQuery.extend({
  unresolvedOnly: z.boolean().optional(),
});
export const CryptoHandoff = z.strictObject({
  attempt: CryptoAttempt,
  launchGranted: z.boolean(),
});
export const CryptoWalletOutcome = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("declined") }),
  z.strictObject({
    kind: z.literal("unavailable"),
    reason: z.string().min(1).max(100),
  }),
  z.strictObject({ kind: z.literal("unknown") }),
  z.strictObject({ kind: z.literal("signature"), signature: CryptoSignature }),
  z.strictObject({
    kind: z.literal("signed"),
    signedTransactionBase64: z.base64().max(1644),
  }),
]);
export const CryptoReceipt = z.strictObject({
  id: CryptoId,
  attemptId: CryptoId.nullable(),
  requestId: CryptoId.nullable(),
  source: CryptoSource,
  signature: CryptoSignature,
  messageDigest: Digest,
  walletIds: z.array(CryptoId),
  slot: Slot,
  time: CryptoUtc.nullable(),
  verifiedAt: CryptoUtc,
  finality: z.literal("finalized"),
  execution: z.literal("success"),
  feeLamports: CryptoAtoms,
  legs: z.array(CryptoActivityLeg),
  eventId: EventId,
  explorerUrl: z.url().nullable(),
});
export const CryptoPocket = z
  .strictObject({
    id: CryptoId,
    cluster: CryptoCluster,
    walletId: CryptoId,
    rootWalletId: CryptoId,
    config: CryptoAddress,
    vault: CryptoAddress,
    program: CryptoAddress,
    programDigest: Digest,
    recoveryVerified: z.boolean(),
    status: z.enum(["active", "paused", "blocked"]),
    spendable: z.array(CryptoAmount),
    pending: z.array(CryptoAmount),
    reserveLamports: CryptoAtoms,
    roles: z.array(
      RoleSpec.extend({
        id: CryptoId,
        remainingAtoms: CryptoAtoms,
        state: z.enum([
          "pending",
          "active",
          "paused",
          "revocation_pending",
          "revoked",
          "expired",
        ]),
      }),
    ),
  })
  .nullable();
export const CryptoRequestInput = z.strictObject({
  walletId: CryptoId,
  amount: CryptoAmount,
  expiresAt: CryptoUtc.optional(),
  invoice: z
    .strictObject({
      title: z.string().max(100),
      notes: z.string().max(500).optional(),
      dueAt: CryptoUtc.optional(),
    })
    .optional(),
});
export const CryptoRequest = CryptoRequestInput.extend({
  id: CryptoId,
  recipient: CryptoAddress,
  reference: CryptoAddress,
  solanaPayUri: z.string(),
  shareUrl: z.url(),
  qrPath: z.string(),
  qrMode: z.enum(["share_url", "solana_pay"]),
  revision: Slot,
  state: z.enum(["open", "cancelled", "expired", "needs_review", "settled"]),
  receiptId: CryptoId.nullable(),
});
export const CryptoRevision = z.strictObject({ revision: Slot });

export const CryptoShare = z.strictObject({
  network: z.literal("devnet"),
  testAssets: z.literal(true),
  requiresExplicitNetworkSelection: z.literal(true),
  recipient: CryptoAddress,
  reference: CryptoAddress,
  amount: CryptoAmount,
  state: CryptoRequest.shape.state,
  expiresAt: CryptoUtc,
  solanaPayUri: z.string().optional(),
});
