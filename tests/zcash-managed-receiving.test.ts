/** MOCKED native viewing transport and fixture output metadata, never live settlement proof. */
import { randomUUID } from "node:crypto";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import vectors from "./fixtures/zcash/unified-reference.json";
import {
  allocateReceivingAddress,
  invoiceTerms,
  matchWalletReceipt,
} from "../src/lib/zcash/receiving-wallet";
import {
  createManagedInvoice,
  checkManagedReceipt,
} from "../src/lib/zcash/managed-invoices";
import {
  productSnapshot,
  cancelRequest,
  recordSettlement,
} from "../src/lib/web-product/service";
import { workspace } from "../src/lib/agent-workspace/store";
const address = vectors.vectors.find(
  (v) => v.receivers.length === 1 && v.receivers[0] === 3,
)!.testnet;
const owner = "managed-receiving-fixture";
let observation: ReturnType<typeof fixture>;
function fixture(
  invoiceKey = "b".repeat(64),
  termsDigest = "c".repeat(64),
  amountAtoms = "5000000",
) {
  return {
    network: "testnet",
    walletId: "a".repeat(24),
    invoiceKey,
    termsDigest,
    walletRequestId: "req_" + randomUUID().replaceAll("-", ""),
    address,
    amountAtoms,
    chainTip: 4619000,
    synced: true,
    observedAt: Math.floor(Date.now() / 1000),
    source: "zaw-librustzcash-receiving-wallet",
    signingAvailable: false,
    outputs: [] as {
      amountAtoms: string;
      transactionId: string;
      height: number | null;
      confirmations: number;
      pool: number;
      outputIndex: number;
      blockTime: number | null;
    }[],
  };
}
function mock() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, opts) => {
      if (opts?.body) {
        const terms = JSON.parse(opts.body);
        observation = fixture(
          terms.invoiceKey,
          terms.termsDigest,
          terms.amountAtoms,
        );
      }
      return Response.json(observation);
    }),
  );
}
beforeAll(() =>
  Object.assign(process.env, {
    DATABASE_URL: "pglite://:memory:",
    OPERATOR_ID: owner,
    PAYMENT_MODE: "fixture",
    AGUS_WORKSPACE_ENABLED: "true",
    ZCASH_RECEIVE_SERVICE_URL: "https://native-wallet.invalid",
    ZCASH_RECEIVE_TOKEN: "fixture-token-no-live-value",
  }),
);
afterEach(() => vi.unstubAllGlobals());
async function invoice() {
  mock();
  return createManagedInvoice(owner, {
    id: randomUUID(),
    title: "Fixture invoice",
    counterparty: "Fictional Ada",
    amount: "0.05",
    currency: "ZEC",
    direction: "receivable",
    dueAt: new Date(Date.now() + 86400000).toISOString(),
    note: "",
  });
}
function paid() {
  observation.outputs = [
    {
      amountAtoms: observation.amountAtoms,
      transactionId: randomUUID().replaceAll("-", "").repeat(2),
      height: 4618998,
      confirmations: 3,
      pool: 4,
      outputIndex: 0,
      blockTime: Math.floor(Date.now() / 1000),
    },
  ];
}
describe("native receiving trust boundary", () => {
  it("does not invent a receiving address when service authentication fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("denied", { status: 401 })),
    );
    await expect(
      allocateReceivingAddress(owner, randomUUID(), "0.05"),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("creates an unpaid wallet-bound invoice, no automatic reminder approval, idempotent retry", async () => {
    const saved = await invoice();
    const snap = await productSnapshot(owner);
    expect(saved.request.recipient).toBe(address);
    expect(saved.request.nativeWallet).toBeDefined();
    expect(saved.request.state).toBe("pending");
    expect(saved.invoice.state).toBe("open");
    expect(
      (await workspace(owner).snapshot()).tasks.find(
        (t) => t.id === saved.invoice.responsibilityId,
      )?.state,
    ).toBe("awaiting_approval");
    const {
      owner: ignored,
      createdAt,
      state,
      responsibilityId,
      ...input
    } = saved.invoice;
    void ignored;
    void createdAt;
    void state;
    void responsibilityId;
    const retried = await createManagedInvoice(owner, input);
    expect(retried.request.id).toBe(saved.request.id);
    expect((await productSnapshot(owner)).requests.length).toBe(
      snap.requests.length,
    );
  });
  it("uses independent decrypted exact-value output with 3 confirmations, then persists invoice/reminder and rejects cross-owner lookup", async () => {
    const saved = await invoice();
    paid();
    const received = await checkManagedReceipt(owner, saved.request.id);
    expect(received.state).toBe("confirmed");
    expect(received.evidence?.walletReceipt?.pool).toBe(4);
    expect(
      (await productSnapshot(owner)).invoices.find(
        (i) => i.id === saved.invoice.id,
      )?.state,
    ).toBe("settled");
    expect(
      (await workspace(owner).snapshot()).tasks.find(
        (t) => t.id === saved.invoice.responsibilityId,
      )?.state,
    ).toBe("completed");
    await expect(
      checkManagedReceipt("other-owner", saved.request.id),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await checkManagedReceipt(owner, saved.request.id)).evidence
        ?.transactionId,
    ).toBe(received.evidence?.transactionId);
  });
  it("cancellation remains effective and cannot be reversed by wallet polling", async () => {
    const saved = await invoice();
    await cancelRequest(owner, saved.request.id);
    paid();
    await expect(
      checkManagedReceipt(owner, saved.request.id),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await productSnapshot(owner)).invoices.find(
        (i) => i.id === saved.invoice.id,
      )?.state,
    ).toBe("open");
  });
  it("rejects a native-wallet proof bound to different invoice terms at the commit boundary", async () => {
    const saved = await invoice();
    paid();
    const evidence = matchWalletReceipt(saved.request, observation)!;
    evidence.walletReceipt!.termsDigest = "d".repeat(64);
    await expect(
      recordSettlement(owner, saved.request.id, evidence),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("never settles insufficient, excess, duplicate-note, unmined, stale, or contradictory observations", async () => {
    const saved = await invoice();
    paid();
    const baseline = structuredClone(observation);
    const cases = [
      (o: typeof observation) => {
        o.outputs[0].amountAtoms = "4999999";
      },
      (o: typeof observation) => {
        o.outputs[0].amountAtoms = "5000001";
      },
      (o: typeof observation) => {
        o.outputs[0].confirmations = 2;
      },
      (o: typeof observation) => {
        o.outputs[0].height = null;
      },
      (o: typeof observation) => {
        o.outputs[0].height = o.chainTip + 1;
      },
      (o: typeof observation) => {
        o.outputs[0].blockTime =
          Math.floor(Date.parse(saved.request.expiresAt) / 1000) + 100;
      },
      (o: typeof observation) => {
        o.outputs[0].blockTime =
          Math.floor(Date.parse(saved.request.createdAt) / 1000) - 400;
      },
      (o: typeof observation) => {
        o.outputs.push(structuredClone(o.outputs[0]));
      },
    ];
    for (const alter of cases) {
      const test = structuredClone(baseline);
      alter(test);
      expect(matchWalletReceipt(saved.request, test)).toBeNull();
    }
    for (const override of [
      { network: "mainnet" },
      { observedAt: 0 },
      { termsDigest: "e".repeat(64) },
      { address: "utest1fake" },
      { walletId: "f".repeat(24) },
      { signingAvailable: true },
    ]) {
      expect(() =>
        matchWalletReceipt(saved.request, { ...baseline, ...override }),
      ).toThrow();
    }
    expect(matchWalletReceipt(saved.request, baseline)?.transactionId).toBe(
      baseline.outputs[0].transactionId,
    );
  });
  it("does not reactivate a cancelled reminder when its invoice is genuinely settled", async () => {
    const saved = await invoice();
    await workspace(owner).transition(
      saved.invoice.responsibilityId,
      0,
      "cancel",
    );
    paid();
    expect((await checkManagedReceipt(owner, saved.request.id)).state).toBe(
      "confirmed",
    );
    expect(
      (await workspace(owner).snapshot()).tasks.find(
        (t) => t.id === saved.invoice.responsibilityId,
      )?.state,
    ).toBe("cancelled");
  });
  it("rejects transaction reuse across invoice bindings without settling the second invoice", async () => {
    const first = await invoice();
    paid();
    const txid = observation.outputs[0].transactionId;
    await checkManagedReceipt(owner, first.request.id);
    const second = await invoice();
    paid();
    observation.outputs[0].transactionId = txid;
    await expect(
      checkManagedReceipt(owner, second.request.id),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      (await productSnapshot(owner)).invoices.find(
        (i) => i.id === second.invoice.id,
      )?.state,
    ).toBe("open");
  });
  it("does not share credentials with a redirect or accept malformed wallet addresses", async () => {
    const terms = invoiceTerms(owner, randomUUID(), "0.05");
    const o = fixture(terms.invoiceKey, terms.termsDigest, terms.amountAtoms);
    o.address = "utest1madeup";
    const fetcher = vi.fn(async (...args: unknown[]) => {
      void args;
      return Response.json(o);
    });
    vi.stubGlobal("fetch", fetcher);
    await expect(
      allocateReceivingAddress(owner, randomUUID(), "0.05"),
    ).rejects.toThrow();
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      cache: "no-store",
    });
  });
});
