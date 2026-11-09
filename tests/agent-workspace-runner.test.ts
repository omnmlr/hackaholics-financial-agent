import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  reminders: vi.fn(async () => ({ delivered: 0 })),
  followups: vi.fn(async () => ({ checked: 0 })),
}));
vi.mock("../src/lib/config", () => ({
  config: () => ({ operator: "runner-owner" }),
}));
vi.mock("../src/lib/agent-workspace/store", () => ({
  workspace: (owner: string) => {
    expect(owner).toBe("runner-owner");
    return { runDue: mocks.reminders };
  },
}));
vi.mock("../src/lib/agent-workspace/solana-followups", () => ({
  runSolanaFollowups: mocks.followups,
}));
import { startDevelopmentRunner } from "../src/lib/agent-workspace/runner";
let handle: ReturnType<typeof startDevelopmentRunner>;
afterEach(() => {
  handle?.stop();
  handle = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
it("is opt-in, disabled in live mode/build workers, and starts no timers or reads", async () => {
  vi.useFakeTimers();
  vi.stubEnv("AGUS_WORKSPACE_ENABLED", "true");
  vi.stubEnv("AGUS_RESPONSIBILITY_RUNNER_ENABLED", "false");
  expect(startDevelopmentRunner()).toBeUndefined();
  vi.stubEnv("AGUS_RESPONSIBILITY_RUNNER_ENABLED", "true");
  vi.stubEnv("PAYMENT_MODE", "live");
  expect(startDevelopmentRunner()).toBeUndefined();
  vi.stubEnv("PAYMENT_MODE", "fixture");
  vi.stubEnv("NEXT_PHASE", "phase-production-build");
  expect(startDevelopmentRunner()).toBeUndefined();
  await vi.advanceTimersByTimeAsync(20000);
  expect(mocks.reminders).not.toHaveBeenCalled();
  expect(mocks.followups).not.toHaveBeenCalled();
});
it("deduplicates registration, does not overlap ticks, honors disabling and stops cleanly", async () => {
  vi.useFakeTimers();
  vi.stubEnv("AGUS_WORKSPACE_ENABLED", "true");
  vi.stubEnv("AGUS_RESPONSIBILITY_RUNNER_ENABLED", "true");
  vi.stubEnv("AGUS_SOLANA_DEVNET_ENABLED", "true");
  vi.stubEnv("PAYMENT_MODE", "fixture");
  vi.stubEnv("NEXT_PHASE", "");
  let complete!: () => void;
  mocks.reminders.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = () => resolve({ delivered: 0 });
      }),
  );
  handle = startDevelopmentRunner();
  expect(startDevelopmentRunner()).toBe(handle);
  await vi.advanceTimersByTimeAsync(45000);
  expect(mocks.reminders).toHaveBeenCalledTimes(1);
  expect(mocks.followups).not.toHaveBeenCalled();
  complete();
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.followups).toHaveBeenCalledWith("runner-owner");
  vi.stubEnv("AGUS_RESPONSIBILITY_RUNNER_ENABLED", "false");
  await vi.advanceTimersByTimeAsync(20000);
  expect(mocks.reminders).toHaveBeenCalledTimes(1);
  handle?.stop();
  expect(vi.getTimerCount()).toBe(0);
});
