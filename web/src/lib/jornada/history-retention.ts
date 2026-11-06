const HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

export function getJornadaHistoryRetentionCutoff() {
  return new Date(Date.now() - HISTORY_RETENTION_MS);
}
