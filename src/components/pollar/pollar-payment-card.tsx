"use client";

import React, { useState } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ArrowRight,
  Lock,
  RefreshCw,
  Wallet,
} from "lucide-react";
import type { PollarReviewPayload, PollarExecutionResult } from "@/lib/pollar/contracts";

export interface PollarPaymentCardProps {
  review: PollarReviewPayload;
  senderAddress: string;
  onExecute?: (draftId: string, digest: string, password?: string) => Promise<PollarExecutionResult>;
  onCancelled?: () => void;
}

export function PollarPaymentCard({
  review,
  senderAddress,
  onExecute,
  onCancelled,
}: PollarPaymentCardProps) {
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PollarExecutionResult | null>(null);

  const handleAuthorize = async () => {
    if (!password || password.trim() === "") {
      setError("Owner approval password is required to authorize this payment.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      if (onExecute) {
        const execResult = await onExecute(review.draftId, review.digest, password);
        setResult(execResult);
      } else {
        // Direct API call fallback
        const res = await fetch("/api/pollar/payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "approve_and_submit",
            draftId: review.draftId,
            digest: review.digest,
            password,
          }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          throw new Error(data.error?.message || data.error || "Execution failed");
        }
        setResult(data.execution);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to authorize and submit payment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-sm text-neutral-900 dark:text-neutral-100">
      {/* Header with Provider Branding */}
      <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold text-xs">
            P
          </div>
          <div>
            <h4 className="font-semibold text-sm">Pollar Conversational Payment</h4>
            <p className="text-xs text-neutral-500">Stellar Testnet · Gasless Sponsor</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600">
          <ShieldCheck className="w-3 h-3" />
          Verified
        </span>
      </div>

      {/* Main Body / States */}
      {!result ? (
        <div className="mt-4 space-y-4">
          {/* Transfer Amount & Asset */}
          <div className="bg-neutral-50 dark:bg-neutral-950/60 p-4 rounded-xl text-center">
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">You are sending</span>
            <div className="text-3xl font-bold tracking-tight text-neutral-900 dark:text-neutral-50 mt-0.5">
              {review.amount} <span className="text-blue-600 dark:text-blue-400">{review.asset}</span>
            </div>
            <div className="text-xs text-neutral-400 mt-1">{review.feeDisplay}</div>
          </div>

          {/* Parties Info */}
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center py-1">
              <span className="text-neutral-500">From Wallet</span>
              <span className="font-mono text-neutral-700 dark:text-neutral-300">
                {senderAddress ? `${senderAddress.slice(0, 6)}...${senderAddress.slice(-6)}` : "Pollar Connected"}
              </span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-neutral-500">To Recipient</span>
              <span className="font-mono font-medium text-neutral-800 dark:text-neutral-200">
                {review.recipientDisplay}
              </span>
            </div>
            <div className="flex justify-between items-center py-1">
              <span className="text-neutral-500">Approval Digest</span>
              <span className="font-mono text-[10px] text-neutral-400 truncate max-w-[180px]">
                {review.digest}
              </span>
            </div>
          </div>

          {/* Password Re-auth if required */}
          {review.requiresPasswordReauth && (
            <div className="pt-2">
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                Owner Re-Authentication
              </label>
              <div className="relative">
                <input
                  type="password"
                  placeholder="Enter approval password..."
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full text-xs rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <Lock className="w-3.5 h-3.5 text-neutral-400 absolute right-3 top-2.5" />
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 text-red-600 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            {onCancelled && (
              <button
                type="button"
                onClick={onCancelled}
                disabled={isSubmitting}
                className="flex-1 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              type="button"
              onClick={handleAuthorize}
              disabled={isSubmitting}
              className="flex-1 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Submitting via Pollar...
                </>
              ) : (
                <>
                  Authorize & Send
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Confirmed Success State */
        <div className="mt-4 space-y-4">
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
            <h5 className="font-semibold text-sm text-emerald-800 dark:text-emerald-400">Payment Confirmed!</h5>
            <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-1">
              Transferred {review.amount} {review.asset} via Pollar on Stellar Testnet.
            </p>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">Transaction Hash</span>
              <span className="font-mono text-[11px] truncate max-w-[180px]">
                {result.transactionHash}
              </span>
            </div>
            {result.ledgerSequence && (
              <div className="flex justify-between py-1">
                <span className="text-neutral-500">Ledger Sequence</span>
                <span className="font-mono">{result.ledgerSequence}</span>
              </div>
            )}
          </div>

          {result.explorerUrl && (
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2 px-3 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-850 transition-colors flex items-center justify-center gap-1.5 text-blue-600 dark:text-blue-400"
            >
              View on Stellar Expert Explorer
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
