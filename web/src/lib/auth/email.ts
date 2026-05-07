export function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}
