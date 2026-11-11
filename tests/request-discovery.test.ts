/** Synthetic signed transactions/RPC metadata, real isolated PostgreSQL. No
 * public-chain execution or wallet acceptance is established by these tests. */
import { randomBytes, randomUUID } from "node:crypto";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type SignatureStatus,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { sharedPlatform } from "./helpers/shared-platform";
import {
  createRequest,
  getRequest,
  requestReceipts,
} from "../src/server/requests";
import {
  discoverRequest,
  matchExternalRequest,
  type RequestChainReader,
} from "../src/server/request-discovery";
import {
  inspectRequestPayment,
  type RequestTerms,
} from "../src/server/request-chain";
import { DEVNET_GENESIS } from "../src/lib/solana/contracts";
import { CIRCLE_DEVNET_USDC_MINT } from "../src/lib/solana/assets";
import {
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "../src/lib/solana/classic-spl";
import { base58 } from "../src/lib/solana/encoding";
function signed(
  request: RequestTerms,
  actualAmount = request.amountAtoms,
  createsAta = false,
) {
  const payer = Keypair.generate(),
    to = new PublicKey(request.recipient),
    reference = new PublicKey(request.reference),
    mint = new PublicKey(CIRCLE_DEVNET_USDC_MINT);
  const source = getAssociatedTokenAddressSync(mint, payer.publicKey),
    destination = getAssociatedTokenAddressSync(mint, to, true);
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  });
  if (request.asset === "SOL")
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: to,
        lamports: BigInt(actualAmount),
      }),
    );
  else {
    if (createsAta)
      tx.add(
        createAssociatedTokenAccountIdempotentInstruction(
          payer.publicKey,
          destination,
          to,
          mint,
        ),
      );
    tx.add(
      createTransferCheckedInstruction(
        source,
        mint,
        destination,
        payer.publicKey,
        BigInt(actualAmount),
        6,
      ),
    );
  }
  tx.instructions
    .at(-1)!
    .keys.push({ pubkey: reference, isSigner: false, isWritable: false });
  tx.sign(payer);
  const message = tx.compileMessage(),
    keys = message.accountKeys,
    pre = keys.map(() => 10000000),
    post = [...pre];
  post[0] -= 5000;
  if (request.asset === "SOL") {
    post[0] -= Number(actualAmount);
    post[keys.findIndex((k) => k.equals(to))] += Number(actualAmount);
  }
  const token = (account: PublicKey, owner: PublicKey, amount: string) => ({
    accountIndex: keys.findIndex((k) => k.equals(account)),
    mint: mint.toBase58(),
    owner: owner.toBase58(),
    uiTokenAmount: {
      amount,
      decimals: 6,
      uiAmount: null,
      uiAmountString: "synthetic fixture",
    },
  });
  const signature = base58(tx.signature!);
  const transaction = {
    version: "legacy",
    slot: 42,
    blockTime: Math.floor(Date.now() / 1000),
    transaction: { message, signatures: [signature] },
    meta: {
      err: null,
      fee: 5000,
      preBalances: pre,
      postBalances: post,
      preTokenBalances:
        request.asset === "SPL"
          ? [
              token(source, payer.publicKey, "2000000"),
              ...(createsAta ? [] : [token(destination, to, "1000000")]),
            ]
          : [],
      postTokenBalances:
        request.asset === "SPL"
          ? [
              token(
                source,
                payer.publicKey,
                (2000000n - BigInt(actualAmount)).toString(),
              ),
              token(
                destination,
                to,
                (
                  (createsAta ? 0n : 1000000n) + BigInt(actualAmount)
                ).toString(),
              ),
            ]
          : [],
    },
  } as VersionedTransactionResponse;
  const status: SignatureStatus = {
    slot: 42,
    confirmations: null,
    err: null,
    confirmationStatus: "finalized",
  };
  return { signature, transaction, status };
}
describe.skipIf(!process.env.AGUS_TEST_DATABASE_URL)(
  "external Solana Pay reference discovery",
  () => {
    let f: Awaited<ReturnType<typeof sharedPlatform>>;
    beforeAll(async () => {
      f = await sharedPlatform(3);
      vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
    }, 60000);
    afterAll(async () => {
      await f?.close();
    });
    async function request(asset: "SOL" | "SPL" = "SOL") {
      const r = await createRequest(f.users[0].id, randomUUID(), {
        recipient: Keypair.generate().publicKey.toBase58(),
        asset,
        amountAtoms: "1000000",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      const terms: RequestTerms = {
        reference: String(r.reference),
        recipient: String(r.recipient),
        asset,
        amountAtoms: "1000000",
        mint: asset === "SOL" ? null : CIRCLE_DEVNET_USDC_MINT,
        scale: asset === "SOL" ? 9 : 6,
      };
      return { id: r.id, terms };
    }
    function rpc(t: ReturnType<typeof signed>): RequestChainReader {
      return {
        genesis: vi.fn(async () => DEVNET_GENESIS),
        signatures: vi.fn(async () => [{ signature: t.signature, err: null }]),
        read: vi.fn(async () => ({
          status: t.status,
          transaction: t.transaction,
        })),
      };
    }
    it("finds direct SOL and classic-USDC QR payments without an AGUS draft using signatures, exact reference/amount and finalized balance evidence", async () => {
      for (const asset of ["SOL", "SPL"] as const) {
        const r = await request(asset),
          payment = signed(r.terms, r.terms.amountAtoms, asset === "SPL");
        const found = await discoverRequest(
          f.users[0].id,
          r.id,
          undefined,
          rpc(payment),
        );
        expect(found.request).toMatchObject({ status: "paid", payable: false });
        expect(found.matches).toEqual([
          { signature: payment.signature, additionalPayment: false },
        ]);
        expect(found.historyComplete).toBe(false);
        expect(
          (await requestReceipts(f.users[0].id, r.id, "", 10))[0],
        ).toMatchObject({
          kind: "primary",
          signature: payment.signature,
          sender:
            payment.transaction.transaction.message.staticAccountKeys[0].toBase58(),
        });
        expect(
          (
            await f.admin.query(
              "SELECT * FROM agus_request_drafts WHERE request_id=$1",
              [r.id],
            )
          ).rows,
        ).toHaveLength(0);
      }
    });
    it("reconciles concurrent repeated reads once and records an additional verified payment without authorizing any refund", async () => {
      const r = await request(),
        payment = signed(r.terms),
        reader = rpc(payment);
      await Promise.all([
        matchExternalRequest(f.users[0].id, r.id, payment.signature, reader),
        matchExternalRequest(f.users[0].id, r.id, payment.signature, reader),
      ]);
      const second = signed(r.terms);
      const extra = await matchExternalRequest(
        f.users[0].id,
        r.id,
        second.signature,
        rpc(second),
      );
      expect(extra).toMatchObject({
        status: "paid_multiple",
        manualReviewRequired: true,
        additionalPayment: true,
        automaticRefundAuthorized: false,
      });
      await matchExternalRequest(
        f.users[0].id,
        r.id,
        second.signature,
        rpc(second),
      );
      expect(await requestReceipts(f.users[0].id, r.id, "", 10)).toHaveLength(
        2,
      );
      expect(
        (
          await f.admin.query(
            "SELECT * FROM agus_jobs WHERE effect_key LIKE $1",
            [`request:${r.id}:%`],
          )
        ).rows,
      ).toHaveLength(2);
      expect((await getRequest(f.users[0].id, r.id)).revision).toBe(2);
    });
    it("does not turn pending, pruned, mismatched or failed observations into payment failure or a confirmed receipt", async () => {
      const r = await request(),
        wrong = signed(r.terms, "999999");
      const found = await discoverRequest(
        f.users[0].id,
        r.id,
        undefined,
        rpc(wrong),
      );
      expect(found.matches).toHaveLength(0);
      expect(found.unresolved[0].code).toBe("REQUEST_TRANSFER_MISMATCH");
      const pending = signed(r.terms);
      pending.status.confirmationStatus = "confirmed";
      expect(
        (await discoverRequest(f.users[0].id, r.id, undefined, rpc(pending)))
          .unresolved[0].code,
      ).toBe("REQUEST_FINALITY_PENDING");
      const unavailable = rpc(signed(r.terms));
      unavailable.read = vi.fn(async () => ({
        status: null,
        transaction: null,
      }));
      expect(
        (await discoverRequest(f.users[0].id, r.id, undefined, unavailable))
          .matches,
      ).toHaveLength(0);
      expect(await getRequest(f.users[0].id, r.id)).toMatchObject({
        status: "open",
        settlementSignature: null,
      });
    });
    it("checks ownership before reading RPC and pins network identity, transfer deltas and bounded reference cursors", async () => {
      const r = await request(),
        payment = signed(r.terms),
        reader = rpc(payment);
      await expect(
        discoverRequest(f.users[1].id, r.id, undefined, reader),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(reader.genesis).not.toHaveBeenCalled();
      const wrongNetwork = rpc(payment);
      wrongNetwork.genesis = vi.fn(async () => "mainnet");
      await expect(
        discoverRequest(f.users[0].id, r.id, undefined, wrongNetwork),
      ).rejects.toMatchObject({ code: "WRONG_DEVNET_GENESIS" });
      const broken = signed(r.terms);
      broken.transaction.meta!.postBalances[1] = 0;
      expect(() =>
        inspectRequestPayment(r.terms, broken.signature, {
          genesisHash: DEVNET_GENESIS,
          status: broken.status,
          transaction: broken.transaction,
        }),
      ).toThrow();
      const page = rpc(payment);
      page.signatures = vi.fn(async () =>
        Array.from({ length: 6 }, () => ({
          signature: base58(randomBytes(64)),
          err: { syntheticFailure: true },
        })),
      );
      const a = await discoverRequest(f.users[0].id, r.id, undefined, page);
      expect(a.unresolved).toHaveLength(5);
      expect(a.nextCursor).toBeTruthy();
      expect(page.read).not.toHaveBeenCalled();
      const other = await request();
      await expect(
        discoverRequest(f.users[0].id, other.id, a.nextCursor!, page),
      ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    });
    it("persists a per-owner public-chain read budget and does not use failed reads as authority to resend", async () => {
      const r = await request(),
        empty = rpc(signed(r.terms));
      empty.signatures = vi.fn(async () => []);
      await f.admin.query("DELETE FROM auth_attempts WHERE key=$1", [
        `request-chain:${f.users[0].id}`,
      ]);
      for (let i = 0; i < 12; i++)
        expect(
          (await discoverRequest(f.users[0].id, r.id, undefined, empty))
            .matches,
        ).toHaveLength(0);
      await expect(
        discoverRequest(f.users[0].id, r.id, undefined, empty),
      ).rejects.toMatchObject({ code: "REQUEST_DISCOVERY_THROTTLED" });
      expect(await getRequest(f.users[0].id, r.id)).toMatchObject({
        status: "open",
        settlementSignature: null,
      });
    });
  },
);
