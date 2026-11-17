/** Civil planning weeks. Weekday identifiers remain Monday=0 ... Sunday=6. */
export type PlanningWeekStartsOn = "MONDAY" | "SUNDAY";
export type PlanningCalendar = { planningWeekStartsOn?: PlanningWeekStartsOn };
export type PlanningPeriod = { startDate: string; endDate: string };
export type PlanningWeek = PlanningPeriod & { dates: string[] };

const DAY_MS = 86_400_000;
const FIRST_PLANNING_DATE = "2000-01-01", LAST_PLANNING_DATE = "2099-12-31";

function calendarObject(input: PlanningCalendar): void {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Convenção semanal inválida.");
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw new Error("Convenção semanal inválida.");
}

/** Only omitted metadata means legacy Monday; malformed inputs must not select a calendar. */
export function planningWeekStartsOn(input: PlanningCalendar = {}): PlanningWeekStartsOn {
  calendarObject(input);
  const value = Object.hasOwn(input, "planningWeekStartsOn") ? input.planningWeekStartsOn : undefined;
  if (value === undefined) return "MONDAY";
  if (value !== "MONDAY" && value !== "SUNDAY") throw new Error("Convenção semanal inválida.");
  return value;
}

function civilDate(value: string): Date {
  if (typeof value !== "string" || !/^(?:19|20)\d{2}-\d{2}-\d{2}$/.test(value)) throw new Error("Data civil inválida.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("Data civil inválida.");
  return parsed;
}

function shift(value: Date, days: number): string {
  return new Date(value.valueOf() + days * DAY_MS).toISOString().slice(0, 10);
}

function weekOffset(day: Date, convention: PlanningWeekStartsOn): number {
  return convention === "SUNDAY" ? day.getUTCDay() : (day.getUTCDay() + 6) % 7;
}

export function planningWeekStart(value: string, calendar: PlanningCalendar = {}): string {
  const day = civilDate(value);
  return shift(day, -weekOffset(day, planningWeekStartsOn(calendar)));
}

export function planningWeekEnd(value: string, calendar: PlanningCalendar = {}): string {
  const day = civilDate(value);
  // Calculate from the original civil date: its surrounding week may start in 1899.
  return shift(day, 6 - weekOffset(day, planningWeekStartsOn(calendar)));
}

function horizonLength(start: Date, end: Date, convention: PlanningWeekStartsOn): number {
  const length = (end.valueOf() - start.valueOf()) / DAY_MS + 1;
  if (start.toISOString().slice(0, 10) < FIRST_PLANNING_DATE || end.toISOString().slice(0, 10) > LAST_PLANNING_DATE
    || length < 7 || length > 42 || length % 7 !== 0 || weekOffset(start, convention) !== 0 || weekOffset(end, convention) !== 6) {
    throw new Error("O horizonte deve conter de 1 a 6 semanas completas, entre 2000 e 2099, na convenção selecionada.");
  }
  return length;
}

/** Complete aligned weeks only; partial employment is handled by employee rules. */
export function planningWeeks(period: PlanningPeriod & PlanningCalendar): PlanningWeek[] {
  const convention = planningWeekStartsOn(period);
  const start = civilDate(period.startDate), end = civilDate(period.endDate);
  const length = horizonLength(start, end, convention);
  return Array.from({ length: length / 7 }, (_, index) => {
    const dates = Array.from({ length: 7 }, (__, offset) => shift(start, index * 7 + offset));
    return { startDate: dates[0], endDate: dates[6], dates };
  });
}

/** Expand the visible month, not a previous horizon shifted by one day. */
export function planningMonthPeriod(month: string, calendar: PlanningCalendar = {}): PlanningPeriod {
  if (typeof month !== "string" || !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error("Mês de planejamento inválido.");
  const convention = planningWeekStartsOn(calendar);
  const first = civilDate(`${month}-01`);
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
  const start = new Date(first.valueOf() - weekOffset(first, convention) * DAY_MS);
  const end = new Date(last.valueOf() + (6 - weekOffset(last, convention)) * DAY_MS);
  // Reuse validation without allocating and immediately discarding all daily entries.
  horizonLength(start, end, convention);
  return { startDate: shift(start, 0), endDate: shift(end, 0) };
}
