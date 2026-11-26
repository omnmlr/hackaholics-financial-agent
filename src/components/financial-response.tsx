import type { AgentReply } from "@/lib/financial-agent";
import {
  FinancialPresentationSchema,
  PaymentPresentationSchema,
  SavingsPresentationSchema,
} from "@/lib/financial-agent/presentation";
import { SavingsPlan, balanceUnavailableText } from "./financial-workspace";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChartNoAxesCombined,
  FileSearch,
  ShieldCheck,
} from "lucide-react";
const resultTitles = {
  calculate_spending: "Your spending, in focus",
  search_transactions: "Transaction matches",
  get_transaction: "Transaction details",
  find_payment_evidence: "Payment evidence",
  get_account_summary: "Account overview",
};
function Cashflow({
  metrics,
}: {
  metrics: { label: string; value: string }[];
}) {
  if (metrics.slice(0, 2).some((metric) => metric.value === "Unavailable"))
    return null;
  const values = metrics
    .slice(0, 2)
    .map((m) => Math.abs(Number(m.value.replace(/[^\d.-]/g, ""))));
  const largest = Math.max(...values);
  if (!values.every(Number.isFinite) || !largest) return null;
  return (
    <div className="agus-cashflow" aria-hidden="true">
      {metrics.slice(0, 2).map((metric, i) => (
        <div key={metric.label}>
          <span>{metric.label}</span>
          <div>
            <i style={{ width: `${(values[i] / largest) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
const date = (value: string, time = false) =>
  new Date(value).toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
export function FinancialResponse({
  reply,
  choose,
  workspaceOpen = false,
}: {
  reply: AgentReply;
  choose: (text: string) => void;
  workspaceOpen?: boolean;
}) {
  const savings = SavingsPresentationSchema.safeParse(reply.savings);
  const payment = PaymentPresentationSchema.safeParse(reply.payments);
  if (payment.success)
    return (
      <>
        <div className="agus-prose">
          {reply.text.split(/\n\n/).map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </div>
        <section
          className="agus-payment-status-result"
          aria-label="Saved payment status"
        >
          <p className="agus-scope">
            {payment.data.scope} · Checked {date(payment.data.asOf, true)} WAT
          </p>
          {payment.data.records.map((p) => (
            <div className="agus-status-record" key={p.paymentId}>
              <strong>{p.verifiedName ?? p.label}</strong>
              <span>{p.status.replaceAll("_", " ")}</span>
              <b>
                {new Intl.NumberFormat("en-NG", {
                  style: "currency",
                  currency: "NGN",
                }).format(p.amountKobo / 100)}
              </b>
              <code className="agus-safe-reference">{p.reference}</code>
              {p.canConfirm && (
                <a
                  href={`/api/batches/${p.batchId}/confirmation?payment=${encodeURIComponent(p.paymentId)}`}
                >
                  Download SIMULATED confirmation
                </a>
              )}
            </div>
          ))}
          <small>
            Saved response reflects the check time above. Ask again for the
            current recorded state.
          </small>
        </section>
      </>
    );
  const parsed = FinancialPresentationSchema.safeParse(reply.presentation);
  const presentation =
    parsed.success &&
    parsed.data.results.every((r) => reply.citations.includes(r.resultId))
      ? parsed.data
      : null;
  if (!presentation)
    return (
      <>
        <div className="agus-prose">
          {reply.text.split(/\n+/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>
        {savings.success && !workspaceOpen && (
          <SavingsPlan plan={savings.data} />
        )}
      </>
    );
  const sources = new Set(
    presentation.results.flatMap((r) =>
      r.sources.map((s) => `${s.provider}/${s.mode}`),
    ),
  );
  return (
    <>
      <div className="agus-prose">
        {presentation.explanation
          .flatMap((p) => p.split(/\n\s*\n/))
          .map((p, i) => (
            <p key={i}>{p}</p>
          ))}
      </div>
      {savings.success && !workspaceOpen && <SavingsPlan plan={savings.data} />}
      {presentation.narration === "factual_fallback" && !reply.savings && (
        <p className="agus-fallback">Verified source summary</p>
      )}
      {[...new Set(presentation.results.flatMap((r) => r.limits))]
        .filter(
          (limit) => !presentation.explanation.some((p) => p.includes(limit)),
        )
        .map((limit) => (
          <p className="agus-answer-limit" key={limit}>
            {limit}
          </p>
        ))}
      {presentation.results
        .filter((r) => !(savings.success && r.type === "get_account_summary"))
        .map((r) => (
          <section
            className="agus-result"
            key={r.resultId}
            aria-label="Financial result"
          >
            <div className="agus-result-header">
              <span>
                {r.type === "calculate_spending" ? (
                  <ChartNoAxesCombined size={16} />
                ) : (
                  <FileSearch size={16} />
                )}
                {resultTitles[r.type]}
              </span>
              <small>
                <ShieldCheck size={11} />{" "}
                {r.sources.some((s) => /fixture|demo|fictional/i.test(s.mode))
                  ? "Fictional records"
                  : "Source records"}
              </small>
            </div>
            {r.balanceUnavailable && (
              <p className="agus-balance-empty">
                {balanceUnavailableText(r.balanceUnavailable)}
              </p>
            )}
            {r.metrics.length > 0 &&
              !savings.success &&
              !r.balanceUnavailable && (
                <dl className="agus-totals" aria-label="Financial totals">
                  {r.metrics.map((m) => (
                    <div key={m.label}>
                      <dt>{m.label}</dt>
                      <dd>{m.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            {r.type === "calculate_spending" && (
              <Cashflow metrics={r.metrics} />
            )}
            <p className="agus-scope">{r.scope}</p>
            {r.records.map((record, i) => (
              <section className="agus-record" key={i}>
                <div className="agus-record-heading">
                  <span
                    className={`agus-record-direction ${record.direction}`}
                    aria-hidden="true"
                  >
                    {record.direction === "debit" ? (
                      <ArrowUpRight size={16} />
                    ) : (
                      <ArrowDownLeft size={16} />
                    )}
                  </span>
                  <div>
                    <h3>{record.name}</h3>
                    <small>
                      {record.direction === "debit" ? "Money out" : "Money in"}
                    </small>
                  </div>
                  <strong>{record.amount}</strong>
                </div>
                <p>
                  {record.date ? date(record.date) : "Date unavailable"} ·{" "}
                  {record.status === "posted"
                    ? "Posted in source records"
                    : `Source status: ${record.status}`}
                </p>
                <p>{record.account}</p>
                {record.choice && (
                  <button
                    className="agus-secondary"
                    onClick={() => choose(record.choice!)}
                  >
                    Show {record.name} · {record.amount}
                    {record.date ? ` · ${date(record.date)}` : ""}
                  </button>
                )}
              </section>
            ))}
          </section>
        ))}
      <details className="agus-sources">
        <summary>
          Sources and calculation · {sources.size}{" "}
          {sources.size === 1 ? "source" : "sources"}
        </summary>
        {presentation.results.map((r) => (
          <section key={r.resultId}>
            <h3>Source snapshot</h3>
            <p>
              {r.sources.some((s) => s.mode === "fixture")
                ? "Fictional demo records"
                : "Authorized source records"}
            </p>
            <p>
              As of {date(r.asOf, true)} WAT · Coverage {r.coverage}
            </p>
            <details className="agus-technical-sources">
              <summary>Technical references</summary>
              <p>Result reference: {r.resultId}</p>
              <p>
                {r.sources.map((s) => `${s.provider}/${s.mode}`).join(", ")}
              </p>
              <pre>{r.originalText}</pre>
            </details>
          </section>
        ))}
      </details>
    </>
  );
}
