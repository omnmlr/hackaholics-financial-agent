import { execFile } from "node:child_process";
import { createHash, randomUUID, sign } from "node:crypto";
import { lstat, open, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { base58 } from "@scure/base";
import {
  Keypair,
  PublicKey,
  SystemInstruction,
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
import {
  evaluateAlertRule,
  runCryptoMonitoring,
} from "../src/server/crypto/alerts";
import {
  getAttempt,
  reconcileCrypto,
  runCryptoReconciliation,
} from "../src/server/crypto/execution";
import { portfolio, sol } from "../src/server/crypto/portfolio";
import { service as solanaService } from "../src/lib/solana";
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
    let preserveAcceptanceDatabase = false;
    beforeAll(async () => {
      fixture = await sharedPlatform(2);
      vi.stubEnv("AGUS_CRYPTO_MONITORING", "true");
    });
    afterAll(async () => {
      await fixture?.close(preserveAcceptanceDatabase);
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

    it("registers concurrent watch wallets for the same owner", async () => {
      const addresses = Array.from({ length: 6 }, () =>
        Keypair.generate().publicKey.toBase58(),
      );
      const responses = await Promise.all(
        addresses.map((address) =>
          POST(
            request(1, "wallets/watch", {
              cluster: devnet,
              address,
              label: "Concurrent watch",
              ownDeclared: false,
            }),
          ),
        ),
      );
      expect(responses.map(({ status }) => status)).toEqual(
        addresses.map(() => 200),
      );
      const wallets = await Promise.all(
        responses.map((response) => response.json()),
      );
      expect(new Set(wallets.map(({ id }) => id)).size).toBe(addresses.length);
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
      tx.instructions[0].keys.push({
        pubkey: new PublicKey(outsider),
        isSigner: false,
        isWritable: false,
      });
      tx.sign(mockSender);
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
      const begins = await Promise.all(
        Array.from({ length: 3 }, () =>
          POST(
            request(0, `reviews/${id}/begin`, { revision: 0, reviewDigest }),
          ),
        ),
      );
      expect(begins.map(({ status }) => status)).toEqual([200, 200, 200]);
      const [attempt, ...replays] = await Promise.all(
        begins.map((response) => response.json()),
      );
      expect(replays.map(({ id }) => id)).toEqual([attempt.id, attempt.id]);
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

      const finalSig = base58.encode(tx.signature!);
      const pre = [2_000_000, 0, 0, 0];
      let post = [995_000, 900_000, 0, 0];
      const chain = {
        getSignaturesForAddress: async () => [{ signature: finalSig }],
        getTransaction: async () => ({
          version: "legacy",
          slot: 1234,
          meta: { err: null, fee: 5000, preBalances: pre, postBalances: post },
          transaction: { signatures: [finalSig], message: tx.compileMessage() },
        }),
        getSignatureStatuses: async () => ({
          value: [{ confirmationStatus: "finalized", slot: 1234, err: null }],
        }),
        getParsedTransaction: async () =>
          parsedTransfer(wallet.address, review.recipient, finalSig),
      } as unknown as Connection;
      const diagnostic = await POST(
        request(0, `attempts/${attempt.id}/wallet-outcome`, {
          kind: "unknown",
          reason: "WALLET_SUBMISSION_UNCERTAIN",
        }),
      );
      expect(await diagnostic.json()).toMatchObject({
        state: "unknown",
        reason: "WALLET_SUBMISSION_UNCERTAIN",
        receiptId: null,
      });
      const wrongEffects = await reconcileCrypto(
        p.id,
        attempt.id,
        async () => chain,
      );
      expect(wrongEffects.state).toBe("unknown");
      expect(wrongEffects.receiptId).toBeNull();
      post = [995_000, 1_000_000, 0, 0];
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

    it("creates an owned Devnet request with a private invoice and a network-labeled PNG share link", async () => {
      vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
      vi.stubEnv("AGUS_CRYPTO_REQUESTS", "true");
      vi.stubEnv("AGUS_CRYPTO_INVOICES", "true");
      const wallet = await associateTestWallet(0, mockRecipient);
      const args = {
        walletId: wallet.id,
        amount: sol(devnet, 1_000_000n),
        invoice: { title: "Consulting", notes: "Private fixture note" },
      };
      const key = randomUUID();
      const response = await POST(request(0, "requests", args, key));
      expect(response.status).toBe(200);
      const created = await response.json();
      expect(
        (await (await POST(request(0, "requests", args, key))).json()).id,
      ).toBe(created.id);
      expect((await GET(request(1, `requests/${created.id}`))).status).toBe(
        404,
      );
      const shared = await GET(new Request(created.shareUrl));
      expect(shared.status).toBe(200);
      const publicView = await shared.json();
      expect(publicView).toMatchObject({
        network: "devnet",
        testAssets: true,
        requiresExplicitNetworkSelection: true,
      });
      expect(publicView).not.toHaveProperty("invoice");
      const png = await GET(request(0, `requests/${created.id}/qr`));
      expect(png.headers.get("content-type")).toBe("image/png");
      expect(
        Buffer.from(await png.arrayBuffer())
          .subarray(1, 4)
          .toString(),
      ).toBe("PNG");
      const cancellation = await POST(
        request(0, `requests/${created.id}/cancel`, {
          revision: created.revision,
        }),
      );
      expect((await cancellation.json()).state).toBe("cancelled");
      expect(
        (await (await GET(new Request(created.shareUrl))).json()).solanaPayUri,
      ).toBeUndefined();
    });
    describe("hosted passwordless authentication", () => {
      const hostedOrigin = "https://auth.fixture.invalid";

      function hostedEnv() {
        vi.stubEnv("AGUS_AUTH_PUBLIC", "true");
        vi.stubEnv("BETTER_AUTH_URL", hostedOrigin);
        vi.stubEnv("RESEND_API_KEY", "disposable-mail-provider-fixture");
        vi.stubEnv("AGUS_AUTH_EMAIL_FROM", "AGUS <mail@fixture.invalid>");
      }

      function requestAuth(
        auth: Awaited<ReturnType<typeof createIdentity>>,
        path: string,
        body?: unknown,
        cookie?: string,
        requestOrigin = hostedOrigin,
      ) {
        return auth.handler(
          new Request(`${hostedOrigin}/api/auth/${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: {
              origin: requestOrigin,
              "content-type": "application/json",
              ...(cookie && { cookie }),
            },
            ...(body !== undefined && { body: JSON.stringify(body) }),
          }),
        );
      }

      function cookies(response: Response) {
        return response.headers
          .getSetCookie()
          .map((cookie) => cookie.split(";")[0])
          .join("; ");
      }

      afterEach(() => {
        vi.restoreAllMocks();
        vi.stubEnv("AGUS_AUTH_PUBLIC", undefined);
        vi.stubEnv("BETTER_AUTH_URL", origin);
        vi.stubEnv("RESEND_API_KEY", undefined);
        vi.stubEnv("AGUS_AUTH_EMAIL_FROM", undefined);
        vi.stubEnv("GOOGLE_CLIENT_ID", undefined);
        vi.stubEnv("GOOGLE_CLIENT_SECRET", undefined);
      });

      it("keeps Devnet password sign-in disabled when email delivery is unavailable", async () => {
        const previous = process.env.AGUS_ENVIRONMENT;
        vi.stubEnv("AGUS_ENVIRONMENT", "devnet");
        try {
          const auth = await createIdentity();
          expect(
            (
              await auth.handler(
                new Request(`${origin}/api/auth/sign-in/email`, {
                  method: "POST",
                  headers: { origin, "content-type": "application/json" },
                  body: JSON.stringify({
                    email: "market0@fixture.invalid",
                    password: "fixture-market-password-only",
                  }),
                }),
              )
            ).status,
          ).toBe(404);
        } finally {
          vi.stubEnv("AGUS_ENVIRONMENT", previous);
        }
      });

      it("creates one verified account and restricts resend, expiry, attempts and replay", async () => {
        hostedEnv();
        const deliveries: Array<{ text: string; to: string[] }> = [];
        vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
          expect(String(url)).toBe("https://api.resend.com/emails");
          deliveries.push(JSON.parse(String(init?.body)));
          return Response.json({ id: "mail-fixture" });
        });
        const auth = await createIdentity();
        const email = "registered@fixture.invalid";
        const issue = () =>
          requestAuth(auth, "email-otp/send-verification-otp", {
            email,
            type: "sign-in",
          });
        const verify = (otp: string) =>
          requestAuth(auth, "sign-in/email-otp", { email, otp });
        const latestCode = () =>
          deliveries.at(-1)!.text.match(/\b[0-9]{6}\b/)![0];

        const issued = await Promise.all([issue(), issue()]);
        expect(issued.map((result) => result.status).sort()).toEqual([
          200, 429,
        ]);
        expect(deliveries).toHaveLength(1);
        expect(deliveries[0].to).toEqual([email]);
        expect(deliveries[0].text).not.toContain("https://");
        expect(
          await fixture.admin
            .query("SELECT id FROM agus_users WHERE email=$1", [email])
            .then(({ rows }) => rows),
        ).toEqual([]);
        expect(
          (
            await fixture.admin.query(
              "SELECT value FROM agus_verifications WHERE id LIKE 'agus-login-otp-%'",
            )
          ).rows.at(-1)?.value,
        ).toMatch(/^[a-f0-9]{64}:0$/);

        const verified = await Promise.all([
          verify(latestCode()),
          verify(latestCode()),
        ]);
        expect(verified.map((result) => result.status).sort()).toEqual([
          200, 400,
        ]);
        const accepted = verified.find((result) => result.ok)!;
        const user = (await accepted.json()).user;
        expect(user).toMatchObject({
          email,
          emailVerified: true,
          role: "consumer",
        });
        const sessionCookie = cookies(accepted);
        expect(
          (
            await (
              await requestAuth(auth, "get-session", undefined, sessionCookie)
            ).json()
          ).user.id,
        ).toBe(user.id);
        expect((await issue()).status).toBe(429);
        expect(
          (
            await requestAuth(auth, "sign-up/email", {
              email,
              password: "legacy-disposable-password",
              name: "Legacy",
            })
          ).status,
        ).toBe(404);

        const allowResend = async () => {
          await fixture.admin.query(
            "UPDATE agus_verifications SET updated_at=now()-interval '61 seconds' WHERE id LIKE 'agus-login-otp-%'",
          );
          await fixture.admin.query(
            "UPDATE agus_rate_limit SET last_request=last_request-61000",
          );
        };
        await allowResend();
        expect((await issue()).status).toBe(200);
        const incorrectCode = latestCode() === "000000" ? "000001" : "000000";
        for (let i = 0; i < 5; i++) {
          // Model distinct rate-limit windows while keeping the same OTP alive.
          await fixture.admin.query(
            "UPDATE agus_rate_limit SET last_request=last_request-61000",
          );
          expect((await verify(incorrectCode)).status).toBe(400);
        }
        await fixture.admin.query(
          "UPDATE agus_rate_limit SET last_request=last_request-61000",
        );
        expect((await verify(latestCode())).status).toBe(403);

        await allowResend();
        expect((await issue()).status).toBe(200);
        await fixture.admin.query(
          "UPDATE agus_verifications SET expires_at=now()-interval '1 second' WHERE id LIKE 'agus-login-otp-%'",
        );
        expect((await verify(latestCode())).status).toBe(400);

        await fixture.admin.query(
          "UPDATE agus_users SET two_factor_enabled=true WHERE id=$1",
          [user.id],
        );
        await allowResend();
        expect((await issue()).status).toBe(200);
        const gated = await verify(latestCode());
        expect(gated.status).toBe(200);
        expect(await gated.json()).toMatchObject({ twoFactorRedirect: true });
        expect(
          await (
            await requestAuth(auth, "get-session", undefined, cookies(gated))
          ).json(),
        ).toBeNull();

        expect(
          (await requestAuth(auth, "sign-out", {}, sessionCookie)).status,
        ).toBe(200);
        expect(
          await (
            await requestAuth(auth, "get-session", undefined, sessionCookie)
          ).json(),
        ).toBeNull();
      });

      it("delivers native Google sessions through a one-time verifier and keeps web callbacks intact", async () => {
        hostedEnv();
        vi.stubEnv("GOOGLE_CLIENT_ID", "google-fixture-id");
        vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-fixture-secret");
        const auth = await createIdentity();
        const google = (await (await auth.$context).socialProviders).find(
          ({ id }) => id === "google",
        )!;
        vi.spyOn(google, "validateAuthorizationCode").mockResolvedValue({
          accessToken: "fixture-access-token",
        });
        vi.spyOn(google, "getUserInfo").mockResolvedValue({
          user: {
            name: "Google Fixture",
            email: "google@fixture.invalid",
            emailVerified: true,
          },
          data: { sub: "fixture-google-subject" },
        });
        async function authorize(
          callbackURL: string,
          requestOrigin = hostedOrigin,
        ) {
          const start = await requestAuth(
            auth,
            "sign-in/social",
            { provider: "google", callbackURL },
            undefined,
            requestOrigin,
          );
          expect(start.status).toBe(200);
          const state = new URL((await start.json()).url).searchParams.get(
            "state",
          );
          return requestAuth(
            auth,
            "callback/google?code=disposable-code&state=" + state,
            undefined,
            cookies(start),
          );
        }
        const verifier = "a".repeat(64);
        const challenge = createHash("sha256").update(verifier).digest("hex");
        const callbackURL = "agus://open/auth?challenge=" + challenge;
        const native = await authorize(callbackURL, "agus://");
        expect(native.status).toBe(302);
        expect(native.headers.get("location")).toBe(callbackURL);
        expect(cookies(native)).not.toContain("session_token");
        const exchange = (value: string) =>
          requestAuth(
            auth,
            "mobile-google/exchange",
            { verifier: value },
            undefined,
            "agus://",
          );
        expect((await exchange("b".repeat(64))).status).toBe(401);
        const exchanged = await Promise.all([
          exchange(verifier),
          exchange(verifier),
        ]);
        expect(exchanged.map((result) => result.status).sort()).toEqual([
          200, 401,
        ]);
        const user = (await exchanged.find((result) => result.ok)!.json()).user;
        const web = await authorize(hostedOrigin + "/auth");
        expect(web.headers.get("location")).toBe(hostedOrigin + "/auth");
        expect(
          (
            await (
              await requestAuth(auth, "get-session", undefined, cookies(web))
            ).json()
          ).user.id,
        ).toBe(user.id);
      });
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
        const simulated = await solanaService().prepare(
          fixture.users[0].id,
          {
            sender: publicAddress,
            recipient: outsider,
            asset: "SOL",
            amount: "0.001",
          },
          undefined,
          false,
        );
        expect(simulated.simulation?.passed).toBe(true);
        const message = Transaction.from(
          Buffer.from(simulated.unsignedTransactionBase64, "base64"),
        ).serializeMessage();
        expect(createHash("sha256").update(message).digest("hex")).toBe(
          simulated.messageDigest,
        );
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
    it.skipIf(process.env.AGUS_CRYPTO_LIVE_READS !== "true")(
      "totals two watched Devnet accounts and indexes their shared finalized transfer once",
      async () => {
        const addresses = [
          "FBaYNnwfxbVFFuetTZGs4GDy8ccEqR3ggXDs78swm7qy",
          "AAQKVK6jegecXLDr2ssP1jcNFF5meVQdhbVPMFpz9YzZ",
        ];
        const wallets = await Promise.all(
          addresses.map(async (address) => {
            const result = await POST(
              request(0, "wallets/watch", {
                cluster: devnet,
                address,
                label: "Public Devnet acceptance wallet",
                ownDeclared: false,
              }),
            );
            expect(result.status).toBe(200);
            return result.json();
          }),
        );
        const walletIds = wallets.map((wallet) => wallet.id);
        const filters = new URLSearchParams([
          ["cluster", devnet],
          ...walletIds.map((id) => ["walletIds", id]),
        ]);
        const portfolioResponse = await GET(request(0, `portfolio?${filters}`));
        expect(portfolioResponse.status).toBe(200);
        const snapshot = await portfolioResponse.json();
        const chain = await cryptoRpc(devnet);
        const expected = await Promise.all(
          addresses.map((address) =>
            chain.getBalance(new PublicKey(address), "finalized"),
          ),
        );
        const holdings = snapshot.holdings.filter(
          (item: { amount: { asset: { kind: string } } }) =>
            item.amount.asset.kind === "sol",
        );
        expect(holdings).toHaveLength(2);
        expect(
          holdings.reduce(
            (sum: bigint, item: { amount: { atoms: string } }) =>
              sum + BigInt(item.amount.atoms),
            0n,
          ),
        ).toBe(expected.reduce((sum, value) => sum + BigInt(value), 0n));
        const activity = await GET(request(0, `activity?${filters}`));
        expect(activity.status).toBe(200);
        const sharedSig =
          "2ztFGAyjsrKmPLG84fY1jXYbZuEsaRBnVFVT9DmF4QJuBAd1GbHXaqWszd469fJSL98mBgQ78MsuJxFZo8bLidds";
        const items = (await activity.json()).items.filter(
          (item: { signature: string }) => item.signature === sharedSig,
        );
        expect(items).toHaveLength(1);
        expect(items[0].status).toBe("success");
      },
    );
    it.skipIf(!process.env.AGUS_CRYPTO_DEVNET_SIGNER_FILE)(
      "broadcasts one explicitly enabled disposable Devnet transfer and observes a finalized receipt and alert",
      async () => {
        const keyFile = process.env.AGUS_CRYPTO_DEVNET_SIGNER_FILE!;
        const evidencePath = process.env.AGUS_CRYPTO_DEVNET_EVIDENCE_FILE;
        const expectedSender = process.env.AGUS_CRYPTO_DEVNET_EXPECTED_SENDER;
        const verifierUrl = process.env.AGUS_DEVNET_VERIFY_RPC;
        if (
          !evidencePath ||
          !isAbsolute(evidencePath) ||
          !expectedSender ||
          !verifierUrl
        )
          throw new Error(
            "Set an absolute one-use evidence path, the expected sender and a separate Devnet verifier",
          );
        const attributes = await lstat(keyFile);
        if (!attributes.isFile() || attributes.mode & 0o077)
          throw new Error(
            "Keep the disposable signer in an owner-only regular file",
          );
        let sender;
        try {
          sender = Keypair.fromSecretKey(
            Uint8Array.from(JSON.parse(await readFile(keyFile, "utf8"))),
          );
        } catch {
          throw new Error("Could not load the disposable signer");
        }
        expect(sender.publicKey.toBase58()).toBe(expectedSender);
        const recipient = Keypair.generate();
        const rpc = await cryptoRpc(devnet);
        const verifier = await cryptoRpc(devnet, true);
        const [sourceBefore, destinationBefore] = await Promise.all([
          verifier.getBalance(sender.publicKey, "finalized"),
          verifier.getBalance(recipient.publicKey, "finalized"),
        ]);
        expect(sourceBefore).toBeGreaterThan(1_010_000);
        expect(destinationBefore).toBe(0);
        vi.stubEnv("AGUS_ENVIRONMENT", "devnet");
        vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
        vi.stubEnv("AGUS_CRYPTO_DEVNET_ROUTES", "phantom");
        const from = await associateTestWallet(0, sender);
        const to = await associateTestWallet(1, recipient);
        const enabled = await POST(
          request(1, "alert-rules", {
            walletId: to.id,
            kind: "external_inflow",
            min: sol(devnet, 1_000_000n),
          }),
        );
        expect(enabled.status).toBe(200);
        const rule = await enabled.json();
        const prepared = await POST(
          request(0, "reviews", {
            kind: "transfer",
            sourceWalletId: from.id,
            routeId: from.routes[0].id,
            amount: sol(devnet, 1_000_000n),
            recipient: to.address,
          }),
        );
        expect(prepared.status).toBe(200);
        const review = await prepared.json();
        const approvalBody = {
          revision: review.revision,
          reviewDigest: review.reviewDigest,
        };
        const approval = await POST(
          request(0, `reviews/${review.id}/begin`, approvalBody),
        );
        expect(approval.status).toBe(200);
        const attempt = await approval.json();
        const repeated = await POST(
          request(0, `reviews/${review.id}/begin`, approvalBody),
        );
        expect((await repeated.json()).id).toBe(attempt.id);
        const handoffPath = `attempts/${attempt.id}/handoff`;
        const handoffKey = randomUUID();
        const handoffs = await Promise.all([
          POST(request(0, handoffPath, {}, handoffKey)),
          POST(request(0, handoffPath, {}, handoffKey)),
          POST(request(0, handoffPath, {})),
        ]);
        expect(handoffs.map((response) => response.status)).toEqual([
          200, 200, 200,
        ]);
        const claims = await Promise.all(
          handoffs.map((response) => response.json()),
        );
        expect(claims.filter((claim) => claim.launchGranted)).toHaveLength(1);

        const tx = Transaction.from(
          Buffer.from(review.unsignedTransactionBase64, "base64"),
        );
        expect(tx.feePayer?.equals(sender.publicKey)).toBe(true);
        expect(
          createHash("sha256").update(tx.serializeMessage()).digest("hex"),
        ).toBe(review.messageDigest);
        expect(tx.instructions).toHaveLength(1);
        const decoded = SystemInstruction.decodeTransfer(tx.instructions[0]);
        expect(decoded.fromPubkey.equals(sender.publicKey)).toBe(true);
        expect(decoded.toPubkey.equals(recipient.publicKey)).toBe(true);
        expect(decoded.lamports).toBe(1_000_000n);
        tx.sign(sender);
        const expectedSignature = base58.encode(tx.signature!);
        const unknown = await POST(
          request(0, `attempts/${attempt.id}/wallet-outcome`, {
            kind: "unknown",
          }),
        );
        expect((await unknown.json()).state).toBe("unknown");
        expect(
          (await getAttempt(fixture.users[0].id, attempt.id)).receiptId,
        ).toBeNull();

        // Reserve the single test submission and journal public identifiers
        // before crossing the broadcast boundary.
        const evidence = await open(evidencePath, "wx", 0o600);
        preserveAcceptanceDatabase = true;
        try {
          const database = await fixture.admin.query(
            "SELECT current_database() AS name, $1::text AS runtime_role",
            [new URL(process.env.DATABASE_URL!).username],
          );
          const claim = {
            phase: "claimed",
            signature: expectedSignature,
            reviewId: review.id,
            attemptId: attempt.id,
            ruleId: rule.id,
            messageDigest: review.messageDigest,
            reference: review.reference,
            sender: from.address,
            recipient: to.address,
            sourceBefore,
            destinationBefore,
            amountLamports: 1_000_000,
            database: database.rows[0],
          };
          await evidence.writeFile(JSON.stringify(claim) + "\n");
          await evidence.sync();
          // One outbound submission. A transport failure leaves the exact
          // signature and reference available for read-only reconciliation.
          const returned = await rpc
            .sendRawTransaction(tx.serialize(), {
              skipPreflight: false,
              maxRetries: 0,
            })
            .catch(() => null);
          if (returned !== null) expect(returned).toBe(expectedSignature);
          const [payer, receiver] = fixture.users;
          let settled = await getAttempt(payer.id, attempt.id);
          for (
            let round = 0;
            round < 25 && settled.state !== "finalized";
            round++
          ) {
            await delay(2000);
            settled = await reconcileCrypto(payer.id, attempt.id);
          }
          await runCryptoReconciliation();
          expect(settled.state).toBe("finalized");
          expect(settled.signature).toBe(expectedSignature);
          const finalized = await GET(
            request(0, `receipts/${settled.receiptId}`),
          );
          expect(finalized.status).toBe(200);
          const receipt = await finalized.json();
          expect(receipt.source.mode).toBe("public-rpc");
          expect(receipt.messageDigest).toBe(review.messageDigest);
          expect(await reconcileCrypto(payer.id, attempt.id)).toMatchObject({
            state: "finalized",
            receiptId: receipt.id,
          });
          expect(
            (await (await POST(request(0, handoffPath, {}, handoffKey))).json())
              .launchGranted,
          ).toBe(false);
          const lateCallback = await POST(
            request(0, `attempts/${attempt.id}/wallet-outcome`, {
              kind: "signature",
              signature: expectedSignature,
            }),
          );
          expect(await lateCallback.json()).toMatchObject({
            state: "finalized",
            receiptId: receipt.id,
          });

          const chain = await verifier.getParsedTransaction(expectedSignature, {
            commitment: "finalized",
            maxSupportedTransactionVersion: 0,
          });
          expect(chain?.meta?.err).toBeNull();
          expect(chain?.slot).toBe(receipt.slot);
          const fee = chain!.meta!.fee;
          const [sourceAfter, destinationAfter] = await Promise.all([
            verifier.getBalance(sender.publicKey, "finalized"),
            verifier.getBalance(recipient.publicKey, "finalized"),
          ]);
          expect(sourceAfter).toBe(sourceBefore - 1_000_000 - fee);
          expect(destinationAfter).toBe(destinationBefore + 1_000_000);
          expect(receipt.feeLamports).toBe(String(fee));

          await runCryptoMonitoring();
          const inboxPath = "alerts?cluster=devnet";
          const matchingAlerts = async () => {
            const inbox = await GET(request(1, inboxPath));
            expect(inbox.status).toBe(200);
            return (await inbox.json()).items.filter(
              (item: { eventId: string }) => item.eventId === receipt.eventId,
            );
          };
          const alerts = await matchingAlerts();
          expect(alerts).toHaveLength(1);
          const marked = await POST(
            request(1, `alerts/${alerts[0].id}/read`, {}),
          );
          expect(marked.status).toBe(200);
          const read = await marked.json();
          expect(read.readAt).toBeTruthy();

          // Make this rule due again and run the actual worker in a new process.
          await fixture.admin.query(
            "UPDATE agus_crypto_alert_rules SET checked_at=NULL WHERE owner=$1 AND id=$2",
            [receiver.id, rule.id],
          );
          await promisify(execFile)(
            process.execPath,
            ["--import=tsx", "scripts/platform-worker.ts", "--once"],
            {
              timeout: 22_000,
              env: {
                ...process.env,
                AGUS_RESPONSIBILITY_RUNNER_ENABLED: "false",
              },
            },
          );
          expect(await matchingAlerts()).toEqual([read]);
          const counts = await fixture.admin.query(
            `SELECT count(*) FILTER (WHERE action='crypto.approved')::int AS approvals,
                    count(*) FILTER (WHERE action='crypto.handoff')::int AS handoffs
             FROM agus_audit WHERE owner=$1 AND resource_id=$2`,
            [payer.id, attempt.id],
          );
          expect(counts.rows[0]).toEqual({ approvals: 1, handoffs: 1 });
          await evidence.writeFile(
            JSON.stringify({
              phase: "verified",
              signature: expectedSignature,
              slot: receipt.slot,
              sourceAfter,
              destinationAfter,
              feeLamports: fee,
              receiptId: receipt.id,
              eventId: receipt.eventId,
              alertId: read.id,
              ruleId: read.ruleId,
              alertCreatedAt: read.createdAt,
              alertReadAt: read.readAt,
              counts: counts.rows[0],
            }) + "\n",
          );
          await evidence.sync();
          preserveAcceptanceDatabase = false;
          console.log(
            "Verified disposable Devnet signature",
            expectedSignature,
          );
        } finally {
          await evidence.close();
        }
      },
      120_000,
    );
  },
);
