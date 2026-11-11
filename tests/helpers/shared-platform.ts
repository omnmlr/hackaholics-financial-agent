import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { vi } from "vitest";
import { migrate } from "../../src/server/migrations";
import {
  createIdentity,
  principal,
  type Principal,
} from "../../src/server/auth";
import { closeDatabase } from "../../src/server/sql";
import { db } from "../../src/lib/db";
export async function sharedPlatform(count = 7) {
  const name = `agus_market_${randomUUID().replaceAll("-", "")}`,
    role = `agus_market_role_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.AGUS_TEST_DATABASE_URL!);
  const root = new Pool({ connectionString: url.href });
  await root.query(`CREATE DATABASE "${name}"`);
  await root.query(
    `CREATE ROLE "${role}" LOGIN PASSWORD 'fixture-market-only'`,
  );
  url.pathname = `/${name}`;
  const admin = new Pool({ connectionString: url.href });
  const client = await admin.connect();
  try {
    await migrate(client);
  } finally {
    client.release();
  }
  await admin.query(
    `REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO "${role}"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO "${role}"; REVOKE INSERT,UPDATE,DELETE ON agus_migrations,agus_legacy_archive,agus_institutions,agus_institution_capabilities,agus_fixture_escrow_authorities,agus_invitations FROM "${role}"; GRANT UPDATE(consumed_at) ON agus_invitations TO "${role}"; REVOKE UPDATE,DELETE ON agus_legacy_authority,agus_p2p_events,agus_request_chain_observations FROM "${role}"`,
  );
  url.username = role;
  url.password = "fixture-market-only";
  vi.stubEnv("DATABASE_URL", url.href);
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  vi.stubEnv(
    "BETTER_AUTH_SECRET",
    "fixture-market-auth-secret-at-least-32-characters",
  );
  vi.stubEnv("PAYMENT_MODE", "fixture");
  vi.stubEnv("AI_PROVIDER", "none");
  vi.stubEnv("AI_API_KEY", "");
  vi.stubEnv("AGUS_ENCRYPTION_ACTIVE_KEY", "fixture");
  vi.stubEnv(
    "AGUS_ENCRYPTION_KEYS",
    JSON.stringify({ fixture: Buffer.alloc(32, 9).toString("base64") }),
  );
  const auth = await createIdentity();
  const users: Array<Principal & { cookie: string }> = [];
  for (let i = 0; i < count; i++) {
    const email = `market${i}@fixture.invalid`;
    await admin.query(
      "INSERT INTO agus_invitations(email,expires_at,created_by) VALUES($1,now()+interval '1 hour','fixture-test')",
      [email],
    );
    const response = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          password: "fixture-market-password-only",
          name: `Fixture ${i}`,
        }),
      }),
    );
    if (response.status !== 200)
      throw new Error(`FIXTURE_SIGNUP_FAILED:${response.status}`);
    const cookie = response.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const p = await principal(
      new Request("http://localhost:3000", { headers: { cookie } }),
    );
    if (i >= 3)
      await admin.query("UPDATE agus_users SET role='operations' WHERE id=$1", [
        p.id,
      ]);
    users.push({ ...p, cookie, role: i >= 3 ? "operations" : "consumer" });
    // Fixture setup enrolls seven users from one in-process address. Keep the
    // production limiter enabled; clear only this disposable test DB's budget.
    await admin.query("DELETE FROM agus_rate_limit");
  }
  return {
    admin,
    users,
    async challenge(
      p: Principal,
      r: { action: string; instructionDigest: string },
    ) {
      const id = randomUUID();
      await admin.query(
        "INSERT INTO agus_step_up(id,owner,session_id,action,digest,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '2 minutes')",
        [id, p.id, p.sessionId, r.action, r.instructionDigest],
      );
      return id;
    },
    async close() {
      await closeDatabase();
      await ((await db()).$client as unknown as Pool).end();
      await admin.end();
      await root.query(`DROP DATABASE "${name}"`);
      await root.query(`DROP ROLE "${role}"`);
      await root.end();
      vi.unstubAllEnvs();
    },
  };
}
