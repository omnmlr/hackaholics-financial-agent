// The simulator can prove whether it executed an attempt. A production RPC
// adapter needs durable storage and separate completeness/finality evidence.
export function rememberAttempt(records, operation, signed) {
  const prior = records.get(operation);
  if (prior) {
    if (
      prior.signature !== signed.signature ||
      prior.bytesSha256 !== signed.bytesSha256
    ) {
      throw new Error("Operation already has a different signed attempt");
    }
    return prior;
  }
  const attempt = {
    signature: signed.signature,
    bytesSha256: signed.bytesSha256,
    blockhash: signed.blockhash,
  };
  records.set(operation, attempt);
  return attempt;
}

export function reconcileAttempt(attempt, observe, latestBlockhash) {
  const result = observe(attempt.signature);
  if (result) return result;
  return attempt.blockhash === latestBlockhash
    ? "unconfirmed"
    : "expired-in-local-ledger";
}
