import { createHash } from "node:crypto";
import {
  APIError,
  createAuthEndpoint,
  createAuthMiddleware,
  formCsrfMiddleware,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { parseUserOutput } from "better-auth/db";
import { z } from "zod";

const callback = "agus://open/auth";
const proof = /^[a-f0-9]{64}$/;
const handoffKey = (challenge: string) => "agus-google-handoff:" + challenge;

export function mobileGoogle() {
  return {
    id: "agus-mobile-google",
    hooks: {
      after: [
        {
          matcher: (ctx: { path?: string }) => ctx.path === "/callback/:id",
          handler: createAuthMiddleware(async (ctx) => {
            const headers = ctx.context.responseHeaders;
            const location = headers?.get("location");
            if (!location?.startsWith("agus:")) return;
            // Native callback URLs are interceptable. Only a proof-of-possession
            // exchange over HTTPS can receive the session cookie.
            headers?.delete("set-cookie");
            const url = new URL(location);
            const challenge = url.searchParams.get("challenge");
            if (
              !location.startsWith(callback + "?") ||
              !challenge ||
              !proof.test(challenge)
            ) {
              ctx.setHeader("location", callback);
              return;
            }
            const current = ctx.context.newSession;
            if (current && ctx.params?.id === "google") {
              await ctx.context.internalAdapter.reserveVerificationValue({
                identifier: handoffKey(challenge),
                value: current.session.token,
                expiresAt: new Date(Date.now() + 60_000),
              });
            }
            ctx.setHeader("location", callback + "?challenge=" + challenge);
          }),
        },
      ],
    },
    endpoints: {
      exchangeMobileGoogle: createAuthEndpoint(
        "/mobile-google/exchange",
        {
          method: "POST",
          use: [formCsrfMiddleware],
          body: z.object({ verifier: z.string().regex(proof) }),
        },
        async (ctx) => {
          const challenge = createHash("sha256")
            .update(ctx.body.verifier)
            .digest("hex");
          const adapter = ctx.context.internalAdapter;
          const handoff = await adapter.consumeVerificationValue(
            handoffKey(challenge),
          );
          const session = handoff && (await adapter.findSession(handoff.value));
          if (!session)
            throw new APIError("UNAUTHORIZED", {
              code: "GOOGLE_HANDOFF_REQUIRED",
            });
          await setSessionCookie(ctx, session);
          return ctx.json({
            user: parseUserOutput(ctx.context.options, session.user),
          });
        },
      ),
    },
  };
}
