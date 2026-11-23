import type { components } from "../src/generated";

type Schemas = components["schemas"];
const cluster = "devnet" as const;
const source = {
  mode: "fixture",
  cluster,
  provider: "agus-fixture-v1",
  observedAt: "2026-11-24T12:00:00.000Z",
  slot: 100,
} satisfies Schemas["CryptoSource"];
const mint = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
const program = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const addresses = [
  "DUs6UkQR4ZyfnAeG4xfNvCWJUr9F9LHKrYAzjpjWv8bT",
  "CNHYp6cXGUn6y2Qg3LYN9eJqupwGv3GYgRq2DYE35cSL",
  "FaXFAKevhg4Nu3kCvec6fhMqx9wp99huN2BqtFZ2bWFy",
  "9zQqcnX7t77pyUEzxnA8e3UEf3f8dmCDH4xzA9WEcRvt",
] as const;
const walletA = "2a8cb2d7-8a3e-40a1-a049-6ba8576c49a1";
const walletB = "2a8cb2d7-8a3e-40a1-a049-6ba8576c49a2";
const walletW = "2a8cb2d7-8a3e-40a1-a049-6ba8576c49a3";
const snapshot = "2a8cb2d7-8a3e-40a1-a049-6ba8576c49a4";
const signature = "1".repeat(64);
const token = (atoms: string) => ({
  asset: { cluster, kind: "token" as const, mint, program },
  atoms,
  decimals: 6,
});

function route(
  id: string,
  provider: "phantom" | "solflare",
  address: string,
): Schemas["CryptoRoute"] {
  return {
    id,
    provider,
    address,
    cluster,
    operations: ["transfer"],
    status: "available",
    reason: null,
  };
}

const wallets: Schemas["CryptoWallet"][] = [
  {
    id: walletA,
    address: addresses[0],
    cluster,
    label: "Daily",
    group: "linked_owned",
    ownership: "verified",
    lastSyncAt: source.observedAt,
    routes: [
      route("48a4421f-4381-4a8e-9574-51a06fe04d81", "phantom", addresses[0]),
      route("48a4421f-4381-4a8e-9574-51a06fe04d82", "solflare", addresses[0]),
    ],
  },
  {
    id: walletB,
    address: addresses[1],
    cluster,
    label: "Reserve",
    group: "linked_owned",
    ownership: "verified",
    lastSyncAt: source.observedAt,
    routes: [
      route("48a4421f-4381-4a8e-9574-51a06fe04d83", "solflare", addresses[1]),
    ],
  },
  {
    id: walletW,
    address: addresses[2],
    cluster,
    label: "Watching",
    group: "third_party_watch",
    ownership: "none",
    lastSyncAt: null,
    routes: [],
  },
];

export const cryptoFixtureScenarios = [
  "owned_duplicate_watch",
  "internal_transfer",
  "outside_inflow_replay",
  "partial_and_stale",
  "decline_and_wrong_wallet",
  "lost_callback_then_finalized",
] as const;
export type CryptoFixtureScenario = (typeof cryptoFixtureScenarios)[number];

export function createCryptoFixtureTransport(
  scenario: CryptoFixtureScenario = "owned_duplicate_watch",
): typeof fetch {
  const adjusted =
    scenario === "internal_transfer" || scenario === "outside_inflow_replay";
  const partial = scenario === "partial_and_stale";
  const inflow = scenario === "outside_inflow_replay";
  const holdings = [
    {
      walletId: walletA,
      tokenAccount: null,
      amount: token(inflow ? "95000000" : adjusted ? "90000000" : "100000000"),
      symbol: "USDC",
      valuation: null,
      spendable: true,
    },
    {
      walletId: walletB,
      tokenAccount: null,
      amount: token(adjusted ? "35000000" : "25000000"),
      symbol: "USDC",
      valuation: null,
      spendable: true,
    },
  ];
  const coverage: Schemas["CryptoCoverage"][] = [walletA, walletB].flatMap(
    (walletId) => [
      {
        walletId,
        kind: "balances",
        state: partial ? "stale" : "ready",
        reason: partial ? "provider_failure" : null,
        observedAt: source.observedAt,
        throughSlot: source.slot,
        coveredWindow: null,
      },
      {
        walletId,
        kind: "activity",
        state: "partial",
        reason: partial ? "pruned" : "missing_token_accounts",
        observedAt: source.observedAt,
        throughSlot: source.slot,
        coveredWindow: null,
      },
    ],
  );
  function event(external: boolean): Schemas["CryptoActivityEvent"] {
    const eventSignature = external ? "1".repeat(63) + "2" : signature;
    const id = `${cluster}:${eventSignature}`;
    const atoms = external ? "5000000" : "10000000";
    return {
      id,
      signature: eventSignature,
      slot: source.slot,
      blockTime: source.observedAt,
      source,
      finality: "finalized",
      status: "success",
      classification: external ? "incoming" : "internal",
      reason: "Decoded fixture transfer",
      explorerUrl: null,
      legs: [
        {
          id: `${id}:0`,
          kind: "transfer",
          from: addresses[external ? 3 : 0],
          to: addresses[external ? 0 : 1],
          fromWalletId: external ? null : walletA,
          toWalletId: external ? walletA : walletB,
          amount: token(atoms),
          walletDeltas: external
            ? [{ walletId: walletA, atoms }]
            : [
                { walletId: walletA, atoms: `-${atoms}` },
                { walletId: walletB, atoms },
              ],
          instructionPath: "0",
        },
        ...(external
          ? []
          : [
              {
                id: `${id}:fee`,
                kind: "fee" as const,
                from: addresses[0],
                to: null,
                fromWalletId: walletA,
                toWalletId: null,
                amount: {
                  asset: { cluster, kind: "sol" as const },
                  atoms: "5000",
                  decimals: 9,
                },
                walletDeltas: [{ walletId: walletA, atoms: "-5000" }],
                instructionPath: "fee",
              },
            ]),
      ],
    };
  }
  const events = adjusted
    ? [...(inflow ? [event(true)] : []), event(false)]
    : [];
  const ruleId = "1ca0c3f9-f67a-470f-8a3b-afb5812c339a";
  const alertId = "4b9f334d-58c8-46ad-9bc6-4290bf04ef71";
  let readAt: string | null = null;
  const execution =
    scenario === "decline_and_wrong_wallet" ||
    scenario === "lost_callback_then_finalized";
  const reviewId = "91e1e573-f200-4134-a098-2ab51da952b1";
  const attemptId = "91e1e573-f200-4134-a098-2ab51da952b2";
  const receiptId = "91e1e573-f200-4134-a098-2ab51da952b3";
  const reviewDigest = "a".repeat(64);
  const messageDigest =
    "04420fbf85abe92ddddcf6b3c5d13a0d92a5a7a5b4f1e38bd9cfc551dcc5d11f";
  const amount = {
    asset: { cluster, kind: "sol" as const },
    atoms: "1000000",
    decimals: 9,
  };
  const routeId = wallets[0].routes[0].id;
  const review: Schemas["CryptoReview"] = {
    id: reviewId,
    revision: 0,
    operation: "transfer",
    cluster,
    sourceWalletId: walletA,
    routeId,
    expectedSigner: addresses[0],
    feePayer: addresses[0],
    recipient: addresses[1],
    sourceTokenAccount: null,
    destinationTokenAccount: null,
    amount,
    estimatedFeeLamports: "5000",
    estimatedRentLamports: "0",
    quote: null,
    expiresAt: "2026-11-24T12:01:30.000Z",
    blockhash: addresses[3],
    lastValidBlockHeight: 120,
    reference: addresses[2],
    minContextSlot: 100,
    messageDigest,
    reviewDigest,
    transactionVersion: "legacy",
    unsignedTransactionBase64:
      "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAIEuW+RIyfH5nrWLn8jlvCmbWBDTcfOM79Q3k4l1ymVGuKo5Hbwq0Sh6VzA1O/KlsJcXzrqjIdWS3IADuDKyFq2SQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA2Jn7GDX/WcrwgwK5d45jAe03kB8CJGLbzfEMeidoSdiFko401SV78c8c7M4cx9V5XEPzAGR8thJIkBBZB1KjfQECAwABAwwCAAAAQEIPAAAAAAA=",
    simulation: {
      passed: true,
      slot: source.slot,
      observedAt: source.observedAt,
    },
    source,
  };
  const attempt: Schemas["CryptoAttempt"] = {
    id: attemptId,
    reviewId,
    revision: 0,
    reviewDigest,
    state: "ready",
    cluster,
    routeId,
    expectedSigner: addresses[0],
    reference: addresses[2],
    signature: null,
    createdAt: source.observedAt,
    updatedAt: source.observedAt,
    reason: null,
    receiptId: null,
  };
  const fixtureEvent = event(false);
  const settledLegs = fixtureEvent.legs.map((leg) =>
    leg.kind === "transfer"
      ? {
          ...leg,
          amount,
          walletDeltas: [
            { walletId: walletA, atoms: "-1000000" },
            { walletId: walletB, atoms: "1000000" },
          ],
        }
      : leg,
  );
  const outgoing: Schemas["CryptoReceipt"] = {
    id: receiptId,
    attemptId,
    requestId: null,
    source,
    signature,
    messageDigest,
    walletIds: [walletA, walletB],
    slot: source.slot,
    time: source.observedAt,
    verifiedAt: source.observedAt,
    finality: "finalized",
    execution: "success",
    feeLamports: "5000",
    legs: settledLegs,
    eventId: fixtureEvent.id,
    explorerUrl: null,
  };
  let prepared = false;
  let begun = false;
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const path = decodeURIComponent(
      url.pathname.replace(/^\/api\/v1\/crypto/, ""),
    );
    const scope = url.searchParams.getAll("walletIds");
    const scopedIds = scope.length ? scope : [walletA, walletB];
    const visibleEvents =
      execution && attempt.state === "finalized"
        ? [{ ...fixtureEvent, legs: settledLegs }]
        : events;
    const scopedEvents = visibleEvents.filter((item) =>
      item.legs.some((leg) =>
        leg.walletDeltas.some((delta) => scopedIds.includes(delta.walletId)),
      ),
    );
    const error = (code: string, status: number) =>
      Response.json(
        {
          error: {
            code,
            retryable: false,
            correlationId: "687a61e4-1626-42d6-b056-d154721a3fb4",
          },
        },
        { status },
      );
    const scopedCoverage = coverage.filter((item) =>
      scopedIds.includes(item.walletId),
    );
    if (execution && request.method === "POST") {
      if (path === "/reviews") {
        prepared = true;
        return Response.json(review);
      }
      if (prepared && path === `/reviews/${reviewId}/begin`) {
        const approval = (await request.json()) as {
          revision: number;
          reviewDigest: string;
        };
        if (
          approval.revision !== review.revision ||
          approval.reviewDigest !== reviewDigest
        )
          return error("REVISION_CHANGED", 409);
        begun = true;
        return Response.json(attempt);
      }
      if (begun && path === `/attempts/${attemptId}/handoff`) {
        const launchGranted = attempt.state === "ready";
        if (launchGranted) attempt.state = "handoff";
        return Response.json({
          attempt,
          launchGranted,
        } satisfies Schemas["CryptoHandoff"]);
      }
      if (begun && path === `/attempts/${attemptId}/wallet-outcome`) {
        const outcome =
          (await request.json()) as Schemas["CryptoWalletOutcome"];
        if (attempt.state === "handoff") {
          attempt.state = outcome.kind === "declined" ? "declined" : "unknown";
          attempt.reason =
            outcome.kind === "unavailable"
              ? outcome.reason
              : outcome.kind === "unknown"
                ? "CALLBACK_UNKNOWN"
                : null;
        }
        return Response.json(attempt);
      }
      if (begun && path === `/attempts/${attemptId}/reconcile`) {
        if (
          scenario === "lost_callback_then_finalized" &&
          ["handoff", "unknown"].includes(attempt.state)
        ) {
          attempt.state = "finalized";
          attempt.signature = signature;
          attempt.receiptId = receiptId;
          attempt.reason = null;
        }
        return Response.json(attempt);
      }
    }
    if (request.method === "GET") {
      if (
        url.searchParams.get("cluster") &&
        url.searchParams.get("cluster") !== cluster
      )
        return error("NOT_FOUND", 404);
      if (execution && path === "/attempts") {
        return Response.json({
          items: begun ? [attempt] : [],
          nextCursor: null,
          source,
        } satisfies Schemas["CryptoAttemptPage"]);
      }
      if (execution && path === `/attempts/${attemptId}`)
        return begun ? Response.json(attempt) : error("NOT_FOUND", 404);
      if (execution && path === `/receipts/${receiptId}`)
        return attempt.state === "finalized"
          ? Response.json(outgoing)
          : error("NOT_FOUND", 404);
      if (path === "/capabilities")
        return Response.json({
          source,
          features: {
            portfolio: true,
            assistant: false,
            monitoring: inflow,
            requests: false,
            invoices: false,
            swap: false,
            pocketCreate: false,
            pocketFund: false,
            pocketSpend: false,
            pocketManage: false,
          },
          approvedRoutes: (["phantom", "solflare"] as const).map(
            (provider) => ({
              provider,
              operations: ["transfer"],
            }),
          ),
        } satisfies Schemas["CryptoCapabilities"]);
      if (path === "/wallets")
        return Response.json({
          items: wallets.filter(
            ({ id }) => !scope.length || scope.includes(id),
          ),
          nextCursor: null,
          source,
        } satisfies Schemas["CryptoWalletPage"]);
      if (path === "/portfolio")
        return Response.json({
          id: snapshot,
          walletIds: scopedIds,
          source,
          holdings: holdings.filter(({ walletId }) =>
            scopedIds.includes(walletId),
          ),
          positions: [],
          coverage: scopedCoverage,
          pricedSubtotalUsd: null,
        } satisfies Schemas["CryptoPortfolio"]);
      if (path === "/activity")
        return Response.json({
          items: scopedEvents,
          nextCursor: null,
          source,
          coverage: scopedCoverage,
        } satisfies Schemas["CryptoActivityPage"]);
      if (path.startsWith("/activity/")) {
        const item = scopedEvents.find(
          ({ id }) => id === path.slice("/activity/".length),
        );
        return item ? Response.json(item) : error("NOT_FOUND", 404);
      }
      if (path === "/alerts")
        return Response.json({
          items:
            inflow && scopedIds.includes(walletA)
              ? [
                  {
                    id: alertId,
                    ruleId,
                    walletId: walletA,
                    eventId: events[0].id,
                    source,
                    dedupeKey: `${ruleId}:${events[0].id}:${walletA}`,
                    createdAt: source.observedAt,
                    readAt,
                  },
                ]
              : [],
          source,
          nextCursor: null,
        } satisfies Schemas["CryptoAlertPage"]);
      if (path === "/pocket") return Response.json(null);
    }
    if (
      request.method === "POST" &&
      path === `/alerts/${alertId}/read` &&
      inflow
    ) {
      readAt = source.observedAt;
      return Response.json({
        id: alertId,
        ruleId,
        walletId: walletA,
        eventId: events[0].id,
        source,
        dedupeKey: `${ruleId}:${events[0].id}:${walletA}`,
        createdAt: source.observedAt,
        readAt,
      } satisfies Schemas["CryptoAlert"]);
    }
    return error("FEATURE_DISABLED", 503);
  };
}
