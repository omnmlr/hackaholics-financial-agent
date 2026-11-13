import { randomUUID, randomBytes, scryptSync } from "node:crypto";
import {
  Account,
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-base";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { login } from "../src/lib/auth";
import { createInvoice } from "../src/lib/web-product/service";
import { workspace } from "../src/lib/agent-workspace/store";
import { database } from "../src/server/sql";
import {
  preparePaymentIntent,
  getPaymentPlan,
  updatePaymentPlan,
  quotePaymentPlan,
  approvePaymentPlan,
  claimPaymentSubmission,
  recordWalletOutcome,
  verifyOutgoingPayment,
} from "../src/lib/web-product/conversational-payments";
import {
  interpretPaymentIntent,
  type PaymentPlan,
} from "../src/lib/web-product/payment-contracts";
import { POST } from "../src/app/api/product/[[...path]]/route";
import type { ToolModel } from "../src/lib/model-led-agent/model";
import { runPersonalConversation } from "../src/lib/personal-agent/conversation";
import { redactAgentText, modelData } from "../src/lib/personal-agent/privacy";
import { GET as runs, POST as control } from "../src/app/api/agent-runs/route";
const source = Keypair.random().publicKey(),
  recipient = Keypair.random().publicKey(),
  issuer = Keypair.random().publicKey();
const owner = "conversational-payment-owner",
  password = randomBytes(24).toString("hex");
let token = "";
beforeAll(async () => {
  const salt = randomBytes(16).toString("hex");
  Object.assign(process.env, {
    DATABASE_URL: "pglite://:memory:",
    PAYMENT_MODE: "fixture",
    AGUS_WORKSPACE_ENABLED: "true",
    AGUS_AGENT_ARCHITECTURE: "native-gemini",
    FINANCIAL_DEMO_ENABLED: "false",
    APP_ORIGIN: "http://localhost:3000",
    OPERATOR_ID: owner,
    OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    NEXT_PUBLIC_POLLAR_API_KEY: "pk_test_controlled",
    POLLAR_TESTNET_USDC_ISSUER: issuer,
    AI_PROVIDER: "none",
    AI_API_KEY: "",
  });
  token = await login(password);
});
afterEach(() => vi.unstubAllGlobals());
async function plan() {
  const draft = await preparePaymentIntent(owner, {
    id: randomUUID(),
    text: "Send Daniel 10 USDC",
    privacyMode: false,
  });
  return updatePaymentPlan(owner, draft.id, {
    recipientLabel: "Daniel",
    recipientAddress: recipient,
    amount: "10",
    asset: "USDC",
    privacy: false,
    saveContact: false,
  });
}
function envelope(
  plan: PaymentPlan,
  changes: {
    amount?: string;
    recipient?: string;
    fee?: string;
    memo?: string;
    source?: string;
    extra?: boolean;
  } = {},
) {
  const builder = new TransactionBuilder(
    new Account(changes.source ?? source, "1"),
    { fee: changes.fee ?? "100", networkPassphrase: Networks.TESTNET },
  )
    .addOperation(
      Operation.payment({
        destination: changes.recipient ?? recipient,
        amount: changes.amount ?? plan.amount!,
        asset: new Asset("USDC", issuer),
      }),
    )
    .addMemo(Memo.text(changes.memo ?? plan.memo))
    .setTimeout(180);
  if (changes.extra)
    builder.addOperation(
      Operation.payment({
        destination: recipient,
        amount: "1",
        asset: Asset.native(),
      }),
    );
  return builder.build().toXDR();
}
function req(path: string, body?: unknown) {
  return new Request(`http://localhost:3000${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      origin: "http://localhost:3000",
      cookie: `ha_session=${token}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
describe("Conversational payment authorization", () => {
  it("dispatches model-selected structured Pidgin preparation on the server without signing authority", async () => {
    const conversationId = randomUUID();
    let turn = 0;
    const model: ToolModel = {
      provider: "gemini",
      model: "scripted-native-dispatch-not-language-evidence",
      async generate(input) {
        expect(
          input.declarations.some(
            (d) => d.name === "read_digital_payment_capabilities",
          ),
        ).toBe(true);
        expect(
          input.declarations.some((d) =>
            /submit|sign_payment|execute_payment/.test(d.name ?? ""),
          ),
        ).toBe(false);
        const call =
          turn++ === 0
            ? {
                id: "structured",
                name: "prepare_digital_payment",
                args: {
                  recipientLabel: "Ada",
                  amount: "10",
                  asset: "USDC",
                  privacy: false,
                },
              }
            : undefined;
        const text = input.responseJsonSchema
          ? '{"grounded":true}'
          : "Your payment review is prepared. Approval is still required.";
        return {
          text: call ? "" : text,
          content: {
            role: "model",
            parts: call ? [{ functionCall: call }] : [{ text }],
          },
          calls: call ? [call] : [],
        };
      },
    };
    const reply = await runPersonalConversation(
      req("/api/conversation"),
      {
        conversationId,
        requestId: randomUUID(),
        text: "Abeg send Ada ten USDC",
        accountIds: [],
        privacyMode: false,
      },
      model,
    );
    expect(reply.digitalPaymentPlanId).toBeTruthy();
    const draft = await getPaymentPlan(owner, reply.digitalPaymentPlanId!);
    expect(draft).toMatchObject({
      recipientLabel: "Ada",
      amount: "10",
      asset: "USDC",
      rail: "pollar-stellar",
      interpretation: "agent-prepared",
      conversationId,
    });
    expect(draft.approval).toBeUndefined();
    expect(draft.quote).toBeUndefined();
  });
  it("binds a model revision to its conversation and invalidates an earlier exact approval", async () => {
    const conversationId = randomUUID();
    let draft = await preparePaymentIntent(
      owner,
      { id: randomUUID(), text: "Send Ada 10 USDC", privacyMode: false },
      "agent-prepared",
      conversationId,
    );
    draft = await updatePaymentPlan(owner, draft.id, {
      recipientLabel: "Ada",
      recipientAddress: recipient,
      amount: "10",
      asset: "USDC",
      privacy: false,
    });
    draft = await quotePaymentPlan(owner, draft.id, envelope(draft), source);
    const approved = await approvePaymentPlan(
      owner,
      draft.id,
      draft.reviewDigest!,
      password,
    );
    let turn = 0;
    const model: ToolModel = {
      provider: "gemini",
      model: "scripted-revision-not-language-evidence",
      async generate(input) {
        const call =
          turn++ === 0
            ? {
                id: "revision",
                name: "prepare_digital_payment",
                args: { paymentPlanId: draft.id, amount: "20" },
              }
            : undefined;
        const text = input.responseJsonSchema
          ? '{"grounded":true}'
          : "Updated the review to 20 USDC. A new approval is required.";
        return {
          text: call ? "" : text,
          content: {
            role: "model",
            parts: call ? [{ functionCall: call }] : [{ text }],
          },
          calls: call ? [call] : [],
        };
      },
    };
    const reply = await runPersonalConversation(
      req("/api/conversation"),
      {
        conversationId,
        requestId: randomUUID(),
        text: "No, na twenty I mean",
        accountIds: [],
        privacyMode: false,
      },
      model,
    );
    expect(reply.digitalPaymentPlanId).toBe(draft.id);
    const revised = await getPaymentPlan(owner, draft.id);
    expect(revised.amount).toBe("20");
    expect(revised.quote).toBeUndefined();
    expect(revised.approval).toBeUndefined();
    await expect(
      claimPaymentSubmission(owner, draft.id, approved.nonce),
    ).rejects.toThrow();
  });
  it("extracts ordinary intent without inventing an address, currency conversion or mainnet path", async () => {
    expect(interpretPaymentIntent("AGUS, send Daniel 10 USDC.")).toMatchObject({
      recipientLabel: "Daniel",
      amount: "10",
      asset: "USDC",
      privacy: false,
    });
    expect(
      interpretPaymentIntent("Send 0.2 ZEC to Daniel privately"),
    ).toMatchObject({
      recipientLabel: "Daniel",
      amount: "0.2",
      asset: "ZEC",
      privacy: true,
    });
    const p = await preparePaymentIntent(owner, {
      id: randomUUID(),
      text: "Send Daniel 10 USDC",
      privacyMode: false,
    });
    expect(p.state).toBe("needs_details");
    expect(p.recipientAddress).toBeNull();
    const privateBtc = await preparePaymentIntent(owner, {
      id: randomUUID(),
      text: "Send Daniel 0.2 BTC privately",
      privacyMode: false,
    });
    expect(privateBtc.asset).toBe("BTC");
    expect(privateBtc.rail).toBeNull();
    expect(privateBtc.blockers.join(" ")).toMatch(
      /does not make a BTC payout private/,
    );
    const mainnet = await preparePaymentIntent(owner, {
      id: randomUUID(),
      text: "Send Daniel 10 USDC on mainnet",
      privacyMode: false,
    });
    expect(mainnet.state).toBe("blocked");
    expect(mainnet.blockers.join(" ")).toMatch(/Mainnet execution is disabled/);
  });
  it("blocks unsupported privacy and shielded sending instead of pretending that a URI executes it", async () => {
    const p = await plan();
    const privateUsdc = await updatePaymentPlan(owner, p.id, {
      recipientLabel: "Daniel",
      recipientAddress: recipient,
      amount: "10",
      asset: "USDC",
      privacy: true,
    });
    expect(privateUsdc.state).toBe("blocked");
    expect(privateUsdc.blockers.join(" ")).toMatch(/visible on Stellar/);
    await expect(
      approvePaymentPlan(owner, p.id, privateUsdc.reviewDigest!, password),
    ).rejects.toThrow(/not executable/);
    const z = await preparePaymentIntent(owner, {
      id: randomUUID(),
      text: "Send Daniel 0.2 ZEC privately",
      privacyMode: true,
    });
    expect(z.blockers.join(" ")).toMatch(
      /authorized Zcash sender-wallet adapter/,
    );
    expect(z.quote).toBeUndefined();
  });
  it("blocks the USDC issuer as a destination and rejects boolean-only authorization", async () => {
    const p = await plan();
    const blocked = await updatePaymentPlan(owner, p.id, {
      recipientLabel: "Daniel",
      recipientAddress: issuer,
      amount: "10",
      asset: "USDC",
      privacy: false,
    });
    expect(blocked.state).toBe("blocked");
    expect(blocked.blockers.join(" ")).toMatch(/issuer address/);
    expect(
      (
        await POST(
          req(`/api/product/payment-plans/${p.id}/approve`, {
            acknowledged: true,
          }),
        )
      ).status,
    ).toBe(400);
  });
  it("isolates plans and saved contact resolution by authenticated owner", async () => {
    const p = await plan();
    await expect(getPaymentPlan("another-owner", p.id)).rejects.toThrow(
      /not found/,
    );
    await updatePaymentPlan(owner, p.id, {
      recipientLabel: "Known Daniel",
      recipientAddress: recipient,
      amount: "10",
      asset: "USDC",
      privacy: false,
      saveContact: true,
    });
    const resolved = await preparePaymentIntent(owner, {
      id: randomUUID(),
      text: "Send Known Daniel 2 USDC",
      privacyMode: false,
    });
    expect(resolved.resolution).toBe("saved-contact");
    expect(resolved.recipientAddress).toBe(recipient);
    const foreign = await preparePaymentIntent("another-owner", {
      id: randomUUID(),
      text: "Send Known Daniel 2 USDC",
      privacyMode: false,
    });
    expect(foreign.recipientAddress).toBeNull();
    await expect(
      updatePaymentPlan(owner, p.id, {
        recipientLabel: "Known Daniel",
        recipientAddress: Keypair.random().publicKey(),
        amount: "10",
        asset: "USDC",
        privacy: false,
        saveContact: true,
      }),
    ).rejects.toThrow(/different address/);
  });
  it("parses the actual provider envelope and rejects wrong amount, recipient, memo, fee, source or extra operations", async () => {
    const p = await plan();
    for (const changes of [
      { amount: "11" },
      { recipient: Keypair.random().publicKey() },
      { memo: "unrelated" },
      { fee: "100001" },
      { source: Keypair.random().publicKey() },
      { extra: true },
    ])
      await expect(
        quotePaymentPlan(owner, p.id, envelope(p, changes), source),
      ).rejects.toThrow();
    const quoted = await quotePaymentPlan(owner, p.id, envelope(p), source);
    expect(quoted.state).toBe("review");
    expect(quoted.quote?.feeStroops).toBe("100");
    expect(quoted.quote?.source).toBe("pollar-sdk-built-transaction");
  });
  it("requires reauthentication, binds immutable instructions, consumes approval once and does not turn a reported success into settlement", async () => {
    let p = await plan();
    p = await quotePaymentPlan(owner, p.id, envelope(p), source);
    await expect(
      approvePaymentPlan(owner, p.id, "0".repeat(64), password),
    ).rejects.toThrow(/changed/);
    await expect(
      approvePaymentPlan(owner, p.id, p.reviewDigest!, "wrong password"),
    ).rejects.toThrow(/password/);
    const approved = await approvePaymentPlan(
      owner,
      p.id,
      p.reviewDigest!,
      password,
    );
    expect(approved.plan.approval?.nonceHash).toBe("withheld");
    const claim = await claimPaymentSubmission(owner, p.id, approved.nonce);
    expect(claim.transactionHash).toBe(p.quote?.transactionHash);
    await expect(
      claimPaymentSubmission(owner, p.id, approved.nonce),
    ).rejects.toThrow(/consumed/);
    expect(
      (await recordWalletOutcome(owner, p.id, "pending", claim.transactionHash))
        .state,
    ).toBe("pending");
    const forged = await POST(
      req(`/api/product/payment-plans/${p.id}/outcome`, {
        status: "confirmed",
        transactionId: claim.transactionHash,
      }),
    );
    expect(forged.status).toBe(400);
    expect((await getPaymentPlan(owner, p.id)).state).toBe("pending");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 404 })),
    );
    await expect(verifyOutgoingPayment(owner, p.id)).rejects.toThrow(
      /not found/,
    );
  });
  it("invalidates approval when the recipient or amount changes", async () => {
    let p = await plan();
    p = await quotePaymentPlan(owner, p.id, envelope(p), source);
    const approved = await approvePaymentPlan(
      owner,
      p.id,
      p.reviewDigest!,
      password,
    );
    const edited = await updatePaymentPlan(owner, p.id, {
      recipientLabel: "Daniel",
      recipientAddress: recipient,
      amount: "11",
      asset: "USDC",
      privacy: false,
    });
    expect(edited.approval).toBeUndefined();
    expect(edited.quote).toBeUndefined();
    await expect(
      claimPaymentSubmission(owner, p.id, approved.nonce),
    ).rejects.toThrow(/invalid/);
  });
  it("keeps interrupted and failed SDK sends uncertain and non-retryable until independent verification", async () => {
    let p = await plan();
    p = await quotePaymentPlan(owner, p.id, envelope(p), source);
    const approved = await approvePaymentPlan(
      owner,
      p.id,
      p.reviewDigest!,
      password,
    );
    await claimPaymentSubmission(owner, p.id, approved.nonce);
    expect((await recordWalletOutcome(owner, p.id, "failed")).state).toBe(
      "unknown",
    );
    await expect(
      claimPaymentSubmission(owner, p.id, approved.nonce),
    ).rejects.toThrow(/consumed/);
    await expect(
      updatePaymentPlan(owner, p.id, {
        recipientLabel: "Daniel",
        recipientAddress: recipient,
        amount: "10",
        asset: "USDC",
        privacy: false,
      }),
    ).rejects.toThrow(/submitted/);
  });
  it("confirms the exact transaction independently and completes only its linked payable responsibility", async () => {
    const inv = await createInvoice(owner, {
      id: randomUUID(),
      title: "Fictional contractor payment",
      counterparty: "Daniel",
      direction: "payable",
      currency: "USDC",
      amount: "10",
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      note: "Test only",
    });
    let p = await plan();
    p = await updatePaymentPlan(owner, p.id, {
      recipientLabel: "Daniel",
      recipientAddress: recipient,
      amount: "10",
      asset: "USDC",
      privacy: false,
      invoiceId: inv.id,
    });
    p = await quotePaymentPlan(owner, p.id, envelope(p), source);
    const approved = await approvePaymentPlan(
      owner,
      p.id,
      p.reviewDigest!,
      password,
    );
    await claimPaymentSubmission(owner, p.id, approved.nonce);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          hash: p.quote!.transactionHash,
          successful: true,
          ledger: 987,
          fee_charged: "100",
          memo_type: "text",
          memo: p.memo,
          created_at: new Date().toISOString(),
        }),
      ),
    );
    const result = await verifyOutgoingPayment(owner, p.id);
    expect(result.state).toBe("confirmed");
    expect(result.evidence?.source).toBe("stellar-horizon-testnet");
    expect(
      (await workspace(owner).snapshot()).tasks.find((t) => t.id === inv.id)
        ?.state,
    ).toBe("completed");
    const sql = await database();
    expect(
      (
        await sql.query(
          "SELECT payload FROM agus_web_invoices WHERE owner=$1 AND id=$2",
          [owner, inv.id],
        )
      ).rows[0].payload.state,
    ).toBe("settled");
    const events = await sql.query(
      "SELECT payload FROM agus_web_events WHERE owner=$1 AND payload->>'paymentPlanId'=$2",
      [owner, p.id],
    );
    expect(JSON.stringify(events.rows)).not.toContain(recipient);
    expect(JSON.stringify(events.rows)).not.toContain("Daniel");
  });
});

describe("Privacy Mode model boundary", () => {
  it("redacts full/incoming viewing keys and spending keys before prompts or tool serialization", () => {
    for (const key of [
      "uviewtest1",
      "uivk1",
      "zxviewtestsapling1",
      "secret-extended-key-test1",
    ])
      expect(
        redactAgentText(`Please keep ${key}${"a".repeat(80)} safe`),
      ).not.toContain(`${key}aaaa`);
    expect(
      modelData({
        viewingKey: "secret",
        fullViewingKey: "secret",
        note: "viewing key=supersecret",
      }),
    ).toEqual({
      viewingKey: "[credential withheld]",
      fullViewingKey: "[credential withheld]",
      note: "[credential withheld]",
    });
  });
  it("omits saved history, memory, wallet tools, account values and private addresses from model calls", async () => {
    await workspace(owner).proposeMemory({
      text: `Confidential recipient ${recipient} and private balance 987654321`,
      category: "note",
    });
    const snapshots: string[] = [];
    const model = {
      provider: "gemini" as const,
      model: "controlled-privacy-test",
      async generate(input: unknown) {
        snapshots.push(JSON.stringify(input));
        return {
          text: "I can help prepare a review. Wallet signing remains with you.",
          content: {
            role: "model",
            parts: [
              {
                text: "I can help prepare a review. Wallet signing remains with you.",
              },
            ],
          },
          calls: [],
        };
      },
    };
    const request = req("/api/conversation");
    await runPersonalConversation(
      request,
      {
        conversationId: randomUUID(),
        requestId: randomUUID(),
        text: `Tell me how Privacy Mode works for ${recipient}; memo: confidential-current-memo`,
        accountIds: [],
        privacyMode: true,
      },
      model,
    );
    const prompts = snapshots.join("\n");
    expect(prompts).not.toContain(recipient);
    expect(prompts).not.toContain("confidential-current-memo");
    expect(prompts).not.toContain("987654321");
    expect(prompts).not.toContain('"name":"list_saved_runs"');
    expect(prompts).not.toContain('"name":"solana_wallet_balances"');
    expect(prompts).toContain("Privacy Mode");
    // Existing run APIs retain authenticated control; the mode is bound to the run.
    expect((await runs(req("/api/agent-runs"))).status).toBe(200);
    expect(
      (
        await control(
          req("/api/agent-runs", {
            action: "resume",
            id: randomUUID(),
            version: 0,
            acknowledged: true,
          }),
        )
      ).status,
    ).toBe(404);
  });
});
