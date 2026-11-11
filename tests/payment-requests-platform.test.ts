/** Database matching and QR acceptance with a mocked, previously verified
 * transfer service. Synthetic finality here is NOT genuine chain evidence. */
import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { sharedPlatform } from "./helpers/shared-platform";
import type { PrepareTransfer, SolanaDraft } from "../src/lib/solana/contracts";
import { DEVNET_GENESIS, DEVNET_RPC } from "../src/lib/solana/contracts";
const mock = vi.hoisted(() => ({ prepare: vi.fn(), reconcile: vi.fn() }));
vi.mock("../src/lib/solana", async () => ({
  ...(await vi.importActual("../src/lib/solana")),
  service: () => mock,
}));
import * as requests from "../src/server/requests";
import { GET } from "../src/app/api/v1/[...path]/route";
describe.skipIf(!process.env.AGUS_TEST_DATABASE_URL)(
  "owned Solana Pay requests and settlement matching",
  () => {
    let f: Awaited<ReturnType<typeof sharedPlatform>>;
    const drafts = new Map<string, SolanaDraft>();
    beforeAll(async () => {
      f = await sharedPlatform(3);
      mock.prepare.mockImplementation(
        async (owner: string, input: PrepareTransfer) => {
          const id = randomUUID();
          const draft = {
            owner,
            id,
            revision: 0,
            state: "prepared",
            network: "devnet",
            genesisHash: DEVNET_GENESIS,
            rpcEndpoint: DEVNET_RPC,
            decimals: input.asset === "SOL" ? 9 : 6,
            recipient: input.recipient,
            sender: input.sender,
            reference: input.reference,
            asset: input.asset,
            mint: input.mint ?? null,
            amountAtoms: input.asset === "SOL" ? "1000000" : "1000000",
            confirmation: null,
            submission: null,
          } as SolanaDraft;
          await f.admin.query(
            "INSERT INTO agus_solana_drafts(owner,id,revision,state,payload) VALUES($1,$2,0,'prepared',$3)",
            [owner, id, JSON.stringify(draft)],
          );
          drafts.set(id, draft);
          return draft;
        },
      );
      mock.reconcile.mockImplementation(async (owner: string, id: string) => {
        const d = drafts.get(id);
        if (!d || d.owner !== owner) throw new Error("NOT_FOUND");
        return d;
      });
    }, 60000);
    afterAll(async () => {
      await f?.close();
    });
    async function create(asset: "SOL" | "SPL" = "SPL") {
      return requests.createRequest(f.users[0].id, randomUUID(), {
        recipient: Keypair.generate().publicKey.toBase58(),
        asset,
        amountAtoms: "1000000",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
    }
    async function prepared(id: string) {
      return requests.prepareRequestedTransfer(
        f.users[1].id,
        id,
        Keypair.generate().publicKey.toBase58(),
        randomUUID(),
      );
    }
    function final(
      d: SolanaDraft,
      blockTime: number | null = Math.floor(Date.now() / 1000),
    ) {
      const next = {
        ...d,
        state: "finalized" as const,
        submission: {
          claimId: randomUUID(),
          claimedAt: new Date().toISOString(),
          signature: `SYNTHETIC-NOT-A-CHAIN-TRANSACTION-${randomUUID()}`,
        },
        confirmation: {
          slot: 42,
          commitment: "finalized" as const,
          at: new Date().toISOString(),
          feeLamports: "5000",
          blockTime,
        },
      };
      drafts.set(d.id, next);
      return next;
    }
    it("publishes a Devnet-labelled QR for active requests, bounds parsing and denies closed QR/other-owner access", async () => {
      const r = await create();
      const qr = await requests.requestQr(f.users[0].id, r.id);
      expect(qr.uri).toBe(r.uri);
      expect(qr.svg).toMatch(/^<svg/);
      expect(qr.svg).not.toMatch(/<script|(?:href|src)=["']https?:/);
      expect(qr.networkNotEnforcedByUri).toBe(true);
      expect(requests.parseSolanaPay(qr.uri)).toMatchObject({
        amountAtoms: "1000000",
        network: "devnet",
        verification: "unverified_request_only",
      });
      for (const uri of [
        r.uri + "&amount=2",
        r.uri + "&reference=" + r.reference,
        r.uri + "&cluster=mainnet-beta",
        r.uri + "#approve",
        "solana:https://attacker.invalid/pay",
        r.uri + "&memo=unexpected",
      ])
        expect(() => requests.parseSolanaPay(uri)).toThrow();
      await expect(
        requests.requestQr(f.users[2].id, r.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      const get = await GET(
        new Request("http://localhost:3000/api/v1/requests", {
          headers: { cookie: f.users[0].cookie },
        }),
      );
      expect(get.status).toBe(200);
      expect(
        (await get.json()).data.some((x: { id: string }) => x.id === r.id),
      ).toBe(true);
      await requests.cancelRequest(f.users[0].id, r.id, 0);
      await expect(
        requests.requestQr(f.users[0].id, r.id),
      ).rejects.toMatchObject({ code: "REQUEST_UNAVAILABLE" });
      expect(await requests.lookupRequest(String(r.reference))).toMatchObject({
        status: "cancelled",
        payable: false,
      });
    });
    it("rejects unfinalized, unmatched, wrong-party and partial transfers; finalized matching and notifications commit once", async () => {
      const r = await create();
      const d = await prepared(r.id);
      await expect(
        requests.matchRequest(f.users[2].id, r.id, d.id),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        requests.matchRequest(f.users[0].id, r.id, d.id),
      ).rejects.toMatchObject({ code: "REQUEST_FINALITY_PENDING" });
      const good = final(d);
      for (const bad of [
        { amountAtoms: "999999" },
        { reference: Keypair.generate().publicKey.toBase58() },
        { mint: Keypair.generate().publicKey.toBase58() },
        { recipient: Keypair.generate().publicKey.toBase58() },
        { genesisHash: "wrong-network-fixture" },
        { decimals: 9 },
      ]) {
        drafts.set(d.id, { ...good, ...bad } as SolanaDraft);
        await expect(
          requests.matchRequest(f.users[0].id, r.id, d.id),
        ).rejects.toMatchObject({ code: "REQUEST_SETTLEMENT_MISMATCH" });
      }
      drafts.set(d.id, good);
      expect(
        await requests.matchRequest(f.users[1].id, r.id, d.id),
      ).toMatchObject({
        status: "paid",
        payable: false,
        settlementSignature: good.submission.signature,
      });
      await requests.matchRequest(f.users[0].id, r.id, d.id);
      expect(
        (
          await f.admin.query(
            "SELECT * FROM agus_jobs WHERE effect_key LIKE $1",
            [`request:${r.id}:%`],
          )
        ).rows,
      ).toHaveLength(2);
      expect(
        (
          await f.admin.query(
            "SELECT payload FROM agus_jobs WHERE owner=$1 AND effect_key LIKE $2",
            [f.users[1].id, `request:${r.id}:%`],
          )
        ).rows[0].payload,
      ).toMatchObject({ resourceType: "solana", resourceId: d.id });
      expect((await requests.getRequest(f.users[0].id, r.id)).revision).toBe(1);
    });
    it("uses chain time rather than delayed observation time and explicitly leaves missing timing unverified", async () => {
      const before = await create();
      const d = await prepared(before.id);
      final(d, Math.floor(Date.now() / 1000) - 20);
      await f.admin.query(
        "UPDATE agus_payment_requests SET expires_at=now()-interval '10 seconds' WHERE id=$1",
        [before.id],
      );
      expect(
        await requests.matchRequest(f.users[0].id, before.id, d.id),
      ).toMatchObject({ status: "paid" });
      const late = await create();
      const lateDraft = await prepared(late.id);
      final(lateDraft);
      await f.admin.query(
        "UPDATE agus_payment_requests SET expires_at=now()-interval '10 seconds' WHERE id=$1",
        [late.id],
      );
      expect(
        await requests.matchRequest(f.users[0].id, late.id, lateDraft.id),
      ).toMatchObject({ status: "paid_after_expiry" });
      const unknown = await create();
      const unknownDraft = await prepared(unknown.id);
      final(unknownDraft, null);
      await requests.cancelRequest(f.users[0].id, unknown.id, 0);
      expect(
        await requests.matchRequest(f.users[0].id, unknown.id, unknownDraft.id),
      ).toMatchObject({
        status: "paid_timing_unverified",
        settlementBlockTime: null,
      });
    });
  },
);
