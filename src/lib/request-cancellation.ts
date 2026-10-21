/** Race a dependency with cancellation even when that dependency ignores signal.
 * The dependency receives the same signal and must avoid new side effects after abort. */
export async function cancellable<T>(
  signal: AbortSignal | undefined,
  run: (signal?: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!signal) return run();
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try {
    return await Promise.race([
      new Promise<never>((_, reject) => {
        abort = () =>
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        signal.addEventListener("abort", abort, { once: true });
      }),
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return run(signal);
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
