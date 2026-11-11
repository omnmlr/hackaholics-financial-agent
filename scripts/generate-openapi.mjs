import { writeFile, mkdir } from "node:fs/promises";
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const string = { type: "string" },
  uuid = { type: "string", format: "uuid" },
  revision = { type: "integer", minimum: 0 };
const schemas = {
  Money: object({
    atoms: { type: "string", pattern: "^(0|[1-9][0-9]{0,77})$" },
    currency: { type: "string", pattern: "^[A-Z]{3,12}$" },
    scale: { type: "integer", minimum: 0, maximum: 18 },
  }),
  Error: object({
    error: object({
      code: string,
      retryable: { type: "boolean" },
      correlationId: uuid,
    }),
  }),
  Revision: object({ revision }),
  Approval: object({ revision, challengeId: uuid }),
  StepUp: object({
    action: string,
    digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
    password: { type: "string", writeOnly: true },
    code: { type: "string", pattern: "^[0-9]{6}$", writeOnly: true },
  }),
  PreparePayment: object(
    {
      sourceAccountId: uuid,
      beneficiaryId: uuid,
      amount: ref("Money"),
      testScenario: {
        type: "string",
        enum: [
          "normal",
          "delayed",
          "timeout_before_send",
          "timeout_after_send",
          "outage",
          "failure",
          "reversal",
        ],
      },
    },
    ["sourceAccountId", "beneficiaryId", "amount"],
  ),
  Connection: object(
    { institutionId: string, provider: { type: "string", enum: ["fixture"] } },
    ["institutionId"],
  ),
  Callback: object({
    connectionId: uuid,
    state: string,
    code: { type: "string", writeOnly: true },
  }),
  Beneficiary: object({
    bankCode: string,
    accountNumber: { type: "string", pattern: "^[0-9]{10}$", writeOnly: true },
  }),
  Payment: {
    type: "object",
    required: [
      "id",
      "revision",
      "status",
      "instructionDigest",
      "instruction",
      "provider",
      "environment",
      "simulated",
    ],
    properties: {
      id: uuid,
      revision,
      status: string,
      instructionDigest: string,
      instruction: { type: "object", additionalProperties: true },
      provider: string,
      environment: string,
      simulated: { type: "boolean" },
    },
  },
  Page: object({
    data: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    nextCursor: { type: ["string", "null"] },
  }),
  Resource: { type: "object", additionalProperties: true },
};
const paths = {};
function operation(
  path,
  method,
  name,
  input,
  output = "Resource",
  financial = false,
  paginated = false,
) {
  const parameters = [...path.matchAll(/\{([a-z]+)\}/g)].map((match) => ({
    name: match[1],
    in: "path",
    required: true,
    schema: uuid,
  }));
  if (financial)
    parameters.push({
      name: "Idempotency-Key",
      in: "header",
      required: true,
      schema: { type: "string", minLength: 8, maxLength: 128 },
    });
  if (paginated)
    parameters.push(
      { name: "cursor", in: "query", schema: string },
      {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 100 },
      },
    );
  (paths[`/api/v1/${path}`] ??= {})[method] = {
    operationId: name,
    security: [{ Session: [] }],
    parameters,
    ...(input
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: input === "Empty" ? object({}) : ref(input),
              },
            },
          },
        }
      : {}),
    responses: {
      200: {
        description:
          "Authenticated owned resource; fixture records identify simulation explicitly",
        content: { "application/json": { schema: ref(output) } },
      },
      default: {
        description: "Stable error with retryability and correlation ID",
        content: { "application/json": { schema: ref("Error") } },
      },
    },
  };
}
operation("me", "get", "currentUser");
operation("sessions", "get", "listSessions");
operation("sessions/{id}", "delete", "revokeSession");
operation("step-up", "post", "issueStepUp", "StepUp");
operation("banking/institutions", "get", "institutionCapabilities");
operation("banking/beneficiary-banks", "get", "beneficiaryBanks");
operation("banking/connections", "get", "listConnections");
operation(
  "banking/connections",
  "post",
  "connectAccount",
  "Connection",
  "Resource",
  true,
);
operation(
  "banking/connections/callback",
  "post",
  "completeConnection",
  "Callback",
);
operation(
  "banking/connections/{id}/revoke",
  "post",
  "revokeConnection",
  "Revision",
);
operation("banking/accounts", "get", "sourceAccounts");
operation("banking/accounts/{id}/balance", "post", "refreshBalance", "Empty");
operation("banking/accounts/{id}/sync", "post", "syncTransactions", "Empty");
operation(
  "banking/accounts/{id}/transactions",
  "get",
  "accountTransactions",
  null,
  "Page",
  false,
  true,
);
operation(
  "banking/beneficiaries",
  "post",
  "verifyBeneficiary",
  "Beneficiary",
  "Resource",
  true,
);
operation("payments", "get", "listPayments", null, "Page", false, true);
operation(
  "payments",
  "post",
  "preparePayment",
  "PreparePayment",
  "Payment",
  true,
);
operation("payments/{id}", "get", "getPayment", null, "Payment");
operation(
  "payments/{id}/authorize",
  "post",
  "authorizePayment",
  "Approval",
  "Payment",
);
operation(
  "payments/{id}/submit",
  "post",
  "submitPayment",
  "Revision",
  "Payment",
);
operation(
  "payments/{id}/reconcile",
  "post",
  "reconcilePayment",
  "Empty",
  "Payment",
);
operation("payments/{id}/receipts", "get", "paymentReceipts");
operation(
  "payments/{id}/disputes",
  "post",
  "openDispute",
  "Resource",
  "Resource",
  true,
);
operation(
  "notifications",
  "get",
  "notificationInbox",
  null,
  "Page",
  false,
  true,
);
operation("notifications/{id}", "post", "markNotificationRead", "Resource");
operation("devices", "post", "registerDevice", "Resource");
operation("responsibilities", "get", "workspaceSnapshot");
operation("responsibilities", "post", "createResponsibility", "Resource");
operation(
  "responsibilities/{id}",
  "post",
  "transitionResponsibility",
  "Resource",
);
operation("solana", "get", "listDevnetDrafts");
operation("solana/{id}", "get", "getDevnetDraft");
operation("jobs", "get", "operationsJobMetrics");
schemas.DevnetPrepare = object(
  {
    sender: string,
    recipient: string,
    asset: { type: "string", enum: ["SOL", "SPL"] },
    mint: string,
    amount: ref("Money"),
  },
  ["sender", "recipient", "asset", "amount"],
);
schemas.SignedSubmission = object({
  digest: string,
  signedTransactionBase64: string,
});
schemas.Wallet = object({ wallet: string });
schemas.PaymentRequest = object({
  recipient: string,
  asset: { type: "string", enum: ["SOL", "SPL"] },
  amountAtoms: { type: "string", pattern: "^[1-9][0-9]*$" },
  expiresAt: { type: "string", format: "date-time" },
});
operation(
  "banking/connections/{id}/reauthorize",
  "post",
  "reauthorizeConnection",
  "Revision",
);
operation(
  "solana/prepare",
  "post",
  "prepareDevnetTransfer",
  "DevnetPrepare",
  "Resource",
  true,
);
operation("solana/balances", "post", "walletBalances", "Wallet");
operation(
  "solana/wallet-challenge",
  "post",
  "walletOwnershipChallenge",
  "Wallet",
);
operation("solana/wallet-association", "post", "associateWallet", "Resource");
operation("solana/{id}/approve", "post", "approveDevnetDraft", "Approval");
operation(
  "solana/{id}/submit",
  "post",
  "submitSignedDevnetDraft",
  "SignedSubmission",
);
operation("solana/{id}/reconcile", "post", "reconcileDevnetDraft", "Empty");
operation("solana/{id}/cancel", "post", "cancelDevnetDraft", "Empty");
operation("solana/history", "get", "walletSignatureHistory");
paths["/api/v1/solana/history"].get.parameters.push(
  { name: "wallet", in: "query", required: true, schema: string },
  { name: "cursor", in: "query", schema: string },
);
operation(
  "requests",
  "post",
  "createPaymentRequest",
  "PaymentRequest",
  "Resource",
  true,
);
operation("requests/{id}", "get", "getPaymentRequest");
operation("requests/lookup/{reference}", "get", "lookupSharedPaymentRequest");
paths["/api/v1/requests/lookup/{reference}"].get.parameters = [
  { name: "reference", in: "path", required: true, schema: string },
];
operation("requests/{id}/cancel", "post", "cancelPaymentRequest", "Revision");
operation(
  "requests/{id}/prepare",
  "post",
  "prepareRequestedTransfer",
  "Resource",
  "Resource",
  true,
);
operation("requests/{id}/match", "post", "matchRequestSettlement", "Resource");
operation("requests/parse", "post", "parseSolanaPayRequest", "Resource");
operation(
  "p2p/offers",
  "get",
  "listSimulationOffers",
  null,
  "Page",
  false,
  true,
);
operation(
  "p2p/offers",
  "post",
  "createSimulationOffer",
  "Resource",
  "Resource",
  true,
);
operation("p2p/quotes", "post", "quoteSimulationOffer", "Resource");
operation(
  "p2p/reservations",
  "post",
  "reserveSimulationQuote",
  "Resource",
  "Resource",
  true,
);
operation(
  "p2p/orders",
  "get",
  "listSimulationOrders",
  null,
  "Page",
  false,
  true,
);
operation("p2p/orders/{id}", "get", "getSimulationOrder");
operation("p2p/orders/{id}/cancel", "post", "cancelUnfundedOrder", "Revision");
operation("usd", "get", "usdExternalIntegrationGates");
operation(
  "p2p/orders/{id}/disputes",
  "post",
  "openSimulationDispute",
  "Resource",
  "Resource",
  true,
);
for (const path of [
  "payments/{id}/authorize",
  "payments/{id}/submit",
  "solana/{id}/approve",
  "solana/{id}/submit",
])
  paths[`/api/v1/${path}`].post.parameters.push({
    name: "Idempotency-Key",
    in: "header",
    required: true,
    schema: { type: "string", minLength: 8, maxLength: 128 },
  });
operation("memory", "post", "proposeMemory", "Resource", "Resource", true);
schemas.Connection.properties.testDataScenario = {
  type: "string",
  enum: [
    "normal",
    "data_delayed",
    "partial_history",
    "grant_expired",
    "rate_limited",
    "outage",
    "revocation_outage",
  ],
};
operation("memory/{id}", "post", "confirmOrForgetMemory", "Resource");
operation("runs", "get", "listPreservedRuns");
operation("runs/{id}", "get", "getPreservedRun");
operation("runs/{id}", "post", "controlPreservedRun", "Resource");
schemas.EscrowAction = ref("Approval");
schemas.EscrowBinding = object({
  buyerWallet: string,
  sellerWallet: string,
  buyerDestination: string,
  sellerSource: string,
});
schemas.UsdOnboard = object({
  residency: { type: "string", enum: ["NG"] },
  purpose: { type: "string", enum: ["freelance", "salary"] },
});
schemas.UsdIncoming = object({
  owner: uuid,
  amountAtoms: { type: "string", pattern: "^[1-9][0-9]{0,8}$" },
  purpose: { type: "string", enum: ["freelance", "salary"] },
});
schemas.UsdQuote = object(
  { incomingId: uuid, destination: string, beneficiaryId: uuid },
  ["incomingId", "destination"],
);
schemas.UsdConvert = object(
  { quoteId: uuid, challengeId: uuid, loseResponse: { type: "boolean" } },
  ["quoteId", "challengeId"],
);
schemas.OfferEdit = object({
  revision,
  offer: { anyOf: [ref("Resource"), { type: "null" }] },
});
operation("requests", "get", "listPaymentRequests", null, "Page", false, true);
operation("requests/{id}/qr", "get", "paymentRequestQr");
schemas.RequestDiscovery = object({ cursor: string }, []);
schemas.RequestExternalSignature = object({
  signature: { type: "string", minLength: 64, maxLength: 88 },
});
operation(
  "requests/{id}/discover",
  "post",
  "discoverReferencePayments",
  "RequestDiscovery",
);
operation(
  "requests/{id}/match-external",
  "post",
  "matchExternalRequestPayment",
  "RequestExternalSignature",
);
operation(
  "requests/{id}/settlements",
  "get",
  "listRequestSettlements",
  null,
  "Page",
  false,
  true,
);
operation("p2p/escrow", "get", "devnetEscrowReadiness");
operation("p2p/offers/{id}", "post", "editOrCloseSimulationOffer", "OfferEdit");
operation("p2p/orders/{id}/fixture", "get", "getFixtureEscrow");
operation("p2p/orders/{id}/fixture/review", "get", "reviewFixtureEscrowAction");
const escrowActions = [
  "fund",
  "claim_fiat",
  "verify_fiat",
  "release",
  "mutual_cancel",
  "arbitrate_release",
  "arbitrate_refund",
];
paths["/api/v1/p2p/orders/{id}/fixture/review"].get.parameters.push({
  name: "action",
  in: "query",
  required: true,
  schema: { type: "string", enum: escrowActions },
});
operation(
  "p2p/orders/{id}/fixture/{action}",
  "post",
  "executeFixtureEscrowAction",
  "EscrowAction",
  "Resource",
  true,
);
paths["/api/v1/p2p/orders/{id}/fixture/{action}"].post.parameters.find(
  (p) => p.name === "action",
).schema = { type: "string", enum: escrowActions };
operation("p2p/orders/{id}/devnet-binding", "get", "getDevnetEscrowBinding");
operation(
  "p2p/orders/{id}/devnet-binding",
  "post",
  "bindDevnetEscrowInstructionTemplate",
  "EscrowBinding",
  "Resource",
  true,
);
operation(
  "p2p/orders/{id}/devnet-binding/reconcile",
  "post",
  "readFinalizedEscrowFunding",
  "Resource",
);
operation("usd/fixture/account", "get", "getFixtureUsdAccount");
operation(
  "usd/fixture/account",
  "post",
  "onboardFixtureUsdAccount",
  "UsdOnboard",
  "Resource",
  true,
);
operation(
  "usd/fixture/incoming",
  "get",
  "listFixtureUsdIncoming",
  null,
  "Page",
  false,
  true,
);
operation(
  "usd/fixture/incoming",
  "post",
  "recordFixtureUsdIncoming",
  "UsdIncoming",
  "Resource",
  true,
);
operation(
  "usd/fixture/quotes",
  "post",
  "quoteFixtureUsdConversion",
  "UsdQuote",
  "Resource",
  true,
);
operation(
  "usd/fixture/conversions",
  "post",
  "submitFixtureUsdConversion",
  "UsdConvert",
  "Resource",
  true,
);
operation("usd/fixture/conversions/{id}", "get", "getFixtureUsdConversion");
operation(
  "usd/fixture/conversions/{id}/review",
  "get",
  "reviewFixtureUsdStage",
);
paths["/api/v1/usd/fixture/conversions/{id}/review"].get.parameters.push({
  name: "stage",
  in: "query",
  required: true,
  schema: { type: "string", enum: ["deliver", "payout"] },
});
operation(
  "usd/fixture/conversions/{id}/deliver",
  "post",
  "deliverFixtureUsdc",
  "Approval",
  "Resource",
  true,
);
operation(
  "usd/fixture/conversions/{id}/payout",
  "post",
  "settleFixtureNgn",
  "Approval",
  "Resource",
  true,
);
operation(
  "usd/fixture/conversions/{id}/reconcile",
  "post",
  "reconcileFixtureUsdStages",
  "Empty",
);
operation(
  "usd/fixture/incoming/{id}/return-review",
  "get",
  "reviewFixtureUsdReturn",
);
operation(
  "usd/fixture/incoming/{id}/return",
  "post",
  "returnFixtureUsdIncoming",
  "Approval",
  "Resource",
  true,
);
const document = {
  openapi: "3.1.0",
  info: {
    title: "AGUS shared API",
    version: "1.0.0",
    description:
      "Integer atomic-unit money; owner-bound resources; explicit provider/environment/provenance; no live source-bank acceptance implied.",
  },
  paths,
  components: {
    securitySchemes: {
      Session: {
        type: "apiKey",
        in: "cookie",
        name: "better-auth.session_token",
      },
    },
    schemas,
  },
};
await mkdir("packages/contracts", { recursive: true });
await writeFile(
  "packages/contracts/openapi.json",
  JSON.stringify(document, null, 2) + "\n",
);
