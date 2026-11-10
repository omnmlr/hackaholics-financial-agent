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
      url.search ||
      url.hash
    )
      return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (
      parts.length !== 2 ||
      !["payment", "responsibility", "solana"].includes(parts[0]) ||
      !/^[a-f0-9-]{36}$/.test(parts[1])
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
