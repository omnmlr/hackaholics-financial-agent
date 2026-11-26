import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { claim, deliverNotification, retry, finish } from "../src/server/jobs";
import {
  syncAccount,
  retryProviderRevocation,
} from "../src/server/banking/service";
import { reconcilePayment } from "../src/server/banking/payments";
import { transaction } from "../src/server/sql";
import { runResponsibilities } from "../src/server/responsibilities";
import { expireUnfundedOrders } from "../src/server/p2p";
import { reconcile as reconcileUsd } from "../src/server/usd/fixture";
import { runCryptoRequests } from "../src/server/crypto/requests";
import { runCryptoReconciliation } from "../src/server/crypto/execution";
import { runCryptoMonitoring } from "../src/server/crypto/alerts";
import { operationalEvent } from "../src/server/observability";

const worker = randomUUID();
let nextCryptoCheck = 0;
let cryptoCheck: Promise<unknown> | undefined;
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
  });
do {
  await runResponsibilities();
  await expireUnfundedOrders();
  if (!cryptoCheck && Date.now() >= nextCryptoCheck) {
    nextCryptoCheck = Date.now() + 30_000;
    cryptoCheck = Promise.allSettled([
      runCryptoMonitoring(),
      runCryptoReconciliation(),
      runCryptoRequests(),
    ])
      .then((results) => {
        if (results.some((result) => result.status === "rejected"))
          operationalEvent("crypto.worker_failed", {
            code: "CRYPTO_CHECK_FAILED",
          });
      })
      .finally(() => {
        cryptoCheck = undefined;
      });
  }
  const job = await claim(worker);
  if (!job) {
    if (process.argv.includes("--once")) break;
    await delay(500);
    continue;
  }
  try {
    if (job.kind === "notification.in_app") await deliverNotification(job);
    else if (job.kind === "usd.reconcile") {
      const result = await reconcileUsd(
        job.owner,
        String(job.payload.conversionId),
      );
      if (["pending", "unknown"].includes(String(result.conversion_status)))
        await retry(job, "RECONCILIATION_PENDING");
      else await transaction((sql) => finish(sql, job));
    } else if (job.kind === "bank.revoke") {
      await retryProviderRevocation(
        job.owner,
        String(job.payload.connectionId),
      );
      await transaction((sql) => finish(sql, job));
    } else if (job.kind === "bank.sync") {
      await syncAccount(job.owner, String(job.payload.accountId));
      await transaction((sql) => finish(sql, job));
    } else if (job.kind === "payment.reconcile") {
      const payment = await reconcilePayment(
        job.owner,
        String(job.payload.paymentId),
      );
      if (["pending", "unknown", "submitting"].includes(payment.status))
        await retry(job, "RECONCILIATION_PENDING");
      else await transaction((sql) => finish(sql, job));
    } else await retry(job, "HANDLER_UNAVAILABLE");
  } catch {
    await retry(job, "HANDLER_FAILED");
  }
} while (!stopping && !process.argv.includes("--once"));
await cryptoCheck;
const { closeDatabase } = await import("../src/server/sql");
await closeDatabase();
