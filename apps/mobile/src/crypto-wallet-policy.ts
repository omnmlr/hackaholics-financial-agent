import type { components } from "@agus/api-client";

type Outcome = components["schemas"]["CryptoWalletOutcome"];
export type WalletProvider = "phantom" | "solflare";
export type WalletStage =
  | "association"
  | "authorization"
  | "capabilities"
  | "ownership-proof"
  | "submission";
export type WalletDiagnostic = {
  provider: WalletProvider;
  stage: WalletStage;
  reason: string;
};

export class WalletRouteError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
  }
}

function diagnosticReason(error: unknown) {
  if (error instanceof WalletRouteError) return error.reason;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : "";
  if (/low power|battery saver/i.test(message))
    return "WALLET_POWER_RESTRICTION";
  if (code === "ERROR_WALLET_NOT_FOUND") return "WALLET_NOT_INSTALLED";
  if (code === "ERROR_WALLET_ACTIVITY_UNAVAILABLE")
    return "WALLET_ACTIVITY_UNAVAILABLE";
  if (code === "ERROR_SESSION_TIMEOUT" || code === "ERROR_ASSOCIATION_TIMEOUT")
    return "WALLET_ASSOCIATION_TIMEOUT";
  if (code === "ERROR_ASSOCIATION_CANCELLED")
    return "WALLET_ASSOCIATION_CANCELLED";
  if (code === -100) return "WALLET_ATTESTATION_REQUIRED";
  if (code === -1) return "WALLET_RECONNECT_REQUIRED";
  if (code === -2) return "WALLET_PAYLOAD_REJECTED";
  if (code === -3) return "WALLET_DECLINED";
  if (code === -4) return "WALLET_SUBMISSION_UNCERTAIN";
  return "WALLET_TRANSPORT_LOST";
}

export function walletFailure(
  error: unknown,
  stage: WalletStage,
): { reason: string; outcome: Outcome } {
  const reason = diagnosticReason(error);
  if (stage === "submission") {
    if (reason === "WALLET_DECLINED")
      return { reason, outcome: { kind: "declined" } };
    return { reason, outcome: { kind: "unknown", reason } };
  }
  if (reason === "WALLET_DECLINED" || reason === "WALLET_ASSOCIATION_CANCELLED")
    return { reason, outcome: { kind: "declined" } };
  return { reason, outcome: { kind: "unavailable", reason } };
}
