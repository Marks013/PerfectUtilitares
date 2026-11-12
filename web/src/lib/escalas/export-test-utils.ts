/** Readers may expose an Excel time serial as a number or a UTC Date. Text is not a typed duration. */
export function exportedDurationMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 1440);
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Math.round(value.getUTCHours() * 60 + value.getUTCMinutes() + value.getUTCSeconds() / 60);
  }
  return null;
}

export function exportedDateISO(value: unknown): string | null {
  const date = typeof value === "number" ? new Date((value - 25569) * 86400000) : value;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}
