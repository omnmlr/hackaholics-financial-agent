import { betterAuth, APIError } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { twoFactor } from "better-auth/plugins/two-factor";
import { expo } from "@better-auth/expo";
import { nextCookies } from "better-auth/next-js";
import { db } from "../lib/db";
import * as schema from "./auth-schema";
import { database } from "./sql";
import { invariant } from "./errors";

export async function createIdentity() {
  invariant(
    (process.env.BETTER_AUTH_SECRET?.length ?? 0) >= 32,
    "IDENTITY_CONFIGURATION_REQUIRED",
    503,
  );
  const sql = await database();
  const origin =
    process.env.BETTER_AUTH_URL ??
    process.env.APP_ORIGIN ??
    "http://localhost:3000";
  return betterAuth({
    appName: "AGUS",
    baseURL: origin,
    secret: process.env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(await db(), { provider: "pg", schema }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "consumer", input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      freshAge: 15 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 20 },
    trustedOrigins: [origin, "agus://"],
    advanced: {
      useSecureCookies: origin.startsWith("https://"),
      database: { generateId: "uuid" },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const r = await sql.query(
              "SELECT email FROM agus_invitations WHERE email=$1 AND consumed_at IS NULL AND expires_at>now()",
              [user.email.toLowerCase()],
            );
            if (!r.rows.length)
              throw new APIError("FORBIDDEN", {
                code: "INVITATION_REQUIRED",
                message: "Invitation required",
              });
            return {
              data: {
                ...user,
                email: user.email.toLowerCase(),
                role: "consumer",
              },
            };
          },
          after: async (user) => {
            await sql.query(
              "UPDATE agus_invitations SET consumed_at=now() WHERE email=$1",
              [user.email.toLowerCase()],
            );
          },
        },
      },
      account: {
        update: {
          after: async (account) => {
            // Any credential change invalidates every existing session. A new login
            // is required, including on the device which initiated the change.
            if (account.providerId === "credential" && account.password)
              await sql.query("DELETE FROM agus_sessions WHERE user_id=$1", [
                account.userId,
              ]);
          },
        },
      },
    },
    plugins: [
      twoFactor({ issuer: "AGUS" }),
      expo({ disableOriginOverride: true }),
      nextCookies(),
    ],
  });
}
let identityPromise: ReturnType<typeof createIdentity> | undefined;
export function identity() {
  return (identityPromise ??= createIdentity().catch((error) => {
    identityPromise = undefined;
    throw error;
  }));
}
export type Principal = {
  id: string;
  sessionId: string;
  role: string;
  twoFactorEnabled: boolean;
};
export async function principal(req: Request): Promise<Principal> {
  const session = await (
    await identity()
  ).api.getSession({ headers: req.headers });
  invariant(session, "UNAUTHENTICATED", 401);
  return {
    id: session.user.id,
    sessionId: session.session.id,
    role: session.user.role,
    twoFactorEnabled: session.user.twoFactorEnabled === true,
  };
}
export function mutationOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const expected =
    process.env.BETTER_AUTH_URL ??
    process.env.APP_ORIGIN ??
    "http://localhost:3000";
  // Origin is CSRF protection only. Neither this nor an Expo/device header
  // authenticates a native client: every call also verifies its server session.
  invariant(
    origin === expected || origin === "agus://",
    "ORIGIN_REJECTED",
    403,
  );
}
