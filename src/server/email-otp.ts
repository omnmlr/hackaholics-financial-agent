import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import {
  APIError,
  createAuthEndpoint,
  formCsrfMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseUserOutput, revokeUnprovenAccountAccess } from "better-auth/db";
import { z } from "zod";
import { database, transaction } from "./sql";

const emailAddress = z.string().trim().max(254).email().toLowerCase();
const lifetimeSeconds = 300;
const resendSeconds = 60;
const maxAttempts = 5;

export function emailOtp(
  secret: string,
  send: (email: string, otp: string) => Promise<void>,
) {
  function hash(...parts: string[]) {
    return createHmac("sha256", secret)
      .update(JSON.stringify(parts))
      .digest("hex");
  }
  const keyFor = (email: string) => "agus-login-otp-" + hash("email", email);

  return {
    id: "agus-email-otp",
    endpoints: {
      sendVerificationOTP: createAuthEndpoint(
        "/email-otp/send-verification-otp",
        {
          method: "POST",
          use: [formCsrfMiddleware],
          body: z.object({ email: emailAddress, type: z.literal("sign-in") }),
        },
        async (ctx) => {
          const { email } = ctx.body;
          const key = keyFor(email);
          const code = String(randomInt(1_000_000)).padStart(6, "0");
          const sql = await database();
          // The primary key serializes requests for this recipient across API replicas.
          const issued = await sql.query(
            `INSERT INTO agus_verifications (id, identifier, value, expires_at, created_at, updated_at)
           VALUES ($1, $1, $2, now() + make_interval(secs => $3), now(), now())
           ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value,
               expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at
           WHERE agus_verifications.updated_at <= now() - make_interval(secs => $4)
           RETURNING id`,
            [key, hash(key, code) + ":0", lifetimeSeconds, resendSeconds],
          );
          if (!issued.rows.length) {
            ctx.setHeader("Retry-After", String(resendSeconds));
            throw new APIError("TOO_MANY_REQUESTS", {
              code: "OTP_RESEND_THROTTLED",
            });
          }
          try {
            await send(email, code);
          } catch {
            throw new APIError("SERVICE_UNAVAILABLE", {
              code: "OTP_DELIVERY_UNAVAILABLE",
            });
          }
          return ctx.json({ success: true });
        },
      ),
      signInEmailOTP: createAuthEndpoint(
        "/sign-in/email-otp",
        {
          method: "POST",
          use: [formCsrfMiddleware],
          body: z.object({
            email: emailAddress,
            otp: z.string().regex(/^\d{6}$/),
          }),
        },
        async (ctx) => {
          const { email, otp } = ctx.body;
          const key = keyFor(email);
          const result = await transaction(async (tx) => {
            const {
              rows: [row],
            } = await tx.query<{ value: string }>(
              "SELECT value FROM agus_verifications WHERE id=$1 AND expires_at>now() FOR UPDATE",
              [key],
            );
            if (!row || row.value === "used") return "INVALID_OTP";
            const [stored, attempts] = row.value.split(":");
            if (Number(attempts) >= maxAttempts) return "TOO_MANY_ATTEMPTS";
            const valid = timingSafeEqual(
              Buffer.from(stored),
              Buffer.from(hash(key, otp)),
            );
            // Keep the consumed row until expiry so verification cannot reset the resend window.
            await tx.query(
              "UPDATE agus_verifications SET value=$2 WHERE id=$1",
              [key, valid ? "used" : stored + ":" + (Number(attempts) + 1)],
            );
            return valid ? null : "INVALID_OTP";
          });
          if (result) {
            throw new APIError(
              result === "TOO_MANY_ATTEMPTS" ? "FORBIDDEN" : "BAD_REQUEST",
              { code: result },
            );
          }

          const adapter = ctx.context.internalAdapter;
          const existing = (await adapter.findUserByEmail(email))?.user;
          const user = existing
            ? existing.emailVerified
              ? existing
              : await revokeUnprovenAccountAccess(ctx, existing.id)
            : await adapter.createUser(
                { name: "", email, emailVerified: true },
                { method: "email-otp" },
              );
          if (!user?.emailVerified) {
            throw new APIError("BAD_REQUEST", { code: "INVALID_OTP" });
          }
          const session = await adapter.createSession(user.id);
          await setSessionCookie(ctx, { user, session });
          return ctx.json({ user: parseUserOutput(ctx.context.options, user) });
        },
      ),
    },
  };
}
