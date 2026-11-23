import { URL } from "node:url";
import { clearTimeout } from "node:timers";
import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, scryptSync, createHmac } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { Keypair } from "@solana/web3.js";
const source = process.env.AGUS_TEST_DATABASE_URL;
if (!source?.startsWith("postgres"))
  throw new Error("AGUS_TEST_DATABASE_URL_REQUIRED");
const name = `agus_http_${randomUUID().replaceAll("-", "")}`,
  role = `agus_http_role_${randomUUID().replaceAll("-", "")}`;
const root = new Pool({ connectionString: source }),
  url = new URL(source);
let admin, server;
let logs = "";
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const port = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const origin = `http://127.0.0.1:${port}`,
  password = randomBytes(24).toString("hex"),
  salt = randomBytes(16).toString("hex");
const key = randomBytes(32).toString("base64"),
  authSecret = randomBytes(40).toString("hex");
const sensitiveValues = new Set([password, key, authSecret]);
let runtime;
function jar() {
  return {
    cookies: new Map(),
    async request(path, body, options = {}) {
      const response = await fetch(origin + path, {
        method: options.method ?? (body === undefined ? "GET" : "POST"),
        headers: {
          origin,
          cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "),
          "content-type": "application/json",
          "idempotency-key": options.key ?? randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const value of response.headers.getSetCookie()) {
        const cookie = value.split(";")[0],
          i = cookie.indexOf("=");
        const credential = cookie.slice(i + 1);
        if (credential.length >= 16) {
          sensitiveValues.add(credential);
          sensitiveValues.add(decodeURIComponent(credential));
        }
        if (/max-age=0/i.test(value)) this.cookies.delete(cookie.slice(0, i));
        else this.cookies.set(cookie.slice(0, i), cookie.slice(i + 1));
      }
      return { status: response.status, data: await response.json() };
    },
  };
}
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase())
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2))),
    counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", bytes).update(counter).digest(),
    offset = hash[19] & 15;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    "0",
  );
}
async function stop() {
  if (!server) return;
  const child = server;
  server = undefined;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 10000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
async function start() {
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { env: runtime, stdio: ["ignore", "pipe", "pipe"] },
  );
  server.stdout.on("data", (chunk) => (logs += chunk));
  server.stderr.on("data", (chunk) => (logs += chunk));
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(origin + "/api/v1/health")).ok) return;
    } catch {
      /* Server starting. */
    }
    await delay(200);
  }
  throw new Error("PLATFORM_SERVER_START_FAILED");
}
try {
  await root.query(`CREATE DATABASE "${name}"`);
  await root.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD 'fixture-http-runtime-only'`,
  );
  url.pathname = `/${name}`;
  admin = new Pool({ connectionString: url.href });
  const migration = spawnSync(
    process.execPath,
    ["--import=tsx", "scripts/migrate.ts"],
    {
      encoding: "utf8",
      timeout: 30000,
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "test",
        MIGRATION_DATABASE_URL: url.href,
      },
    },
  );
  assert.equal(migration.status, 0, "HTTP test migrations failed");
  await admin.query(
    `REVOKE CREATE ON SCHEMA public FROM PUBLIC;GRANT USAGE ON SCHEMA public TO "${role}";GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${role}";REVOKE INSERT,UPDATE,DELETE ON agus_migrations,agus_legacy_archive,agus_institutions,agus_institution_capabilities,agus_invitations,agus_fixture_escrow_authorities FROM "${role}";GRANT UPDATE(consumed_at) ON agus_invitations TO "${role}";REVOKE UPDATE,DELETE ON agus_legacy_authority,agus_p2p_events,agus_request_chain_observations FROM "${role}"`,
  );
  for (let n = 0; n < 2; n++)
    await admin.query(
      "INSERT INTO agus_invitations(email,expires_at,created_by) VALUES($1,now()+interval '1 hour','http-acceptance')",
      [`http${n}@fixture.invalid`],
    );
  url.username = role;
  url.password = "fixture-http-runtime-only";
  runtime = {
    PATH: process.env.PATH,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    DATABASE_URL: url.href,
    BETTER_AUTH_URL: origin,
    APP_ORIGIN: origin,
    BETTER_AUTH_SECRET: authSecret,
    AGUS_ENCRYPTION_ACTIVE_KEY: "http-v1",
    AGUS_ENCRYPTION_KEYS: JSON.stringify({ "http-v1": key }),
    PAYMENT_MODE: "fixture",
    AI_PROVIDER: "none",
    AI_API_KEY: "",
    PAYSTACK_SECRET_KEY: "",
    AGUS_WORKSPACE_ENABLED: "true",
    AGUS_SOLANA_DEVNET_ENABLED: "false",
    OPERATOR_ID: "legacy-http",
    OPERATOR_PASSWORD_HASH: `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  };
  await start();
  const user = jar(),
    other = jar(),
    legacy = jar();
  assert.equal((await user.request("/api/v1/ready")).status, 200);
  assert.equal(
    (
      await user.request("/api/auth/sign-up/email", {
        email: "http0@fixture.invalid",
        name: "HTTP fixture",
        password,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await other.request("/api/auth/sign-up/email", {
        email: "http1@fixture.invalid",
        name: "Other HTTP fixture",
        password,
      })
    ).status,
    200,
  );
  const anonymous = await jar().request(
    "/api/v1/crypto/wallets?cluster=devnet",
  );
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.data.error.code, "SESSION_REQUIRED");
  const watched = await user.request("/api/v1/crypto/wallets/watch", {
    cluster: "devnet",
    address: Keypair.generate().publicKey.toBase58(),
    label: "Disposable HTTP watch",
    ownDeclared: false,
  });
  assert.equal(watched.status, 200);
  assert.equal(watched.data.group, "third_party_watch");
  assert.equal(
    (await user.request("/api/v1/crypto/portfolio?cluster=devnet")).data
      .holdings.length,
    0,
  );
  assert.equal(
    (
      await other.request(
        `/api/v1/crypto/wallets?cluster=devnet&walletIds=${watched.data.id}`,
      )
    ).status,
    404,
  );
  const connection = await user.request("/api/v1/banking/connections", {
    institutionId: "wema",
    provider: "fixture",
  });
  assert.equal(connection.status, 200);
  assert.equal(
    (
      await user.request("/api/v1/banking/connections/callback", {
        connectionId: connection.data.id,
        state: connection.data.state,
        code: "fixture-consent-approved",
      })
    ).status,
    200,
  );
  const accounts = await user.request("/api/v1/banking/accounts");
  assert.equal(accounts.data.data.length, 2);
  assert.equal(
    (await other.request("/api/v1/banking/accounts")).data.data.length,
    0,
  );
  const accountId = accounts.data.data[0].id;
  const beneficiary = await user.request("/api/v1/banking/beneficiaries", {
    bankCode: "035",
    accountNumber: "0000000001",
  });
  assert.equal(beneficiary.status, 200);
  const prepared = await user.request("/api/v1/payments", {
    sourceAccountId: accountId,
    beneficiaryId: beneficiary.data.id,
    amount: { atoms: "10000", currency: "NGN", scale: 2 },
  });
  assert.equal(prepared.status, 200);
  const enabled = await user.request("/api/auth/two-factor/enable", {
    password,
  });
  assert.equal(enabled.status, 200);
  const secret = new URL(enabled.data.totpURI).searchParams.get("secret");
  assert.equal(
    (
      await user.request("/api/auth/two-factor/verify-totp", {
        code: totp(secret),
      })
    ).status,
    200,
  );
  const challenge = await user.request("/api/v1/step-up", {
    action: "payment.authorize",
    digest: prepared.data.instructionDigest,
    password,
    code: totp(secret),
  });
  assert.equal(challenge.status, 200);
  const authorized = await user.request(
    `/api/v1/payments/${prepared.data.id}/authorize`,
    { revision: prepared.data.revision, challengeId: challenge.data.id },
  );
  assert.equal(authorized.status, 200);
  const submits = await Promise.all(
    Array.from({ length: 2 }, () =>
      user.request(`/api/v1/payments/${prepared.data.id}/submit`, {
        revision: authorized.data.revision,
      }),
    ),
  );
  assert.ok(submits.every((s) => s.status === 200));
  assert.equal(
    (await user.request(`/api/v1/payments/${prepared.data.id}/reconcile`, {}))
      .data.status,
    "succeeded",
  );
  assert.equal(
    (await other.request(`/api/v1/payments/${prepared.data.id}`)).status,
    404,
  );
  const receipts = await user.request(
    `/api/v1/payments/${prepared.data.id}/receipts`,
  );
  assert.match(receipts.data.data.at(-1).payload.label, /SIMULATED/);
  assert.equal(receipts.data.data.at(-1).payload.bankCreditVerified, false);
  const self = (await user.request("/api/v1/me")).data,
    counterparty = (await other.request("/api/v1/me")).data;
  async function step(action, digest) {
    const r = await user.request("/api/v1/step-up", {
      action,
      digest,
      password,
      code: totp(secret),
    });
    assert.equal(r.status, 200, `Step-up failed: ${r.data.error?.code}`);
    return r.data.id;
  }
  for (const id of [self.user.id, counterparty.user.id])
    await admin.query(
      "INSERT INTO agus_trader_eligibility(owner,environment,eligible,evidence) VALUES($1,'fixture',true,'HTTP simulation fixture')",
      [id],
    );
  const authorities = Array.from({ length: 4 }, () => randomUUID());
  for (const id of authorities)
    await admin.query(
      "INSERT INTO agus_users(id,name,email,role) VALUES($1,'Fixture authority',$2,'operations')",
      [id, `${id}@fixture.invalid`],
    );
  await admin.query(
    "INSERT INTO agus_fixture_escrow_authorities(id,verifier,arbitrators) VALUES(1,$1,$2)",
    [authorities[0], JSON.stringify(authorities.slice(1))],
  );
  assert.equal(
    (
      await other.request("/api/v1/p2p/offers", {
        side: "buy",
        availableAtoms: "1000000",
        minimumAtoms: "1000000",
        maximumAtoms: "1000000",
        rateNumerator: "300000",
        rateDenominator: "1",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        paymentMethod: "bank-transfer-simulated",
      })
    ).status,
    200,
  );
  const p2pQuote = await user.request("/api/v1/p2p/quotes", {
    side: "sell",
    amountAtoms: "1000000",
  });
  assert.equal(p2pQuote.status, 200);
  const reservation = await user.request("/api/v1/p2p/reservations", {
    quoteId: p2pQuote.data.id,
    challengeId: await step("p2p.reserve", p2pQuote.data.instructionDigest),
  });
  assert.equal(reservation.status, 200);
  const escrowReview = await user.request(
    `/api/v1/p2p/orders/${reservation.data.id}/fixture/review?action=fund`,
  );
  assert.equal(escrowReview.status, 200);
  const funded = await user.request(
    `/api/v1/p2p/orders/${reservation.data.id}/fixture/fund`,
    {
      revision: escrowReview.data.instruction.revision,
      challengeId: await step(
        escrowReview.data.action,
        escrowReview.data.instructionDigest,
      ),
    },
  );
  assert.equal(funded.status, 200);
  assert.equal(funded.data.state, "escrow_funded");
  assert.equal(funded.data.chainFinalityVerified, false);
  assert.equal(
    (
      await user.request("/api/v1/usd/fixture/account", {
        residency: "NG",
        purpose: "freelance",
      })
    ).status,
    200,
  );
  await admin.query("UPDATE agus_users SET role='operations' WHERE id=$1", [
    counterparty.user.id,
  ]);
  const incoming = await other.request("/api/v1/usd/fixture/incoming", {
    owner: self.user.id,
    amountAtoms: "10000",
    purpose: "freelance",
  });
  assert.equal(incoming.status, 200);
  const destination = Keypair.generate().publicKey.toBase58();
  const usdQuote = await user.request("/api/v1/usd/fixture/quotes", {
    incomingId: incoming.data.id,
    destination,
    beneficiaryId: beneficiary.data.id,
  });
  assert.equal(usdQuote.status, 200);
  const usdChallenge = await step(
      usdQuote.data.action,
      usdQuote.data.instructionDigest,
    ),
    conversionKey = randomUUID();
  const conversion = await user.request(
    "/api/v1/usd/fixture/conversions",
    {
      quoteId: usdQuote.data.id,
      challengeId: usdChallenge,
      loseResponse: true,
    },
    { key: conversionKey },
  );
  assert.equal(conversion.status, 200);
  assert.equal(
    (
      await user.request(
        "/api/v1/usd/fixture/conversions",
        {
          quoteId: usdQuote.data.id,
          challengeId: usdChallenge,
          loseResponse: true,
        },
        { key: conversionKey },
      )
    ).data.id,
    conversion.data.id,
  );
  let usdState = (
    await user.request(
      `/api/v1/usd/fixture/conversions/${conversion.data.id}/reconcile`,
      {},
    )
  ).data;
  assert.equal(usdState.conversion_status, "succeeded");
  assert.equal(usdState.delivery_status, "not_started");
  for (const stage of ["deliver", "payout"]) {
    const r = await user.request(
      `/api/v1/usd/fixture/conversions/${conversion.data.id}/review?stage=${stage}`,
    );
    assert.equal(r.status, 200);
    const effect = await user.request(
      `/api/v1/usd/fixture/conversions/${conversion.data.id}/${stage}`,
      {
        revision: r.data.instruction.revision,
        challengeId: await step(r.data.action, r.data.instructionDigest),
      },
    );
    assert.equal(effect.status, 200);
    usdState = (
      await user.request(
        `/api/v1/usd/fixture/conversions/${conversion.data.id}/reconcile`,
        {},
      )
    ).data;
  }
  assert.equal(usdState.payout_status, "succeeded");
  assert.equal(usdState.bankCreditVerified, false);
  assert.equal(usdState.chainFinalityVerified, false);
  assert.equal(
    (
      await other.request(
        `/api/v1/usd/fixture/conversions/${conversion.data.id}`,
      )
    ).status,
    404,
  );
  const request = await user.request("/api/v1/requests", {
    recipient: destination,
    asset: "SOL",
    amountAtoms: "1000000",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal(request.status, 200);
  const qr = await user.request(`/api/v1/requests/${request.data.id}/qr`);
  assert.equal(qr.status, 200);
  assert.match(qr.data.svg, /^<svg/);
  assert.equal(qr.data.networkNotEnforcedByUri, true);
  const disabledDiscovery = await user.request(
    `/api/v1/requests/${request.data.id}/discover`,
    {},
  );
  assert.equal(disabledDiscovery.status, 503);
  assert.equal(disabledDiscovery.data.error.code, "DEVNET_DISABLED");
  assert.equal(
    (await other.request(`/api/v1/requests/${request.data.id}`)).status,
    404,
  );
  assert.equal(
    (
      await user.request(`/api/v1/requests/${request.data.id}/cancel`, {
        revision: 0,
      })
    ).status,
    200,
  );
  assert.equal(
    (await user.request(`/api/v1/requests/${request.data.id}/qr`)).status,
    409,
  );
  // Existing operator API uses the same normalized legacy storage cutover.
  assert.equal(
    (await legacy.request("/api/session", { password })).status,
    200,
  );
  const old = await legacy.request("/api/batches", {
    payments: [
      {
        name: "Fixture",
        bankCode: "035",
        accountNumber: "0000000001",
        amountKobo: 10000,
        reason: "Legacy compatibility",
      },
    ],
  });
  assert.equal(old.status, 201);
  assert.equal(
    (await legacy.request(`/api/batches/${old.data.id}/verify`, {})).status,
    200,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT payload->'batches' AS batches FROM workflow_state WHERE id=1",
      )
    ).rows[0].batches.length,
    0,
  );
  assert.equal(
    (await admin.query("SELECT id FROM agus_legacy_batches")).rows.length,
    1,
  );
  await stop();
  await start();
  assert.equal(
    (await user.request(`/api/v1/p2p/orders/${reservation.data.id}`)).data
      .state,
    "escrow_funded",
  );
  assert.equal(
    (
      await user.request(
        `/api/v1/usd/fixture/conversions/${conversion.data.id}`,
      )
    ).data.payout_status,
    "succeeded",
  );
  assert.equal(
    (await user.request(`/api/v1/payments/${prepared.data.id}`)).data.status,
    "succeeded",
  );
  assert.equal(
    (
      await admin.query(
        "SELECT submissions FROM agus_test_effects WHERE reference=$1",
        [prepared.data.providerReference],
      )
    ).rows[0].submissions,
    1,
  );
  const me = await other.request("/api/v1/me");
  assert.equal(
    (
      await other.request(`/api/v1/sessions/${me.data.sessionId}`, undefined, {
        method: "DELETE",
      })
    ).status,
    200,
  );
  assert.equal((await other.request("/api/v1/me")).status, 401);
  sensitiveValues.add(secret);
  for (const value of sensitiveValues)
    assert.equal(
      logs.includes(value),
      false,
      "Sensitive material appeared in server logs",
    );
  console.log(
    "PASS: actual production HTTP -> Better Auth/TOTP -> least-privilege PostgreSQL -> simulated bank payment, P2P funding, staged USD conversion/delivery/payout and request QR; owner isolation, duplicate claims, legacy compatibility, restart recovery and revocation. Zero paid model, bank-provider or chain calls.",
  );
} finally {
  await stop();
  await admin?.end();
  try {
    await root.query(`DROP DATABASE IF EXISTS "${name}"`);
    await root.query(`DROP ROLE IF EXISTS "${role}"`);
  } finally {
    await root.end();
  }
}
