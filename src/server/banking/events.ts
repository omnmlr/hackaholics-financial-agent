import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { invariant, jsonText } from "../errors";
import { transaction } from "../sql";
import { seal } from "../secrets";
import { enqueue } from "../jobs";
const Event = z.strictObject({
  id: z.string().min(1).max(100),
  reference: z.string().min(1).max(100),
  claimedStatus: z.enum(["pending", "succeeded", "failed", "reversed"]),
});
export async function receiveFixtureEvent(req: Request) {
  invariant(
    (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
    "FIXTURE_MODE_REQUIRED",
    403,
  );
  const secret = process.env.FIXTURE_WEBHOOK_SECRET;
  invariant(
    secret && secret.length >= 32,
    "FIXTURE_WEBHOOK_NOT_CONFIGURED",
    503,
  );
  const raw = await jsonText(req);
  const signature = req.headers.get("x-agus-fixture-signature") ?? "";
  invariant(
    /^[a-f0-9]{64}$/.test(signature),
    "WEBHOOK_AUTHENTICATION_FAILED",
    403,
  );
  invariant(
    timingSafeEqual(
      Buffer.from(signature, "hex"),
      createHmac("sha256", secret).update(raw).digest(),
    ),
    "WEBHOOK_AUTHENTICATION_FAILED",
    403,
  );
  const event = Event.parse(JSON.parse(raw)),
    hash = createHash("sha256").update(raw).digest("hex");
  return transaction(async (sql) => {
    const payment = (
      await sql.query(
        "SELECT owner,id FROM agus_payments WHERE provider_reference=$1 AND provider='fixture-source' AND environment='fixture'",
        [event.reference],
      )
    ).rows[0];
    invariant(payment, "PAYMENT_NOT_FOUND", 404);
    await sql.query(
      "INSERT INTO agus_inbox(provider,environment,event_id,request_hash,envelope) VALUES('fixture-source','fixture',$1,$2,$3) ON CONFLICT DO NOTHING",
      [
        event.id,
        hash,
        JSON.stringify(
          seal(payment.owner, `provider-event:${event.id}`, event),
        ),
      ],
    );
    const prior = (
      await sql.query(
        "SELECT request_hash FROM agus_inbox WHERE provider='fixture-source' AND environment='fixture' AND event_id=$1",
        [event.id],
      )
    ).rows[0];
    invariant(prior.request_hash === hash, "WEBHOOK_IDEMPOTENCY_CONFLICT");
    await enqueue(
      sql,
      payment.owner,
      "payment.reconcile",
      `payment-event:${event.id}`,
      { paymentId: payment.id },
    );
    // Claimed status is retained as an encrypted observation only. Authoritative
    // provider reads, including reversals, drive payment/receipt transitions.
    return { accepted: true, simulated: true, settlementVerified: false };
  });
}
