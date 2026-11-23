import { randomUUID, sign } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { base58 } from "@scure/base";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  type Connection,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { GET, POST } from "../src/app/api/v1/crypto/[[...path]]/route";
import {
  associate,
  challenge,
  listWallets,
} from "../src/server/crypto/registry";
import {
  normalizeTransaction,
  attributeEvent,
} from "../src/server/crypto/ledger";
import { evaluateAlertRule } from "../src/server/crypto/alerts";
import { getAttempt, reconcileCrypto } from "../src/server/crypto/execution";
import { portfolio, sol } from "../src/server/crypto/portfolio";
import { cryptoRpc } from "../src/server/crypto/rpc";
import { createIdentity } from "../src/server/auth";
import { sharedPlatform } from "./helpers/shared-platform";

const devnet = "devnet";
const liveGeminiKey = process.env.AI_API_KEY;
const mockSender = Keypair.generate();
const mockRecipient = Keypair.generate();
const outsider = Keypair.generate().publicKey.toBase58();
const signature = base58.encode(Buffer.alloc(64, 43));

function proof(key: Keypair, message: string) {
  return base58.encode(
    sign(null, Buffer.from(message, "base64"), {
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(key.secretKey.subarray(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    }),
  );
}

function parsedTransfer(from: string, to: string, sig = signature) {
  return {
    blockTime: Math.trunc(Date.now() / 1000),
    slot: 1234,
    transaction: {
      signatures: [sig],
      message: {
        accountKeys: [
          { pubkey: new PublicKey(from) },
          { pubkey: new PublicKey(to) },
        ],
        instructions: [
          {
            programId: SystemProgram.programId,
            parsed: {
              type: "transfer",
              info: { source: from, destination: to, lamports: 1000000 },
            },
          },
        ],
      },
    },
    meta: { fee: 5000, err: null },
  } as unknown as ParsedTransactionWithMeta;
}

describe.skipIf(!process.env.AGUS_TEST_DATABASE_URL)(
  "AGUS Crypto PostgreSQL and authenticated API",
  () => {
    let fixture: Awaited<ReturnType<typeof sharedPlatform>>;
    const origin = "http://localhost:3000";
    beforeAll(async () => {
      fixture = await sharedPlatform(2);
      vi.stubEnv("AGUS_CRYPTO_MONITORING", "true");
    });
    afterAll(async () => {
      await fixture?.close();
    });

    function request(
      index: number,
      path: string,
      value?: unknown,
      key = randomUUID(),
    ) {
      const url = origin + "/api/v1/crypto/" + path;
      return new Request(url, {
        method: value === undefined ? "GET" : "POST",
        headers: {
          cookie: fixture.users[index].cookie,
          origin,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        ...(value !== undefined && { body: JSON.stringify(value) }),
      });
    }

    it("deduplicates logical wallets, binds ownership proof to session and rejects cross-user reads", async () => {
      const p = fixture.users[0],
        address = mockSender.publicKey.toBase58();
      const watched = await POST(
        request(0, "wallets/watch", {
          cluster: devnet,
          address,
          label: "Daily",
          ownDeclared: false,
        }),
      );
      expect(watched.status).toBe(200);
      const original = await watched.json();
      for (const provider of ["phantom", "solflare"] as const) {
        const req = { cluster: devnet, address, provider };
        const challengeResponse = await POST(
          request(0, "wallets/challenge", req),
        );
        expect(challengeResponse.status).toBe(200);
        const issued = await challengeResponse.json();
        const payload = {
          challengeId: issued.id,
          signature: proof(mockSender, issued.messageBase64),
        };
        await expect(
          associate({ ...p, sessionId: randomUUID() }, payload, randomUUID()),
        ).rejects.toThrow("OWNERSHIP_PROOF_REQUIRED");
        expect(
          (
            await POST(
              request(0, "wallets/association", {
                ...payload,
                signature: proof(mockRecipient, issued.messageBase64),
              }),
            )
          ).status,
        ).toBe(403);
        const key = randomUUID(),
          associated = await POST(
            request(0, "wallets/association", payload, key),
          );
        expect(associated.status).toBe(200);
        const body = await associated.json();
        expect(body.id).toBe(original.id);
        expect(
          (await POST(request(0, "wallets/association", payload, key))).status,
        ).toBe(200);
        expect(
          (await POST(request(0, "wallets/association", payload))).status,
        ).toBe(403);
      }
      const wallets = await listWallets(p.id, { cluster: devnet }, true);
      expect(wallets).toHaveLength(1);
      expect(wallets[0].routes).toHaveLength(2);
      expect(
        (
          await GET(
            request(1, `wallets?cluster=devnet&walletIds=${wallets[0].id}`),
          )
        ).status,
      ).toBe(404);
    });

    async function associateTestWallet(owner: number, key: Keypair) {
      const p = fixture.users[owner];
      const issued = await challenge(
        p,
        {
          address: key.publicKey.toBase58(),
          cluster: devnet,
          provider: "phantom",
        },
        randomUUID(),
      );
      return associate(
        p,
        { challengeId: issued.id, signature: proof(key, issued.messageBase64) },
        randomUUID(),
      );
    }

    it("keeps one finalized alert across worker replay and retains canonical wallet attribution", async () => {
      const p = fixture.users[0];
      const sender = await associateTestWallet(0, mockSender);
      const recipient = await associateTestWallet(0, mockRecipient);
      const rule = await POST(
        request(0, "alert-rules", {
          walletId: recipient.id,
          kind: "external_inflow",
        }),
      );
      expect(rule.status).toBe(200);
      const { id } = await rule.json();
      await fixture.admin.query(
        "UPDATE agus_crypto_alert_rules SET activated_at=now()-interval '1 minute' WHERE id=$1",
        [id],
      );
      for (const [from, sig] of [
        [sender.address, base58.encode(Buffer.alloc(64, 42))],
        [outsider, signature],
      ]) {
        const event = normalizeTransaction(
          devnet,
          sig,
          parsedTransfer(from, recipient.address, sig),
        )!;
        expect(attributeEvent(event, [sender, recipient]).classification).toBe(
          from === sender.address ? "internal" : "incoming",
        );
        await fixture.admin.query(
          "INSERT INTO agus_crypto_chain_events VALUES($1,$2,$3,$4,$5::jsonb)",
          [devnet, sig, event.slot, event.blockTime, JSON.stringify(event)],
        );
        await fixture.admin.query(
          "INSERT INTO agus_crypto_wallet_events(owner,wallet_id,cluster,signature) VALUES($1,$2,$3,$4)",
          [p.id, recipient.id, devnet, sig],
        );
      }
      await Promise.all([
        evaluateAlertRule(p.id, devnet, id),
        evaluateAlertRule(p.id, devnet, id),
      ]);
      await evaluateAlertRule(p.id, devnet, id);
      const inbox = await GET(request(0, "alerts?cluster=devnet"));
      expect(inbox.status).toBe(200);
      const items = (await inbox.json()).items;
      expect(items).toHaveLength(1);
      expect(items[0].eventId).toBe(`devnet:${signature}`);
      const read = await POST(request(0, `alerts/${items[0].id}/read`, {}));
      expect((await read.json()).readAt).toBeTruthy();
      expect(
        (await GET(request(1, `activity/${items[0].eventId}?cluster=devnet`)))
          .status,
      ).toBe(404);
    });

    it("durably grants one handoff and reconciles an exact finalized message after a lost callback", async () => {
      vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
      vi.stubEnv("AGUS_CRYPTO_DEVNET_ROUTES", "phantom");
      const p = fixture.users[0],
        wallet = await associateTestWallet(0, mockSender);
      const route = wallet.routes.find((item) => item.provider === "phantom")!;
      const id = randomUUID(),
        reviewDigest = "a".repeat(64);
      const tx = new Transaction();
      tx.feePayer = mockSender.publicKey;
      tx.recentBlockhash = outsider;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: mockSender.publicKey,
          toPubkey: mockRecipient.publicKey,
          lamports: 1000000n,
        }),
      );
      const { createHash } = await import("node:crypto");
      const review = {
        id,
        revision: 0,
        reviewDigest,
        routeId: route.id,
        cluster: devnet,
        expectedSigner: wallet.address,
        sourceWalletId: wallet.id,
        reference: outsider,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        messageDigest: createHash("sha256")
          .update(tx.serializeMessage())
          .digest("hex"),
        recipient: mockRecipient.publicKey.toBase58(),
        sourceTokenAccount: null,
        destinationTokenAccount: null,
        amount: sol(devnet, 1_000_000n),
      };
      await fixture.admin.query(
        "INSERT INTO agus_crypto_reviews VALUES($1,$2,$3,$4,$5::jsonb)",
        [p.id, id, wallet.id, "fixture-fingerprint", JSON.stringify(review)],
      );
      const begin = await POST(
        request(0, `reviews/${id}/begin`, { revision: 0, reviewDigest }),
      );
      expect(begin.status).toBe(200);
      const attempt = await begin.json();
      const key = randomUUID();
      const responses = await Promise.all(
        Array.from({ length: 4 }, () =>
          POST(request(0, `attempts/${attempt.id}/handoff`, {}, key)),
        ),
      );
      const claims = await Promise.all(
        responses.map((response) => response.json()),
      );
      expect(claims.filter((claim) => claim.launchGranted)).toHaveLength(1);
      const unknown = await POST(
        request(0, `attempts/${attempt.id}/wallet-outcome`, {
          kind: "unknown",
        }),
      );
      expect((await unknown.json()).state).toBe("unknown");
      expect((await getAttempt(p.id, attempt.id)).receiptId).toBeNull();

      const finalSig = base58.encode(Buffer.alloc(64, 44));
      const chain = {
        getSignaturesForAddress: async () => [{ signature: finalSig }],
        getTransaction: async () => ({
          version: "legacy",
          slot: 1234,
          meta: { err: null, fee: 5000 },
          transaction: { signatures: [finalSig], message: tx.compileMessage() },
        }),
        getParsedTransaction: async () =>
          parsedTransfer(wallet.address, review.recipient, finalSig),
      } as unknown as Connection;
      const settled = await Promise.all([
        reconcileCrypto(p.id, attempt.id, async () => chain),
        reconcileCrypto(p.id, attempt.id, async () => chain),
      ]);
      expect(settled[0].state).toBe("finalized");
      expect(settled[0].receiptId).toBe(settled[1].receiptId);
      const receipt = await GET(request(0, `receipts/${settled[0].receiptId}`));
      expect((await receipt.json()).signature).toBe(finalSig);
      expect(
        (await GET(request(1, `receipts/${settled[0].receiptId}`))).status,
      ).toBe(404);
    });

    it("supports public email verification and reset with the existing identity tables", async () => {
      vi.stubEnv("AGUS_AUTH_PUBLIC", "true");
      vi.stubEnv("BETTER_AUTH_URL", "https://auth.fixture.invalid");
      vi.stubEnv("RESEND_API_KEY", "disposable-mail-provider-fixture");
      vi.stubEnv("AGUS_AUTH_EMAIL_FROM", "AGUS <mail@fixture.invalid>");
      const deliveries: Array<{ subject: string; text: string }> = [];
      const fetcher = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (_url, init) => {
          deliveries.push(JSON.parse(String(init?.body)));
          return Response.json({ id: "mail-fixture" });
        });
      const auth = await createIdentity();
      const email = "registered@fixture.invalid",
        password = "disposable-registration-password";
      const call = (path: string, data?: unknown) =>
        auth.handler(
          new Request(`https://auth.fixture.invalid/api/auth/${path}`, {
            method: data ? "POST" : "GET",
            headers: {
              origin: "https://auth.fixture.invalid",
              "content-type": "application/json",
            },
            ...(data !== undefined && { body: JSON.stringify(data) }),
          }),
        );
      try {
        expect(
          (await call("sign-up/email", { email, password, name: "Registered" }))
            .status,
        ).toBe(200);
        expect((await call("sign-in/email", { email, password })).status).toBe(
          403,
        );
        const verification = deliveries
          .find((mail) => mail.subject === "Verify your AGUS email")
          ?.text.match(/https:\/\/[^\s]+/)?.[0];
        expect(verification).toBeTruthy();
        expect(
          (await auth.handler(new Request(verification!))).status,
        ).toBeLessThan(400);
        expect((await call("sign-in/email", { email, password })).status).toBe(
          200,
        );
        expect(
          (
            await call("request-password-reset", {
              email,
              redirectTo: "https://auth.fixture.invalid/reset",
            })
          ).status,
        ).toBe(200);
        const reset = deliveries
          .find((mail) => mail.subject === "Reset your AGUS password")
          ?.text.match(/https:\/\/[^\s]+/)?.[0];
        expect(reset).toBeTruthy();
        const token = new URL(reset!).pathname.split("/").at(-1);
        expect(
          (
            await call("reset-password", {
              token,
              newPassword: "changed-disposable-password",
            })
          ).status,
        ).toBe(200);
        expect(
          (
            await call("sign-in/email", {
              email,
              password: "changed-disposable-password",
            })
          ).status,
        ).toBe(200);
      } finally {
        fetcher.mockRestore();
        vi.stubEnv("AGUS_AUTH_PUBLIC", undefined);
        vi.stubEnv("BETTER_AUTH_URL", origin);
        vi.stubEnv("RESEND_API_KEY", undefined);
        vi.stubEnv("AGUS_AUTH_EMAIL_FROM", undefined);
      }
    });

    it.skipIf(process.env.AGUS_CRYPTO_LIVE_READS !== "true")(
      "serves verified public Devnet balance, history and mint identity",
      async () => {
        const publicAddress = "47vuSgvjhkYoqz6A3VgDpGLth1LjQM7G9VqZr2wcwmbC";
        const watched = await POST(
          request(0, "wallets/watch", {
            cluster: devnet,
            address: publicAddress,
            label: "Public Devnet test address",
            ownDeclared: false,
          }),
        );
        expect(watched.status).toBe(200);
        const wallet = await watched.json();
        const snapshot = await portfolio(fixture.users[0].id, {
          cluster: devnet,
          walletIds: [wallet.id],
        });
        const chain = await cryptoRpc(devnet);
        const actual = await chain.getBalance(
          new PublicKey(publicAddress),
          "finalized",
        );
        expect(
          snapshot.holdings.find((item) => item.amount.asset.kind === "sol")
            ?.amount.atoms,
        ).toBe(String(actual));
        expect(snapshot.source.mode).toBe("public-rpc");
        const response = await GET(
          request(0, `activity?cluster=devnet&walletIds=${wallet.id}`),
        );
        expect(response.status).toBe(200);
        const { items, coverage } = await response.json();
        expect(
          items.some(
            (item: { finality: string; explorerUrl: string }) =>
              item.finality === "finalized" &&
              item.explorerUrl.includes("?cluster=devnet"),
          ),
          JSON.stringify(coverage),
        ).toBe(true);
      },
    );
    it.skipIf(process.env.AGUS_CRYPTO_LIVE_READS !== "true" || !liveGeminiKey)(
      "grounds a live Gemini response in an exact scoped Devnet balance",
      async () => {
        vi.stubEnv("AI_PROVIDER", "gemini");
        vi.stubEnv("AI_API_KEY", liveGeminiKey);
        vi.stubEnv("AGUS_CRYPTO_AI_DAILY", "1");
        const p = fixture.users[0];
        const wallets = await listWallets(p.id, { cluster: devnet });
        const wallet = wallets.find(
          (item) => item.label === "Public Devnet test address",
        )!;
        const ask = {
          text: "What is my SOL balance?",
          scope: { cluster: devnet, walletIds: [wallet.id] },
          reportingTimeZone: "UTC",
          clientTurnId: randomUUID(),
        };
        const key = randomUUID();
        const response = await POST(request(0, "assistant/turns", ask, key));
        const answer = await response.json();
        expect(response.status).toBe(200);
        expect(answer.kind).toBe("answer");
        const chain = await cryptoRpc(devnet);
        const exact = await chain.getBalance(
          new PublicKey(wallet.address),
          "finalized",
        );
        expect(answer.facts).toEqual([sol(devnet, BigInt(exact))]);
        expect(answer.evidence[0].kind).toBe("portfolio");
        expect(
          (await (await POST(request(0, "assistant/turns", ask, key))).json())
            .turnId,
        ).toBe(answer.turnId);
        expect(
          (
            await POST(
              request(0, "assistant/turns", {
                ...ask,
                clientTurnId: randomUUID(),
              }),
            )
          ).status,
        ).toBe(429);
        expect(
          (
            await GET(
              request(0, `portfolio?cluster=devnet&walletIds=${wallet.id}`),
            )
          ).status,
        ).toBe(200);
      },
    );
  },
);
