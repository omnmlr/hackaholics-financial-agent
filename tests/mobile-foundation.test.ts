/** Automated mobile foundation policy tests for app switching, recovery, and notification links. */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canAutomaticallySubmit,
  canPrepareNewDraft,
  parseNotificationLink,
  shouldLockOnBackground,
} from "../apps/mobile/src/policy";

describe("mobile policy helpers (app switching, deep links, recovery)", () => {
  it("locks on background in all states except mid-login TOTP authenticator switch", () => {
    expect(
      shouldLockOnBackground({ ready: true, awaitingTwoFactor: false }),
    ).toBe(true);
    expect(
      shouldLockOnBackground({ ready: true, awaitingTwoFactor: true }),
    ).toBe(true);
    expect(
      shouldLockOnBackground({ ready: false, awaitingTwoFactor: false }),
    ).toBe(true);
    expect(
      shouldLockOnBackground({ ready: false, awaitingTwoFactor: true }),
    ).toBe(false);
  });

  it("blocks preparing a new Devnet draft while an existing submission is unresolved or unrecovered", () => {
    const id = randomUUID();
    expect(canPrepareNewDraft(null, null)).toBe(true);
    expect(
      canPrepareNewDraft({ id, state: "prepared" }, null),
    ).toBe(true);
    expect(
      canPrepareNewDraft({ id, state: "submitting" }, null),
    ).toBe(false);
    expect(
      canPrepareNewDraft({ id, state: "submitted" }, null),
    ).toBe(false);
    expect(
      canPrepareNewDraft({ id, state: "unknown" }, null),
    ).toBe(false);
    expect(
      canPrepareNewDraft(null, { draftId: id, idempotencyKey: id, submitted: true }),
    ).toBe(false);
    expect(
      canPrepareNewDraft(
        { id: randomUUID(), state: "finalized" },
        { draftId: id, idempotencyKey: id, submitted: true },
      ),
    ).toBe(false);
    for (const terminal of ["finalized", "failed", "expired", "cancelled"]) {
      expect(
        canPrepareNewDraft(
          { id, state: terminal },
          { draftId: id, idempotencyKey: id, submitted: true },
        ),
      ).toBe(true);
    }
  });

  it("never permits automatic background/network submission", () => {
    expect(canAutomaticallySubmit()).toBe(false);
    expect(
      parseNotificationLink(`agus://open/solana/${randomUUID()}`),
    ).toMatchObject({ resourceType: "solana" });
  });
});
