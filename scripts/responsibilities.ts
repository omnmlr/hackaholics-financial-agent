// Local reminders plus explicitly approved read-only devnet reconciliation. No external sends.
import { setTimeout as delay } from "node:timers/promises";
import { workspace } from "../src/lib/agent-workspace/store";
import { runSolanaFollowups } from "../src/lib/agent-workspace/solana-followups";
import { config } from "../src/lib/config";
const watch = process.argv.includes("--watch");
const database = process.env.DATABASE_URL ?? "pglite://.data/agent";
if (
  !database.startsWith("postgres") &&
  !process.argv.includes("--offline-embedded")
) {
  console.error(
    "PGlite supports one process. Use AGUS_RESPONSIBILITY_RUNNER_ENABLED=true inside the local web server. For a stopped web server only, explicitly pass --offline-embedded. PostgreSQL supports a separate runner.",
  );
  process.exit(1);
}
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
do {
  const owner = config().operator;
  const result = await workspace(owner).runDue();
  const followups =
    process.env.AGUS_SOLANA_DEVNET_ENABLED === "true"
      ? await runSolanaFollowups(owner)
      : { checked: 0 };
  console.log(
    JSON.stringify({
      kind: "in_app_reminders",
      ...result,
      devnetFollowups: followups,
      checkedAt: new Date().toISOString(),
    }),
  );
  if (!watch || stopped) break;
  await delay(10000);
} while (!stopped);
process.exit(0);
