// Local, credential-free in-app scheduling. No banking or external sends.
import { setTimeout as delay } from "node:timers/promises";
import { workspace } from "../src/lib/agent-workspace/store";
import { config } from "../src/lib/config";
const watch = process.argv.includes("--watch");
let stopped = false;
process.on("SIGINT", () => {
  stopped = true;
});
process.on("SIGTERM", () => {
  stopped = true;
});
do {
  const result = await workspace(config().operator).runDue();
  console.log(
    JSON.stringify({
      kind: "in_app_reminders",
      ...result,
      checkedAt: new Date().toISOString(),
    }),
  );
  if (!watch || stopped) break;
  await delay(10000);
} while (!stopped);
process.exit(0);
