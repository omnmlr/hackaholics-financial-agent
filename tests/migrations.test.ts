import { PGlite } from "@electric-sql/pglite";
import { mkdtemp, readFile, cp, appendFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { assertSchema, migrate } from "../src/server/migrations";
import { hydrateLegacyFinancialState } from "../src/server/legacy-storage";
import { seedState, type Batch } from "../src/lib/domain";
it("adopts existing fixtures without changing submitted authority, record order or uncertainty, invalidates only unused authority, and rejects changed migration checksums", async () => {
  const client = new PGlite(),
    directory = await mkdtemp(join(tmpdir(), "agus-migrations-"));
  try {
    await cp("migrations", join(directory, "migrations"), { recursive: true });
    await client.exec(await readFile("migrations/0001_initial.sql", "utf8"));
    await client.exec(
      await readFile("migrations/0003_legacy_runtime_tables.sql", "utf8"),
    );
    const oldDraft = {
      owner: "legacy",
      id: "fixture-unsigned-draft",
      revision: 1,
      state: "approved",
      approval: { actor: "legacy", digest: "fixture-only" },
      submission: null,
      unsignedTransactionBase64: "fixture-unchanged-reviewed-bytes",
    };
    const submittedDraft = {
      ...oldDraft,
      id: "fixture-submitted-draft",
      state: "unknown",
      submission: { signature: "fixture-public-signature" },
    };
    for (const draft of [oldDraft, submittedDraft])
      await client.query(
        "INSERT INTO agus_solana_drafts(owner,id,revision,state,signature,payload) VALUES($1,$2,$3,$4,$5,$6)",
        [
          draft.owner,
          draft.id,
          draft.revision,
          draft.state,
          draft.submission?.signature ?? null,
          JSON.stringify(draft),
        ],
      );
    const at = "2026-11-10T00:00:00.000Z";
    const payment = (id: string) => ({
      id,
      reference: `fixture_${id}`,
      name: "Fixture",
      bankCode: "035",
      accountNumber: "0000000001",
      amountKobo: 100,
      reason: "Fixture",
      status: "unknown" as const,
      responses: [],
    });
    const submitted: Batch = {
      id: "submitted",
      owner: "legacy",
      mode: "fixture",
      createdAt: at,
      updatedAt: at,
      version: 4,
      payments: [payment("z-last"), payment("a-first")],
      feeReserveKobo: 0,
      status: "unknown",
      approval: {
        actor: "legacy",
        at,
        expiresAt: at,
        digest: "a".repeat(64),
        nonce: "consumed-original-nonce",
        consumedAt: at,
      },
    };
    const unsubmitted: Batch = {
      ...structuredClone(submitted),
      id: "unsubmitted",
      status: "approved",
      approval: { ...submitted.approval!, consumedAt: undefined },
      payments: [{ ...payment("unused"), status: "approved" }],
    };
    const state = {
      ...seedState(),
      batches: [submitted, unsubmitted],
      audit: [
        {
          id: "audit-z",
          actor: "legacy",
          action: "submitted",
          at,
          details: { signature: "fixture-public-signature" },
        },
        {
          id: "audit-a",
          actor: "legacy",
          action: "unknown",
          at,
          details: null,
        },
      ],
    };
    await client.query(
      "INSERT INTO workflow_state(id,revision,payload) VALUES(1,7,$1)",
      [JSON.stringify(state)],
    );
    await migrate(client, join(directory, "migrations"), false);
    await migrate(client, join(directory, "migrations"), false);
    await assertSchema(client);
    await client.query("BEGIN");
    await client.query("DELETE FROM agus_legacy_archive");
    await expect(assertSchema(client)).rejects.toThrow(
      "SCHEMA_MIGRATION_REQUIRED",
    );
    await client.query("ROLLBACK");
    await assertSchema(client);
    const original = (
      await client.query<{ payload: unknown }>(
        "SELECT payload FROM agus_legacy_archive",
      )
    ).rows[0].payload;
    expect(original).toEqual(state);
    const stored = (
      await client.query<{ payload: typeof state }>(
        "SELECT payload FROM workflow_state WHERE id=1",
      )
    ).rows[0].payload;
    expect(stored.batches).toEqual([]);
    expect(stored.audit).toEqual([]);
    const hydrated = await hydrateLegacyFinancialState(client, stored);
    expect(hydrated.batches[0]).toEqual(submitted);
    expect(hydrated.batches[1].approval).toBeUndefined();
    expect(hydrated.batches[1].status).toBe("awaiting_user_approval");
    expect(hydrated.audit).toEqual(state.audit);
    const reset = (
      await client.query<{ payload: typeof oldDraft }>(
        "SELECT payload FROM agus_solana_drafts WHERE id=$1",
        [oldDraft.id],
      )
    ).rows[0].payload;
    expect(reset.approval).toBeNull();
    expect(reset.state).toBe("prepared");
    expect(reset.unsignedTransactionBase64).toBe(
      oldDraft.unsignedTransactionBase64,
    );
    expect(
      (
        await client.query<{ payload: unknown }>(
          "SELECT payload FROM agus_solana_drafts WHERE id=$1",
          [submittedDraft.id],
        )
      ).rows[0].payload,
    ).toEqual(submittedDraft);
    expect(
      (await client.query("SELECT payload FROM agus_legacy_authority")).rows,
    ).toHaveLength(1);
    await appendFile(
      join(directory, "migrations/0001_initial.sql"),
      "\n-- tampered\n",
    );
    await expect(
      migrate(client, join(directory, "migrations"), false),
    ).rejects.toThrow("MIGRATION_CHECKSUM_MISMATCH");
    expect(
      (
        await client.query<{ payload: unknown }>(
          "SELECT payload FROM agus_legacy_archive",
        )
      ).rows[0].payload,
    ).toEqual(original);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 30000);
