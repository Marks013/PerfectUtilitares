const DAY_MS = 86_400_000;
const branchFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function isDate(value: string): boolean {
  if (!/^(?:19|20)\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function addDays(value: string, days: number): string {
  if (!isDate(value) || !Number.isSafeInteger(days)) throw new Error("Data ou quantidade de dias inválida");
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday=0, Sunday=6. Civil dates never pass through the host timezone. */
export function dayOfWeek(value: string): number {
  if (!isDate(value)) throw new Error("Data inválida");
  return (new Date(`${value}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function weekStart(value: string): string {
  return addDays(value, -dayOfWeek(value));
}

export function dateRange(start: string, end: string): string[] {
  if (!isDate(start) || !isDate(end) || end < start) return [];
  const count = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS) + 1;
  if (count > 366) throw new Error("Intervalo de datas muito extenso");
  return Array.from({ length: count }, (_, index) => addDays(start, index));
}

/** Actual instant of a civil minute in the explicitly supported branch timezone. */
export function absoluteMinute(date: string, minute: number): number {
  const civil = Date.parse(`${date}T00:00:00Z`) + minute * 60_000;
  let instant = civil + 3 * 3_600_000;
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = Object.fromEntries(branchFormatter.formatToParts(instant).map((part) => [part.type, part.value]));
    const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
    const delta = civil - rendered;
    if (delta === 0) return instant / 60_000;
    instant += delta;
  }
  throw new Error("Horário civil inexistente ou ambíguo na mudança de fuso");
}
