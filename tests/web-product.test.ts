import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { base32, bech32 } from "@scure/base";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { login } from "../src/lib/auth";
import { database } from "../src/server/sql";
import { workspace } from "../src/lib/agent-workspace/store";
import { GET, POST } from "../src/app/api/product/[[...path]]/route";
import { atomic, type InvoiceInput } from "../src/lib/web-product/contracts";
import {
  createInvoice,
  createPaymentRequest,
  productSnapshot,
  checkPayment,
  importStatement,
  currentRequest,
  beginPollarSubmission,
  cancelRequest,
  completeOnboarding,
} from "../src/lib/web-product/service";
import {
  stellarAddress,
  zcashTestnetAddress,
  zcashUri,
} from "../src/lib/web-product/rails";
import { isStellarTestnetApp } from "../src/components/agus/pollar-safety";

function stellar(seed: number) {
  const bytes = new Uint8Array(35);
  bytes[0] = 48;
  bytes.fill(seed, 1, 33);
  let crc = 0;
  for (const byte of bytes.slice(0, 33)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++)
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x1021 : 0)) & 0xffff;
  }
  bytes[33] = crc & 255;
  bytes[34] = crc >> 8;
  return base32.encode(bytes);
}
// Synthetic, structurally encoded test-only receivers. No keys or funds exist.
const recipient = stellar(7),
  issuer = stellar(9);
const zaddr = bech32.encode(
  "ztestsapling",
  bech32.toWords(new Uint8Array(43).fill(3)),
  200,
);
const owner = "web-test-owner";
let token = "";
let password = "";
function invoice(currency: InvoiceInput["currency"] = "USDC"): InvoiceInput {
  return {
    id: randomUUID(),
    title: "Fictional design project",
    counterparty: "Fictional client",
    direction: "receivable",
    currency,
    amount: currency === "ZEC" ? "0.01" : "5",
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    note: "Test-only obligation",
  };
}
async function request(currency: "USDC" | "ZEC" = "USDC") {
  const inv = await createInvoice(owner, invoice(currency));
  const req = await createPaymentRequest(owner, {
    id: randomUUID(),
    invoiceId: inv.id,
    rail: currency === "ZEC" ? "zcash" : "pollar-stellar",
    recipient: currency === "ZEC" ? zaddr : recipient,
  });
  return { inv, req };
}
function api(
  path: string,
  payload?: unknown,
  cookie = token,
  origin = "http://localhost:3000",
) {
  return new Request(`http://localhost:3000/api/product${path}`, {
    method: payload ? "POST" : "GET",
    headers: {
      origin,
      cookie: `ha_session=${cookie}`,
      "content-type": "application/json",
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
}
beforeAll(async () => {
  password = randomBytes(22).toString("hex");
  const salt = randomBytes(16).toString("hex");
  Object.assign(process.env, {
    DATABASE_URL: "pglite://:memory:",
    PAYMENT_MODE: "fixture",
    AGUS_WORKSPACE_ENABLED: "true",
    FINANCIAL_DEMO_ENABLED: "false",
    OPERATOR_ID: owner,
    APP_ORIGIN: "http://localhost:3000",
    OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
    NEXT_PUBLIC_POLLAR_API_KEY: "pk_test_transport_only",
    POLLAR_TESTNET_USDC_ISSUER: issuer,
  });
  delete process.env.ZCASH_WALLET_RPC_URL;
  token = await login(password);
});
afterEach(() => vi.unstubAllGlobals());

describe("Web financial boundaries", () => {
  it("persists onboarding for its owner and rejects preference identity injection", async () => {
    const isolatedOwner = `onboarding-${randomUUID()}`;
    expect(
      (await productSnapshot(isolatedOwner)).preferences.onboardingCompleted,
    ).toBe(false);
    await completeOnboarding(isolatedOwner);
    await completeOnboarding(isolatedOwner);
    expect(
      (await productSnapshot(isolatedOwner)).preferences.onboardingCompleted,
    ).toBe(true);
    expect(
      (await productSnapshot("another-onboarding-owner")).preferences
        .onboardingCompleted,
    ).toBe(false);
    const injected = await POST(
      api("/preferences", { onboardingCompleted: true, owner: isolatedOwner }),
    );
    expect(injected.status).toBe(400);
    const foreign = await POST(
      api("/preferences", { onboardingCompleted: true }, "invalid-session"),
    );
    expect(foreign.status).toBe(401);
    expect(
      (await POST(api("/preferences", { onboardingCompleted: true }))).status,
    ).toBe(200);
    expect((await productSnapshot(owner)).preferences.onboardingCompleted).toBe(
      true,
    );
  });
  it("uses exact atomic amounts and rejects extra precision, negative amounts and mainnet receivers", () => {
    expect(atomic("12345678.12345678", 8)).toBe(1234567812345678n);
    expect(() => atomic("0.001", 2)).toThrow();
    expect(() => atomic("-1", 8)).toThrow();
    expect(stellarAddress(recipient)).toBe(true);
    expect(stellarAddress(recipient.slice(0, -1) + "A")).toBe(false);
    expect(zcashTestnetAddress(zaddr)).toBe(true);
    expect(
      zcashTestnetAddress(
        bech32.encode("zs", bech32.toWords(new Uint8Array(43)), 200),
      ),
    ).toBe(false);
    expect(zcashTestnetAddress(zaddr.slice(0, -1) + "q")).toBe(false);
    expect(
      isStellarTestnetApp({
        application: { network: "testnet", chains: ["STELLAR"] },
      }),
    ).toBe(true);
    expect(
      isStellarTestnetApp({
        application: { network: "mainnet", chains: ["STELLAR"] },
      }),
    ).toBe(false);
    expect(isStellarTestnetApp({ network: "testnet" })).toBe(false);
  });
  it("encodes ZIP 321 memo bytes as unpadded base64url", () => {
    const uri = zcashUri(zaddr, "0.00000001", "AGUS-invoice");
    expect(uri.startsWith(`zcash:${zaddr}?`)).toBe(true);
    const params = new URLSearchParams(uri.split("?")[1]);
    expect(Buffer.from(params.get("memo")!, "base64url").toString("utf8")).toBe(
      "AGUS-invoice",
    );
    expect(params.get("memo")).not.toContain("=");
    expect(params.get("amount")).toBe("0.00000001");
  });
  it("authenticates every product route and rejects cross-origin writes and owner spoofing", async () => {
    expect((await GET(api("", undefined, ""))).status).toBe(401);
    expect(
      (
        await POST(
          api("/invoices", invoice(), token, "https://hostile.invalid"),
        )
      ).status,
    ).toBe(403);
    expect(
      (await POST(api("/invoices", { ...invoice(), owner: "another-user" })))
        .status,
    ).toBe(400);
    expect((await GET(api("?owner=another-user"))).status).toBe(400);
  });
  it("saves an invoice exactly once and reuses the existing responsibility service", async () => {
    const input = invoice();
    const one = await createInvoice(owner, input),
      two = await createInvoice(owner, input);
    expect(one.id).toBe(two.id);
    const tasks = (await workspace(owner).snapshot()).tasks.filter(
      (t) => t.id === input.id,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].state).toBe("awaiting_approval");
    await expect(
      createInvoice(owner, { ...input, amount: "9" }),
    ).rejects.toThrow();
  });
  it("keeps rails and invoice currencies separate; pending and cancelled requests do not settle obligations", async () => {
    const { inv, req } = await request();
    await expect(
      createPaymentRequest(owner, {
        id: randomUUID(),
        invoiceId: inv.id,
        rail: "zcash",
        recipient: zaddr,
      }),
    ).rejects.toThrow(/asset/);
    await expect(
      createPaymentRequest("another-owner", {
        id: randomUUID(),
        invoiceId: inv.id,
        rail: "pollar-stellar",
        recipient,
      }),
    ).rejects.toThrow(/not found/);
    await expect(
      createPaymentRequest(owner, {
        id: randomUUID(),
        invoiceId: inv.id,
        rail: "pollar-stellar",
        recipient,
      }),
    ).rejects.toThrow(/active/);
    expect(
      currentRequest({ ...req, expiresAt: new Date(0).toISOString() }).state,
    ).toBe("expired");
    await cancelRequest(owner, req.id);
    expect(
      (await productSnapshot(owner)).invoices.find((i) => i.id === inv.id)
        ?.state,
    ).toBe("open");
    expect(
      (await workspace(owner).snapshot()).tasks.find((t) => t.id === inv.id)
        ?.state,
    ).toBe("awaiting_approval");
    await expect(checkPayment(owner, req.id, "a".repeat(64))).rejects.toThrow(
      /expired|cancelled/,
    );
  });
  it("reserves one explicit SDK submission and rejects a duplicate or foreign send", async () => {
    const { req } = await request();
    const digest = currentRequest(req).reviewDigest!;
    expect(
      (
        await POST(
          api(`/requests/${req.id}/submit-intent`, { acknowledged: true }),
        )
      ).status,
    ).toBe(400);
    await expect(
      beginPollarSubmission(owner, req.id, "wrong password", digest),
    ).rejects.toThrow(/password/);
    await expect(
      beginPollarSubmission(owner, req.id, password, "0".repeat(64)),
    ).rejects.toThrow(/instructions changed/);
    expect(
      (await beginPollarSubmission(owner, req.id, password, digest))
        .submissionStartedAt,
    ).toBeTruthy();
    await expect(
      beginPollarSubmission(owner, req.id, password, digest),
    ).rejects.toThrow(/another send/);
    await expect(
      beginPollarSubmission("another-owner", req.id, password, digest),
    ).rejects.toThrow(/Reauthentication/);
  });
  it("rejects the configured USDC issuer as an invoice recipient", async () => {
    const inv = await createInvoice(owner, invoice());
    await expect(
      createPaymentRequest(owner, {
        id: randomUUID(),
        invoiceId: inv.id,
        rail: "pollar-stellar",
        recipient: issuer,
      }),
    ).rejects.toThrow(/issuer address/);
  });
  it("never accepts a client transaction ID or forged client evidence as settlement", async () => {
    const { inv, req } = await request();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({}, { status: 404 })),
    );
    await expect(checkPayment(owner, req.id, "b".repeat(64))).rejects.toThrow(
      /not found/,
    );
    const fake = await POST(
      api(`/requests/${req.id}/verify`, {
        transactionId: "b".repeat(64),
        evidence: { confirmed: true },
      }),
    );
    expect(fake.status).toBe(400);
    expect(
      (await productSnapshot(owner)).invoices.find((i) => i.id === inv.id)
        ?.state,
    ).toBe("open");
  });
  it("rejects wrong Stellar memo, asset issuer, recipient or amount", async () => {
    const { req } = await request();
    const tx = {
      successful: true,
      memo_type: "text",
      memo: req.memo,
      ledger: 123,
      operation_count: 1,
      created_at: new Date().toISOString(),
    };
    for (const wrong of [
      { to: stellar(10) },
      { asset_issuer: stellar(11) },
      { amount: "5.0000001" },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) =>
          Response.json(
            String(url).includes("/operations?")
              ? {
                  _embedded: {
                    records: [
                      {
                        type: "payment",
                        to: req.recipient,
                        asset_code: "USDC",
                        asset_issuer: req.issuer,
                        amount: "5.0000000",
                        ...wrong,
                      },
                    ],
                  },
                }
              : tx,
          ),
        ),
      );
      await expect(checkPayment(owner, req.id, "c".repeat(64))).rejects.toThrow(
        /No unique/,
      );
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ ...tx, memo: "wrong" })),
    );
    await expect(checkPayment(owner, req.id, "c".repeat(64))).rejects.toThrow(
      /memo/,
    );
  });
  it("commits matching Horizon evidence, receipt and responsibility completion atomically", async () => {
    const { inv, req } = await request();
    const mock = vi.fn(async (url) =>
      Response.json(
        String(url).includes("/operations?")
          ? {
              _embedded: {
                records: [
                  {
                    type: "payment",
                    to: req.recipient,
                    asset_code: "USDC",
                    asset_issuer: req.issuer,
                    amount: "5.0000000",
                  },
                ],
              },
            }
          : {
              successful: true,
              memo_type: "text",
              memo: req.memo,
              ledger: 123,
              operation_count: 1,
              created_at: new Date().toISOString(),
            },
      ),
    );
    vi.stubGlobal("fetch", mock);
    const settled = await checkPayment(owner, req.id, "d".repeat(64));
    expect(settled.state).toBe("confirmed");
    expect(settled.evidence?.source).toBe("stellar-horizon-testnet");
    expect(
      (await productSnapshot(owner)).invoices.find((i) => i.id === inv.id)
        ?.state,
    ).toBe("settled");
    expect(
      (await workspace(owner).snapshot()).tasks.find((t) => t.id === inv.id)
        ?.state,
    ).toBe("completed");
    await checkPayment(owner, req.id, "d".repeat(64));
    expect(mock).toHaveBeenCalledTimes(2);
    await expect(cancelRequest(owner, req.id)).rejects.toThrow(
      /verified receipt/,
    );
    const other = await request();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        Response.json(
          String(url).includes("/operations?")
            ? {
                _embedded: {
                  records: [
                    {
                      type: "payment",
                      to: other.req.recipient,
                      asset_code: "USDC",
                      asset_issuer: other.req.issuer,
                      amount: "5.0000000",
                    },
                  ],
                },
              }
            : {
                successful: true,
                memo_type: "text",
                memo: other.req.memo,
                ledger: 123,
                operation_count: 1,
                created_at: new Date().toISOString(),
              },
        ),
      ),
    );
    await expect(
      checkPayment(owner, other.req.id, "d".repeat(64)),
    ).rejects.toThrow(/already settled/);
  });
  it("requires receiving-wallet access for Zcash; a public transaction ID is insufficient", async () => {
    const { inv, req } = await request("ZEC");
    delete process.env.ZCASH_WALLET_RPC_URL;
    await expect(checkPayment(owner, req.id, "e".repeat(64))).rejects.toThrow(
      /Receiving-wallet verification is not configured/,
    );
    expect(
      (await productSnapshot(owner)).invoices.find((i) => i.id === inv.id)
        ?.state,
    ).toBe("open");
  });
  it("uses only testnet read-only wallet evidence and requires exact Zcash memo and confirmations", async () => {
    const { inv, req } = await request("ZEC");
    process.env.ZCASH_WALLET_RPC_URL = "http://127.0.0.1:18232";
    const methods: string[] = [];
    let confirmations = 2;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, init) => {
        const { method, params } = JSON.parse(String(init?.body));
        methods.push(method);
        const result =
          method === "getblockchaininfo"
            ? { chain: "test", initialblockdownload: false }
            : method === "z_listreceivedbyaddress"
              ? [
                  {
                    txid: "f".repeat(64),
                    amount: 0.01,
                    amountZat: 1000000,
                    memo: Buffer.from(req.memo)
                      .toString("hex")
                      .padEnd(1024, "0"),
                  },
                ]
              : { confirmations, blocktime: Math.floor(Date.now() / 1000) };
        if (method === "z_listreceivedbyaddress")
          expect(params).toEqual([zaddr, 3]);
        return Response.json({ result, error: null });
      }),
    );
    await expect(checkPayment(owner, req.id, "f".repeat(64))).rejects.toThrow(
      /not confirmed/,
    );
    confirmations = 3;
    expect((await checkPayment(owner, req.id, "f".repeat(64))).state).toBe(
      "confirmed",
    );
    expect(
      (await productSnapshot(owner)).invoices.find((i) => i.id === inv.id)
        ?.state,
    ).toBe("settled");
    expect(new Set(methods)).toEqual(
      new Set([
        "getblockchaininfo",
        "z_listreceivedbyaddress",
        "gettransaction",
      ]),
    );
    delete process.env.ZCASH_WALLET_RPC_URL;
  });
  it("imports persisted statements, deduplicates re-imports, and never leaks accounts across owners", async () => {
    const content = await readFile("public/demo/sample-statement.csv", "utf8");
    const input = {
      institution: "Fictional test bank",
      label: "Fictional statement",
      lastFour: "1234",
      currency: "NGN",
      fileName: "sample.csv",
      content,
    };
    const one = await importStatement(owner, input);
    expect(one.imported).toBe(5);
    const again = await importStatement(owner, {
      ...input,
      accountId: one.accountId,
    });
    expect(again.imported).toBe(0);
    expect(again.duplicates).toBe(5);
    const snapshot = await productSnapshot(owner);
    expect(snapshot.intelligence.naira).toBe("₦117,950.00");
    expect(snapshot.accounts[0].source).toBe("statement import");
    expect(snapshot.transactions).toHaveLength(5);
    const isolated = await productSnapshot("another-owner");
    expect(isolated.accounts).toHaveLength(0);
    expect(isolated.invoices).toHaveLength(0);
    expect(isolated.requests).toHaveLength(0);
    expect(isolated.intelligence.naira).toBeNull();
    await expect(
      importStatement("another-owner", { ...input, accountId: one.accountId }),
    ).rejects.toThrow(/not found/);
  });
  it("preserves data when a new service snapshot is constructed", async () => {
    const sql = await database();
    const before = await productSnapshot(owner);
    expect(
      (
        await sql.query(
          "SELECT count(*) AS count FROM agus_web_invoices WHERE owner=$1",
          [owner],
        )
      ).rows[0].count,
    ).toBe(before.invoices.length);
    const after = await productSnapshot(owner);
    expect(after.invoices).toEqual(before.invoices);
    expect(after.requests).toEqual(before.requests);
  });
});
