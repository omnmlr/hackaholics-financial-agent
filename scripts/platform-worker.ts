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
const worker = randomUUID();
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    stopping = true;
  });
do {
  await runResponsibilities();
  await expireUnfundedOrders();
  const job = await claim(worker);
  if (!job) {
    if (process.argv.includes("--once")) break;
    await delay(500);
    continue;
  }
  try {
    if (job.kind === "notification.in_app") await deliverNotification(job);
    else if (job.kind === "bank.revoke") {
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
const { closeDatabase } = await import("../src/server/sql");
await closeDatabase();
