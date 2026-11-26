import { randomUUID } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sharedPlatform } from "./helpers/shared-platform";
import * as p2p from "../src/server/p2p";
import * as escrow from "../src/server/p2p-fixture";
import * as usd from "../src/server/usd/fixture";
import {
  unavailablePartners,
  usdCapabilities,
} from "../src/server/usd/partners";
import { verifyBeneficiary } from "../src/server/banking/service";
import { GET, POST } from "../src/app/api/v1/[...path]/route";
import { createBinding, getBinding } from "../src/server/escrow/bindings";
import { database } from "../src/server/sql";
describe.skipIf(!process.env.AGUS_TEST_DATABASE_URL)(
  "marketplace and USD PostgreSQL acceptance (simulation only)",
  () => {
    let f: Awaited<ReturnType<typeof sharedPlatform>>;
    beforeAll(async () => {
      f = await sharedPlatform();
      for (const u of f.users)
        await f.admin.query(
          "INSERT INTO agus_trader_eligibility(owner,environment,eligible,evidence) VALUES($1,'fixture',true,'simulation only')",
          [u.id],
        );
      await f.admin.query(
        "INSERT INTO agus_fixture_escrow_authorities(id,verifier,arbitrators) VALUES(1,$1,$2)",
        [f.users[3].id, JSON.stringify(f.users.slice(4).map((u) => u.id))],
      );
    }, 60000);
    afterAll(async () => {
      await f?.close();
    });
    const base = () => ({
      side: "sell" as const,
      availableAtoms: "10000000",
      minimumAtoms: "1",
      maximumAtoms: "10000000",
      rateNumerator: "300000",
      rateDenominator: "1",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      paymentMethod: "bank-transfer-simulated" as const,
    });
    async function order() {
      await p2p.createOffer(f.users[1].id, randomUUID(), base());
      const q = await p2p.quote(f.users[0].id, {
        side: "buy",
        amountAtoms: "1000000",
      });
      const c = await f.challenge(f.users[0], { ...q, action: "p2p.reserve" });
      return p2p.reserve(f.users[0], randomUUID(), q.id, c);
    }
    async function act(
      i: number,
      id: string,
      a: Parameters<typeof escrow.fixtureAction>[3],
      key = randomUUID(),
    ) {
      const r = await escrow.fixtureReview(f.users[i], id, a);
      const c = await f.challenge(f.users[i], r);
      return escrow.fixtureAction(
        f.users[i],
        id,
        key,
        a,
        r.instruction.revision,
        c,
      );
    }
    function req(i: number, path: string, body?: unknown) {
      return new Request(`http://localhost:3000/api/v1/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin: "http://localhost:3000",
          cookie: f.users[i].cookie,
          "content-type": "application/json",
          "idempotency-key": randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    }
    it("persists buyer/seller, requires seller funding and an independent verifier, and releases once for 100 duplicate submissions", async () => {
      const o = await order();
      const id = o.id;
      const buyer = f.users[0],
        seller = f.users[1];
      expect((await escrow.fixtureSnapshot(buyer, id)).order).toMatchObject({
        buyer: buyer.id,
        seller: seller.id,
      });
      await expect(act(0, id, "fund")).rejects.toMatchObject({
        code: "SELLER_REQUIRED",
      });
      await act(1, id, "fund");
      await expect(act(1, id, "release")).rejects.toMatchObject({
        code: "FIAT_VERIFIER_AUTHORITY_REQUIRED",
      });
      await act(0, id, "claim_fiat");
      await expect(act(0, id, "verify_fiat")).rejects.toMatchObject({
        code: "FIXTURE_VERIFIER_REQUIRED",
      });
      await act(3, id, "verify_fiat");
      const r = await escrow.fixtureReview(seller, id, "release"),
        c = await f.challenge(seller, r),
        key = randomUUID();
      const all = await Promise.all(
        Array.from({ length: 100 }, () =>
          escrow.fixtureAction(
            seller,
            id,
            key,
            "release",
            r.instruction.revision,
            c,
          ),
        ),
      );
      expect(
        all.every(
          (x) =>
            x.state === "completed" &&
            x.simulated &&
            !x.chainFinalityVerified &&
            !x.bankSettlementVerified,
        ),
      ).toBe(true);
      expect(
        (
          await f.admin.query(
            "SELECT atoms FROM agus_fixture_token_balances WHERE owner=$1",
            [buyer.id],
          )
        ).rows[0].atoms,
      ).toBe("1000000");
      expect(
        (
          await f.admin.query(
            "SELECT * FROM agus_p2p_events WHERE order_id=$1 AND action='p2p.fixture.release'",
            [id],
          )
        ).rows,
      ).toHaveLength(1);
      await expect(
        escrow.fixtureAction(
          seller,
          id,
          key,
          "release",
          r.instruction.revision + 1,
          c,
        ),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect((await GET(req(2, `p2p/orders/${id}/fixture`))).status).toBe(404);
    });
    it("never refunds a funded order by time or one-party cancellation, freezes disputes and enforces fixed distinct 2-of-3 arbitration", async () => {
      const o = await order();
      const id = o.id;
      await act(1, id, "fund");
      await f.admin.query(
        "UPDATE agus_p2p_orders SET expires_at=now()-interval '1 day' WHERE id=$1",
        [id],
      );
      await p2p.expireUnfundedOrders();
      expect((await p2p.getOrder(f.users[0].id, id)).state).toBe(
        "escrow_funded",
      );
      await expect(p2p.cancelOrder(f.users[0].id, id, 1)).rejects.toMatchObject(
        { code: "ORDER_NOT_CANCELLABLE" },
      );
      await p2p.openDispute(
        f.users[0].id,
        id,
        randomUUID(),
        "Fixture disputed fiat claim; no bank evidence",
      );
      await expect(act(1, id, "release")).rejects.toMatchObject({
        code: "FIAT_VERIFIER_AUTHORITY_REQUIRED",
      });
      await expect(act(3, id, "arbitrate_refund")).rejects.toMatchObject({
        code: "ARBITRATOR_REQUIRED",
      });
      await act(4, id, "arbitrate_refund");
      expect((await p2p.getOrder(f.users[0].id, id)).state).toBe("disputed");
      await p2p.openDispute(
        f.users[0].id,
        id,
        randomUUID(),
        "Repeated case cannot erase existing arbitration votes",
      );
      await expect(act(4, id, "arbitrate_refund")).rejects.toMatchObject({
        code: "ARBITRATOR_ALREADY_SIGNED",
      });
      await act(5, id, "arbitrate_release");
      expect((await p2p.getOrder(f.users[0].id, id)).state).toBe("disputed");
      await act(6, id, "arbitrate_refund");
      expect((await p2p.getOrder(f.users[0].id, id)).state).toBe("refunded");
      const before = (
        await f.admin.query(
          "SELECT atoms FROM agus_fixture_token_balances WHERE owner=$1",
          [f.users[1].id],
        )
      ).rows[0].atoms;
      await expect(act(5, id, "arbitrate_refund")).rejects.toMatchObject({
        code: "ORDER_TERMINAL",
      });
      expect(
        (
          await f.admin.query(
            "SELECT atoms FROM agus_fixture_token_balances WHERE owner=$1",
            [f.users[1].id],
          )
        ).rows[0].atoms,
      ).toBe(before);
    });
    it("requires both parties to refund and keeps funded cancellation pending until the second authorization", async () => {
      const o = await order();
      await act(1, o.id, "fund");
      await act(0, o.id, "mutual_cancel");
      expect((await p2p.getOrder(f.users[0].id, o.id)).state).toBe(
        "cancellation_pending",
      );
      await expect(act(0, o.id, "mutual_cancel")).rejects.toMatchObject({
        code: "CANCELLATION_ALREADY_SIGNED",
      });
      await expect(act(3, o.id, "mutual_cancel")).rejects.toMatchObject({
        code: "PARTY_REQUIRED",
      });
      await act(1, o.id, "mutual_cancel");
      expect((await p2p.getOrder(f.users[0].id, o.id)).state).toBe("refunded");
      expect(
        (await escrow.fixtureSnapshot(f.users[0], o.id)).escrow?.state,
      ).toBe("refunded");
    });
    it("edits invalidate old quotes, closing blocks new reservations, and maker-buy orders bind the correct seller", async () => {
      await f.admin.query("UPDATE agus_p2p_offers SET status='closed'");
      const offer = await p2p.createOffer(f.users[1].id, randomUUID(), base());
      const q = await p2p.quote(f.users[0].id, {
        side: "buy",
        amountAtoms: "1000000",
      });
      await p2p.updateOffer(f.users[1].id, offer.id, 0, {
        ...base(),
        rateNumerator: "310000",
      });
      const c = await f.challenge(f.users[0], { ...q, action: "p2p.reserve" });
      await expect(
        p2p.reserve(f.users[0], randomUUID(), q.id, c),
      ).rejects.toMatchObject({ code: "OFFER_REVISION_CONFLICT" });
      await p2p.updateOffer(f.users[1].id, offer.id, 1, null);
      await p2p.createOffer(f.users[0].id, randomUUID(), {
        ...base(),
        side: "buy",
      });
      const q2 = await p2p.quote(f.users[1].id, {
        side: "sell",
        amountAtoms: "1000000",
      });
      const c2 = await f.challenge(f.users[1], {
        ...q2,
        action: "p2p.reserve",
      });
      const o = await p2p.reserve(f.users[1], randomUUID(), q2.id, c2);
      expect(
        (await escrow.fixtureSnapshot(f.users[1], o.id)).order,
      ).toMatchObject({ buyer: f.users[0].id, seller: f.users[1].id });
      expect((await GET(req(0, "p2p/escrow"))).status).toBe(200);
      await expect(
        (await GET(req(0, "p2p/escrow"))).json(),
      ).resolves.toMatchObject({ genuineExecutionEnabled: false });
    });
    it("keeps authority administration privileged and snapshots owner-verified wallet bindings without enabling execution", async () => {
      await expect(
        (await database()).query(
          "UPDATE agus_fixture_escrow_authorities SET verifier=$1 WHERE id=1",
          [f.users[0].id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      const o = await order();
      const wallets = Array.from({ length: 6 }, () =>
        Keypair.generate().publicKey.toBase58(),
      );
      const input = {
        buyerWallet: wallets[0],
        sellerWallet: wallets[1],
        buyerDestination: Keypair.generate().publicKey.toBase58(),
        sellerSource: Keypair.generate().publicKey.toBase58(),
      };
      vi.stubEnv("AGUS_DEVNET_ESCROW_VERIFIER", wallets[2]);
      vi.stubEnv("AGUS_DEVNET_ESCROW_ARBITRATORS", wallets.slice(3).join(","));
      await expect(
        createBinding(f.users[0], o.id, randomUUID(), input),
      ).rejects.toMatchObject({ code: "SELLER_REQUIRED" });
      await expect(
        createBinding(f.users[1], o.id, randomUUID(), input),
      ).rejects.toMatchObject({ code: "VERIFIED_PARTY_WALLET_REQUIRED" });
      for (const [owner, wallet] of [
        [f.users[0].id, wallets[0]],
        [f.users[1].id, wallets[1]],
      ])
        await f.admin.query(
          "INSERT INTO agus_wallets(owner,wallet,network,challenge,expires_at,verified_at) VALUES($1,$2,'devnet','synthetic ownership fixture',now()+interval '1 hour',now())",
          [owner, wallet],
        );
      const b = await createBinding(f.users[1], o.id, randomUUID(), input);
      expect(b).toMatchObject({
        genuineExecutionEnabled: false,
        transactionPrepared: false,
        feeAndRentReviewed: false,
        verifierSimulated: true,
      });
      vi.stubEnv(
        "AGUS_DEVNET_ESCROW_VERIFIER",
        Keypair.generate().publicKey.toBase58(),
      );
      expect(
        (await createBinding(f.users[1], o.id, randomUUID(), input)).terms
          .verifier,
      ).toBe(wallets[2]);
      await expect(
        createBinding(f.users[1], o.id, randomUUID(), {
          ...input,
          sellerSource: Keypair.generate().publicKey.toBase58(),
        }),
      ).rejects.toMatchObject({ code: "ESCROW_BINDING_IMMUTABLE" });
      await expect(getBinding(f.users[2], o.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
    async function funds(amount = "10000") {
      await usd.onboard(f.users[0].id, randomUUID(), {
        residency: "NG",
        purpose: "freelance",
      });
      return usd.recordIncoming(f.users[3], randomUUID(), {
        owner: f.users[0].id,
        amountAtoms: amount,
        purpose: "freelance",
      });
    }
    it("pages public executable offers and private participant orders without leaking other consumers' orders", async () => {
      const offers = await (await GET(req(0, "p2p/offers?limit=1"))).json();
      expect(offers.data).toHaveLength(1);
      expect(offers.nextCursor).toBeTruthy();
      expect(offers.data[0].available).toMatchObject({
        currency: "USDC",
        scale: 6,
      });
      const next = await (
        await GET(req(0, `p2p/offers?limit=1&cursor=${offers.nextCursor}`))
      ).json();
      expect(next.data[0].id).not.toBe(offers.data[0].id);
      const orders = await (await GET(req(0, "p2p/orders?limit=1"))).json();
      expect(orders.data).toHaveLength(1);
      expect(orders.nextCursor).toBeTruthy();
      expect(
        (await (await GET(req(2, "p2p/orders?limit=1"))).json()).data,
      ).toHaveLength(0);
    });
    it("issues only clearly fictional receiving details, encrypts them and keeps real partner ports unavailable", async () => {
      const key = randomUUID();
      const a = await usd.onboard(f.users[0].id, key, {
        residency: "NG",
        purpose: "salary",
      });
      expect(a).toMatchObject({
        simulated: true,
        receivingStatus: "fixture_issued",
        bankCreditVerified: false,
      });
      expect(
        (
          await usd.onboard(f.users[0].id, key, {
            residency: "NG",
            purpose: "salary",
          })
        ).id,
      ).toBe(a.id);
      await expect(
        usd.onboard(f.users[0].id, key, {
          residency: "NG",
          purpose: "freelance",
        }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
      expect(
        JSON.stringify(
          (
            await f.admin.query(
              "SELECT details_envelope FROM agus_usd_customers",
            )
          ).rows,
        ),
      ).not.toContain("FIXTURE-USD-NOT-A-BANK");
      expect(usdCapabilities()).toMatchObject({
        receivingEnabled: false,
        conversionEnabled: false,
        blockchainDeliveryEnabled: false,
        ngnSettlementEnabled: false,
        returnsEnabled: false,
      });
      await expect(
        unavailablePartners.receiving.issueAccount({
          customerReference: "fixture",
          environment: "sandbox",
          idempotencyKey: key,
        }),
      ).rejects.toMatchObject({ code: "USD_PARTNER_NOT_ACCEPTED" });
      expect((await GET(req(2, "usd/fixture/account"))).status).toBe(404);
      expect(
        (
          await POST(
            req(0, "usd/fixture/incoming", {
              owner: f.users[0].id,
              amountAtoms: "100",
              purpose: "salary",
            }),
          )
        ).status,
      ).toBe(403);
    });
    it("claims one conversion for 100 duplicate submits, reconciles lost response, and separates USD receipt from token delivery and bank payout", async () => {
      const incoming = await funds();
      const beneficiary = await verifyBeneficiary(f.users[0].id, randomUUID(), {
        bankCode: "035",
        accountNumber: "0000000001",
      });
      const q = await usd.quote(f.users[0].id, randomUUID(), {
        incomingId: incoming.id,
        destination: Keypair.generate().publicKey.toBase58(),
        beneficiaryId: beneficiary.id,
      });
      const c = await f.challenge(f.users[0], q),
        key = randomUUID();
      const all = await Promise.all(
        Array.from({ length: 100 }, () =>
          usd.submit(f.users[0], key, q.id, c, true),
        ),
      );
      expect(new Set(all.map((x) => x.id)).size).toBe(1);
      const id = String(all[0].id);
      expect(
        (
          await f.admin.query(
            "SELECT submissions FROM agus_usd_effects WHERE resource_id=$1",
            [id],
          )
        ).rows,
      ).toEqual([{ submissions: 1 }]);
      const converted = await usd.reconcile(f.users[0].id, id);
      expect(converted).toMatchObject({
        conversion_status: "succeeded",
        delivery_status: "not_started",
        payout_status: "not_started",
        simulated: true,
        chainFinalityVerified: false,
      });
      let r = await usd.stageReview(f.users[0].id, id, "payout");
      let approval = await f.challenge(f.users[0], r);
      await expect(
        usd.submitStage(
          f.users[0],
          id,
          randomUUID(),
          "payout",
          Number(converted.revision),
          approval,
        ),
      ).rejects.toMatchObject({ code: "DELIVERY_AND_BENEFICIARY_REQUIRED" });
      r = await usd.stageReview(f.users[0].id, id, "deliver");
      approval = await f.challenge(f.users[0], r);
      await usd.submitStage(
        f.users[0],
        id,
        randomUUID(),
        "deliver",
        Number(converted.revision),
        approval,
      );
      const delivered = await usd.reconcile(f.users[0].id, id);
      expect(delivered).toMatchObject({
        delivery_status: "succeeded",
        payout_status: "not_started",
        chainFinalityVerified: false,
      });
      r = await usd.stageReview(f.users[0].id, id, "payout");
      approval = await f.challenge(f.users[0], r);
      await usd.submitStage(
        f.users[0],
        id,
        randomUUID(),
        "payout",
        Number(delivered.revision),
        approval,
      );
      expect(await usd.reconcile(f.users[0].id, id)).toMatchObject({
        payout_status: "succeeded",
        bankCreditVerified: false,
      });
      await expect(usd.getConversion(f.users[1].id, id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      const ret = await usd.returnReview(f.users[0].id, String(incoming.id));
      await expect(
        usd.returnIncoming(
          f.users[0],
          String(incoming.id),
          randomUUID(),
          1,
          await f.challenge(f.users[0], ret),
        ),
      ).rejects.toMatchObject({ code: "INCOMING_FUNDS_ALREADY_CLAIMED" });
    });
    it("races conversion against return without double allocation and never resends an ambiguous claim", async () => {
      const incoming = await funds("500");
      const q = await usd.quote(f.users[0].id, randomUUID(), {
        incomingId: incoming.id,
        destination: Keypair.generate().publicKey.toBase58(),
      });
      const ret = await usd.returnReview(f.users[0].id, String(incoming.id));
      const result = await Promise.allSettled([
        usd.submit(
          f.users[0],
          randomUUID(),
          q.id,
          await f.challenge(f.users[0], q),
          true,
        ),
        usd.returnIncoming(
          f.users[0],
          String(incoming.id),
          randomUUID(),
          0,
          await f.challenge(f.users[0], ret),
        ),
      ]);
      expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const another = await funds("600");
      const quote = await usd.quote(f.users[0].id, randomUUID(), {
        incomingId: another.id,
        destination: Keypair.generate().publicKey.toBase58(),
      });
      const c = await f.challenge(f.users[0], quote),
        key = randomUUID();
      const submitted = await usd.submit(f.users[0], key, quote.id, c, true);
      // Isolated provider fixture models a committed claim with no effect found.
      await f.admin.query("DELETE FROM agus_usd_effects WHERE resource_id=$1", [
        submitted.id,
      ]);
      await usd.reconcile(f.users[0].id, String(submitted.id));
      await usd.submit(f.users[0], key, quote.id, c, true);
      expect(
        (
          await f.admin.query(
            "SELECT * FROM agus_usd_effects WHERE resource_id=$1",
            [submitted.id],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        await usd.getConversion(f.users[0].id, String(submitted.id)),
      ).toMatchObject({ conversion_status: "unknown" });
    });
    it("returns unallocated incoming funds with a separate idempotent simulated receipt", async () => {
      const incoming = await funds("700");
      const r = await usd.returnReview(f.users[0].id, String(incoming.id)),
        c = await f.challenge(f.users[0], r),
        key = randomUUID();
      const returned = await usd.returnIncoming(
        f.users[0],
        String(incoming.id),
        key,
        0,
        c,
      );
      expect(returned).toMatchObject({
        status: "returned",
        simulated: true,
        bankCreditVerified: false,
      });
      expect(
        (await usd.returnIncoming(f.users[0], String(incoming.id), key, 0, c))
          .id,
      ).toBe(returned.id);
    });
  },
);
