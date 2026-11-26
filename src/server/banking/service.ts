import { randomBytes, randomUUID, createHash } from "node:crypto";
import { database, transaction, type Sql } from "../sql";
import { invariant } from "../errors";
import { seal, unseal, type Envelope } from "../secrets";
import { operation } from "../idempotency";
import { fixtureAccountProvider } from "./fixture-scenarios";
import { fixtureAccounts, fixtureDirectory } from "./fixture";
import { externalIntegrationGates } from "./unavailable";
import { enqueue } from "../jobs";
import type { GrantCredential } from "./contracts";
import { z } from "zod";
import type {
  ConnectAccount,
  CompleteConnection,
  VerifyBeneficiary,
} from "../../../packages/contracts/src";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function institutions() {
  const sql = await database();
  return {
    data: (
      await sql.query(
        "SELECT i.id,i.display_name,i.legal_entity_name,i.legal_entity_identifier,i.legal_entity_verified,i.provider_ids,jsonb_agg(jsonb_build_object('operation',c.operation,'environment',c.environment,'accepted',c.accepted,'provider',c.provider,'evidence',c.evidence) ORDER BY c.operation) AS capabilities FROM agus_institutions i JOIN agus_institution_capabilities c ON c.institution=i.id GROUP BY i.id ORDER BY i.id",
      )
    ).rows,
    acceptedSourceInstitutions: 0,
    integrationGates: externalIntegrationGates,
  };
}
export async function beginConnection(
  owner: string,
  key: string,
  input: z.infer<typeof ConnectAccount>,
) {
  invariant(
    (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
    "FIXTURE_MODE_REQUIRED",
    403,
  );
  const result = await transaction(async (sql) => {
    invariant(
      (
        await sql.query("SELECT 1 FROM agus_institutions WHERE id=$1", [
          input.institutionId,
        ])
      ).rows.length,
      "INSTITUTION_NOT_FOUND",
      404,
    );
    const op = await operation(sql, owner, "bank.connection", key, input);
    if (op.created) {
      const state = randomBytes(32).toString("hex");
      await sql.query(
        "INSERT INTO agus_connections(owner,id,provider,environment,institution,state_hash,state_expires_at,status,state_envelope,test_scenario) VALUES($1,$2,'fixture','fixture',$3,$4,now()+interval '10 minutes','awaiting_consent',$5,$6)",
        [
          owner,
          op.id,
          input.institutionId,
          hash(state),
          JSON.stringify(seal(owner, `connection-state:${op.id}`, state)),
          input.testDataScenario ?? "normal",
        ],
      );
    }
    const saved = (
      await sql.query(
        "SELECT state_envelope,status FROM agus_connections WHERE owner=$1 AND id=$2",
        [owner, op.id],
      )
    ).rows[0];
    const state = unseal<string>(
      owner,
      `connection-state:${op.id}`,
      saved.state_envelope,
    );
    const redirectUri = `${process.env.BETTER_AUTH_URL ?? process.env.APP_ORIGIN ?? "http://localhost:3000"}/api/v1/banking/fixture-consent`;
    // Local fixture hosting does not impersonate a bank-hosted consent page.
    return {
      id: op.id,
      state,
      status: saved.status,
      simulated: true,
      environment: "fixture",
      redirectUri,
    };
  });
  const { redirectUri, ...view } = result;
  return {
    ...view,
    ...(await fixtureAccounts.initiate({
      state: result.state,
      redirectUri,
      institutionId: input.institutionId,
    })),
  };
}
export async function completeConnection(
  owner: string,
  input: z.infer<typeof CompleteConnection>,
) {
  const sql = await database();
  const claimed = await sql.query(
    "UPDATE agus_connections SET callback_consumed_at=now(),status='authorizing',revision=revision+1 WHERE owner=$1 AND id=$2 AND state_hash=$3 AND callback_consumed_at IS NULL AND state_expires_at>now() AND revoked_at IS NULL RETURNING provider,test_scenario",
    [owner, input.connectionId, hash(input.state)],
  );
  invariant(claimed.rows.length, "CONNECTION_CALLBACK_INVALID", 403);
  try {
    const provider = fixtureAccountProvider(claimed.rows[0].test_scenario);
    const exchange = await provider.exchange(input.code);
    // Fixture account identity is stable across explicit grant renewal.
    if (exchange.credential.kind === "fixture-grant")
      exchange.credential.id = input.connectionId;
    const stableAccounts = await provider.accounts(exchange.credential);
    invariant(exchange.expiresAt, "FIXTURE_GRANT_EXPIRY_REQUIRED", 503);
    return await transaction(async (tx) => {
      const row = (
        await tx.query(
          "SELECT status,revoked_at FROM agus_connections WHERE owner=$1 AND id=$2 FOR UPDATE",
          [owner, input.connectionId],
        )
      ).rows[0];
      invariant(
        row && !row.revoked_at && row.status === "authorizing",
        "CONNECTION_REVOKED",
        403,
      );
      const grantId = randomUUID();
      await tx.query(
        "UPDATE agus_grants SET revoked_at=coalesce(revoked_at,now()),revision=revision+1 WHERE owner=$1 AND connection_id=$2 AND revoked_at IS NULL",
        [owner, input.connectionId],
      );
      await tx.query(
        "INSERT INTO agus_grants(owner,id,connection_id,scopes,expires_at) VALUES($1,$2,$3,$4,$5)",
        [
          owner,
          grantId,
          input.connectionId,
          JSON.stringify([
            "accounts",
            "balances",
            "history",
            "fixture-source-payment",
          ]),
          exchange.expiresAt,
        ],
      );
      for (const account of stableAccounts)
        await tx.query(
          "INSERT INTO agus_source_accounts(owner,id,connection_id,grant_id,provider_account_id,currency,scale,display_name,simulated) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT(owner,connection_id,provider_account_id) DO UPDATE SET grant_id=excluded.grant_id,revision=agus_source_accounts.revision+1,observed_at=now()",
          [
            owner,
            randomUUID(),
            input.connectionId,
            grantId,
            account.id,
            account.currency,
            account.scale,
            account.displayName,
          ],
        );
      await tx.query(
        "INSERT INTO agus_test_balances(account_id) SELECT id FROM agus_source_accounts WHERE owner=$1 AND connection_id=$2 ON CONFLICT DO NOTHING",
        [owner, input.connectionId],
      );
      await tx.query(
        "UPDATE agus_connections SET status='active',credential_envelope=$3,revision=revision+1 WHERE owner=$1 AND id=$2",
        [
          owner,
          input.connectionId,
          JSON.stringify(
            seal(
              owner,
              `bank-grant:${input.connectionId}`,
              exchange.credential,
            ),
          ),
        ],
      );
      return {
        connectionId: input.connectionId,
        grantId,
        accountCount: stableAccounts.length,
        simulated: true,
      };
    });
  } catch (error) {
    await sql.query(
      "UPDATE agus_connections SET status='reauthorization_required',revision=revision+1 WHERE owner=$1 AND id=$2 AND revoked_at IS NULL",
      [owner, input.connectionId],
    );
    throw error;
  }
}
export async function sourceAccess(
  sql: Sql,
  owner: string,
  id: string,
  lock = false,
  scope = "accounts",
) {
  invariant(
    (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
    "PAYMENT_ENVIRONMENT_CHANGED",
    403,
  );
  if (lock) {
    // Match revocation/reauthorization lock order: connection before grant and
    // account. Otherwise a concurrent consent change can deadlock a claim.
    const identity = (
      await sql.query(
        "SELECT connection_id FROM agus_source_accounts WHERE owner=$1 AND id=$2",
        [owner, id],
      )
    ).rows[0];
    invariant(identity, "SOURCE_GRANT_UNAVAILABLE", 403);
    await sql.query(
      "SELECT id FROM agus_connections WHERE owner=$1 AND id=$2 FOR UPDATE",
      [owner, identity.connection_id],
    );
  }
  const r = await sql.query(
    `SELECT a.*,g.expires_at AS grant_expires_at,g.revision AS grant_revision,c.credential_envelope,c.provider,c.environment,c.test_scenario FROM agus_source_accounts a JOIN agus_grants g ON g.owner=a.owner AND g.id=a.grant_id JOIN agus_connections c ON c.owner=a.owner AND c.id=a.connection_id WHERE a.owner=$1 AND a.id=$2 AND g.revoked_at IS NULL AND g.expires_at>now() AND g.scopes ? $3 AND c.revoked_at IS NULL AND c.status='active' ${lock ? "FOR UPDATE OF a,g,c" : ""}`,
    [owner, id, scope],
  );
  invariant(r.rows.length, "SOURCE_GRANT_UNAVAILABLE", 403);
  return r.rows[0];
}
export async function listAccounts(owner: string) {
  return {
    data: (
      await (
        await database()
      ).query(
        "SELECT a.id,a.connection_id,a.grant_id,a.currency,a.scale,a.display_name,a.simulated,a.revision,a.observed_at,a.history_complete,c.provider,c.environment,g.expires_at,g.revoked_at FROM agus_source_accounts a JOIN agus_connections c ON c.owner=a.owner AND c.id=a.connection_id JOIN agus_grants g ON g.owner=a.owner AND g.id=a.grant_id WHERE a.owner=$1 ORDER BY a.id",
        [owner],
      )
    ).rows,
  };
}
export async function refreshBalance(owner: string, accountId: string) {
  const sql = await database(),
    access = await sourceAccess(sql, owner, accountId, false, "balances");
  const credential = unseal<GrantCredential>(
    owner,
    `bank-grant:${access.connection_id}`,
    access.credential_envelope,
  );
  const balance = await fixtureAccountProvider(access.test_scenario).balances(
    credential,
    access.provider_account_id,
  );
  invariant(
    balance.available && balance.ledger,
    "BALANCE_KINDS_UNAVAILABLE",
    503,
  );
  return transaction(async (tx) => {
    await sourceAccess(tx, owner, accountId, true, "balances");
    const id = randomUUID();
    await tx.query(
      "INSERT INTO agus_balance_snapshots(owner,id,account_id,available_atoms,ledger_atoms,observed_at,provider,environment,simulated) VALUES($1,$2,$3,$4,$5,$6,'fixture','fixture',true)",
      [
        owner,
        id,
        accountId,
        balance.available!.atoms,
        balance.ledger!.atoms,
        balance.observedAt,
      ],
    );
    return {
      id,
      accountId,
      ...balance,
      provider: "fixture",
      environment: "fixture",
      simulated: true,
      verification: "simulated",
    };
  });
}
export async function syncAccount(
  owner: string,
  accountId: string,
  refresh = false,
) {
  const sql = await database();
  let access = await sourceAccess(sql, owner, accountId, false, "history");
  if (refresh && access.history_complete) {
    await sql.query(
      "UPDATE agus_source_accounts SET sync_cursor=NULL,history_complete=false,revision=revision+1 WHERE owner=$1 AND id=$2 AND history_complete=true",
      [owner, accountId],
    );
    access = await sourceAccess(sql, owner, accountId, false, "history");
  }
  if (access.history_complete)
    return { accountId, complete: true, simulated: true };
  const credential = unseal<GrantCredential>(
    owner,
    `bank-grant:${access.connection_id}`,
    access.credential_envelope,
  );
  const result = await fixtureAccountProvider(
    access.test_scenario,
  ).transactions(
    credential,
    access.provider_account_id,
    access.sync_cursor ?? undefined,
  );
  return transaction(async (tx) => {
    const current = await sourceAccess(tx, owner, accountId, true, "history");
    // A competing/restarted synchronization may already have committed this page.
    if (current.sync_cursor !== access.sync_cursor || current.history_complete)
      return { accountId, complete: current.history_complete, simulated: true };
    for (const t of result.data) {
      z.object({
        id: z.string().min(1).max(200),
        revision: z.number().int().nonnegative().safe(),
        amountAtoms: z.string().regex(/^(0|[1-9][0-9]{0,77})$/),
        direction: z.enum(["credit", "debit"]),
        status: z.enum(["posted", "reversed", "pending"]),
        occurredAt: z.iso.datetime(),
        description: z.string().max(2000),
      }).parse(t);
      const prior = (
        await tx.query(
          "SELECT revision,amount_atoms,direction,status FROM agus_bank_transactions WHERE owner=$1 AND account_id=$2 AND provider_id=$3",
          [owner, accountId, t.id],
        )
      ).rows[0];
      if (prior && prior.revision === t.revision)
        invariant(
          prior.amount_atoms === t.amountAtoms &&
            prior.direction === t.direction &&
            prior.status === t.status,
          "PROVIDER_REVISION_CONFLICT",
          502,
        );
      await tx.query(
        "INSERT INTO agus_bank_transactions(owner,id,account_id,provider_id,revision,amount_atoms,direction,status,occurred_at,observed_at,provider,environment,simulated,description) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'fixture','fixture',true,$11) ON CONFLICT(owner,account_id,provider_id) DO UPDATE SET revision=excluded.revision,amount_atoms=excluded.amount_atoms,direction=excluded.direction,status=excluded.status,observed_at=excluded.observed_at,description=excluded.description WHERE agus_bank_transactions.revision<excluded.revision",
        [
          owner,
          randomUUID(),
          accountId,
          t.id,
          t.revision,
          t.amountAtoms,
          t.direction,
          t.status,
          t.occurredAt,
          result.observedAt,
          t.description,
        ],
      );
    }
    await tx.query(
      "UPDATE agus_source_accounts SET sync_cursor=$3,history_complete=$4,revision=revision+1 WHERE owner=$1 AND id=$2",
      [owner, accountId, result.nextCursor, result.complete],
    );
    if (result.nextCursor)
      await enqueue(
        tx,
        owner,
        "bank.sync",
        `bank-sync:${accountId}:${current.revision}:${hash(result.nextCursor)}`,
        { accountId },
      );
    return {
      accountId,
      complete: result.complete,
      simulated: true,
      nextPagePending: Boolean(result.nextCursor),
    };
  });
}
export async function revokeConnection(
  owner: string,
  id: string,
  revision: number,
) {
  const row = await transaction(async (sql) => {
    const r = await sql.query(
      "UPDATE agus_connections SET status='revoked',revoked_at=now(),provider_revocation_pending=true,revision=revision+1 WHERE owner=$1 AND id=$2 AND revision=$3 AND revoked_at IS NULL RETURNING credential_envelope,test_scenario",
      [owner, id, revision],
    );
    invariant(r.rows.length, "CONNECTION_REVISION_CONFLICT");
    await sql.query(
      "UPDATE agus_grants SET revoked_at=now(),revision=revision+1 WHERE owner=$1 AND connection_id=$2 AND revoked_at IS NULL",
      [owner, id],
    );
    await enqueue(sql, owner, "bank.revoke", `bank-revoke:${id}`, {
      connectionId: id,
    });
    return r.rows[0];
  });
  // Local revocation commits before the external request; an outage never
  // leaves local reads or pending payment authority enabled.
  if (row.credential_envelope) {
    try {
      await fixtureAccountProvider(row.test_scenario).revoke(
        unseal<GrantCredential>(
          owner,
          `bank-grant:${id}`,
          row.credential_envelope as Envelope,
        ),
      );
      await (
        await database()
      ).query(
        "UPDATE agus_connections SET provider_revocation_pending=false WHERE owner=$1 AND id=$2",
        [owner, id],
      );
    } catch {
      /* Keep the durable pending state for operations/retry. */
    }
  }
  return { revoked: true, simulated: true };
}
export async function retryProviderRevocation(owner: string, id: string) {
  const sql = await database(),
    row = (
      await sql.query(
        "SELECT credential_envelope,test_scenario FROM agus_connections WHERE owner=$1 AND id=$2 AND revoked_at IS NOT NULL AND provider_revocation_pending=true",
        [owner, id],
      )
    ).rows[0];
  if (!row) return;
  if (row.credential_envelope)
    await fixtureAccountProvider(row.test_scenario).revoke(
      unseal<GrantCredential>(
        owner,
        `bank-grant:${id}`,
        row.credential_envelope,
      ),
    );
  await sql.query(
    "UPDATE agus_connections SET provider_revocation_pending=false WHERE owner=$1 AND id=$2 AND revoked_at IS NOT NULL",
    [owner, id],
  );
}
export async function verifyBeneficiary(
  owner: string,
  key: string,
  input: z.infer<typeof VerifyBeneficiary>,
) {
  invariant(
    (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
    "FIXTURE_MODE_REQUIRED",
    403,
  );
  const result = await fixtureDirectory.verify(
    input.bankCode,
    input.accountNumber,
  );
  return transaction(async (sql) => {
    const op = await operation(sql, owner, "beneficiary.verify", key, input);
    if (op.created)
      await sql.query(
        "INSERT INTO agus_beneficiaries(owner,id,bank_code,account_envelope,identity_hash,verified_name,provider,environment,verified_at,simulated) VALUES($1,$2,$3,$4,$5,$6,'fixture-directory','fixture',$7,true)",
        [
          owner,
          op.id,
          input.bankCode,
          JSON.stringify(
            seal(owner, `beneficiary:${op.id}`, input.accountNumber),
          ),
          hash(`${input.bankCode}:${input.accountNumber}:${result.name}`),
          result.name,
          result.observedAt,
        ],
      );
    return (
      await sql.query(
        "SELECT id,bank_code,verified_name,provider,environment,verified_at,simulated FROM agus_beneficiaries WHERE owner=$1 AND id=$2",
        [owner, op.id],
      )
    ).rows[0];
  });
}
