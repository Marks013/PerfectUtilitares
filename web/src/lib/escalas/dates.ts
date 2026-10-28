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

/** Calendar presentation never truncates the solver or the continuity verifier. */
export function monthBounds(month: string): { startDate: string; endDate: string } {
  if (!/^(?:20)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error("Mês inválido.");
  const [year, number] = month.split("-").map(Number);
  return { startDate: month + "-01", endDate: new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10) };
}

type PresentationPeriod = { startDate: string; endDate: string; visibleMonth?: string };

export function visibleDates(input: PresentationPeriod): string[] {
  if (input.visibleMonth) {
    const month = monthBounds(input.visibleMonth);
    if (month.startDate < input.startDate || month.endDate > input.endDate) throw new Error("O mês não está contido no horizonte técnico.");
    return dateRange(month.startDate, month.endDate);
  }
  // Old monthly revisions did not store their month. Infer only an exact full-month horizon,
  // keeping genuinely weekly legacy proposals unchanged and never rewriting their data.
  const technical = dateRange(input.startDate, input.endDate);
  if (!technical.length) return [];
  const middle = technical[Math.floor(technical.length / 2)].slice(0, 7);
  const month = monthBounds(middle);
  if (weekStart(month.startDate) === input.startDate && addDays(month.endDate, 6 - dayOfWeek(month.endDate)) === input.endDate)
    return dateRange(month.startDate, month.endDate);
  return technical;
}
