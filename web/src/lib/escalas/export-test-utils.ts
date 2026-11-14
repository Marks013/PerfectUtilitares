/** Readers may expose an Excel time serial as a number or a UTC Date. Text is not a typed duration. */
export function exportedDurationMinutes(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 1440);
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return Math.round(value.getUTCHours() * 60 + value.getUTCMinutes() + value.getUTCSeconds() / 60);
  }
  return null;
}

/** Match an ordered rendered PDF row while allowing line wrapping between words and cells. */
export function exportedPdfRowPattern(values: readonly (string | number)[]): RegExp {
  return new RegExp(values.map(value => String(value).trim().split(/\s+/)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")).join("\\s+"));
}
