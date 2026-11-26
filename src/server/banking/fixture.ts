import { randomUUID } from "node:crypto";
import { database, transaction } from "../sql";
import { instructionHash } from "../approvals";
import { DomainError, invariant } from "../errors";
import type {
  AccountDataProvider,
  BeneficiaryDirectoryProvider,
  SourcePaymentProvider,
  GrantCredential,
  SourceInstruction,
  PaymentObservation,
} from "./contracts";

function grant(c: GrantCredential) {
  invariant(c.kind === "fixture-grant", "PROVIDER_CREDENTIAL_MISMATCH", 403);
}
export const fixtureAccounts: AccountDataProvider = {
  id: "fixture",
  environment: "fixture",
  simulated: true,
  async initiate({ state, redirectUri }) {
    return {
      hostedUrl: `${redirectUri}?simulated=true&state=${encodeURIComponent(state)}`,
    };
  },
  async exchange(code) {
    invariant(
      code === "fixture-consent-approved",
      "FIXTURE_CONSENT_REQUIRED",
      403,
    );
    return {
      credential: { kind: "fixture-grant", id: randomUUID() },
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  },
  async accounts(c) {
    grant(c);
    const id = c.kind === "fixture-grant" ? c.id : "";
    return [
      {
        id: `${id}:current`,
        currency: "NGN",
        scale: 2,
        displayName: "Simulated current account",
      },
      {
        id: `${id}:savings`,
        currency: "NGN",
        scale: 2,
        displayName: "Simulated savings account",
      },
    ];
  },
  async balances(c, account) {
    grant(c);
    invariant(
      c.kind === "fixture-grant" && account.startsWith(`${c.id}:`),
      "FIXTURE_ACCOUNT_MISMATCH",
      403,
    );
    const row = (
      await (
        await database()
      ).query(
        "SELECT b.ledger_atoms,(b.ledger_atoms-b.reserved_atoms)::text AS available_atoms FROM agus_test_balances b JOIN agus_source_accounts a ON a.id=b.account_id WHERE a.provider_account_id=$1",
        [account],
      )
    ).rows[0];
    invariant(row, "FIXTURE_BALANCE_UNAVAILABLE", 503);
    return {
      available: { atoms: row.available_atoms, currency: "NGN", scale: 2 },
      ledger: { atoms: row.ledger_atoms, currency: "NGN", scale: 2 },
      observedAt: new Date().toISOString(),
    };
  },
  async transactions(c, account, cursor) {
    grant(c);
    invariant(!cursor || cursor === "page-2", "PROVIDER_CURSOR_INVALID", 400);
    const date = "2026-11-10T00:00:00.000Z";
    const tx = {
      id: `${account}:tx-1`,
      revision: cursor ? 2 : 1,
      amountAtoms: "10000",
      direction: "debit" as const,
      status: cursor ? ("reversed" as const) : ("posted" as const),
      occurredAt: date,
      description: "SIMULATED transaction",
    };
    return {
      data: cursor
        ? [
            tx,
            {
              ...tx,
              id: `${account}:tx-2`,
              revision: 1,
              direction: "credit",
              status: "posted",
              amountAtoms: "20000",
            },
          ]
        : [tx, tx],
      nextCursor: cursor ? null : "page-2",
      complete: Boolean(cursor),
      observedAt: new Date().toISOString(),
    };
  },
  async reauthorize(c) {
    grant(c);
    return { hostedUrl: "https://fixture.invalid/consent/simulated-only" };
  },
  async revoke(c) {
    grant(c);
  },
  async health() {
    return {
      linking: true,
      balances: true,
      history: true,
      sourcePayments: false,
    };
  },
};
export const fixtureDirectory: BeneficiaryDirectoryProvider = {
  id: "fixture-directory",
  environment: "fixture",
  simulated: true,
  async banks() {
    return [
      { code: "035", name: "Simulated Wema destination" },
      { code: "044", name: "Simulated Access destination" },
    ];
  },
  async verify(bankCode, account) {
    invariant(
      ["035", "044"].includes(bankCode) && /^\d{10}$/.test(account),
      "BENEFICIARY_NOT_FOUND",
      404,
    );
    return {
      name: `SIMULATED recipient ${account.slice(-4)}`,
      observedAt: new Date().toISOString(),
    };
  },
};
function observation(
  reference: string,
  status: PaymentObservation["status"],
): PaymentObservation {
  return {
    providerReference: reference,
    status,
    observedAt: new Date().toISOString(),
    simulated: true,
  };
}
export const fixturePayments: SourcePaymentProvider = {
  id: "fixture-source",
  environment: "fixture",
  simulated: true,
  async quote({ amount }) {
    return {
      fee: { atoms: "0", currency: amount.currency, scale: amount.scale },
      version: "fixture-no-charge-v1",
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    };
  },
  async submit(reference: string, instruction: SourceInstruction) {
    const scenario = instruction.testScenario ?? "normal";
    if (scenario === "outage" || scenario === "timeout_before_send")
      throw new DomainError("FIXTURE_SUBMISSION_UNCERTAIN", 503, true);
    const hash = instructionHash(instruction);
    await transaction(async (sql) => {
      const inserted = await sql.query(
        "INSERT INTO agus_test_effects(reference,request_hash,scenario,status,instruction) VALUES($1,$2,$3,'pending',$4) ON CONFLICT DO NOTHING RETURNING reference",
        [reference, hash, scenario, JSON.stringify(instruction)],
      );
      if (!inserted.rows.length) {
        const existing = (
          await sql.query(
            "UPDATE agus_test_effects SET submissions=submissions+1 WHERE reference=$1 RETURNING request_hash",
            [reference],
          )
        ).rows[0];
        invariant(
          existing.request_hash === hash,
          "PROVIDER_IDEMPOTENCY_CONFLICT",
        );
        return;
      }
      const cost = (
        BigInt(instruction.amount.atoms) + BigInt(instruction.fee.atoms)
      ).toString();
      const held = await sql.query(
        "UPDATE agus_test_balances SET reserved_atoms=reserved_atoms+$2 WHERE account_id=$1 AND ledger_atoms-reserved_atoms>=$2 RETURNING account_id",
        [instruction.sourceAccountId, cost],
      );
      await sql.query(
        "UPDATE agus_test_effects SET reserved=$2,status=CASE WHEN $2 THEN 'pending' ELSE 'failed' END,scenario=CASE WHEN $2 THEN scenario ELSE 'failure' END WHERE reference=$1",
        [reference, held.rows.length === 1],
      );
    });
    if (scenario === "timeout_after_send")
      throw new DomainError("FIXTURE_SUBMISSION_UNCERTAIN", 503, true);
    return observation(reference, "pending");
  },
  async verify(reference) {
    return transaction(async (sql) => {
      const row = (
        await sql.query(
          "SELECT * FROM agus_test_effects WHERE reference=$1 FOR UPDATE",
          [reference],
        )
      ).rows[0];
      if (!row) return observation(reference, "not_found");
      const status =
        row.scenario === "failure"
          ? "failed"
          : row.scenario === "delayed" && row.observed_reads < 2
            ? "pending"
            : row.scenario === "reversal" && row.observed_reads >= 1
              ? "reversed"
              : "succeeded";
      const instruction = row.instruction as SourceInstruction,
        cost = (
          BigInt(instruction.amount.atoms) + BigInt(instruction.fee.atoms)
        ).toString();
      if (row.reserved && status !== "pending") {
        await sql.query(
          "UPDATE agus_test_balances SET reserved_atoms=reserved_atoms-$2,ledger_atoms=ledger_atoms-CASE WHEN $3 THEN $2::numeric ELSE 0 END WHERE account_id=$1",
          [
            instruction.sourceAccountId,
            cost,
            status === "succeeded" || status === "reversed",
          ],
        );
        await sql.query(
          "UPDATE agus_test_effects SET reserved=false,settled=$2 WHERE reference=$1",
          [reference, status === "succeeded" || status === "reversed"],
        );
        row.settled = status === "succeeded" || status === "reversed";
      }
      if (status === "reversed" && row.settled && !row.reversed) {
        await sql.query(
          "UPDATE agus_test_balances SET ledger_atoms=ledger_atoms+$2 WHERE account_id=$1",
          [instruction.sourceAccountId, cost],
        );
        await sql.query(
          "UPDATE agus_test_effects SET reversed=true WHERE reference=$1",
          [reference],
        );
      }
      await sql.query(
        "UPDATE agus_test_effects SET observed_reads=observed_reads+1,status=$2 WHERE reference=$1",
        [reference, status],
      );
      return observation(reference, status);
    });
  },
};
