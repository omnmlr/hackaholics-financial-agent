import { isIssuerAddress } from "../pollar/network";
import { randomUUID, createHash } from "node:crypto";
import {
  TransactionBuilder,
  Transaction,
  Networks,
} from "@stellar/stellar-base";
import { AppError } from "../domain";
import { reauthenticate } from "../auth";
import { redactAgentText } from "../personal-agent/privacy";
import { instructionHash } from "../../server/approvals";
import { transaction, type Sql } from "../../server/sql";
import { initializeProduct } from "./service";
import { atomic } from "./contracts";
import {
  pollarConfiguration,
  stellarAddress,
  zcashTestnetAddress,
  zcashUri,
  readStellarTestnet,
} from "./rails";
import {
  IntentInput,
  PaymentFields,
  interpretPaymentIntent,
  type PaymentPlan,
} from "./payment-contracts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export function paymentDigest(plan: PaymentPlan) {
  return instructionHash({
    id: plan.id,
    owner: plan.owner,
    recipientLabel: plan.recipientLabel,
    recipientAddress: plan.recipientAddress,
    asset: plan.asset,
    amount: plan.amount,
    privacy: plan.privacy,
    rail: plan.rail,
    network: plan.network,
    memo: plan.memo,
    maxFeeStroops: plan.maxFeeStroops,
    quote: plan.quote ?? null,
    invoiceId: plan.invoiceId ?? null,
  });
}
function present(plan: PaymentPlan): PaymentPlan {
  const result = { ...plan, reviewDigest: paymentDigest(plan) };
  if (
    ![
      "confirmed",
      "failed",
      "cancelled",
      "submitting",
      "pending",
      "unknown",
    ].includes(plan.state) &&
    Date.parse(plan.expiresAt) <= Date.now()
  )
    result.state = "expired";
  if (result.approval)
    result.approval = { ...result.approval, nonceHash: "withheld" };
  return result;
}
async function get(
  sql: Sql,
  owner: string,
  id: string,
  lock = false,
): Promise<PaymentPlan> {
  const rows = await sql.query(
    "SELECT payload FROM agus_web_payment_plans WHERE owner=$1 AND id=$2" +
      (lock ? " FOR UPDATE" : ""),
    [owner, id],
  );
  if (!rows.rows.length) throw new AppError("Payment review not found", 404);
  return rows.rows[0].payload;
}
async function save(sql: Sql, plan: PaymentPlan) {
  await sql.query(
    "UPDATE agus_web_payment_plans SET payload=$3::jsonb WHERE owner=$1 AND id=$2",
    [plan.owner, plan.id, JSON.stringify(plan)],
  );
}
async function event(sql: Sql, plan: PaymentPlan, kind: string) {
  // No counterparty, address, memo or amount enters the general activity log.
  const payload = {
    id: randomUUID(),
    at: new Date().toISOString(),
    kind,
    text: `${plan.privacy ? "Private" : "Standard"} testnet payment: ${plan.state.replaceAll("_", " ")}.`,
    paymentPlanId: plan.id,
  };
  await sql.query(
    "INSERT INTO agus_web_events(owner,id,payload) VALUES($1,$2,$3::jsonb)",
    [plan.owner, payload.id, JSON.stringify(payload)],
  );
}
function assess(plan: PaymentPlan) {
  const blockers: string[] = [];
  plan.rail =
    plan.asset === "USDC"
      ? "pollar-stellar"
      : plan.asset === "ZEC"
        ? "zcash"
        : null;
  if (!plan.asset)
    blockers.push(
      "Choose the exact asset. No currency or network will be substituted.",
    );
  else if (!plan.rail)
    blockers.push(
      plan.privacy && plan.asset === "BTC"
        ? "Zcash shields ZEC on Zcash. It does not make a BTC payout private. Choose a supported ZEC payment explicitly; no swap or bridge will be performed."
        : `${plan.asset} is not a supported payment asset in this testnet web flow. No currency conversion will be performed.`,
    );
  if (plan.privacy && plan.asset === "USDC")
    blockers.push(
      "Pollar USDC payments are visible on Stellar. For a shielded payment, explicitly choose ZEC and a shielded Zcash recipient. No private-USDC pathway is claimed.",
    );
  if (!plan.recipientLabel) blockers.push("Who should receive this payment?");
  let validAmount = false;
  if (plan.amount && (plan.asset === "USDC" || plan.asset === "ZEC")) {
    try {
      validAmount = atomic(plan.amount, plan.asset === "ZEC" ? 8 : 7) > 0n;
    } catch {
      /* detail required */
    }
  }
  if (!validAmount)
    blockers.push(
      "Enter a positive amount with the asset’s supported decimal precision.",
    );
  if (!plan.recipientAddress)
    blockers.push(
      "Add the recipient’s exact testnet address in the trusted review. A name alone never resolves a wallet.",
    );
  else if (
    plan.rail === "pollar-stellar" &&
    !stellarAddress(plan.recipientAddress)
  )
    blockers.push("Use a valid Stellar G-address for this recipient.");
  else if (plan.rail === "zcash" && !zcashTestnetAddress(plan.recipientAddress))
    blockers.push(
      "Use a shielded Sapling testnet receiving address (ztestsapling…).",
    );
  if (
    plan.rail === "pollar-stellar" &&
    plan.recipientAddress &&
    isIssuerAddress(plan.recipientAddress ?? "", pollarConfiguration().issuer)
  )
    blockers.push(
      "This is the USDC issuer address, not your recipient’s wallet. Choose a separate controlled recipient account with the required USDC trustline.",
    );
  if (plan.rail === "pollar-stellar" && !pollarConfiguration().configured)
    blockers.push(
      "Pollar onboarding and signing need this app’s publishable Stellar testnet key and exact USDC issuer.",
    );
  if (plan.rail === "zcash") {
    blockers.push(
      "Shielded sending is unavailable: an authorized Zcash sender-wallet adapter, funded shielded testnet balance, fee quote and signing policy have not been integrated. A request URI alone cannot enforce a shielded source or prove execution.",
    );
    if (
      plan.recipientAddress &&
      zcashTestnetAddress(plan.recipientAddress) &&
      validAmount
    )
      plan.walletRequest = zcashUri(
        plan.recipientAddress,
        plan.amount!,
        plan.memo,
      );
  }
  plan.blockers = blockers;
  plan.state = blockers.length
    ? !plan.recipientLabel || !validAmount || !plan.recipientAddress
      ? "needs_details"
      : "blocked"
    : "ready_for_quote";
}

export async function preparePaymentIntent(
  owner: string,
  raw: unknown,
  interpretation: PaymentPlan["interpretation"] = "local-intent-parser",
) {
  const input = IntentInput.parse(raw);
  await initializeProduct();
  return transaction(async (sql) => {
    const existing = await sql.query(
      "SELECT payload FROM agus_web_payment_plans WHERE owner=$1 AND id=$2",
      [owner, input.id],
    );
    const cleanedIntent = redactAgentText(input.text);
    if (existing.rows.length) {
      const saved: PaymentPlan = existing.rows[0].payload;
      if (
        saved.originalIntent !== cleanedIntent ||
        saved.privacy !==
          (input.privacyMode ||
            /\b(?:private|privately|shielded|privacy)\b/i.test(input.text))
      )
        throw new AppError(
          "Request identity already used for a different payment intent.",
          409,
        );
      return present(saved);
    }
    const extracted = interpretPaymentIntent(input.text, input.privacyMode);
    const plan: PaymentPlan = {
      id: input.id,
      owner,
      interpretation,
      originalIntent: cleanedIntent,
      ...extracted,
      recipientAddress: null,
      resolution: "unresolved",
      rail: null,
      network: "testnet",
      memo: `AGUS-${input.id.replaceAll("-", "").slice(0, 20)}`,
      state: "needs_details",
      blockers: [],
      maxFeeStroops: "100000",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    if (plan.recipientLabel && plan.asset) {
      const contacts = await sql.query(
        "SELECT address FROM agus_web_contacts WHERE owner=$1 AND lower(label)=lower($2) AND asset=$3 AND network='testnet'",
        [owner, plan.recipientLabel, plan.asset],
      );
      if (contacts.rows.length === 1) {
        plan.recipientAddress = contacts.rows[0].address;
        plan.resolution = "saved-contact";
      }
    }
    assess(plan);
    if (extracted.mainnetRequested) {
      plan.state = "blocked";
      plan.blockers = [
        "Mainnet execution is disabled. This review cannot authorize real-money payments.",
      ];
    }
    await sql.query(
      "INSERT INTO agus_web_payment_plans(owner,id,payload) VALUES($1,$2,$3::jsonb)",
      [owner, plan.id, JSON.stringify(plan)],
    );
    await event(sql, plan, "payment.intent_prepared");
    return present(plan);
  });
}
export async function getPaymentPlan(owner: string, id: string) {
  return present(await get(await initializeProduct(), owner, id));
}
export async function listPaymentPlans(owner: string) {
  const rows = await (
    await initializeProduct()
  ).query(
    "SELECT payload FROM agus_web_payment_plans WHERE owner=$1 ORDER BY created_at DESC LIMIT 100",
    [owner],
  );
  return rows.rows.map((row) => present(row.payload));
}
export async function updatePaymentPlan(
  owner: string,
  id: string,
  raw: unknown,
) {
  const input = PaymentFields.parse(raw);
  await initializeProduct();
  return transaction(async (sql) => {
    const plan = await get(sql, owner, id, true);
    if (
      [
        "submitting",
        "pending",
        "confirmed",
        "unknown",
        "failed",
        "cancelled",
      ].includes(plan.state)
    )
      throw new AppError(
        "This payment has already been submitted or closed. Create a new review for new instructions.",
        409,
      );
    if (Date.parse(plan.expiresAt) <= Date.now())
      throw new AppError(
        "This payment review expired. Describe the payment again.",
        409,
      );
    Object.assign(plan, {
      recipientLabel: input.recipientLabel,
      recipientAddress: input.recipientAddress || null,
      amount: input.amount || null,
      asset: input.asset.toUpperCase(),
      privacy: input.privacy,
      resolution: "user-entered",
      invoiceId: input.invoiceId,
    });
    delete plan.quote;
    delete plan.approval;
    delete plan.walletRequest;
    assess(plan);
    if (input.invoiceId) {
      const rows = await sql.query(
        "SELECT payload FROM agus_web_invoices WHERE owner=$1 AND id=$2",
        [owner, input.invoiceId],
      );
      const invoice = rows.rows[0]?.payload;
      if (
        !invoice ||
        invoice.direction !== "payable" ||
        invoice.state !== "open" ||
        invoice.currency !== plan.asset ||
        !plan.amount ||
        atomic(invoice.amount, invoice.currency === "ZEC" ? 8 : 7) !==
          atomic(plan.amount, invoice.currency === "ZEC" ? 8 : 7)
      )
        throw new AppError(
          "The linked obligation must be your open payable in the exact asset and amount.",
          409,
        );
    }
    if (input.saveContact) {
      if (
        !plan.recipientAddress ||
        !(
          (plan.rail === "pollar-stellar" &&
            stellarAddress(plan.recipientAddress)) ||
          (plan.rail === "zcash" && zcashTestnetAddress(plan.recipientAddress))
        )
      )
        throw new AppError(
          "Enter a valid supported recipient address before saving the contact.",
        );
      const existing = await sql.query(
        "SELECT address FROM agus_web_contacts WHERE owner=$1 AND lower(label)=lower($2) AND asset=$3",
        [owner, plan.recipientLabel, plan.asset],
      );
      if (
        existing.rows.length &&
        existing.rows[0].address !== plan.recipientAddress
      )
        throw new AppError(
          "This saved name has a different address. Choose a distinct label; the existing contact was not overwritten.",
          409,
        );
      if (!existing.rows.length)
        await sql.query(
          "INSERT INTO agus_web_contacts(owner,id,label,asset,address,network) VALUES($1,$2,$3,$4,$5,'testnet')",
          [
            owner,
            randomUUID(),
            plan.recipientLabel,
            plan.asset,
            plan.recipientAddress,
          ],
        );
    }
    await save(sql, plan);
    await event(sql, plan, "payment.details_reviewed");
    return present(plan);
  });
}

/** Parse the exact SDK-built envelope server-side; no model fields authorize it. */
export function validateStellarEnvelope(
  plan: PaymentPlan,
  xdr: string,
  sourceAddress: string,
  now = Date.now(),
) {
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET);
  } catch {
    throw new AppError("The Pollar transaction envelope could not be read.");
  }
  if (
    !(tx instanceof Transaction) ||
    tx.operations.length !== 1 ||
    tx.memo.type !== "text" ||
    (Buffer.isBuffer(tx.memo.value)
      ? tx.memo.value.toString("utf8")
      : tx.memo.value) !== plan.memo
  )
    throw new AppError(
      "Only the exact reviewed single-payment Stellar envelope is supported.",
      409,
    );
  const op = tx.operations[0];
  const issuer = pollarConfiguration().issuer;
  if (
    op.type !== "payment" ||
    op.destination !== plan.recipientAddress ||
    isIssuerAddress(op.destination, issuer) ||
    op.asset.isNative() ||
    op.asset.getCode() !== "USDC" ||
    op.asset.getIssuer() !== issuer ||
    atomic(op.amount, 7) !== atomic(plan.amount!, 7) ||
    (op.source ?? tx.source) !== sourceAddress ||
    !stellarAddress(sourceAddress)
  )
    throw new AppError(
      "The built transaction does not match the exact recipient, asset, issuer, amount and source wallet.",
      409,
    );
  if (!/^\d+$/.test(tx.fee) || BigInt(tx.fee) > BigInt(plan.maxFeeStroops))
    throw new AppError(
      "The built transaction exceeds your 0.01 XLM fee cap.",
      409,
    );
  const maxTime = Number(tx.timeBounds?.maxTime ?? "0");
  if (
    !Number.isSafeInteger(maxTime) ||
    maxTime <= now / 1000 ||
    maxTime * 1000 > Math.min(Date.parse(plan.expiresAt), now + 360000)
  )
    throw new AppError(
      "The provider transaction needs a valid expiry within six minutes.",
      409,
    );
  return {
    transactionHash: tx.hash().toString("hex"),
    feeStroops: tx.fee,
    sourceAddress,
    expiresAt: new Date(Math.min(maxTime * 1000, now + 300000)).toISOString(),
  };
}
export async function quotePaymentPlan(
  owner: string,
  id: string,
  xdr: string,
  sourceAddress: string,
) {
  await initializeProduct();
  return transaction(async (sql) => {
    const plan = await get(sql, owner, id, true);
    if (
      plan.rail !== "pollar-stellar" ||
      plan.privacy ||
      !["ready_for_quote", "review", "approved"].includes(plan.state) ||
      !pollarConfiguration().configured
    )
      throw new AppError(
        "Complete a supported standard testnet payment before requesting its quote.",
        409,
      );
    if (xdr.length > 16000)
      throw new AppError("Transaction envelope too large", 413);
    const quote = validateStellarEnvelope(plan, xdr, sourceAddress);
    plan.quote = {
      ...quote,
      unsignedXdr: xdr,
      source: "pollar-sdk-built-transaction",
      observedAt: new Date().toISOString(),
    };
    plan.state = "review";
    plan.blockers = [];
    delete plan.approval;
    await save(sql, plan);
    return present(plan);
  });
}
export async function approvePaymentPlan(
  owner: string,
  id: string,
  digest: string,
  password: string,
) {
  await initializeProduct();
  await reauthenticate(owner, password);
  return transaction(async (sql) => {
    const plan = await get(sql, owner, id, true);
    if (
      !["review", "approved"].includes(plan.state) ||
      !plan.quote ||
      plan.privacy ||
      plan.rail !== "pollar-stellar" ||
      plan.blockers.length ||
      paymentDigest(plan) !== digest ||
      Date.parse(plan.quote.expiresAt) <= Date.now()
    )
      throw new AppError(
        "The exact payment review changed, expired or is not executable. Refresh the quote before approval.",
        409,
      );
    validateStellarEnvelope(
      plan,
      plan.quote.unsignedXdr,
      plan.quote.sourceAddress,
    );
    const nonce = randomUUID();
    plan.approval = {
      digest,
      nonceHash: sha(nonce),
      expiresAt: new Date(
        Math.min(Date.now() + 120000, Date.parse(plan.quote.expiresAt)),
      ).toISOString(),
    };
    plan.state = "approved";
    await save(sql, plan);
    await event(sql, plan, "payment.owner_approved");
    return { plan: present(plan), nonce };
  });
}
export async function claimPaymentSubmission(
  owner: string,
  id: string,
  nonce: string,
) {
  await initializeProduct();
  return transaction(async (sql) => {
    const plan = await get(sql, owner, id, true);
    if (
      plan.state !== "approved" ||
      !plan.quote ||
      !plan.approval ||
      plan.approval.consumedAt ||
      plan.approval.nonceHash !== sha(nonce) ||
      Date.parse(plan.approval.expiresAt) <= Date.now() ||
      plan.approval.digest !== paymentDigest(plan)
    )
      throw new AppError(
        "Approval is invalid, consumed or expired. No further send is authorized.",
        403,
      );
    validateStellarEnvelope(
      plan,
      plan.quote.unsignedXdr,
      plan.quote.sourceAddress,
    );
    plan.approval.consumedAt = new Date().toISOString();
    plan.state = "submitting";
    await save(sql, plan);
    await event(sql, plan, "payment.wallet_signing_authorized");
    return {
      unsignedXdr: plan.quote.unsignedXdr,
      sourceAddress: plan.quote.sourceAddress,
      transactionHash: plan.quote.transactionHash,
    };
  });
}
export async function recordWalletOutcome(
  owner: string,
  id: string,
  status: "pending" | "failed" | "unknown",
  transactionId?: string,
) {
  await initializeProduct();
  return transaction(async (sql) => {
    const plan = await get(sql, owner, id, true);
    if (plan.state === "confirmed") return present(plan);
    if (!["submitting", "pending", "unknown"].includes(plan.state))
      throw new AppError("No authorized wallet operation is in progress.", 409);
    if (
      transactionId &&
      transactionId.toLowerCase() !== plan.quote?.transactionHash
    )
      throw new AppError(
        "The wallet returned a different transaction. Keep it for manual review; no settlement was recorded.",
        409,
      );
    // Provider-reported errors can still hide an accepted send. Never make it retryable.
    plan.state = status === "failed" ? "unknown" : status;
    plan.candidateTransactionId = transactionId ?? plan.quote?.transactionHash;
    plan.lastCheck =
      "Wallet-reported outcome only. Independent settlement verification is required; no automatic retry.";
    await save(sql, plan);
    await event(sql, plan, "payment.wallet_outcome");
    return present(plan);
  });
}
export async function verifyOutgoingPayment(owner: string, id: string) {
  const sql = await initializeProduct();
  const before = await get(sql, owner, id);
  if (before.state === "confirmed") return present(before);
  if (
    !["submitting", "pending", "unknown"].includes(before.state) ||
    !before.quote ||
    !before.approval?.consumedAt
  )
    throw new AppError(
      "An authorized wallet send must precede settlement verification.",
      409,
    );
  const hash = before.quote.transactionHash;
  const tx = await readStellarTestnet(`/transactions/${hash}`);
  if (
    tx.hash !== hash ||
    !Number.isInteger(tx.ledger) ||
    !/^\d+$/.test(String(tx.fee_charged)) ||
    BigInt(tx.fee_charged) > BigInt(before.maxFeeStroops)
  )
    throw new AppError(
      "The network receipt does not match the approved transaction or fee cap.",
      409,
    );
  if (tx.successful !== true) {
    return transaction(async (client) => {
      const plan = await get(client, owner, id, true);
      if (plan.state !== "confirmed") {
        plan.state = "failed";
        plan.lastCheck =
          "Stellar testnet confirms the approved transaction failed. The obligation remains open; network fees may still apply.";
        await save(client, plan);
        await event(client, plan, "payment.network_failed");
      }
      return present(plan);
    });
  }
  const verified = validateStellarEnvelope(
    before,
    before.quote.unsignedXdr,
    before.quote.sourceAddress,
    Date.parse(before.quote.observedAt),
  );
  // A signed Stellar transaction's hash binds all the approved instructions.
  if (
    verified.transactionHash !== tx.hash ||
    tx.memo_type !== "text" ||
    tx.memo !== before.memo ||
    Date.parse(tx.created_at) < Date.parse(before.quote.observedAt) - 60000 ||
    Date.parse(tx.created_at) > Date.parse(verified.expiresAt)
  )
    throw new AppError(
      "The confirmed transaction does not match the approved memo or time window.",
      409,
    );
  return transaction(async (client) => {
    const plan = await get(client, owner, id, true);
    if (plan.state === "confirmed") return present(plan);
    const used = await client.query(
      "SELECT id FROM agus_web_payment_plans WHERE payload->>'state'='confirmed' AND payload->'evidence'->>'transactionId'=$1",
      [hash],
    );
    if (used.rows.length)
      throw new AppError(
        "This transaction already belongs to another confirmed payment.",
        409,
      );
    plan.state = "confirmed";
    plan.evidence = {
      source: "stellar-horizon-testnet",
      transactionId: hash,
      ledger: tx.ledger,
      feeStroops: String(tx.fee_charged),
      confirmedAt: tx.created_at,
      observedAt: new Date().toISOString(),
    };
    if (plan.invoiceId) {
      const rows = await client.query(
        "SELECT payload FROM agus_web_invoices WHERE owner=$1 AND id=$2 FOR UPDATE",
        [owner, plan.invoiceId],
      );
      const invoice = rows.rows[0]?.payload;
      if (
        !invoice ||
        invoice.state !== "open" ||
        invoice.direction !== "payable" ||
        invoice.currency !== plan.asset ||
        atomic(invoice.amount, 7) !== atomic(plan.amount!, 7)
      ) {
        plan.lastCheck =
          "Payment confirmed, but the linked obligation changed. Its responsibility was not updated; review the receipt separately.";
      } else {
        invoice.state = "settled";
        invoice.settledAt = plan.evidence.observedAt;
        invoice.settlementRequestId = plan.id;
        await client.query(
          "UPDATE agus_web_invoices SET payload=$3::jsonb WHERE owner=$1 AND id=$2",
          [owner, invoice.id, JSON.stringify(invoice)],
        );
        await client.query(
          "UPDATE agus2_tasks SET state='completed',version=version+1,payload=jsonb_set(jsonb_set(payload,'{state}','\"completed\"'::jsonb),'{version}',to_jsonb(version+1)) WHERE owner=$1 AND id=$2 AND state<>'cancelled'",
          [owner, invoice.responsibilityId],
        );
      }
    }
    await save(client, plan);
    await event(client, plan, "payment.network_confirmed");
    return present(plan);
  });
}
