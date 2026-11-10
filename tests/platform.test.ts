/** Mandatory PostgreSQL acceptance, isolated database and least-privilege role.
 * Set AGUS_TEST_DATABASE_URL; fixture providers only, no paid model/financial keys. */
import { randomUUID, createHmac, createPrivateKey, sign } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { migrate } from "../src/server/migrations";
import { createIdentity, principal } from "../src/server/auth";
import { database, closeDatabase } from "../src/server/sql";
import { db } from "../src/lib/db";
import {
  instructionHash,
  consumeStepUp,
  issueStepUp,
} from "../src/server/approvals";
import { seal, unseal } from "../src/server/secrets";
import { enqueue, claim, deliverNotification } from "../src/server/jobs";
import { operationalEvent } from "../src/server/observability";
import { GET, POST, DELETE } from "../src/app/api/v1/[...path]/route";
import * as banking from "../src/server/banking/service";
import * as payments from "../src/server/banking/payments";
import type { FixtureScenario } from "../packages/contracts/src";
import * as p2p from "../src/server/p2p";
import { walletChallenge, associateWallet } from "../src/server/solana";
import * as requests from "../src/server/requests";

const enabled = Boolean(process.env.AGUS_TEST_DATABASE_URL);
describe.skipIf(!enabled)("real PostgreSQL platform acceptance", () => {
  const databaseName = `agus_test_${randomUUID().replaceAll("-", "")}`;
  const role = `agus_runtime_${randomUUID().replaceAll("-", "")}`;
  const password = "fixture-only-user-password";
  const origin = "http://localhost:3000";
  let admin: Pool, root: Pool, auth: Awaited<ReturnType<typeof createIdentity>>;
  const users: {
    id: string;
    cookie: string;
    sessionId: string;
    headers: Headers;
    role: string;
    twoFactorEnabled: boolean;
  }[] = [];
  let sourceAccountId: string, beneficiaryId: string;
  beforeAll(async () => {
    const url = new URL(process.env.AGUS_TEST_DATABASE_URL!);
    root = new Pool({ connectionString: url.href });
    await root.query(`CREATE DATABASE "${databaseName}"`);
    await root.query(
      `CREATE ROLE "${role}" LOGIN PASSWORD 'fixture-runtime-only'`,
    );
    url.pathname = `/${databaseName}`;
    admin = new Pool({ connectionString: url.href });
    const client = await admin.connect();
    try {
      await migrate(client);
      await migrate(client);
    } finally {
      client.release();
    }
    await admin.query(
      `REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${role}"; REVOKE INSERT,UPDATE,DELETE ON agus_migrations,agus_legacy_archive,agus_institutions,agus_institution_capabilities,agus_invitations FROM "${role}"; GRANT UPDATE(consumed_at) ON agus_invitations TO "${role}"`,
    );
    url.username = role;
    url.password = "fixture-runtime-only";
    vi.stubEnv("DATABASE_URL", url.href);
    vi.stubEnv("BETTER_AUTH_URL", origin);
    vi.stubEnv("APP_ORIGIN", origin);
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "fixture-only-better-auth-secret-at-least-32-characters",
    );
    vi.stubEnv("PAYMENT_MODE", "fixture");
    vi.stubEnv("AGUS_WORKSPACE_ENABLED", "true");
    vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
    vi.stubEnv("AGUS_ENCRYPTION_ACTIVE_KEY", "test-v1");
    vi.stubEnv(
      "AGUS_ENCRYPTION_KEYS",
      JSON.stringify({
        "test-v1": Buffer.alloc(32, 7).toString("base64"),
        "test-v2": Buffer.alloc(32, 8).toString("base64"),
      }),
    );
    auth = await createIdentity();
    for (let n = 0; n < 3; n++) {
      const email = `user${n}@fixture.invalid`;
      await admin.query(
        "INSERT INTO agus_invitations(email,expires_at,created_by) VALUES($1,now()+interval '1 hour','test')",
        [email],
      );
      const response = await auth.handler(
        new Request(`${origin}/api/auth/sign-up/email`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({ email, password, name: `Fixture ${n}` }),
        }),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const cookie = response.headers
        .getSetCookie()
        .map((c) => c.split(";")[0])
        .join("; ");
      const headers = new Headers({ cookie, origin });
      const p = await principal(new Request(origin, { headers }));
      users.push({ ...p, cookie, headers });
    }
  }, 60_000);
  afterAll(async () => {
    await closeDatabase();
    const client = (await db()).$client as unknown as Pool;
    await client.end();
    await admin?.end();
    if (root) {
      await root.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
      await root.query(`DROP ROLE IF EXISTS "${role}"`);
      await root.end();
    }
    vi.unstubAllEnvs();
  });
  function request(
    user: number,
    path: string,
    input?: unknown,
    method = input ? "POST" : "GET",
  ) {
    return new Request(`${origin}/api/v1/${path}`, {
      method,
      headers: {
        cookie: users[user].cookie,
        origin,
        "content-type": "application/json",
        "idempotency-key": randomUUID(),
      },
      body: input ? JSON.stringify(input) : undefined,
    });
  }
  it("uses Better Auth sessions for three distinct consumers and rejects origin/device identity spoofing", async () => {
    expect(new Set(users.map((u) => u.id)).size).toBe(3);
    expect(users.every((u) => u.role === "consumer")).toBe(true);
    expect(
      (
        await GET(
          new Request(`${origin}/api/v1/me`, {
            headers: { origin: "agus://", "x-device-id": users[0].id },
          }),
        )
      ).status,
    ).toBe(401);
    await admin.query("DELETE FROM agus_rate_limit");
    const response = await auth.handler(
      new Request(`${origin}/api/auth/sign-up/email`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          email: "uninvited@fixture.invalid",
          password,
          name: "Uninvited",
        }),
      }),
    );
    expect(response.status).toBe(403);
  });
  it("cannot perform runtime DDL, edit migration checksums or rewrite the original archive", async () => {
    const sql = await database();
    await expect(
      sql.query("CREATE TABLE forbidden_runtime_ddl(id text)"),
    ).rejects.toThrow();
    await expect(
      sql.query("UPDATE agus_migrations SET checksum='forged'"),
    ).rejects.toThrow();
    await expect(
      sql.query("DELETE FROM agus_legacy_archive"),
    ).rejects.toThrow();
  });
  it("isolates responsibilities, memories, notifications and session revocation by owner", async () => {
    const task = await POST(
      request(0, "responsibilities", {
        title: "Fixture task",
        objective: "Read only",
        dueAt: new Date(Date.now() + 60000).toISOString(),
      }),
    );
    const created = await task.json();
    expect(task.status).toBe(200);
    const denied = await POST(
      request(1, `responsibilities/${created.id}`, {
        revision: 0,
        action: "approve",
      }),
    );
    expect(denied.status).toBe(404);
    const other = await (await GET(request(2, "responsibilities"))).json();
    expect(other.tasks).toHaveLength(0);
    expect(other.memories).toHaveLength(0);
    expect(other.notifications).toHaveLength(0);
    expect(
      (
        await DELETE(
          request(1, `sessions/${users[0].sessionId}`, undefined, "DELETE"),
        )
      ).status,
    ).toBe(404);
  });
  it("validates one-use approval ownership, session, action, digest and expiry atomically", async () => {
    const sql = await database(),
      digest = instructionHash({
        amountAtoms: "100",
        source: "fixture-account",
      });
    const id = randomUUID();
    await sql.query(
      "INSERT INTO agus_step_up(id,owner,session_id,action,digest,expires_at) VALUES($1,$2,$3,'payment.submit',$4,now()+interval '1 minute')",
      [id, users[0].id, users[0].sessionId, digest],
    );
    await expect(
      consumeStepUp(sql, users[1], id, "payment.submit", digest),
    ).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    await expect(
      consumeStepUp(sql, users[0], id, "payment.submit", "f".repeat(64)),
    ).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    await consumeStepUp(sql, users[0], id, "payment.submit", digest);
    await expect(
      consumeStepUp(sql, users[0], id, "payment.submit", digest),
    ).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    const expired = randomUUID();
    await sql.query(
      "INSERT INTO agus_step_up(id,owner,session_id,action,digest,expires_at) VALUES($1,$2,$3,'payment.submit',$4,now()-interval '1 second')",
      [expired, users[0].id, users[0].sessionId, digest],
    );
    await expect(
      consumeStepUp(sql, users[0], expired, "payment.submit", digest),
    ).rejects.toMatchObject({ code: "APPROVAL_INVALID" });
    await expect(
      issueStepUp(
        users[0],
        users[0].headers,
        "payment.submit",
        digest,
        password,
        "000000",
      ),
    ).rejects.toMatchObject({ code: "TOTP_ENROLLMENT_REQUIRED" });
  });
  it("enrolls real Better Auth TOTP and binds password plus TOTP to the requested instruction", async () => {
    const current = users[0];
    function updateCookies(response: Response) {
      const cookies = new Map(
        current.cookie.split("; ").map((c) => {
          const index = c.indexOf("=");
          return [c.slice(0, index), c.slice(index + 1)];
        }),
      );
      for (const value of response.headers.getSetCookie()) {
        const cookie = value.split(";")[0],
          index = cookie.indexOf("=");
        if (/max-age=0/i.test(value)) cookies.delete(cookie.slice(0, index));
        else cookies.set(cookie.slice(0, index), cookie.slice(index + 1));
      }
      current.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
      current.headers.set("cookie", current.cookie);
    }
    const enabled = await auth.handler(
      new Request(`${origin}/api/auth/two-factor/enable`, {
        method: "POST",
        headers: {
          cookie: current.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ password }),
      }),
    );
    expect(enabled.status).toBe(200);
    updateCookies(enabled);
    const enrollment = await enabled.json();
    if (enrollment.method !== "totp")
      throw new Error("TOTP_ENROLLMENT_NOT_RETURNED");
    const secret = new URL(enrollment.totpURI).searchParams.get("secret")!;
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const char of secret.replace(/=+$/, ""))
      bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
    const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
    const mac = createHmac("sha1", key).update(counter).digest(),
      offset = mac[19] & 15;
    const code = String(
      (mac.readUInt32BE(offset) & 0x7fffffff) % 1000000,
    ).padStart(6, "0");
    const verified = await auth.handler(
      new Request(`${origin}/api/auth/two-factor/verify-totp`, {
        method: "POST",
        headers: {
          cookie: current.cookie,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ code }),
      }),
    );
    expect(verified.status).toBe(200);
    updateCookies(verified);
    const p = await principal(
      new Request(origin, { headers: current.headers }),
    );
    Object.assign(current, p);
    const approved = await issueStepUp(
      p,
      current.headers,
      "payment.submit",
      "a".repeat(64),
      password,
      code,
    );
    expect(approved.digest).toBe("a".repeat(64));
    await expect(
      issueStepUp(
        p,
        current.headers,
        "payment.submit",
        "b".repeat(64),
        "incorrect-password",
        code,
      ),
    ).rejects.toMatchObject({ code: "STEP_UP_REJECTED" });
  });
  it("fences two worker claims and commits a notification once after lease recovery", async () => {
    const sql = await database();
    const key = `notification:${randomUUID()}`;
    await enqueue(sql, users[0].id, "test.notification", key, {
      resourceType: "payment",
      resourceId: randomUUID(),
    });
    const claims = await Promise.all([
      claim("worker-a", 30, "test.notification"),
      claim("worker-b", 30, "test.notification"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const stale = claims.find(Boolean)!;
    await sql.query(
      "UPDATE agus_jobs SET lease_until=now()-interval '1 second' WHERE id=$1",
      [stale.id],
    );
    const replacement = (await claim(
      "worker-replacement",
      30,
      "test.notification",
    ))!;
    await expect(deliverNotification(stale)).rejects.toMatchObject({
      code: "JOB_FENCE_REJECTED",
    });
    await deliverNotification(replacement);
    await expect(deliverNotification(replacement)).rejects.toMatchObject({
      code: "JOB_FENCE_REJECTED",
    });
    expect(
      (
        await sql.query(
          "SELECT id FROM agus_notifications WHERE effect_key=$1",
          [key],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (await (await GET(request(1, "notifications"))).json()).data,
    ).toHaveLength(0);
  });
  it("encrypts owner/purpose-bound provider material with versioned envelope keys and redacts logs", () => {
    const envelope = seal(users[0].id, "provider-grant", {
      token: "fixture-sensitive-token",
    });
    expect(JSON.stringify(envelope)).not.toContain("fixture-sensitive-token");
    expect(unseal(users[0].id, "provider-grant", envelope)).toEqual({
      token: "fixture-sensitive-token",
    });
    expect(() => unseal(users[1].id, "provider-grant", envelope)).toThrow();
    vi.stubEnv("AGUS_ENCRYPTION_ACTIVE_KEY", "test-v2");
    expect(unseal(users[0].id, "provider-grant", envelope)).toEqual({
      token: "fixture-sensitive-token",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    operationalEvent("payment.checked", { code: "fixture-sensitive-token" });
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      "fixture-sensitive-token",
    );
    log.mockRestore();
  });
  it("remote session revocation takes effect immediately without trusting cached cookies", async () => {
    expect(
      (
        await DELETE(
          request(2, `sessions/${users[2].sessionId}`, undefined, "DELETE"),
        )
      ).status,
    ).toBe(200);
    expect((await GET(request(2, "me"))).status).toBe(401);
  });
  it("creates 23 individually disabled source institutions and keeps destinations separate", async () => {
    const result = await banking.institutions();
    expect(result.data).toHaveLength(23);
    expect(result.acceptedSourceInstitutions).toBe(0);
    expect(
      result.data.every(
        (i) =>
          i.capabilities.length === 7 &&
          i.capabilities.every((c: { accepted: boolean }) => !c.accepted),
      ),
    ).toBe(true);
    const directory = await (
      await GET(request(0, "banking/beneficiary-banks"))
    ).json();
    expect(directory.sourceCapabilitiesEnabled).toBe(false);
  });
  it("persists single-use owner-bound linking, multiple accounts, balance kinds and incremental corrected transaction history", async () => {
    const key = randomUUID(),
      connected = await banking.beginConnection(users[0].id, key, {
        institutionId: "wema",
        provider: "fixture",
      });
    expect(
      (
        await banking.beginConnection(users[0].id, key, {
          institutionId: "wema",
          provider: "fixture",
        })
      ).id,
    ).toBe(connected.id);
    await expect(
      banking.beginConnection(users[0].id, key, {
        institutionId: "access",
        provider: "fixture",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const callback = {
      connectionId: connected.id,
      state: connected.state,
      code: "fixture-consent-approved",
    };
    await expect(
      banking.completeConnection(users[1].id, callback),
    ).rejects.toMatchObject({ code: "CONNECTION_CALLBACK_INVALID" });
    expect(
      (await banking.completeConnection(users[0].id, callback)).accountCount,
    ).toBe(2);
    await expect(
      banking.completeConnection(users[0].id, callback),
    ).rejects.toMatchObject({ code: "CONNECTION_CALLBACK_INVALID" });
    const accounts = await banking.listAccounts(users[0].id);
    expect(accounts.data).toHaveLength(2);
    sourceAccountId = accounts.data[0].id;
    expect((await banking.listAccounts(users[1].id)).data).toHaveLength(0);
    const balance = await banking.refreshBalance(users[0].id, sourceAccountId);
    expect(balance.available?.atoms).not.toBe(balance.ledger?.atoms);
    expect(balance.simulated).toBe(true);
    expect(
      (await banking.syncAccount(users[0].id, sourceAccountId)).complete,
    ).toBe(false);
    expect(
      (await banking.syncAccount(users[0].id, sourceAccountId)).complete,
    ).toBe(true);
    await banking.syncAccount(users[0].id, sourceAccountId);
    const history = await (
      await GET(
        request(0, `banking/accounts/${sourceAccountId}/transactions?limit=1`),
      )
    ).json();
    expect(history.data).toHaveLength(1);
    expect(history.nextCursor).toBeTruthy();
    expect(history.historyComplete).toBe(true);
    const rows = (
      await (
        await database()
      ).query(
        "SELECT status,revision FROM agus_bank_transactions WHERE owner=$1 AND account_id=$2",
        [users[0].id, sourceAccountId],
      )
    ).rows;
    expect(rows).toHaveLength(2);
    expect(rows.find((t) => t.revision === 2)?.status).toBe("reversed");
    const beneficiary = await banking.verifyBeneficiary(
      users[0].id,
      randomUUID(),
      { bankCode: "035", accountNumber: "0000000001" },
    );
    beneficiaryId = beneficiary.id;
  });
  async function prepared(scenario: FixtureScenario = "normal") {
    return payments.preparePayment(users[0].id, randomUUID(), {
      sourceAccountId,
      beneficiaryId,
      amount: { atoms: "10000", currency: "NGN", scale: 2 },
      testScenario: scenario,
    });
  }
  async function authorized(scenario: FixtureScenario = "normal") {
    const payment = await prepared(scenario),
      id = randomUUID();
    await (
      await database()
    ).query(
      "INSERT INTO agus_step_up(id,owner,session_id,action,digest,expires_at) VALUES($1,$2,$3,'payment.authorize',$4,now()+interval '1 minute')",
      [id, users[0].id, users[0].sessionId, payment.instructionDigest],
    );
    return payments.authorizePayment(
      users[0],
      payment.id,
      payment.revision,
      id,
    );
  }
  it("binds the source/grant/beneficiary/amount/fee/environment and rejects changed idempotency payloads and other users", async () => {
    const input = {
        sourceAccountId,
        beneficiaryId,
        amount: { atoms: "10000", currency: "NGN", scale: 2 },
      },
      key = randomUUID();
    const p = await payments.preparePayment(users[0].id, key, input);
    expect(p.instruction).toMatchObject({
      sourceAccountId,
      beneficiaryId,
      grantRevision: 0,
      feeQuoteVersion: "fixture-no-charge-v1",
      environment: "fixture",
    });
    expect((await payments.preparePayment(users[0].id, key, input)).id).toBe(
      p.id,
    );
    await expect(
      payments.preparePayment(users[0].id, key, {
        ...input,
        amount: { ...input.amount, atoms: "10001" },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect((await GET(request(1, `payments/${p.id}`))).status).toBe(404);
    expect((await GET(request(1, `payments/${p.id}/receipts`))).status).toBe(
      404,
    );
    await expect(
      payments.submitPayment(users[1], p.id, p.revision),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("one hundred duplicate submissions produce one durable claim and one provider submission", async () => {
    const p = await authorized();
    await Promise.all(
      Array.from({ length: 100 }, () =>
        payments.submitPayment(users[0], p.id, p.revision),
      ),
    );
    const sql = await database();
    expect(
      (
        await sql.query(
          "SELECT * FROM agus_payment_attempts WHERE payment_id=$1",
          [p.id],
        )
      ).rows,
    ).toHaveLength(1);
    expect(
      (
        await sql.query(
          "SELECT submissions FROM agus_test_effects WHERE reference=$1",
          [p.providerReference],
        )
      ).rows[0].submissions,
    ).toBe(1);
    const settled = await payments.reconcilePayment(users[0].id, p.id);
    expect(settled.status).toBe("succeeded");
    const receipt = (await payments.receipts(users[0].id, p.id)).data.at(-1)!;
    expect(receipt.payload.label).toContain("SIMULATED");
    expect(receipt.payload.bankCreditVerified).toBe(false);
    const id = randomUUID(),
      raw = JSON.stringify({
        id,
        reference: p.providerReference,
        claimedStatus: "reversed",
      }),
      secret = "fixture-webhook-secret-at-least-32-characters";
    vi.stubEnv("FIXTURE_WEBHOOK_SECRET", secret);
    const signature = createHmac("sha256", secret).update(raw).digest("hex");
    const webhook = () =>
      POST(
        new Request(`${origin}/api/v1/provider-events/fixture`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-agus-fixture-signature": signature,
          },
          body: raw,
        }),
      );
    expect((await webhook()).status).toBe(200);
    expect((await webhook()).status).toBe(200);
    expect((await payments.getPayment(users[0].id, p.id)).status).toBe(
      "succeeded",
    );
    expect(
      (
        await sql.query("SELECT event_id FROM agus_inbox WHERE event_id=$1", [
          id,
        ])
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects a reused submission idempotency key with different instructions", async () => {
    const a = await authorized(),
      b = await authorized(),
      key = randomUUID();
    await payments.submitPayment(users[0], a.id, a.revision, key);
    await expect(
      payments.submitPayment(users[0], b.id, b.revision, key),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it.each(["timeout_before_send", "timeout_after_send", "outage"] as const)(
    "never resubmits uncertainty after %s",
    async (scenario) => {
      const p = await authorized(scenario),
        submitted = await payments.submitPayment(users[0], p.id, p.revision);
      expect(submitted.status).toBe("unknown");
      await payments.submitPayment(users[0], p.id, p.revision);
      const reconciled = await payments.reconcilePayment(users[0].id, p.id);
      expect(reconciled.status).toBe(
        scenario === "timeout_after_send" ? "succeeded" : "unknown",
      );
      const effects = (
        await (
          await database()
        ).query(
          "SELECT submissions FROM agus_test_effects WHERE reference=$1",
          [p.providerReference],
        )
      ).rows;
      expect(effects[0]?.submissions ?? 0).toBe(
        scenario === "timeout_after_send" ? 1 : 0,
      );
    },
  );
  it("observes delayed reversals after earlier success and makes disputes separately idempotent", async () => {
    const p = await authorized("reversal");
    await payments.submitPayment(users[0], p.id, p.revision);
    expect((await payments.reconcilePayment(users[0].id, p.id)).status).toBe(
      "succeeded",
    );
    expect((await payments.reconcilePayment(users[0].id, p.id)).status).toBe(
      "reversed",
    );
    const key = randomUUID(),
      d = await payments.dispute(users[0].id, p.id, key, "Fixture dispute");
    expect(
      (await payments.dispute(users[0].id, p.id, key, "Fixture dispute")).id,
    ).toBe(d.id);
    await expect(
      payments.dispute(users[1].id, p.id, randomUUID(), "Other user"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("an expired linking callback, revoked consent and stale grant cannot acquire new submission authority", async () => {
    const expired = await banking.beginConnection(users[0].id, randomUUID(), {
      institutionId: "kuda",
      provider: "fixture",
    });
    await admin.query(
      "UPDATE agus_connections SET state_expires_at=now()-interval '1 second' WHERE id=$1",
      [expired.id],
    );
    await expect(
      banking.completeConnection(users[0].id, {
        connectionId: expired.id,
        state: expired.state,
        code: "fixture-consent-approved",
      }),
    ).rejects.toMatchObject({ code: "CONNECTION_CALLBACK_INVALID" });
    const p = await authorized(),
      source = (await banking.listAccounts(users[0].id)).data.find(
        (a) => a.id === sourceAccountId,
      )!;
    const connection = (
      await admin.query(
        "SELECT revision FROM agus_connections WHERE owner=$1 AND id=$2",
        [users[0].id, source.connection_id],
      )
    ).rows[0];
    await banking.revokeConnection(
      users[0].id,
      source.connection_id,
      connection.revision,
    );
    await expect(
      payments.submitPayment(users[0], p.id, p.revision),
    ).rejects.toMatchObject({ code: "SOURCE_GRANT_UNAVAILABLE" });
    await expect(
      banking.refreshBalance(users[0].id, sourceAccountId),
    ).rejects.toMatchObject({ code: "SOURCE_GRANT_UNAVAILABLE" });
    await expect(
      banking.syncAccount(users[0].id, sourceAccountId),
    ).rejects.toMatchObject({ code: "SOURCE_GRANT_UNAVAILABLE" });
  });
  it("recovers claimed payments and a committed notification in another process without another provider send", async () => {
    // A durable claim represents a process killed before the network write.
    // Revoked source authority must not recreate that write right on restart.
    const sql = await database(),
      existing = (
        await sql.query(
          "SELECT * FROM agus_payments WHERE owner=$1 ORDER BY id LIMIT 1",
          [users[0].id],
        )
      ).rows[0];
    const output = spawnSync(
      process.execPath,
      [
        "--import=tsx",
        "--input-type=module",
        "-e",
        `
      import {getPayment,submitPayment} from './src/server/banking/payments.ts';
      import {closeDatabase} from './src/server/sql.ts';
      const p=await getPayment(process.env.FIXTURE_OWNER,process.env.FIXTURE_PAYMENT);
      if(p.status==='awaiting_confirmation'||p.status==='authorized') console.log(JSON.stringify({persisted:true,claimed:false}));
      else {await submitPayment({id:process.env.FIXTURE_OWNER},p.id,p.revision);console.log(JSON.stringify({persisted:true,claimed:true}));}
      await closeDatabase();
    `,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 20000,
        env: {
          PATH: process.env.PATH,
          NODE_ENV: "test",
          DATABASE_URL: process.env.DATABASE_URL,
          PAYMENT_MODE: "fixture",
          FIXTURE_OWNER: users[0].id,
          FIXTURE_PAYMENT: existing.id,
        },
      },
    );
    expect(output.status, output.stderr).toBe(0);
    expect(JSON.parse(output.stdout).persisted).toBe(true);
    const claimed = await sql.query(
      "SELECT p.id,p.provider_reference FROM agus_payments p JOIN agus_payment_attempts a ON a.owner=p.owner AND a.payment_id=p.id WHERE p.owner=$1 LIMIT 1",
      [users[0].id],
    );
    const before = (
      await sql.query(
        "SELECT submissions FROM agus_test_effects WHERE reference=$1",
        [claimed.rows[0].provider_reference],
      )
    ).rows[0]?.submissions;
    await payments.submitPayment(users[0], claimed.rows[0].id, 0);
    expect(
      (
        await sql.query(
          "SELECT submissions FROM agus_test_effects WHERE reference=$1",
          [claimed.rows[0].provider_reference],
        )
      ).rows[0]?.submissions,
    ).toBe(before);
  });
  it("verifies single-use wallet association signatures without treating a public address or device flag as ownership", async () => {
    const key = Keypair.generate(),
      wallet = key.publicKey.toBase58(),
      challenge = await walletChallenge(users[0].id, wallet);
    const privateKey = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from(key.secretKey.slice(0, 32)),
      ]),
      format: "der",
      type: "pkcs8",
    });
    const signature = sign(
      null,
      Buffer.from(challenge.challenge),
      privateKey,
    ).toString("base64");
    await expect(
      associateWallet(users[1].id, wallet, signature),
    ).rejects.toMatchObject({ code: "WALLET_CHALLENGE_INVALID" });
    expect(
      (await associateWallet(users[0].id, wallet, signature)).ownershipVerified,
    ).toBe(true);
    await expect(
      associateWallet(users[0].id, wallet, signature),
    ).rejects.toMatchObject({ code: "WALLET_CHALLENGE_INVALID" });
  });
  it("recovers process termination before notification commit and after commit without a duplicate logical delivery", async () => {
    const sql = await database(),
      key = `crash-delivery:${randomUUID()}`;
    await enqueue(sql, users[0].id, "test.crash", key, {
      resourceType: "payment",
      resourceId: randomUUID(),
    });
    const run = (phase: string) =>
      spawnSync(
        process.execPath,
        [
          "--import=tsx",
          "--input-type=module",
          "-e",
          `
      import {claim,finish,deliverNotification} from './src/server/jobs.ts';
      import {transaction} from './src/server/sql.ts';
      const job=await claim('crash-worker',30,'test.crash');
      if(process.env.FIXTURE_PHASE==='before')await transaction(async sql=>{
        await finish(sql,job);
        await sql.query("INSERT INTO agus_notifications(owner,id,effect_key,resource_type,resource_id) VALUES($1,$2,$3,'payment',$4)",[job.owner,job.id,job.effect_key,job.payload.resourceId]);
        process.kill(process.pid,'SIGKILL');
      });
      else{await deliverNotification(job);process.kill(process.pid,'SIGKILL');}
    `,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 20000,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "test",
            DATABASE_URL: process.env.DATABASE_URL,
            PAYMENT_MODE: "fixture",
            FIXTURE_PHASE: phase,
          },
        },
      );
    expect(run("before").signal).toBe("SIGKILL");
    expect(
      (
        await sql.query(
          "SELECT id FROM agus_notifications WHERE effect_key=$1",
          [key],
        )
      ).rows,
    ).toHaveLength(0);
    await sql.query(
      "UPDATE agus_jobs SET lease_until=now()-interval '1 second' WHERE effect_key=$1",
      [key],
    );
    expect(run("after").signal).toBe("SIGKILL");
    expect(
      (
        await sql.query(
          "SELECT id FROM agus_notifications WHERE effect_key=$1",
          [key],
        )
      ).rows,
    ).toHaveLength(1);
    expect(await claim("recovered", 30, "test.crash")).toBeNull();
  });
  it("matches P2P quotes by executable value and atomically reserves one counterparty without enabling escrow or accepting paid screenshots", async () => {
    for (const user of users)
      await admin.query(
        "INSERT INTO agus_trader_eligibility(owner,environment,eligible,evidence) VALUES($1,'fixture',true,'internal simulation only')",
        [user.id],
      );
    const base = {
      side: "sell" as const,
      availableAtoms: "1000000",
      minimumAtoms: "1000000",
      maximumAtoms: "1000000",
      rateNumerator: "300000",
      rateDenominator: "1",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      paymentMethod: "bank-transfer-simulated" as const,
    };
    await p2p.createOffer(users[1].id, randomUUID(), base);
    const best = await p2p.createOffer(users[2].id, randomUUID(), {
      ...base,
      rateNumerator: "290000",
    });
    const quotes = await Promise.all([
      p2p.quote(users[0].id, { side: "buy", amountAtoms: "1000000" }),
      p2p.quote(users[1].id, { side: "buy", amountAtoms: "1000000" }),
    ]);
    expect(quotes[0].instruction.offerId).toBe(best.id);
    expect(quotes[0].instruction.fiatAtoms).toBe("290000");
    const capabilities = [];
    for (let i = 0; i < 2; i++) {
      const id = randomUUID();
      await admin.query(
        "INSERT INTO agus_step_up(id,owner,session_id,action,digest,expires_at) VALUES($1,$2,$3,'p2p.reserve',$4,now()+interval '1 minute')",
        [id, users[i].id, users[i].sessionId, quotes[i].instructionDigest],
      );
      capabilities.push(id);
    }
    const results = await Promise.allSettled([
      p2p.reserve(users[0], randomUUID(), quotes[0].id, capabilities[0]),
      p2p.reserve(users[1], randomUUID(), quotes[1].id, capabilities[1]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const index = results[0].status === "fulfilled" ? 0 : 1,
      fulfilled = results[index];
    if (fulfilled.status !== "fulfilled")
      throw new Error("RESERVATION_EXPECTED");
    expect(fulfilled.value.state).toBe("awaiting_escrow");
    expect(fulfilled.value.escrowExecutionEnabled).toBe(false);
    expect(
      (
        await admin.query(
          "SELECT available_atoms FROM agus_p2p_offers WHERE id=$1",
          [best.id],
        )
      ).rows[0].available_atoms,
    ).toBe("0");
    await p2p.cancelOrder(users[index].id, fulfilled.value.id, 0);
    await expect(
      p2p.cancelOrder(users[index].id, fulfilled.value.id, 0),
    ).rejects.toMatchObject({ code: "ORDER_NOT_CANCELLABLE" });
    await admin.query(
      "UPDATE agus_p2p_orders SET state='escrow_funded',expires_at=now()-interval '1 hour' WHERE id=$1",
      [fulfilled.value.id],
    );
    expect((await p2p.expireUnfundedOrders()).fundedRefunds).toBe(0);
    expect(
      (await p2p.getOrder(users[index].id, fulfilled.value.id)).state,
    ).toBe("escrow_funded");
    const disputeKey = randomUUID();
    const dispute = await p2p.openDispute(
      users[index].id,
      fulfilled.value.id,
      disputeKey,
      "Simulated payment disputed",
    );
    expect(dispute.releaseAuthorized).toBe(false);
    expect(
      (
        await p2p.openDispute(
          users[index].id,
          fulfilled.value.id,
          disputeKey,
          "Simulated payment disputed",
        )
      ).id,
    ).toBe(dispute.id);
    await expect(
      p2p.openDispute(
        users[index].id,
        fulfilled.value.id,
        disputeKey,
        "Changed case",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(() => p2p.escrowGate()).toThrow("GENUINE_DEVNET_ACCEPTANCE_PENDING");
  });
  it("persists owner-controlled payment requests and explicit Solana Pay amounts without fabricating settlement", async () => {
    const key = randomUUID(),
      input = {
        recipient: Keypair.generate().publicKey.toBase58(),
        asset: "SPL" as const,
        amountAtoms: "1000000",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
    const created = await requests.createRequest(users[0].id, key, input);
    expect((await requests.createRequest(users[0].id, key, input)).id).toBe(
      created.id,
    );
    expect(requests.parseSolanaPay(created.uri)).toMatchObject({
      recipient: input.recipient,
      amountAtoms: "1000000",
      network: "devnet",
      verification: "unverified_request_only",
    });
    await expect(
      requests.getRequest(users[1].id, String(created.id)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const shared = await requests.lookupRequest(String(created.reference));
    expect(shared.settlementSignature).toBeNull();
    expect(shared).not.toHaveProperty("owner");
    await requests.cancelRequest(users[0].id, String(created.id), 0);
    await expect(
      requests.cancelRequest(users[0].id, String(created.id), 0),
    ).rejects.toMatchObject({ code: "REQUEST_REVISION_CONFLICT" });
    await expect(
      requests.matchRequest(users[0].id, String(created.id), randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("credential reset revokes existing device access", async () => {
    await auth.api.changePassword({
      headers: users[1].headers,
      body: {
        currentPassword: password,
        newPassword: "changed-fixture-password-only",
        revokeOtherSessions: true,
      },
    });
    expect((await GET(request(1, "me"))).status).toBe(401);
  });
  it("binds encrypted push registration to the server session and handles denial or invalidation without claiming delivery", async () => {
    const id = randomUUID(),
      token = "ExponentPushToken[fixture-sensitive-push-token]";
    const registered = await POST(
      request(0, "devices", {
        id,
        platform: "android",
        pushState: "registered",
        pushToken: token,
        preferences: { inApp: true, push: true },
      }),
    );
    expect(registered.status).toBe(200);
    expect((await registered.json()).deliveryVerified).toBe(false);
    const row = (
      await admin.query(
        "SELECT session_id,push_envelope FROM agus_devices WHERE owner=$1 AND id=$2",
        [users[0].id, id],
      )
    ).rows[0];
    expect(row.session_id).toBe(users[0].sessionId);
    expect(JSON.stringify(row.push_envelope)).not.toContain(token);
    expect(
      (
        await POST(
          request(0, "devices", {
            id,
            platform: "android",
            pushState: "denied",
            preferences: { inApp: true, push: false },
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await admin.query(
          "SELECT push_envelope FROM agus_devices WHERE owner=$1 AND id=$2",
          [users[0].id, id],
        )
      ).rows[0].push_envelope,
    ).toBeNull();
  });
  it.each([
    ["data_delayed", "FIXTURE_DATA_PENDING"],
    ["rate_limited", "FIXTURE_RATE_LIMITED"],
    ["grant_expired", "SOURCE_GRANT_UNAVAILABLE"],
  ] as const)(
    "persists and enforces configured %s account-data failures",
    async (scenario, code) => {
      const c = await banking.beginConnection(users[0].id, randomUUID(), {
        institutionId: "kuda",
        provider: "fixture",
        testDataScenario: scenario,
      });
      await banking.completeConnection(users[0].id, {
        connectionId: c.id,
        state: c.state,
        code: "fixture-consent-approved",
      });
      const account = (await banking.listAccounts(users[0].id)).data.find(
        (a) => a.connection_id === c.id,
      )!;
      await expect(
        banking.refreshBalance(users[0].id, account.id),
      ).rejects.toMatchObject({ code });
    },
  );
  it("keeps local revocation effective while a simulated provider outage leaves remote revocation pending", async () => {
    const c = await banking.beginConnection(users[0].id, randomUUID(), {
      institutionId: "kuda",
      provider: "fixture",
      testDataScenario: "revocation_outage",
    });
    await banking.completeConnection(users[0].id, {
      connectionId: c.id,
      state: c.state,
      code: "fixture-consent-approved",
    });
    const account = (await banking.listAccounts(users[0].id)).data.find(
      (a) => a.connection_id === c.id,
    )!;
    const revision = (
      await admin.query(
        "SELECT revision FROM agus_connections WHERE owner=$1 AND id=$2",
        [users[0].id, c.id],
      )
    ).rows[0].revision;
    await banking.revokeConnection(users[0].id, c.id, revision);
    expect(
      (
        await admin.query(
          "SELECT provider_revocation_pending FROM agus_connections WHERE owner=$1 AND id=$2",
          [users[0].id, c.id],
        )
      ).rows[0].provider_revocation_pending,
    ).toBe(true);
    await expect(
      banking.refreshBalance(users[0].id, account.id),
    ).rejects.toMatchObject({ code: "SOURCE_GRANT_UNAVAILABLE" });
  });
});
