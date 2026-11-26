import { config } from "../config";
import { workspace } from "./store";
import { runSolanaFollowups } from "./solana-followups";

function enabled() {
  return (
    process.env.AGUS_RESPONSIBILITY_RUNNER_ENABLED === "true" &&
    process.env.AGUS_WORKSPACE_ENABLED === "true" &&
    process.env.PAYMENT_MODE !== "live" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  );
}
const runtime = globalThis as typeof globalThis & {
  agus2DevelopmentRunner?: { stop(): void };
};

/** Local long-lived Node server only. Shares the web app's global SQL client;
 * no second PGlite process, serverless uptime claim, or overlapping timer ticks. */
export function startDevelopmentRunner() {
  if (!enabled()) return undefined;
  if (runtime.agus2DevelopmentRunner) return runtime.agus2DevelopmentRunner;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const handle = {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (runtime.agus2DevelopmentRunner === handle)
        delete runtime.agus2DevelopmentRunner;
    },
  };
  const tick = async () => {
    try {
      if (!stopped && enabled()) {
        const owner = config().operator;
        await workspace(owner).runDue();
        if (
          !stopped &&
          enabled() &&
          process.env.AGUS_SOLANA_DEVNET_ENABLED === "true"
        )
          await runSolanaFollowups(owner);
      }
    } catch {
      // Fixed diagnostic only. Never log provider bodies, user content or credentials.
      console.warn(
        "AGUS development responsibility check deferred; saved jobs will retry.",
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(() => void tick(), 10000);
        timer.unref?.();
      }
    }
  };
  runtime.agus2DevelopmentRunner = handle;
  timer = setTimeout(() => void tick(), 1000);
  timer.unref?.();
  return handle;
}
