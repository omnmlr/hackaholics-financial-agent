"use client";
import { useLayoutEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  CheckCheck,
  Clock3,
  Download,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type { PaymentPlan } from "@/lib/web-product/payment-contracts";
import type { ProductSnapshot } from "@/lib/web-product/contracts";
import { productApi } from "./api";
import { PollarWallet } from "./pollar-wallet";
import s from "./workspace.module.css";

export function PaymentReview({
  plan,
  snapshot,
  onChange,
}: {
  plan: PaymentPlan;
  snapshot: ProductSnapshot;
  onChange: (plan: PaymentPlan) => void;
}) {
  const [editing, setEditing] = useState(plan.state === "needs_details");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState<string>();
  const [password, setPassword] = useState("");
  const [privacy, setPrivacy] = useState(plan.privacy);
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    root.current?.closest("dialog")?.scrollTo({ top: 0 });
  }, [editing, plan.state]);
  async function verify() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onChange(
        await productApi<PaymentPlan>(
          `product/payment-plans/${plan.id}/verify`,
          { acknowledged: true },
        ),
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Settlement is not verified. No further send is authorized.",
      );
    } finally {
      setBusy(false);
    }
  }
  const canEdit = [
    "needs_details",
    "blocked",
    "ready_for_quote",
    "review",
    "approved",
  ].includes(plan.state);
  return (
    <div className={s.detail} ref={root}>
      <div className={s.detailAmount}>
        <span>{plan.recipientLabel || "Recipient needed"}</span>
        <strong>
          {plan.amount ?? "—"} {plan.asset ?? "Asset needed"}
        </strong>
        <span className={s.pill}>
          {plan.privacy ? (
            <ShieldCheck size={13} />
          ) : (
            <ArrowUpRight size={13} />
          )}
          {plan.privacy ? "Private payment" : "Standard payment"} · testnet
        </span>
      </div>
      {editing && canEdit ? (
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError("");
            try {
              const next = await productApi<PaymentPlan>(
                `product/payment-plans/${plan.id}/details`,
                {
                  recipientLabel: form.get("recipient"),
                  recipientAddress: String(form.get("address")).trim(),
                  amount: form.get("amount"),
                  asset: form.get("asset"),
                  privacy,
                  saveContact: form.get("saveContact") === "on",
                  ...(form.get("invoice")
                    ? { invoiceId: form.get("invoice") }
                    : {}),
                },
              );
              onChange(next);
              setNonce(undefined);
              setEditing(false);
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : "Payment details could not be saved.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Recipient name
            <input
              name="recipient"
              defaultValue={plan.recipientLabel}
              required
              maxLength={100}
              placeholder="e.g. Daniel"
            />
          </label>
          <div className={s.formGrid}>
            <label>
              Payment amount
              <input
                name="amount"
                defaultValue={plan.amount ?? ""}
                required
                inputMode="decimal"
                pattern="[0-9]+(\.[0-9]{1,8})?"
              />
            </label>
            <label>
              Payment asset
              <select
                name="asset"
                aria-label="Payment asset"
                defaultValue={plan.asset ?? "USDC"}
              >
                <option value="USDC">USDC · Stellar testnet</option>
                <option value="ZEC">ZEC · Zcash testnet</option>
                {plan.asset && !["USDC", "ZEC"].includes(plan.asset) && (
                  <option value={plan.asset}>{plan.asset} · unsupported</option>
                )}
              </select>
            </label>
          </div>
          <label>
            Exact recipient address
            <textarea
              name="address"
              defaultValue={plan.recipientAddress ?? ""}
              rows={3}
              maxLength={300}
              required
              placeholder="The recipient’s supported testnet address"
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label className={s.checkbox}>
            <input
              type="checkbox"
              checked={privacy}
              onChange={(e) => setPrivacy(e.target.checked)}
            />{" "}
            Private payment · shielded Zcash only.
          </label>
          <label className={s.checkbox}>
            <input type="checkbox" name="saveContact" /> Save this name and
            address as a contact.
          </label>
          <label>
            Link an existing obligation{" "}
            <small>Optional · exact payable asset and amount must match</small>
            <select
              name="invoice"
              aria-label="Linked obligation"
              defaultValue={plan.invoiceId ?? ""}
            >
              <option value="">No linked obligation</option>
              {snapshot.invoices
                .filter((i) => i.direction === "payable" && i.state === "open")
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.title} · {i.amount} {i.currency}
                  </option>
                ))}
            </select>
          </label>
          <label className={s.checkbox}>
            <input type="checkbox" required /> I checked the recipient address.
            This is a Testnet payment.
          </label>
          <button className={s.primary} disabled={busy}>
            {busy ? (
              <Loader2 size={16} className={s.spin} />
            ) : (
              <ShieldCheck size={16} />
            )}{" "}
            Continue
          </button>
        </form>
      ) : (
        <>
          <dl className={s.definition}>
            <div>
              <dt>Recipient</dt>
              <dd>{plan.recipientLabel || "Not supplied"}</dd>
            </div>
            <div>
              <dt>Address</dt>
              <dd>
                <code>
                  {plan.recipientAddress ??
                    "Enter the exact address in this review"}
                </code>
              </dd>
            </div>
            <div>
              <dt>Resolution</dt>
              <dd>
                {plan.resolution === "saved-contact"
                  ? "Your saved contact · verify the address"
                  : plan.resolution === "user-entered"
                    ? "You entered this address"
                    : "Unresolved · never inferred from a name"}
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>
                {plan.rail === "pollar-stellar"
                  ? "Pollar · Stellar testnet"
                  : plan.rail === "zcash"
                    ? "Zcash · shielded testnet target"
                    : "Unsupported / not yet selected"}
              </dd>
            </div>
            <div>
              <dt>State</dt>
              <dd>{plan.state.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Fee quote</dt>
              <dd>
                {plan.quote
                  ? `${Number(plan.quote.feeStroops) / 10000000} XLM · network fee`
                  : "Not quoted yet"}
              </dd>
            </div>
            <div>
              <dt>Fee cap</dt>
              <dd>
                {plan.rail === "pollar-stellar"
                  ? "0.01 XLM maximum · not a fee estimate"
                  : "Unavailable · sending blocked"}
              </dd>
            </div>
            <div>
              <dt>Review expires</dt>
              <dd>
                {new Date(plan.expiresAt).toLocaleString("en-NG", {
                  timeZone: "Africa/Lagos",
                })}{" "}
                WAT
              </dd>
            </div>
          </dl>
          {canEdit && (
            <button
              className={s.secondary}
              onClick={() => {
                setEditing(true);
                setNonce(undefined);
              }}
            >
              Review / complete details <ArrowUpRight size={15} />
            </button>
          )}
        </>
      )}
      {plan.blockers.length > 0 && (
        <div className={s.blockers}>
          <h3>
            {plan.state === "needs_details"
              ? "A little more context is needed."
              : "This payment is blocked."}
          </h3>
          <ul>
            {plan.blockers.map((blocker) => (
              <li key={blocker}>
                {blocker.startsWith("Shielded sending is unavailable")
                  ? "Shielded sending is unavailable. A supported sender wallet must be connected before AGUS can obtain fees, authorize a shielded source or verify the outcome."
                  : blocker.startsWith("Pollar onboarding and signing need")
                    ? "Pollar wallet setup is incomplete. A publishable Stellar testnet application key and its USDC issuer are needed before this payment can continue."
                    : blocker}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.privacy && (
        <div className={s.privacyDisclosure}>
          <ShieldCheck size={17} />
          <div>
            <strong>What Privacy Mode protects</strong>
            <p>
              Recipient addresses, wallet balances, viewing keys, provider
              envelopes and payment history stay out of this chat’s model tools.
              The AI may see what you type, including a name and amount.
              Authorized owner records remain in AGUS. No anonymity or hidden
              BTC payout is claimed.
            </p>
          </div>
        </div>
      )}
      {plan.walletRequest && (
        <div className={s.notice}>
          <div>
            <strong>Shielded wallet request prepared</strong>
            <p>
              A ZIP 321 URI is available for a compatible wallet. Opening it
              does not prove a shielded source, approve AGUS execution, or
              record settlement.
            </p>
            <a className={s.textButton} href={plan.walletRequest}>
              Open request in compatible testnet wallet{" "}
              <ArrowUpRight size={14} />
            </a>
          </div>
        </div>
      )}
      {!editing &&
        plan.rail === "pollar-stellar" &&
        !plan.privacy &&
        ["ready_for_quote", "review", "approved"].includes(plan.state) && (
          <div className={s.paymentSigner}>
            <PollarWallet
              config={snapshot.capabilities.pollar}
              paymentPlan={plan}
              approvalNonce={nonce}
              onPlanChange={onChange}
              onError={setError}
            />
          </div>
        )}
      {!editing &&
        plan.quote &&
        ["review", "approved"].includes(plan.state) && (
          <form
            className={s.form}
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                const result = await productApi<{
                  plan: PaymentPlan;
                  nonce: string;
                }>(`product/payment-plans/${plan.id}/approve`, {
                  password,
                  reviewDigest: plan.reviewDigest,
                  acknowledged: true,
                });
                onChange(result.plan);
                setNonce(result.nonce);
                setPassword("");
              } catch (err) {
                setError(
                  err instanceof Error ? err.message : "Approval was rejected.",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <h3>Approve this exact operation</h3>
            <p className={s.fine}>
              Source: {plan.quote.sourceAddress}
              <br />
              The envelope binds the recipient, amount, issuer, memo, fee and
              expiry. Changing any instruction invalidates approval.
            </p>
            <label className={s.checkbox}>
              <input type="checkbox" required /> I approve {plan.amount}{" "}
              {plan.asset} to this exact address on Stellar testnet, with the
              displayed provider fee and a 0.01 XLM maximum. This approves one
              wallet signing attempt only.
            </label>
            <label>
              Re-enter operator password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={256}
                autoComplete="current-password"
              />
            </label>
            <button className={s.primary} disabled={busy}>
              {busy ? (
                <Loader2 className={s.spin} size={16} />
              ) : (
                <ShieldCheck size={16} />
              )}{" "}
              Approve exact test payment
            </button>
            {nonce && (
              <p role="status" className={s.notice}>
                Approved for this session. Use “Sign & send approved test
                payment” in the connected wallet panel above. Approval expires
                in at most two minutes.
              </p>
            )}
          </form>
        )}
      {["submitting", "pending", "unknown"].includes(plan.state) && (
        <div className={s.notice}>
          <Clock3 size={17} />
          <div>
            <strong>Do not send again.</strong>
            <p>
              {plan.lastCheck ??
                "Wallet signing was authorized. Its outcome may be uncertain until network verification completes."}
            </p>
            <button
              className={s.secondary}
              disabled={busy}
              onClick={() => void verify()}
            >
              {busy ? (
                <Loader2 size={15} className={s.spin} />
              ) : (
                <ShieldCheck size={15} />
              )}{" "}
              Check settlement
            </button>
          </div>
        </div>
      )}
      {plan.evidence && (
        <div className={s.receipt}>
          <CheckCheck size={25} />
          <h3>
            {plan.amount} {plan.asset} confirmed on testnet
          </h3>
          <p>
            Independent Stellar evidence · ledger {plan.evidence.ledger}
            <br />
            Actual charged fee: {Number(plan.evidence.feeStroops) /
              10000000}{" "}
            XLM.
          </p>
          <code>{plan.evidence.transactionId}</code>
          <p>
            {plan.lastCheck?.includes("linked obligation changed")
              ? plan.lastCheck
              : plan.invoiceId
                ? "The linked obligation was settled in the same database transaction."
                : "The outcome is saved durably. No unrelated responsibility was changed."}
          </p>
          <button
            className={s.secondary}
            onClick={() => {
              const receipt = {
                product: "AGUS",
                testnet: true,
                amount: plan.amount,
                asset: plan.asset,
                recipient: plan.recipientAddress,
                evidence: plan.evidence,
              };
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(receipt, null, 2)], {
                  type: "application/json",
                }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `agus-testnet-payment-${plan.id.slice(0, 8)}.json`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            <Download size={15} /> Download payment receipt
          </button>
        </div>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
