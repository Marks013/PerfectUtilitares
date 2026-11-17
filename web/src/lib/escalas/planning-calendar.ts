/** Civil planning weeks. Weekday identifiers remain Monday=0 ... Sunday=6. */
export type PlanningWeekStartsOn = "MONDAY" | "SUNDAY";
export type PlanningCalendar = { planningWeekStartsOn?: PlanningWeekStartsOn };
export type PlanningPeriod = { startDate: string; endDate: string };
export type PlanningWeek = PlanningPeriod & { dates: string[] };

const DAY_MS = 86_400_000;

/** Absence means legacy Monday, never permission to reinterpret stored records. */
export function planningWeekStartsOn(input: PlanningCalendar = {}): PlanningWeekStartsOn {
  const value = input.planningWeekStartsOn;
  if (value === undefined) return "MONDAY";
  if (value !== "MONDAY" && value !== "SUNDAY") throw new Error("Convenção semanal inválida.");
  return value;
}

function civilDate(value: string): Date {
  if (!/^(?:19|20)\d{2}-\d{2}-\d{2}$/.test(value)) throw new Error("Data civil inválida.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Data civil inválida.");
  return parsed;
}

function shift(value: Date, days: number): string {
  return new Date(value.valueOf() + days * DAY_MS).toISOString().slice(0, 10);
}

export function planningWeekStart(value: string, calendar: PlanningCalendar = {}): string {
  const day = civilDate(value);
  const offset = planningWeekStartsOn(calendar) === "SUNDAY" ? day.getUTCDay() : (day.getUTCDay() + 6) % 7;
  return shift(day, -offset);
}

export function planningWeekEnd(value: string, calendar: PlanningCalendar = {}): string {
  return shift(civilDate(planningWeekStart(value, calendar)), 6);
}

/** Complete aligned weeks only; partial employment is handled by employee rules. */
export function planningWeeks(period: PlanningPeriod & PlanningCalendar): PlanningWeek[] {
  const start = civilDate(period.startDate), end = civilDate(period.endDate);
  const length = (end.valueOf() - start.valueOf()) / DAY_MS + 1;
  if (length < 7 || length > 42 || length % 7 !== 0
    || planningWeekStart(period.startDate, period) !== period.startDate
    || planningWeekEnd(period.endDate, period) !== period.endDate) {
    throw new Error("O horizonte deve conter de 1 a 6 semanas completas na convenção selecionada.");
  }
  return Array.from({ length: length / 7 }, (_, index) => {
    const dates = Array.from({ length: 7 }, (__, offset) => shift(start, index * 7 + offset));
    return { startDate: dates[0], endDate: dates[6], dates };
  });
}

/** Expand the visible month, not a previous horizon shifted by one day. */
export function planningMonthPeriod(month: string, calendar: PlanningCalendar = {}): PlanningPeriod {
  if (!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error("Mês de planejamento inválido.");
  const first = civilDate(`${month}-01`);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const period = { startDate: planningWeekStart(`${month}-01`, calendar),
    endDate: planningWeekEnd(last.toISOString().slice(0, 10), calendar) };
  if (period.startDate < "2000-01-01" || period.endDate > "2099-12-31") {
    throw new Error("As semanas completas devem estar entre 2000 e 2099.");
  }
  planningWeeks({ ...period, planningWeekStartsOn: planningWeekStartsOn(calendar) });
  return period;
}
