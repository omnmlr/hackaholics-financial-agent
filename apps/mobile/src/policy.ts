export type PendingOperation = {
  idempotencyKey: string;
  draftId?: string;
  submitted: boolean;
};
export function parseNotificationLink(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "agus:" ||
      url.hostname !== "open" ||
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash
    )
      return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts.length !== 2 ||
      !["payment", "responsibility", "solana", "p2p", "request"].includes(
        parts[0],
      ) ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        parts[1],
      )
    )
      return null;
    return { resourceType: parts[0], resourceId: parts[1] };
  } catch {
    return null;
  }
}
/** Lifecycle/network changes can refresh authenticated state only. They never
 * select a financial action, sign a wallet payload or broadcast a saved intent. */
export const canAutomaticallySubmit = () => false;

/** Keep an unauthenticated pending 2FA sign-in cookie alive while the user
 * briefly switches to an authenticator app; lock every authenticated session. */
export function shouldLockOnBackground(state: {
  ready: boolean;
  awaitingTwoFactor: boolean;
}) {
  return state.ready || !state.awaitingTwoFactor;
}

const UNRESOLVED_DRAFT_STATES = new Set(["submitting", "submitted", "unknown"]);
const SETTLED_DRAFT_STATES = new Set([
  "finalized",
  "failed",
  "expired",
  "cancelled",
]);

export function canPrepareNewDraft(
  currentDraft: { id: string; state: string } | null,
  storedPending: PendingOperation | null,
) {
  if (currentDraft && UNRESOLVED_DRAFT_STATES.has(currentDraft.state))
    return false;
  if (
    storedPending?.submitted &&
    (!currentDraft ||
      currentDraft.id !== storedPending.draftId ||
      !SETTLED_DRAFT_STATES.has(currentDraft.state))
  )
    return false;
  return true;
}
