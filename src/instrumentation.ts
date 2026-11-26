/** Development responsibilities share the running Node server's database client. */
export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.ZCASH_RECEIVE_SERVICE_URL &&
    process.env.ZCASH_RECEIVE_WATCHER_ENABLED === "true"
  ) {
    const { startZcashReceivingWatcher } =
      await import("./lib/zcash/managed-invoices");
    startZcashReceivingWatcher();
  }
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.AGUS_RESPONSIBILITY_RUNNER_ENABLED === "true"
  ) {
    const { startDevelopmentRunner } =
      await import("./lib/agent-workspace/runner");
    startDevelopmentRunner();
  }
}
