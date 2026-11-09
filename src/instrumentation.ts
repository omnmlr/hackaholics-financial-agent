/** Development responsibilities share the running Node server's database client. */
export async function register() {
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
