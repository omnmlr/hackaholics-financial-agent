import type { WalletSnapshot } from "../solana/contracts";

/** Display hints only. Re-fetch owner-scoped records before any action.
 * No approval, signed bytes, credential, or reusable financial authority. */
export type WorkspaceAction =
  | { kind: "responsibility"; id: string }
  | { kind: "memory"; id: string }
  | { kind: "solana"; id: string }
  | { kind: "wallet"; wallet: WalletSnapshot }
  | { kind: "overview" };
