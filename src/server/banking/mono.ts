/** Transport-injected Mono data adapter. No source-payment capability. Nothing
 * here enables an institution or claims approved credentials/sandbox acceptance.
 * Wire references checked 2026-11-10: integration-guide, reauth-link and the
 * accounts/unlink API reference at docs.mono.co. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DomainError, invariant } from "../errors";
import type {
  AccountDataProvider,
  GrantCredential,
  ProviderEnvironment,
} from "./contracts";
const accountId = z.string().regex(/^[a-f0-9]{24}$/);
const atomic = z.number().int().nonnegative().safe();
const accountSchema = z.object({
  account: z.object({
    id: accountId,
    name: z.string().max(200),
    currency: z.literal("NGN"),
    balance: atomic,
  }),
});
type HostedConnect = AccountDataProvider["initiate"];
export class MonoDataAdapter implements AccountDataProvider {
  readonly id = "mono-data";
  readonly simulated = false;
  constructor(
    readonly environment: Exclude<ProviderEnvironment, "fixture">,
    private secret: string,
    private hostedConnect?: HostedConnect,
    private transport: typeof fetch = fetch,
  ) {
    invariant(secret.length > 0, "MONO_CREDENTIAL_REQUIRED", 503);
  }
  private idFor(c: GrantCredential) {
    invariant(c.kind === "mono-account-id", "MONO_CREDENTIAL_MISMATCH", 403);
    return accountId.parse(c.accountId);
  }
  private async call(path: string, method = "GET", body?: unknown) {
    let response: Response;
    try {
      response = await this.transport(
        `https://api.withmono.com/v2/accounts${path}`,
        {
          method,
          redirect: "error",
          signal: AbortSignal.timeout(12000),
          headers: {
            "mono-sec-key": this.secret,
            accept: "application/json",
            "content-type": "application/json",
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
      );
    } catch {
      throw new DomainError("MONO_UNAVAILABLE", 503, true);
    }
    if (response.status === 429)
      throw new DomainError("MONO_RATE_LIMITED", 429, true);
    invariant(
      response.ok && response.body,
      response.status === 401 || response.status === 403
        ? "MONO_REAUTHORIZATION_REQUIRED"
        : "MONO_UNAVAILABLE",
      response.status < 500 ? 403 : 503,
    );
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 256000) {
        await reader.cancel();
        throw new DomainError("MONO_RESPONSE_TOO_LARGE", 502);
      }
      chunks.push(part.value);
    }
    const raw = z
      .object({
        status: z.literal("successful"),
        data: z.unknown(),
        meta: z.object({ next: z.string().nullable().optional() }).optional(),
      })
      .safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    invariant(raw.success, "MONO_INVALID_RESPONSE", 502);
    return raw.data;
  }
  async initiate(input: Parameters<HostedConnect>[0]) {
    invariant(this.hostedConnect, "MONO_HOSTED_CONNECT_NOT_CONFIGURED", 503);
    const result = await this.hostedConnect(input),
      url = new URL(result.hostedUrl);
    invariant(
      url.protocol === "https:" &&
        url.hostname === "link.mono.co" &&
        !url.username &&
        !url.password,
      "MONO_HOSTED_URL_INVALID",
      502,
    );
    return result;
  }
  async exchange(code: string) {
    const raw = await this.call("/auth", "POST", { code });
    const credential: GrantCredential = {
      kind: "mono-account-id",
      accountId: z.object({ id: accountId }).parse(raw.data).id,
    };
    // Mono's account identifier is not an OAuth refresh token and does not
    // inherit an invented provider expiry. Local consent expiry is separate.
    return { credential, expiresAt: null };
  }
  async accounts(c: GrantCredential) {
    const value = accountSchema.parse(
      (await this.call(`/${this.idFor(c)}`)).data,
    ).account;
    return [
      {
        id: value.id,
        displayName: value.name,
        currency: value.currency,
        scale: 2,
      },
    ];
  }
  async balances(c: GrantCredential, account: string) {
    invariant(account === this.idFor(c), "MONO_ACCOUNT_MISMATCH", 403);
    const value = accountSchema.parse(
      (await this.call(`/${account}`)).data,
    ).account;
    // Public account data exposes a balance, without establishing separate
    // available/ledger semantics. Preserve that distinction rather than guess.
    return {
      available: null,
      ledger: null,
      reported: {
        atoms: String(value.balance),
        currency: value.currency,
        scale: 2,
      },
      observedAt: new Date().toISOString(),
    };
  }
  async transactions(c: GrantCredential, account: string, cursor?: string) {
    invariant(account === this.idFor(c), "MONO_ACCOUNT_MISMATCH", 403);
    invariant(
      !cursor || /^[1-9][0-9]{0,6}$/.test(cursor),
      "MONO_CURSOR_INVALID",
      400,
    );
    const raw = await this.call(
      `/${account}/transactions?page=${cursor ?? "1"}`,
    );
    const rows = z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          amount: atomic,
          type: z.enum(["debit", "credit"]),
          date: z.iso.datetime(),
          narration: z.string().max(2000),
        }),
      )
      .max(1000)
      .parse(raw.data);
    let nextCursor: string | null = null;
    if (raw.meta?.next) {
      const next = new URL(raw.meta.next);
      invariant(
        next.origin === "https://api.withmono.com" &&
          !next.username &&
          !next.password,
        "MONO_CURSOR_INVALID",
        502,
      );
      const page = next.searchParams.get("page");
      invariant(
        page &&
          /^[1-9][0-9]{0,6}$/.test(page) &&
          Number(page) > Number(cursor ?? 1),
        "MONO_CURSOR_INVALID",
        502,
      );
      // Never fetch a provider-supplied next URL; reconstruct our pinned path.
      nextCursor = page;
    }
    return {
      data: rows.map((t) => ({
        id: t.id,
        revision: 1,
        amountAtoms: String(t.amount),
        direction: t.type,
        status: "posted" as const,
        occurredAt: t.date,
        description: t.narration,
      })),
      nextCursor,
      complete: !nextCursor,
      observedAt: new Date().toISOString(),
    };
  }
  async reauthorize(
    c: GrantCredential,
    input: { state: string; redirectUri: string },
  ) {
    const raw = await this.call("/initiate", "POST", {
      scope: "reauth",
      account: this.idFor(c),
      redirect_url: input.redirectUri,
      meta: { ref: input.state || randomUUID() },
    });
    const hostedUrl = z.object({ mono_url: z.url() }).parse(raw.data).mono_url,
      url = new URL(hostedUrl);
    invariant(
      url.origin === "https://link.mono.co" && !url.username && !url.password,
      "MONO_HOSTED_URL_INVALID",
      502,
    );
    return { hostedUrl };
  }
  async revoke(c: GrantCredential) {
    await this.call(`/${this.idFor(c)}/unlink`, "POST");
  }
  async health() {
    return {
      linking: false,
      balances: false,
      history: false,
      sourcePayments: false as const,
    };
  }
}
