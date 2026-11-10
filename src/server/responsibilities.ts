import { database } from "./sql";
import { workspace } from "../lib/agent-workspace/store";
/** Independent worker bridge over the preserved responsibility service. */
export async function runResponsibilities() {
  const sql = await database();
  const owners = (
    await sql.query(
      "SELECT DISTINCT owner FROM agus2_tasks WHERE state='active' AND due_at<=now() AND payload->>'scope'='in_app_reminder_only' LIMIT 25",
    )
  ).rows;
  let delivered = 0;
  for (const row of owners)
    delivered += (await workspace(row.owner).runDue()).delivered;
  // Recover a crash between the legacy reminder commit and inbox projection.
  // Only opaque resource IDs cross into the new inbox/push boundary.
  await sql.query(
    "INSERT INTO agus_notifications(owner,id,effect_key,resource_type,resource_id) SELECT n.owner,gen_random_uuid()::text,'responsibility:'||n.owner||':'||n.id,'responsibility',n.task FROM agus2_notifications n WHERE NOT EXISTS(SELECT 1 FROM agus_notifications a WHERE a.effect_key='responsibility:'||n.owner||':'||n.id) LIMIT 100 ON CONFLICT(effect_key) DO NOTHING",
  );
  return { delivered, externalActions: 0 };
}
