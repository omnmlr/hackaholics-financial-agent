import { z } from "zod";
import * as contracts from "../packages/contracts/src/crypto";

type SchemaName = keyof typeof contracts;
type Parameter = {
  name: string;
  in: string;
  required?: boolean;
  schema: unknown;
};

const json = (schema: unknown) => ({ "application/json": { schema } });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const schema = (value: z.ZodType) => {
  const { $schema: _dialect, ...document } = z.toJSONSchema(value, {
    io: "input",
  });
  return document;
};

export function addCryptoPaths(
  paths: Record<string, Record<string, unknown>>,
  schemas: Record<string, unknown>,
) {
  const registry = z.registry<{ id: string }>();
  for (const [id, value] of Object.entries(contracts))
    registry.add(value, { id });
  const { schemas: generated } = z.toJSONSchema(registry, {
    io: "input",
    uri: (id) => `#/components/schemas/${id}`,
  });
  for (const [
    name,
    { $schema: _dialect, $id: _id, ...value },
  ] of Object.entries(generated)) {
    schemas[name] = value;
  }
  const error = {
    type: "object",
    properties: {
      error: {
        type: "object",
        properties: {
          code: { type: "string" },
          retryable: { type: "boolean" },
          correlationId: { type: "string" },
          retryAfterSeconds: { type: "integer" },
          fields: { type: "object", additionalProperties: { type: "string" } },
        },
        required: ["code", "retryable", "correlationId"],
        additionalProperties: false,
      },
    },
    required: ["error"],
    additionalProperties: false,
  };
  schemas.CryptoError = error;

  function operation(
    method: string,
    path: string,
    operationId: string,
    output: SchemaName | "png",
    options: {
      input?: SchemaName;
      query?: z.ZodObject;
      idempotency?: boolean;
      nullable?: boolean;
    } = {},
  ) {
    const parameters: Parameter[] = Array.from(
      path.matchAll(/\{(\w+)\}/g),
      ([, name]) => ({
        name,
        in: "path",
        required: true,
        schema: path.startsWith("/activity/")
          ? { type: "string" }
          : ref("CryptoId"),
      }),
    );
    for (const [name, value] of Object.entries(options.query?.shape ?? {})) {
      const field = value as z.ZodType;
      parameters.push({
        name,
        in: "query",
        required: !field.isOptional(),
        schema: schema(field),
      });
    }
    if (options.idempotency)
      parameters.push({
        name: "Idempotency-Key",
        in: "header",
        required: true,
        schema: { type: "string", minLength: 8, maxLength: 128 },
      });
    (paths[`/api/v1/crypto${path}`] ??= {})[method] = {
      operationId,
      security: [{ Session: [] }],
      parameters,
      ...(options.input && {
        requestBody: { required: true, content: json(ref(options.input)) },
      }),
      responses: {
        200: {
          description: "Authenticated crypto resource",
          content:
            output === "png"
              ? {
                  "image/png": { schema: { type: "string", format: "binary" } },
                }
              : json(
                  options.nullable
                    ? { anyOf: [ref(output), { type: "null" }] }
                    : ref(output),
                ),
        },
        default: {
          description: "Stable API error",
          content: json(ref("CryptoError")),
        },
      },
    };
  }

  const scope = { query: contracts.CryptoScope };
  const cluster = { query: contracts.CryptoScope.pick({ cluster: true }) };
  const mutation = { idempotency: true };
  operation(
    "get",
    "/capabilities",
    "cryptoCapabilities",
    "CryptoCapabilities",
    cluster,
  );
  operation("get", "/wallets", "cryptoWallets", "CryptoWalletPage", scope);
  operation("post", "/wallets/watch", "cryptoWatch", "CryptoWallet", {
    input: "CryptoWatch",
    ...mutation,
  });
  operation(
    "post",
    "/wallets/challenge",
    "cryptoChallenge",
    "CryptoChallenge",
    { input: "CryptoChallengeInput", ...mutation },
  );
  operation("post", "/wallets/association", "cryptoAssociate", "CryptoWallet", {
    input: "CryptoAssociation",
    ...mutation,
  });
  operation("patch", "/wallets/{id}", "cryptoRelabel", "CryptoWallet", {
    input: "CryptoRelabel",
    ...mutation,
  });
  operation(
    "delete",
    "/wallets/{id}/routes/{routeId}",
    "cryptoUnlink",
    "CryptoWallet",
    mutation,
  );
  operation("get", "/portfolio", "cryptoPortfolio", "CryptoPortfolio", scope);
  operation("get", "/activity", "cryptoActivity", "CryptoActivityPage", {
    query: contracts.CryptoActivityQuery,
  });
  operation(
    "get",
    "/activity/{id}",
    "cryptoActivityEvent",
    "CryptoActivityEvent",
    scope,
  );
  operation("post", "/assistant/turns", "cryptoAsk", "CryptoAnswer", {
    input: "CryptoAsk",
    ...mutation,
  });
  operation("post", "/eligibility", "cryptoEligibility", "CryptoEligibility", {
    input: "CryptoEligibilityInput",
  });
  operation("post", "/swaps/quote", "cryptoQuote", "CryptoQuote", {
    input: "CryptoQuoteInput",
    ...mutation,
  });
  operation("post", "/reviews", "cryptoPrepare", "CryptoReview", {
    input: "CryptoIntent",
    ...mutation,
  });
  operation("post", "/reviews/{id}/begin", "cryptoBegin", "CryptoAttempt", {
    input: "CryptoBegin",
    ...mutation,
  });
  operation(
    "post",
    "/attempts/{id}/handoff",
    "cryptoHandoff",
    "CryptoHandoff",
    mutation,
  );
  operation(
    "post",
    "/attempts/{id}/wallet-outcome",
    "cryptoWalletOutcome",
    "CryptoAttempt",
    { input: "CryptoWalletOutcome", ...mutation },
  );
  operation("get", "/attempts", "cryptoAttempts", "CryptoAttemptPage", {
    query: contracts.CryptoAttemptQuery,
  });
  operation("get", "/attempts/{id}", "cryptoAttempt", "CryptoAttempt");
  operation(
    "post",
    "/attempts/{id}/reconcile",
    "cryptoReconcile",
    "CryptoAttempt",
  );
  operation("get", "/receipts/{id}", "cryptoReceipt", "CryptoReceipt");
  operation(
    "post",
    "/alert-rules",
    "cryptoCreateAlertRule",
    "CryptoAlertRule",
    { input: "CryptoAlertRuleInput", ...mutation },
  );
  operation(
    "patch",
    "/alert-rules/{id}",
    "cryptoUpdateAlertRule",
    "CryptoAlertRule",
    { input: "CryptoAlertRuleUpdate", ...mutation },
  );
  operation(
    "get",
    "/alert-rules",
    "cryptoAlertRules",
    "CryptoAlertRulePage",
    scope,
  );
  operation("get", "/alerts", "cryptoAlerts", "CryptoAlertPage", {
    query: contracts.CryptoPageQuery,
  });
  operation(
    "post",
    "/alerts/{id}/read",
    "cryptoReadAlert",
    "CryptoAlert",
    mutation,
  );
  operation("get", "/pocket", "cryptoPocket", "CryptoPocket", cluster);
  operation("post", "/requests", "cryptoCreateRequest", "CryptoRequest", {
    input: "CryptoRequestInput",
    ...mutation,
  });
  operation("get", "/requests/{id}", "cryptoRequest", "CryptoRequest");
  operation("get", "/requests/{id}/qr", "cryptoRequestQr", "png");
  operation(
    "post",
    "/requests/{id}/cancel",
    "cryptoCancelRequest",
    "CryptoRequest",
    { input: "CryptoRevision", ...mutation },
  );
}
