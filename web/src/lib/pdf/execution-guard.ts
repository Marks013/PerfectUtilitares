const CHECK_INTERVAL_MS = 20_000;

export function guardPdfExecution(
  isCurrent: () => Promise<boolean>,
  queueSignal?: AbortSignal,
) {
  const controller = new AbortController();
  const signal = queueSignal
    ? AbortSignal.any([queueSignal, controller.signal])
    : controller.signal;
  let checking = false;
  const timer = setInterval(async () => {
    if (checking || signal.aborted) return;
    checking = true;
    try {
      if (await isCurrent()) return;
    } catch {
      // Without a database check, the worker cannot confirm it still owns the job.
    } finally {
      checking = false;
    }
    controller.abort(new Error("PDF_EXECUTION_LEASE_LOST"));
  }, CHECK_INTERVAL_MS);
  timer.unref();
  return { signal, stop: () => clearInterval(timer) };
}
