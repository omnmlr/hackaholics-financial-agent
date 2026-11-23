import { z } from "zod";
import * as C from "../../../../../../packages/contracts/src/crypto";
import { mutationOrigin, principal } from "@/server/auth";
import { body, DomainError, endpoint } from "@/server/errors";
import { idempotencyKey } from "@/server/idempotency";
import { activity, activityEvent } from "@/server/crypto/activity";
import { askCrypto, cryptoAssistantReady } from "@/server/crypto/assistant";
import {
  addAlertRule,
  cryptoMonitoringReady,
  listAlertRules,
  listAlerts,
  readAlert,
  updateAlertRule,
} from "@/server/crypto/alerts";
import {
  beginCrypto,
  getAttempt,
  handoffCrypto,
  listAttempts,
  prepareCrypto,
  receipt,
  reconcileCrypto,
  reportWalletOutcome,
  walletEligibility,
} from "@/server/crypto/execution";
import {
  cancelCryptoRequest,
  createCryptoRequest,
  cryptoInvoicesReady,
  cryptoRequestQr,
  cryptoRequestsReady,
  getCryptoRequest,
  shareCryptoRequest,
} from "@/server/crypto/requests";
import { portfolio } from "@/server/crypto/portfolio";
import * as registry from "@/server/crypto/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function input<T extends z.ZodType>(
  schema: T,
  data: unknown,
): Promise<z.output<T>> {
  const parsed = schema.safeParse(await data);
  if (!parsed.success) throw new DomainError("INVALID_INPUT", 400);
  return parsed.data;
}

function query(url: URL) {
  const values: Record<string, unknown> = Object.create(null);
  for (const [key, value] of url.searchParams) {
    if (key === "walletIds") {
      values[key] ??= [] as string[];
      (values[key] as string[]).push(value);
    } else {
      if (key in values) throw new DomainError("INVALID_INPUT", 400);
      values[key] = value;
    }
  }
  return values;
}

async function handle(request: Request) {
  return endpoint(async () => {
    const url = new URL(request.url);
    const path = url.pathname
      .replace(/^\/api\/v1\/crypto\/?/, "")
      .split("/")
      .map(decodeURIComponent);
    const method = request.method;
    if (method === "GET" && path.length === 2 && path[0] === "share")
      return shareCryptoRequest(await input(C.CryptoAddress, path[1]));
    const p = await principal(request).catch((error) => {
      if (error instanceof DomainError && error.status === 401)
        throw new DomainError("SESSION_REQUIRED", 401);
      throw error;
    });
    if (method !== "GET") mutationOrigin(request);
    if (method === "GET" && path.length === 1) {
      if (path[0] === "capabilities" || path[0] === "pocket") {
        const { cluster } = await input(
          C.CryptoScope.pick({ cluster: true }),
          query(url),
        );
        if (path[0] === "pocket") return null;
        return C.CryptoCapabilities.parse({
          source: registry.readSource(cluster),
          approvedRoutes: registry
            .approvedCryptoProviders(cluster)
            .map((provider) => ({ provider, operations: ["transfer"] })),
          features: {
            portfolio: true,
            assistant: cryptoAssistantReady(),
            monitoring: cryptoMonitoringReady(),
            requests: cluster === "devnet" && cryptoRequestsReady(),
            invoices: cluster === "devnet" && cryptoInvoicesReady(),
            swap: false,
            pocketCreate: false,
            pocketFund: false,
            pocketSpend: false,
            pocketManage: false,
          },
        });
      }
      if (path[0] === "wallets") {
        const scope = await input(C.CryptoScope, query(url));
        return C.CryptoWalletPage.parse({
          source: registry.readSource(scope.cluster),
          items: await registry.listWallets(p.id, scope),
          nextCursor: null,
        });
      }
      if (path[0] === "portfolio")
        return portfolio(p.id, await input(C.CryptoScope, query(url)));
      if (path[0] === "activity")
        return activity(p.id, await input(C.CryptoActivityQuery, query(url)));
    }
    if (method === "GET" && path.length === 2 && path[0] === "activity")
      return activityEvent(
        p.id,
        await input(C.CryptoScope, query(url)),
        path[1],
      );
    if (path[0] === "wallets") {
      if (method === "POST" && path.length === 2) {
        const key = idempotencyKey(request);
        if (path[1] === "watch")
          return registry.watch(
            p,
            await input(C.CryptoWatch, body(request)),
            key,
          );
        if (path[1] === "challenge")
          return registry.challenge(
            p,
            await input(C.CryptoChallengeInput, body(request)),
            key,
          );
        if (path[1] === "association")
          return registry.associate(
            p,
            await input(C.CryptoAssociation, body(request)),
            key,
          );
      }
      if (method === "PATCH" && path.length === 2) {
        const { label } = await input(C.CryptoRelabel, body(request));
        return registry.relabel(
          p,
          await input(C.CryptoId, path[1]),
          label,
          idempotencyKey(request),
        );
      }
      if (method === "DELETE" && path.length === 4 && path[2] === "routes")
        return registry.unlink(
          p,
          await input(C.CryptoId, path[1]),
          await input(C.CryptoId, path[3]),
          idempotencyKey(request),
        );
    }
    if (method === "POST" && path.join("/") === "assistant/turns")
      return askCrypto(
        p.id,
        await input(C.CryptoAsk, body(request)),
        idempotencyKey(request),
      );
    if (path[0] === "alert-rules") {
      if (method === "GET" && path.length === 1)
        return listAlertRules(p.id, await input(C.CryptoScope, query(url)));
      if (method === "POST" && path.length === 1)
        return addAlertRule(
          p,
          await input(C.CryptoAlertRuleInput, body(request)),
          idempotencyKey(request),
        );
      if (method === "PATCH" && path.length === 2) {
        const { enabled } = await input(C.CryptoAlertRuleUpdate, body(request));
        return updateAlertRule(
          p,
          await input(C.CryptoId, path[1]),
          enabled,
          idempotencyKey(request),
        );
      }
    }
    if (path[0] === "alerts") {
      if (method === "GET" && path.length === 1)
        return listAlerts(p.id, await input(C.CryptoPageQuery, query(url)));
      if (method === "POST" && path.length === 3 && path[2] === "read")
        return readAlert(
          p,
          await input(C.CryptoId, path[1]),
          idempotencyKey(request),
        );
    }
    if (method === "POST" && path.join("/") === "eligibility")
      return walletEligibility(
        p.id,
        await input(C.CryptoEligibilityInput, body(request)),
      );
    if (path[0] === "reviews" && method === "POST") {
      if (path.length === 1)
        return prepareCrypto(
          p,
          await input(C.CryptoIntent, body(request)),
          idempotencyKey(request),
        );
      if (path.length === 3 && path[2] === "begin")
        return beginCrypto(
          p,
          await input(C.CryptoId, path[1]),
          await input(C.CryptoBegin, body(request)),
          idempotencyKey(request),
        );
    }
    if (path[0] === "attempts") {
      if (method === "GET" && path.length === 1) {
        const args = query(url);
        if (args.unresolvedOnly === "true") args.unresolvedOnly = true;
        if (args.unresolvedOnly === "false") args.unresolvedOnly = false;
        return listAttempts(p.id, await input(C.CryptoAttemptQuery, args));
      }
      if (method === "GET" && path.length === 2)
        return getAttempt(p.id, await input(C.CryptoId, path[1]));
      if (method === "POST" && path.length === 3) {
        const id = await input(C.CryptoId, path[1]);
        if (path[2] === "handoff") return handoffCrypto(p, id, request);
        if (path[2] === "wallet-outcome")
          return reportWalletOutcome(
            p,
            id,
            await input(C.CryptoWalletOutcome, body(request)),
            idempotencyKey(request),
          );
        if (path[2] === "reconcile") return reconcileCrypto(p.id, id);
      }
    }
    if (method === "GET" && path.length === 2 && path[0] === "receipts")
      return receipt(p.id, await input(C.CryptoId, path[1]));
    if (path[0] === "requests") {
      if (method === "POST" && path.length === 1)
        return createCryptoRequest(
          p,
          await input(C.CryptoRequestInput, body(request)),
          idempotencyKey(request),
        );
      const id = await input(C.CryptoId, path[1]);
      if (method === "GET" && path.length === 2)
        return getCryptoRequest(p.id, id);
      if (method === "GET" && path.length === 3 && path[2] === "qr")
        return cryptoRequestQr(p.id, id);
      if (method === "POST" && path.length === 3 && path[2] === "cancel") {
        const { revision } = await input(C.CryptoRevision, body(request));
        return cancelCryptoRequest(p, id, revision, idempotencyKey(request));
      }
    }
    if (
      [
        "assistant",
        "eligibility",
        "reviews",
        "attempts",
        "receipts",
        "alert-rules",
        "alerts",
        "swaps",
        "requests",
      ].includes(path[0])
    )
      throw new DomainError("FEATURE_DISABLED", 503);
    throw new DomainError("NOT_FOUND", 404);
  });
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
