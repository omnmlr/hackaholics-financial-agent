import { randomUUID } from "node:crypto";
import { z } from "zod";
import { endpoint, body, invariant } from "@/server/errors";
import { principal, mutationOrigin } from "@/server/auth";
import { database, transaction } from "@/server/sql";
import { assertSchema } from "@/server/migrations";
import { issueStepUp } from "@/server/approvals";
import { page, pageInput } from "@/server/pagination";
import { seal, assertEncryptionReady } from "@/server/secrets";
import { identity } from "@/server/auth";
import { runJournal } from "@/lib/personal-agent/journal";
import { report } from "@/lib/personal-agent/contracts";
import { workspace } from "@/lib/agent-workspace/store";
import { service as solana } from "@/lib/solana";
import { jobMetrics } from "@/server/jobs";
import * as banking from "@/server/banking/service";
import * as payments from "@/server/banking/payments";
import { fixtureDirectory } from "@/server/banking/fixture";
import {
  ConnectAccount,
  CompleteConnection,
  VerifyBeneficiary,
  PreparePayment,
  ApprovalAction,
  RevisionAction,
  AtomicMoney,
} from "../../../../../packages/contracts/src";
import { idempotencyKey, operation } from "@/server/idempotency";
import { receiveFixtureEvent } from "@/server/banking/events";
import { reauthorizeConnection } from "@/server/banking/reauthorize";
import * as marketplace from "@/server/p2p";
import * as fixtureEscrow from "@/server/p2p-fixture";
import * as usd from "@/server/usd/fixture";
import { usdCapabilities } from "@/server/usd/partners";
import * as escrowBindings from "@/server/escrow/bindings";
import {
  walletChallenge,
  associateWallet,
  approveDevnet,
  devnetView,
  verifySubmissionReplay,
} from "@/server/solana";
import * as requests from "@/server/requests";
import {
  discoverRequest,
  matchExternalRequest,
} from "@/server/request-discovery";
import { readWalletHistory } from "@/server/solana-history";
import { atomsToDecimal } from "@/lib/solana/money";
import { CIRCLE_DEVNET_USDC_MINT } from "@/lib/solana/assets";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  return endpoint(async () => {
    const url = new URL(req.url),
      path = url.pathname.replace(/^\/api\/v1\//, "").split("/");
    if (path[0] === "health") return { status: "ok" };
    if (path[0] === "ready") {
      await assertSchema(await database());
      await identity();
      assertEncryptionReady();
      return { status: "ready" };
    }
    if (req.method === "POST" && path.join("/") === "provider-events/fixture")
      return receiveFixtureEvent(req);
    const p = await principal(req),
      sql = await database();
    if (req.method !== "GET") mutationOrigin(req);
    if (req.method === "GET") {
      if (path[0] === "banking") {
        if (path[1] === "institutions") return banking.institutions();
        if (path[1] === "beneficiary-banks")
          return {
            data: await fixtureDirectory.banks(),
            simulated: true,
            sourceCapabilitiesEnabled: false,
          };
        if (path[1] === "connections")
          return {
            data: (
              await sql.query(
                "SELECT id,institution,provider,environment,status,revision,revoked_at,provider_revocation_pending FROM agus_connections WHERE owner=$1 ORDER BY id",
                [p.id],
              )
            ).rows,
          };
        if (path[1] === "accounts" && !path[2])
          return banking.listAccounts(p.id);
        if (path[1] === "accounts" && path[2]) {
          const id = z.uuid().parse(path[2]);
          const source = await banking.sourceAccess(sql, p.id, id);
          if (path[3] === "transactions") {
            const { limit, after } = pageInput(url);
            const rows = (
              await sql.query<{ id: string; amount_atoms: string }>(
                "SELECT id,provider_id,revision,amount_atoms,direction,status,occurred_at,observed_at,provider,environment,simulated,description FROM agus_bank_transactions WHERE owner=$1 AND account_id=$2 AND id>$3 ORDER BY id LIMIT $4",
                [p.id, id, after, limit + 1],
              )
            ).rows;
            return {
              ...page(
                rows.map((row) => ({
                  ...row,
                  amount: {
                    atoms: row.amount_atoms,
                    currency: source.currency,
                    scale: source.scale,
                  },
                })),
                limit,
              ),
              historyComplete: (
                await sql.query(
                  "SELECT history_complete FROM agus_source_accounts WHERE owner=$1 AND id=$2",
                  [p.id, id],
                )
              ).rows[0].history_complete,
            };
          }
        }
      }
      if (path[0] === "payments") {
        if (!path[1]) {
          const { limit, after } = pageInput(url);
          return page(
            await payments.listPayments(p.id, after, limit + 1),
            limit,
          );
        }
        const id = z.uuid().parse(path[1]);
        return path[2] === "receipts"
          ? payments.receipts(p.id, id)
          : payments.getPayment(p.id, id);
      }
      if (path[0] === "p2p") {
        if (path[1] === "escrow")
          return {
            programId: "AYCkNeJSmk99TSDYq7tH7yRmAfv64vw6vA6SvT732yCi",
            network: "devnet",
            mint: CIRCLE_DEVNET_USDC_MINT,
            genuineExecutionEnabled: false,
            programAddressAccepted: false,
            deploymentStatus:
              "local-program-only; owner-controlled Devnet deployment pending",
            gate: "GENUINE_DEVNET_ACCEPTANCE_PENDING",
            verifier: "simulated-prototype-only",
          };
        if (path[1] === "orders" && path[2] && path[3] === "fixture") {
          const id = z.uuid().parse(path[2]);
          return path[4] === "review"
            ? fixtureEscrow.fixtureReview(
                p,
                id,
                fixtureEscrow.FixtureEscrowAction.parse(
                  url.searchParams.get("action"),
                ),
              )
            : fixtureEscrow.fixtureSnapshot(p, id);
        }
        if (path[1] === "orders" && path[2] && path[3] === "devnet-binding")
          return escrowBindings.getBinding(p, z.uuid().parse(path[2]));
        if (path[1] === "orders" && path[2])
          return marketplace.getOrder(p.id, z.uuid().parse(path[2]));
        if (path[1] === "orders") {
          const { after, limit } = pageInput(url);
          const rows = (
            await sql.query<{ id: string }>(
              "SELECT id,state,revision,expires_at,environment FROM agus_p2p_orders WHERE (owner=$1 OR counterparty=$1) AND id>$2 ORDER BY id LIMIT $3",
              [p.id, after, limit + 1],
            )
          ).rows;
          return { ...page(rows, limit), simulated: true };
        }
        if (path[1] === "offers") {
          const { after, limit } = pageInput(url);
          const rows = (
            await sql.query<{
              id: string;
              available_atoms: string;
              minimum_atoms: string;
              maximum_atoms: string;
            }>(
              "SELECT o.id,o.side,o.available_atoms,o.minimum_atoms,o.maximum_atoms,o.rate_numerator,o.rate_denominator,o.revision,o.expires_at,o.environment FROM agus_p2p_offers o JOIN agus_trader_eligibility e ON e.owner=o.owner AND e.eligible=true AND e.environment='fixture' WHERE o.status='open' AND o.expires_at>now() AND o.available_atoms>0 AND o.id>$1 ORDER BY o.id LIMIT $2",
              [after, limit + 1],
            )
          ).rows;
          return {
            ...page(
              rows.map((r) => ({
                ...r,
                available: {
                  atoms: r.available_atoms,
                  currency: "USDC",
                  scale: 6,
                },
                minimum: { atoms: r.minimum_atoms, currency: "USDC", scale: 6 },
                maximum: { atoms: r.maximum_atoms, currency: "USDC", scale: 6 },
                rateUnits: "NGN atomic units (scale 2) per USDC (scale 6)",
              })),
              limit,
            ),
            simulated: true,
          };
        }
      }
      if (path[0] === "usd") {
        if (path[1] === "fixture") {
          if (path[2] === "account") return usd.account(p.id);
          if (path[2] === "incoming" && !path[3]) {
            const { after, limit } = pageInput(url);
            return page(await usd.incoming(p.id, after, limit + 1), limit);
          }
          if (path[2] === "incoming" && path[3] && path[4] === "return-review")
            return usd.returnReview(p.id, z.uuid().parse(path[3]));
          if (path[2] === "conversions" && path[3])
            return path[4] === "review"
              ? usd.stageReview(
                  p.id,
                  z.uuid().parse(path[3]),
                  usd.StageAction.parse(url.searchParams.get("stage")),
                )
              : usd.getConversion(p.id, z.uuid().parse(path[3]));
          invariant(false, "NOT_FOUND", 404);
        }
        return usdCapabilities();
      }
      if (path[0] === "me")
        return {
          user: {
            id: p.id,
            role: p.role,
            twoFactorEnabled: p.twoFactorEnabled,
          },
          sessionId: p.sessionId,
        };
      if (path[0] === "sessions")
        return {
          data: (
            await sql.query(
              "SELECT id,created_at,expires_at,user_agent FROM agus_sessions WHERE user_id=$1 ORDER BY created_at,id",
              [p.id],
            )
          ).rows,
        };
      if (path[0] === "notifications") {
        const { limit, after } = pageInput(url);
        return page(
          (
            await sql.query<{ id: string }>(
              "SELECT id,resource_type,resource_id,created_at,read_at FROM agus_notifications WHERE owner=$1 AND id>$2 ORDER BY id LIMIT $3",
              [p.id, after, limit + 1],
            )
          ).rows,
          limit,
        );
      }
      if (path[0] === "responsibilities") {
        const snapshot = await workspace(p.id).snapshot();
        if (path[1]) {
          const task = snapshot.tasks.find(
            (task) => task.id === z.uuid().parse(path[1]),
          );
          invariant(task, "NOT_FOUND", 404);
          return task;
        }
        return snapshot;
      }
      if (path[0] === "runs") {
        const journal = runJournal(p.id),
          runs = path[1]
            ? [await journal.read(z.uuid().parse(path[1]))]
            : await journal.list();
        return {
          data: runs.map((run) => ({
            conversationId: run.conversationId,
            version: run.version,
            goal: run.goal,
            ...report(run),
          })),
        };
      }
      if (path[0] === "solana") {
        if (path[1] === "history")
          return readWalletHistory(
            z.string().min(32).max(44).parse(url.searchParams.get("wallet")),
            url.searchParams.get("cursor") ?? undefined,
          );
        return path[1]
          ? devnetView(await solana().get(p.id, z.uuid().parse(path[1])))
          : { data: (await solana().list(p.id)).map(devnetView) };
      }
      if (path[0] === "requests") {
        if (path[1] && path[2] === "settlements") {
          const { after, limit } = pageInput(url);
          return {
            ...page(
              await requests.requestReceipts(
                p.id,
                z.uuid().parse(path[1]),
                after,
                limit + 1,
              ),
              limit,
            ),
            historyComplete: false,
            coverage:
              "Recorded verified matches only; public RPC discovery may be incomplete.",
          };
        }
        if (!path[1]) {
          const { after, limit } = pageInput(url);
          return page(
            await requests.listRequests(p.id, after, limit + 1),
            limit,
          );
        }
        if (path[2] === "qr")
          return requests.requestQr(p.id, z.uuid().parse(path[1]));
        return path[1] === "lookup"
          ? requests.lookupRequest(z.string().min(32).max(44).parse(path[2]))
          : requests.getRequest(p.id, z.uuid().parse(path[1]));
      }
      if (path[0] === "jobs") {
        invariant(p.role === "operations", "FORBIDDEN", 403);
        return {
          metrics: await jobMetrics(),
          dead: (
            await sql.query(
              "SELECT id,kind,attempts,last_error FROM agus_jobs WHERE state='dead' ORDER BY created_at LIMIT 100",
            )
          ).rows,
        };
      }
    }
    if (req.method === "DELETE" && path[0] === "sessions") {
      const id = z.string().min(1).max(100).parse(path[1]);
      const r = await sql.query(
        "DELETE FROM agus_sessions WHERE user_id=$1 AND id=$2 RETURNING id",
        [p.id, id],
      );
      invariant(r.rows.length, "NOT_FOUND", 404);
      return { revoked: true };
    }
    if (req.method === "POST") {
      const input = await body(req);
      if (path[0] === "usd" && path[1] === "fixture") {
        if (path[2] === "account")
          return usd.onboard(
            p.id,
            idempotencyKey(req),
            usd.OnboardInput.parse(input),
          );
        if (path[2] === "incoming" && !path[3])
          return usd.recordIncoming(
            p,
            idempotencyKey(req),
            usd.IncomingInput.parse(input),
          );
        if (path[2] === "quotes")
          return usd.quote(
            p.id,
            idempotencyKey(req),
            usd.ConversionInput.parse(input),
          );
        if (path[2] === "conversions" && !path[3]) {
          const v = z
            .strictObject({
              quoteId: z.uuid(),
              challengeId: z.uuid(),
              loseResponse: z.boolean().optional(),
            })
            .parse(input);
          return usd.submit(
            p,
            idempotencyKey(req),
            v.quoteId,
            v.challengeId,
            v.loseResponse,
          );
        }
        if (path[2] === "conversions" && path[3]) {
          const id = z.uuid().parse(path[3]);
          if (path[4] === "reconcile") {
            z.strictObject({}).parse(input);
            return usd.reconcile(p.id, id);
          }
          const v = ApprovalAction.parse(input);
          return usd.submitStage(
            p,
            id,
            idempotencyKey(req),
            usd.StageAction.parse(path[4]),
            v.revision,
            v.challengeId,
          );
        }
        if (path[2] === "incoming" && path[3] && path[4] === "return") {
          const v = ApprovalAction.parse(input);
          return usd.returnIncoming(
            p,
            z.uuid().parse(path[3]),
            idempotencyKey(req),
            v.revision,
            v.challengeId,
          );
        }
      }
      if (path[0] === "memory") {
        if (!path[1])
          return workspace(p.id).proposeMemory(
            input,
            z.uuid().parse(idempotencyKey(req)),
          );
        const action = z
          .strictObject({ action: z.enum(["confirm", "forget"]) })
          .parse(input).action;
        await workspace(p.id).memoryAction(z.uuid().parse(path[1]), action);
        return { updated: true };
      }
      if (path[0] === "runs" && path[1]) {
        const v = z
          .strictObject({
            revision: z.number().int().nonnegative(),
            action: z.enum(["pause", "cancel"]),
            acknowledged: z.literal(true),
          })
          .parse(input);
        return report(
          await runJournal(p.id).control(
            z.uuid().parse(path[1]),
            v.revision,
            v.action,
          ),
        );
      }
      if (path[0] === "requests") {
        if (!path[1])
          return requests.createRequest(
            p.id,
            idempotencyKey(req),
            requests.RequestInput.parse(input),
          );
        if (path[1] === "parse")
          return requests.parseSolanaPay(
            z.strictObject({ uri: z.string().max(4096) }).parse(input).uri,
          );
        const id = z.uuid().parse(path[1]);
        if (path[2] === "discover")
          return discoverRequest(
            p.id,
            id,
            z
              .strictObject({ cursor: z.string().max(512).optional() })
              .parse(input).cursor,
          );
        if (path[2] === "match-external")
          return matchExternalRequest(
            p.id,
            id,
            z
              .strictObject({ signature: z.string().min(64).max(88) })
              .parse(input).signature,
          );
        if (path[2] === "cancel")
          return requests.cancelRequest(
            p.id,
            id,
            RevisionAction.parse(input).revision,
          );
        if (path[2] === "prepare")
          return devnetView(
            await requests.prepareRequestedTransfer(
              p.id,
              id,
              z
                .strictObject({ sender: z.string().min(32).max(44) })
                .parse(input).sender,
              idempotencyKey(req),
            ),
          );
        if (path[2] === "match")
          return requests.matchRequest(
            p.id,
            id,
            z.strictObject({ draftId: z.uuid() }).parse(input).draftId,
          );
      }
      if (path[0] === "banking") {
        if (path[1] === "connections" && !path[2])
          return banking.beginConnection(
            p.id,
            idempotencyKey(req),
            ConnectAccount.parse(input),
          );
        if (path[1] === "connections" && path[2] === "callback")
          return banking.completeConnection(
            p.id,
            CompleteConnection.parse(input),
          );
        if (path[1] === "connections" && path[3] === "revoke")
          return banking.revokeConnection(
            p.id,
            z.uuid().parse(path[2]),
            RevisionAction.parse(input).revision,
          );
        if (path[1] === "connections" && path[3] === "reauthorize")
          return reauthorizeConnection(
            p.id,
            z.uuid().parse(path[2]),
            RevisionAction.parse(input).revision,
          );
        if (path[1] === "beneficiaries")
          return banking.verifyBeneficiary(
            p.id,
            idempotencyKey(req),
            VerifyBeneficiary.parse(input),
          );
        if (path[1] === "accounts" && path[2]) {
          z.strictObject({}).parse(input);
          if (path[3] === "balance")
            return banking.refreshBalance(p.id, z.uuid().parse(path[2]));
          if (path[3] === "sync")
            return banking.syncAccount(p.id, z.uuid().parse(path[2]), true);
        }
      }
      if (path[0] === "payments") {
        if (!path[1])
          return payments.preparePayment(
            p.id,
            idempotencyKey(req),
            PreparePayment.parse(input),
          );
        const id = z.uuid().parse(path[1]);
        if (path[2] === "authorize") {
          const v = ApprovalAction.parse(input);
          return payments.authorizePayment(
            p,
            id,
            v.revision,
            v.challengeId,
            idempotencyKey(req),
          );
        }
        if (path[2] === "submit")
          return payments.submitPayment(
            p,
            id,
            RevisionAction.parse(input).revision,
            idempotencyKey(req),
          );
        if (path[2] === "reconcile") {
          z.strictObject({}).parse(input);
          return payments.reconcilePayment(p.id, id);
        }
        if (path[2] === "disputes")
          return payments.dispute(
            p.id,
            id,
            idempotencyKey(req),
            z.strictObject({ reason: z.string().min(1).max(1000) }).parse(input)
              .reason,
          );
      }
      if (path[0] === "p2p") {
        if (path[1] === "offers" && path[2]) {
          const v = z
            .strictObject({
              revision: z.number().int().nonnegative(),
              offer: marketplace.OfferInput.nullable(),
            })
            .parse(input);
          return marketplace.updateOffer(
            p.id,
            z.uuid().parse(path[2]),
            v.revision,
            v.offer,
          );
        }
        if (path[1] === "offers")
          return marketplace.createOffer(
            p.id,
            idempotencyKey(req),
            marketplace.OfferInput.parse(input),
          );
        if (path[1] === "quotes")
          return marketplace.quote(p.id, marketplace.QuoteInput.parse(input));
        if (path[1] === "reservations") {
          const v = z
            .strictObject({ quoteId: z.uuid(), challengeId: z.uuid() })
            .parse(input);
          return marketplace.reserve(
            p,
            idempotencyKey(req),
            v.quoteId,
            v.challengeId,
          );
        }
        if (path[1] === "orders" && path[2]) {
          if (path[3] === "devnet-binding") {
            const id = z.uuid().parse(path[2]);
            if (path[4] === "reconcile")
              return escrowBindings.reconcileBinding(
                p,
                id,
                z
                  .strictObject({ signature: z.string().min(64).max(88) })
                  .parse(input).signature,
              );
            return escrowBindings.createBinding(
              p,
              id,
              idempotencyKey(req),
              escrowBindings.BindingInput.parse(input),
            );
          }
          if (path[3] === "fixture") {
            const v = ApprovalAction.parse(input);
            return fixtureEscrow.fixtureAction(
              p,
              z.uuid().parse(path[2]),
              idempotencyKey(req),
              fixtureEscrow.FixtureEscrowAction.parse(path[4]),
              v.revision,
              v.challengeId,
            );
          }
          if (path[3] === "disputes")
            return marketplace.openDispute(
              p.id,
              z.uuid().parse(path[2]),
              idempotencyKey(req),
              z
                .strictObject({ reason: z.string().min(1).max(1000) })
                .parse(input).reason,
            );
          if (path[3] === "cancel")
            return marketplace.cancelOrder(
              p.id,
              z.uuid().parse(path[2]),
              RevisionAction.parse(input).revision,
            );
          return marketplace.escrowGate();
        }
      }
      if (path[0] === "solana") {
        if (path[1] === "wallet-challenge")
          return walletChallenge(
            p.id,
            z.strictObject({ wallet: z.string().min(32).max(44) }).parse(input)
              .wallet,
          );
        if (path[1] === "wallet-association") {
          const v = z
            .strictObject({
              wallet: z.string().min(32).max(44),
              signatureBase64: z.string().max(100),
            })
            .parse(input);
          return associateWallet(p.id, v.wallet, v.signatureBase64);
        }
        if (path[1] === "balances")
          return solana().discoverWallet(
            p.id,
            z.strictObject({ wallet: z.string().min(32).max(44) }).parse(input)
              .wallet,
          );
        if (path[1] === "prepare") {
          const v = z
            .strictObject({
              sender: z.string().min(32).max(44),
              recipient: z.string().min(32).max(44),
              asset: z.enum(["SOL", "SPL"]),
              amount: AtomicMoney,
              mint: z.string().min(32).max(44).optional(),
            })
            .parse(input);
          // Existing service accepts a stable request ID, so a lost preparation
          // response reopens the same exact draft instead of creating another.
          const requestId = z.uuid().parse(idempotencyKey(req));
          invariant(
            v.amount.currency === (v.asset === "SOL" ? "SOL" : "USDC") &&
              v.amount.scale === (v.asset === "SOL" ? 9 : 6) &&
              (!v.mint || v.mint === CIRCLE_DEVNET_USDC_MINT),
            "ASSET_SCALE_MISMATCH",
            400,
          );
          return devnetView(
            await solana().prepare(
              p.id,
              {
                ...v,
                amount: atomsToDecimal(BigInt(v.amount.atoms), v.amount.scale),
              },
              requestId,
            ),
          );
        }
        if (path[1]) {
          const id = z.uuid().parse(path[1]);
          if (path[2] === "approve") {
            const v = ApprovalAction.parse(input);
            return devnetView(
              await approveDevnet(
                p,
                id,
                v.revision,
                v.challengeId,
                idempotencyKey(req),
              ),
            );
          }
          if (path[2] === "submit") {
            const v = z
              .strictObject({
                digest: z.string().regex(/^[a-f0-9]{64}$/),
                signedTransactionBase64: z.string().max(4096),
              })
              .parse(input);
            await transaction((sql) =>
              operation(sql, p.id, "solana.submit", idempotencyKey(req), {
                id,
                ...v,
              }),
            );
            const current = await solana().get(p.id, id);
            invariant(current.digest === v.digest, "REVIEW_CHANGED", 409);
            if (current.submission)
              verifySubmissionReplay(current, v.signedTransactionBase64);
            return devnetView(
              current.submission
                ? current
                : await solana().submitSigned(p.id, id, v),
            );
          }
          if (path[2] === "reconcile") {
            z.strictObject({}).parse(input);
            return devnetView(await solana().reconcile(p.id, id));
          }
          if (path[2] === "cancel") {
            z.strictObject({}).parse(input);
            return devnetView(await solana().cancel(p.id, id));
          }
        }
      }
      if (path[0] === "step-up") {
        const v = z
          .strictObject({
            action: z.string().regex(/^[a-z][a-z0-9_.]{0,59}$/),
            digest: z.string().regex(/^[a-f0-9]{64}$/),
            password: z.string().min(1).max(256),
            code: z.string().regex(/^\d{6}$/),
          })
          .parse(input);
        return issueStepUp(
          p,
          req.headers,
          v.action,
          v.digest,
          v.password,
          v.code,
        );
      }
      if (path[0] === "notifications" && path[1]) {
        z.strictObject({ read: z.literal(true) }).parse(input);
        const r = await sql.query(
          "UPDATE agus_notifications SET read_at=coalesce(read_at,now()) WHERE owner=$1 AND id=$2 RETURNING id,read_at",
          [p.id, z.uuid().parse(path[1])],
        );
        invariant(r.rows.length, "NOT_FOUND", 404);
        return r.rows[0];
      }
      if (path[0] === "devices") {
        const v = z
          .strictObject({
            id: z.uuid().optional(),
            platform: z.enum(["android", "ios", "web"]),
            pushState: z.enum([
              "denied",
              "registered",
              "invalid",
              "unavailable",
            ]),
            pushToken: z.string().min(1).max(4096).optional(),
            preferences: z.strictObject({
              inApp: z.boolean(),
              push: z.boolean(),
            }),
          })
          .parse(input);
        invariant(
          v.pushState !== "registered" || v.pushToken,
          "PUSH_TOKEN_REQUIRED",
          400,
        );
        const id = v.id ?? randomUUID(),
          envelope =
            v.pushState === "registered" && v.pushToken
              ? seal(p.id, `push:${id}`, v.pushToken)
              : null;
        await sql.query(
          "INSERT INTO agus_devices(owner,id,session_id,platform,push_state,push_envelope,preferences) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(owner,id) DO UPDATE SET session_id=excluded.session_id,push_state=excluded.push_state,push_envelope=excluded.push_envelope,preferences=excluded.preferences",
          [
            p.id,
            id,
            p.sessionId,
            v.platform,
            v.pushState,
            envelope ? JSON.stringify(envelope) : null,
            JSON.stringify(v.preferences),
          ],
        );
        return { id, pushState: v.pushState, deliveryVerified: false };
      }
      if (path[0] === "responsibilities") {
        if (!path[1]) return workspace(p.id).createTask(input);
        const v = z
          .strictObject({
            revision: z.number().int().nonnegative(),
            action: z.enum(["approve", "pause", "resume", "cancel"]),
          })
          .parse(input);
        return workspace(p.id).transition(
          z.uuid().parse(path[1]),
          v.revision,
          v.action,
        );
      }
    }
    invariant(false, "NOT_FOUND", 404);
  });
}
export { handle as GET, handle as POST, handle as DELETE };
