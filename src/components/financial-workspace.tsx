import { ArrowUpRight, Flag, CalendarDays, Wallet, X } from "lucide-react";
import {
  SavingsPresentationSchema,
  FinancialPresentationSchema,
  PaymentPresentationSchema,
  type SavingsPresentation,
} from "@/lib/financial-agent/presentation";
import type { AgentReply } from "@/lib/financial-agent/agent";
import type { Batch } from "@/lib/domain";
const money = (amount: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(amount);
const date = (at: string) =>
  new Date(at).toLocaleDateString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
export const balanceUnavailableText = (reason: "stale" | "not_provided") =>
  reason === "stale"
    ? "This balance observation is too old to use. You can supply a starting amount instead."
    : "This account has no usable balance record. Choose another account or supply a starting amount.";

export function SavingsPlan({
  plan,
  compact = false,
}: {
  plan: SavingsPresentation;
  compact?: boolean;
}) {
  return (
    <section
      className={`agus-savings-plan${compact ? " is-compact" : ""}`}
      aria-label="Verified savings plan"
    >
      <div className="agus-plan-topline">
        <span>
          <Flag size={15} /> SAVINGS PLAN
        </span>
        <small>
          {plan.source?.simulated
            ? "Fictional starting balance"
            : "Your assumptions"}
        </small>
      </div>
      <div className="agus-goal-amount">
        <small>Your goal</small>
        <strong>{money(plan.target)}</strong>
      </div>
      <progress
        max={plan.target}
        value={Math.min(plan.startingAmount, plan.target)}
        aria-label="Starting amount toward your savings goal"
      />
      <dl className="agus-plan-figures">
        <div>
          <dt>Starting with</dt>
          <dd>{money(plan.startingAmount)}</dd>
        </div>
        <div>
          <dt>Every {plan.cadence.slice(0, -1)}</dt>
          <dd>{money(plan.contribution)}</dd>
        </div>
      </dl>
      <div className="agus-plan-timeline">
        <CalendarDays size={18} />
        <div>
          <strong>
            {plan.periods}{" "}
            {plan.cadence === "days"
              ? "daily"
              : plan.cadence === "weeks"
                ? "weekly"
                : plan.cadence === "months"
                  ? "monthly"
                  : "yearly"}{" "}
            deposits
          </strong>
          {plan.duration && <span>{plan.duration}</span>}
        </div>
      </div>
      <p className="agus-plan-assumption">
        No interest, fees or withdrawals. Deposits at the end of each period.
        {plan.source
          ? ` Uses the ${plan.source.field} balance checked for this plan; state as of ${date(plan.source.asOf)}.`
          : " Starting amount supplied for this calculation."}
      </p>
    </section>
  );
}

export function FinancialWorkspace({
  reply,
  batch,
  close,
  review,
}: {
  reply: AgentReply;
  batch?: Batch;
  close: () => void;
  review: () => void;
}) {
  const savings = SavingsPresentationSchema.safeParse(reply.savings),
    financial = FinancialPresentationSchema.safeParse(reply.presentation),
    payments = PaymentPresentationSchema.safeParse(reply.payments);
  const authorizedFinancial =
    financial.success &&
    financial.data.results.every((r) => reply.citations.includes(r.resultId));
  return (
    <aside
      id="agus-context-workspace"
      className="agus-context-workspace"
      aria-label="Financial workspace"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <header>
        <div>
          <span>YOUR WORKSPACE</span>
          <h2>
            In focus<span>.</span>
          </h2>
        </div>
        <button
          className="agus-icon-button"
          type="button"
          aria-label="Close financial workspace"
          onClick={close}
        >
          <X size={18} />
        </button>
      </header>
      <p className="agus-context-intro">The details behind your next move.</p>
      {savings.success ? (
        <SavingsPlan plan={savings.data} compact />
      ) : batch ? (
        <section className="agus-focus-payment">
          <span className="agus-panel-eyebrow">
            <Wallet size={15} />{" "}
            {batch.mode === "fixture" ? "FICTIONAL PAYMENT" : "PAYMENT"}
          </span>
          <h3>
            {money(batch.payments.reduce((n, p) => n + p.amountKobo, 0) / 100)}
          </h3>
          <p>
            {batch.payments.length} recipients ·{" "}
            {batch.status.replaceAll("_", " ")}
          </p>
          {batch.payments.map((p) => (
            <div key={p.id}>
              <strong>{p.verifiedName ?? p.name}</strong>
              <span>{money(p.amountKobo / 100)}</span>
              <small>{p.status.replaceAll("_", " ")}</small>
            </div>
          ))}
          <button type="button" onClick={review}>
            Review payment controls <ArrowUpRight size={15} />
          </button>
          <small>
            {batch.mode === "fixture"
              ? "Simulation only. No real money moves."
              : "Review and authorize separately."}
          </small>
        </section>
      ) : payments.success ? (
        <section className="agus-focus-payment">
          <span className="agus-panel-eyebrow">RECORDED OUTCOMES</span>
          {payments.data.records.map((p) => (
            <div key={p.paymentId}>
              <strong>{p.verifiedName ?? p.label}</strong>
              <span>{money(p.amountKobo / 100)}</span>
              <small>{p.status.replaceAll("_", " ")}</small>
            </div>
          ))}
          <p>
            Checked {date(payments.data.asOf)}. Source status does not establish
            recipient credit.
          </p>
        </section>
      ) : financial.success && authorizedFinancial ? (
        <>
          {financial.data.results.map((r) => (
            <section className="agus-focus-source" key={r.resultId}>
              <span className="agus-panel-eyebrow">
                {r.type === "get_account_summary"
                  ? "ACCOUNT SNAPSHOT"
                  : "SOURCE RECORDS"}
              </span>
              {r.balanceUnavailable && (
                <p className="agus-plan-assumption">
                  {balanceUnavailableText(r.balanceUnavailable)}
                </p>
              )}
              {!r.balanceUnavailable &&
                r.metrics.map((m) => (
                  <div key={m.label}>
                    <span>{m.label}</span>
                    <strong>{m.value}</strong>
                  </div>
                ))}
              {r.records.slice(0, 3).map((record, i) => (
                <div key={i}>
                  <strong>{record.name}</strong>
                  <span>
                    {record.amount} · {record.status}
                  </span>
                </div>
              ))}
              {r.records.length > 3 && (
                <p className="agus-plan-assumption">
                  First three matches shown. Inspect the reply for the full
                  authorized result.
                </p>
              )}
              {!["complete", "not supplied"].includes(r.coverage) && (
                <p className="agus-plan-assumption">
                  Coverage is {r.coverage}. Inspect the source limitations in
                  the reply.
                </p>
              )}
              <small>
                Checked {date(r.asOf)} ·{" "}
                {r.sources.some((s) => s.mode === "fixture")
                  ? "Fictional records"
                  : "Source records"}
              </small>
            </section>
          ))}
        </>
      ) : null}
      <div className="agus-context-footnote">
        <span />
        <p>
          Source details stay with the conversation. Payment approval and
          submission are always separate.
        </p>
      </div>
    </aside>
  );
}
