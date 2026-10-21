import { Check, Clock3, CircleAlert, Undo2, Download } from "lucide-react";
import type { Batch } from "@/lib/domain";
import { money } from "./payment-ui";
import type { AgentReply } from "@/lib/financial-agent/agent";

const statuses: Record<string, string> = {
  successful: "Successful",
  processing: "Processing",
  submitted: "Submitted; outcome unresolved",
  unknown: "Outcome unknown",
  failed: "Failed",
  reversed: "Reversed",
  awaiting_otp: "Awaiting provider OTP",
};
export function currentPaymentReply(
  reply: AgentReply,
  batch: Batch | undefined,
): AgentReply {
  if (!batch) return reply;
  const simulated = batch.mode === "fixture";
  const text = batch.approval?.consumedAt
    ? `${batch.payments.map((p) => `${p.verifiedName ?? p.name}: ${money(p.amountKobo)} · ${statuses[p.status] ?? p.status.replaceAll("_", " ")}.`).join(" ")} ${simulated ? "These are recorded simulations; no real money moved." : "Provider-reported status does not establish recipient bank credit."}`
    : batch.status === "approved"
      ? "Your reviewed approval is recorded. Nothing has been submitted. Submit explicitly when you are ready."
      : batch.status === "awaiting_user_approval"
        ? `${simulated ? "The fictional recipients" : "The recipients"} are verified. Review the final amounts and fees, then approve separately. Nothing has been submitted.`
        : "Your editable payment draft is saved. Check each recipient’s verification status below before approving. Nothing has been submitted.";
  return { ...reply, text };
}
/** One component per current batch. Polling updates this recorded state instead
 * of appending another 'success' message; a reversal replaces success in place. */
export function PaymentOutcome({
  batch: b,
  banks,
  check,
  busy,
}: {
  batch: Batch;
  banks: { name: string; code: string }[];
  check?: () => void;
  busy?: boolean;
}) {
  if (!b.approval?.consumedAt) return null;
  const successful = b.payments.every((p) => p.status === "successful"),
    reversed = b.payments.some((p) => p.status === "reversed"),
    attention = b.payments.some((p) =>
      ["failed", "unknown"].includes(p.status),
    );
  const title = successful
    ? "Transfer successful"
    : reversed
      ? "Payment reversal recorded"
      : attention
        ? "Payment needs attention"
        : "Payment submitted · awaiting outcome";
  const Icon = successful
    ? Check
    : reversed
      ? Undo2
      : attention
        ? CircleAlert
        : Clock3;
  return (
    <section
      className={`agus-payment-outcome ${successful ? "is-success" : ""}`}
      aria-label="Recorded payment outcome"
    >
      <div className="agus-outcome-title" role="status" aria-live="polite">
        <Icon size={21} />
        <h3>
          {b.mode === "fixture" ? "Simulated " : ""}
          {title.charAt(0).toLowerCase() + title.slice(1)}
        </h3>
      </div>
      <p>
        {successful
          ? b.mode === "fixture"
            ? "The recorded payment simulation completed successfully."
            : "The provider reports successful processing."
          : "Submission is recorded. The individual outcomes below reflect the current saved state."}{" "}
        {b.mode === "fixture"
          ? "No real money moved."
          : "Provider status does not establish recipient bank credit."}
      </p>
      {b.payments.map((p) => (
        <div className="agus-outcome-record" key={p.id}>
          <div>
            <strong>{p.verifiedName ?? p.name}</strong>
            <span>{statuses[p.status] ?? p.status.replaceAll("_", " ")}</span>
          </div>
          <b>{money(p.amountKobo)}</b>
          <small>
            Confirmed fee:{" "}
            {p.providerFeeKobo === undefined
              ? "not yet available"
              : money(p.providerFeeKobo)}
          </small>
          <details>
            <summary>
              Transaction details
              {p.status === "successful" && b.mode === "fixture"
                ? " & simulated confirmation"
                : ""}
            </summary>
            <p>
              {banks.find((b) => b.code === p.bankCode)?.name ??
                "Institution unavailable"}{" "}
              · {p.responses.at(-1)?.at ?? b.updatedAt}
            </p>
            <code className="agus-safe-reference">{p.reference}</code>
            {p.status === "successful" && b.mode === "fixture" && (
              <div className="agus-simulated-confirmation">
                <strong>SIMULATED · DEMO ONLY</strong>
                <p>
                  {money(p.amountKobo)} to {p.verifiedName ?? p.name}. No real
                  funds moved. This is not a bank receipt or proof of recipient
                  credit.
                </p>
                <a
                  href={`/api/batches/${b.id}/confirmation?payment=${encodeURIComponent(p.id)}`}
                >
                  <Download size={15} /> Download simulated confirmation
                </a>
              </div>
            )}
          </details>
        </div>
      ))}
      {!successful &&
        b.payments.some((p) =>
          ["processing", "submitted", "unknown", "awaiting_otp"].includes(
            p.status,
          ),
        ) && (
          <p>
            Check the recorded provider outcome. Do not send these payments
            again while an outcome is unresolved.
          </p>
        )}
      {check && (
        <button
          className="agus-secondary"
          type="button"
          disabled={busy}
          onClick={check}
        >
          Check recorded provider outcome
        </button>
      )}
    </section>
  );
}
