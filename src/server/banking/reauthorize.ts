import { randomBytes, createHash } from "node:crypto";
import { transaction } from "../sql";
import { invariant } from "../errors";
import { seal } from "../secrets";
export async function reauthorizeConnection(
  owner: string,
  id: string,
  revision: number,
) {
  invariant(
    (process.env.PAYMENT_MODE ?? "fixture") === "fixture",
    "FIXTURE_MODE_REQUIRED",
    403,
  );
  return transaction(async (sql) => {
    const state = randomBytes(32).toString("hex"),
      hash = createHash("sha256").update(state).digest("hex");
    const row = await sql.query(
      "UPDATE agus_connections SET state_hash=$4,state_envelope=$5,state_expires_at=now()+interval '10 minutes',callback_consumed_at=NULL,status='awaiting_consent',revision=revision+1 WHERE owner=$1 AND id=$2 AND revision=$3 AND revoked_at IS NULL RETURNING id",
      [
        owner,
        id,
        revision,
        hash,
        JSON.stringify(seal(owner, `connection-state:${id}`, state)),
      ],
    );
    invariant(row.rows.length, "CONNECTION_REVISION_CONFLICT");
    await sql.query(
      "UPDATE agus_grants SET revoked_at=now(),revision=revision+1 WHERE owner=$1 AND connection_id=$2 AND revoked_at IS NULL",
      [owner, id],
    );
    return {
      connectionId: id,
      state,
      simulated: true,
      status: "awaiting_consent",
    };
  });
}
