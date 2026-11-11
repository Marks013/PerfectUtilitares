import { canonicalBranchCode } from "./branch-code";
import { addDays } from "./dates";
import type { EscalaInput } from "./types";

const HOLIDAY_CALENDAR_VERSION = "local-2026-11-v1";
type Holiday = { date: string; name: string; scope: "NATIONAL" | "MUNICIPAL"; closed: boolean };
const national = [["01-01", "Ano Novo"], ["04-21", "Tiradentes"], ["05-01", "Dia do Trabalhador"],
  ["09-07", "Independência do Brasil"], ["10-12", "Nossa Senhora Aparecida"], ["11-02", "Finados"],
  ["11-15", "Proclamação da República"], ["11-20", "Consciência Negra"], ["12-25", "Natal"]] as const;
const closed = new Set(["01-01", "05-01", "12-25"]);

export function isPlanningClosedHoliday(date: string): boolean {
  return closed.has(date.slice(5));
}

/** Gregorian computus; civil dates use UTC, independently of server timezone. */
function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = (h + l - 7 * m + 114) % 31 + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Recurring civil rules, not a forecast of future decrees or a certificate to open. */
export function holidayCalendarFor(input: Pick<EscalaInput, "branchCode" | "startDate" | "endDate">) {
  const municipality = canonicalBranchCode(input.branchCode) === "02" ? "ICARAIMA" as const : "UMUARAMA" as const;
  const label = municipality === "ICARAIMA" ? "Icaraíma-PR" : "Umuarama-PR";
  const holidays: Holiday[] = [];
  const startYear = Number(input.startDate.slice(0, 4)), endYear = Number(input.endDate.slice(0, 4));
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 2000 || endYear > 2099 || endYear - startYear > 1) return { municipality, label, holidays };
  for (let year = startYear; year <= endYear; year++) {
    for (const [day, name] of national) if (day !== "11-20" || year >= 2024) holidays.push({ date: `${year}-${day}`, name, scope: "NATIONAL", closed: closed.has(day) });
    const paschal = easter(year);
    const local: [string, string][] = [[addDays(paschal, -2), "Sexta-feira da Paixão"], [addDays(paschal, 60), "Corpus Christi"], [`${year}-08-15`, "Assunção de Nossa Senhora"]];
    if (municipality === "ICARAIMA") local.push([`${year}-07-25`, "Fundação de Icaraíma"]);
    else local.push([`${year}-06-26`, "Aniversário de Umuarama"], [`${year}-10-04`, "São Francisco de Assis"]);
    for (const [date, name] of local) holidays.push({ date, name, scope: "MUNICIPAL", closed: false });
  }
  return { municipality, label, holidays: holidays.filter(day => input.startDate <= day.date && day.date <= input.endDate).sort((a, b) => a.date.localeCompare(b.date)) };
}

/** Local law: Icaraíma 1.426/2017; Umuarama 2.046/1997 and calendar 027/2026.
 * https://www.icaraima.pr.leg.br/leis/legislacao-municipal-1/leis-2017/lei-1426-2017-dispoe-sobre-feriados-municipais-e-da-outras-providencias
 * https://www.umuarama.pr.gov.br/public/umuarama
 * National laws 662/1949, 6.802/1980 and 14.759/2023. Carnival, public-service
 * discretionary days and Paraná 19 December are deliberately not included.
 * Store closure on Jan 1, May 1 and Dec 25 is this planning profile's rule;
 * it is not automatic proof that a collective agreement covers every branch.
 */
export function applyLocalHolidayCalendar(input: EscalaInput): EscalaInput {
  if (input.policy.calendarMode !== "LOCAL") return input;
  const calendar = holidayCalendarFor(input), previous = input.policy.calendarProvenance;
  const manualHolidays = input.policy.holidayDates.filter(day => !previous?.dates.includes(day));
  const manualClosures = input.policy.closedDates.filter(day => !previous?.closedDates.includes(day));
  const dates = calendar.holidays.map(day => day.date), closures = calendar.holidays.filter(day => day.closed).map(day => day.date);
  const union = (...lists: string[][]) => [...new Set(lists.flat())].sort();
  const holidayDates = union(manualHolidays, dates), closedDates = union(manualClosures, closures);
  const paidHolidayDates = [...closures];
  const provenance = { version: HOLIDAY_CALENDAR_VERSION, municipality: calendar.municipality, dates: [...dates], closedDates: [...closures] };
  if (JSON.stringify([input.policy.holidayDates, input.policy.closedDates, input.policy.paidHolidayDates, previous]) === JSON.stringify([holidayDates, closedDates, paidHolidayDates, provenance])) return input;
  return { ...input, policy: { ...input.policy, holidayDates, closedDates, paidHolidayDates, calendarProvenance: provenance },
    // Automatic demand is rebuilt; real positive demand on a closed date stays as an explicit conflict.
    demands: input.demands.filter(demand => !(demand.estimated === true && closedDates.includes(demand.date))) };
}

export function holidayLabel(input: EscalaInput, date: string): string | undefined {
  if (!input.policy.holidayDates?.includes(date)) return undefined;
  return holidayCalendarFor(input).holidays.find(day => day.date === date)?.name ?? "Feriado cadastrado";
}

/** No attendance, payroll credit or makeup hours are inferred from a closure. */
export function closedHolidayDates(input: EscalaInput): Set<string> {
  return new Set((input.policy.paidHolidayDates ?? []).filter(day => isPlanningClosedHoliday(day) && input.policy.closedDates.includes(day) && input.policy.holidayDates.includes(day)));
}

export function assertHolidayLocks(input: EscalaInput): string | undefined {
  const holidays = closedHolidayDates(input);
  return input.assignments.find(day => day.locked && holidays.has(day.date) && day.kind !== "ABSENCE" && day.kind !== "HOLIDAY")?.date;
}

