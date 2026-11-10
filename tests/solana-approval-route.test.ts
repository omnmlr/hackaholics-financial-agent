/** HTTP boundary with real durable auth; Solana service is isolated from RPC. */
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, attempts, sessions } from "../src/lib/db";
import { hash, login, reauthenticate } from "../src/lib/auth";
import { POST, GET } from "../src/app/api/agent-workspace/solana/route";
import { SolanaError } from "../src/lib/solana/contracts";

const mocked = vi.hoisted(() => ({
  approve: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
}));
vi.mock("../src/lib/solana", () => ({ service: () => mocked }));
const password = "fixture-step-up-only";
let token: string;
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "pglite://:memory:");
  vi.stubEnv("PAYMENT_MODE", "fixture");
  vi.stubEnv("OPERATOR_ID", "approval-owner");
  vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
  const salt = randomBytes(16).toString("hex");
  vi.stubEnv(
    "OPERATOR_PASSWORD_HASH",
    `${salt}:${scryptSync(password, salt, 64).toString("hex")}`,
  );
  await (await db()).delete(attempts);
  await (await db()).delete(sessions);
  mocked.approve.mockReset().mockResolvedValue({ state: "approved" });
  mocked.get
    .mockReset()
    .mockResolvedValue({ owner: "approval-owner", state: "submitted" });
  token = await login(password);
});
it("exports only an authenticated owner's saved draft with private response headers", async () => {
  const id = randomUUID();
  const response = await GET(
    new Request(
      `http://localhost:3000/api/agent-workspace/solana?id=${id}&download=1`,
      { headers: { cookie: `ha_session=${token}` } },
    ),
  );
  expect(response.status).toBe(200);
  expect(mocked.get).toHaveBeenCalledWith("approval-owner", id);
  expect(response.headers.get("Content-Disposition")).toBe(
    `attachment; filename="devnet-draft-${id}.json"`,
  );
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const hidden = await GET(
    new Request(
      `http://localhost:3000/api/agent-workspace/solana?id=${id}&download=1`,
    ),
  );
  expect(hidden.status).toBe(401);
  mocked.get.mockRejectedValue(
    new SolanaError("NOT_FOUND", "Draft not found", 404),
  );
  const other = await GET(
    new Request(
      `http://localhost:3000/api/agent-workspace/solana?id=${randomUUID()}`,
      { headers: { cookie: `ha_session=${token}` } },
    ),
  );
  expect(other.status).toBe(404);
});
afterEach(() => vi.unstubAllEnvs());
function approve(
  secret: string,
  cookie = token,
  origin = "http://localhost:3000",
) {
  return POST(
    new Request("http://localhost:3000/api/agent-workspace/solana", {
      method: "POST",
      headers: {
        origin,
        cookie: `ha_session=${cookie}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "approve",
        id: randomUUID(),
        digest: "a".repeat(64),
        acknowledged: true,
        password: secret,
      }),
    }),
  );
}
it("throttles ten failed Solana approvals across draft IDs and session replacement", async () => {
  for (let i = 0; i < 10; i++)
    expect((await approve("incorrect")).status).toBe(401);
  token = await login(password);
  expect((await approve(password)).status).toBe(429);
  expect(mocked.approve).not.toHaveBeenCalled();
  expect(await (await db()).select().from(sessions)).toHaveLength(2);
});
it("does not issue a session for successful step-up and passes exact authenticated approval", async () => {
  expect((await approve(password)).status).toBe(200);
  expect(mocked.approve).toHaveBeenCalledWith(
    "approval-owner",
    expect.any(String),
    { digest: "a".repeat(64), acknowledged: true },
  );
  expect(await (await db()).select().from(sessions)).toHaveLength(1);
});
it("rejects unauthenticated, wrong-origin and wrong-owner attempts before password verification", async () => {
  expect((await approve(password, "invalid")).status).toBe(401);
  expect((await approve(password, token, "https://evil.invalid")).status).toBe(
    403,
  );
  await (
    await db()
  )
    .update(sessions)
    .set({ operatorId: "other-owner" })
    .where(eq(sessions.tokenHash, hash(token)));
  expect((await approve(password)).status).toBe(401);
  await expect(reauthenticate("other-owner", password)).rejects.toMatchObject({
    status: 401,
  });
  expect(mocked.approve).not.toHaveBeenCalled();
  expect(await (await db()).select().from(attempts)).toHaveLength(0);
});
it("resets an elapsed persistent window and clears failures after a valid password", async () => {
  for (let i = 0; i < 10; i++) await approve("incorrect");
  expect((await approve(password)).status).toBe(429);
  await (await db()).update(attempts).set({ resetAt: new Date(0) });
  expect((await approve(password)).status).toBe(200);
  expect(await (await db()).select().from(attempts)).toHaveLength(0);
});
