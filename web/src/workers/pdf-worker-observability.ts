type WorkerFailureEvent =
  | "pdf_worker_input_cleanup_failed"
  | "pdf_worker_heartbeat_failed"
  | "pdf_worker_retention_failed"
  | "pdf_worker_presence_maintenance_failed";

const FAILURE_LOG_INTERVAL_MS = 5 * 60 * 1_000;
const lastFailureAt = new Map<WorkerFailureEvent, number>();

export function logPdfWorkerFailure(event: WorkerFailureEvent) {
  const now = Date.now();
  const previous = lastFailureAt.get(event);
  if (previous !== undefined && now - previous < FAILURE_LOG_INTERVAL_MS) return;
  lastFailureAt.set(event, now);
  // Fixed event codes only: errors, paths and document identifiers stay out of logs.
  console.error(
    JSON.stringify({
      timestamp: new Date(now).toISOString(),
      level: "error",
      event,
    }),
  );
}
