import { visibleDates } from "./dates";
import type { EscalaEmployee, EscalaInput } from "./types";

const portuguese = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const exact = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "variant" });

export function compareBranches(
  left: { branchCode: string; branchName?: string },
  right: { branchCode: string; branchName?: string },
): number {
  return portuguese.compare(left.branchCode, right.branchCode)
    || exact.compare(left.branchCode, right.branchCode)
    || portuguese.compare(left.branchName ?? "", right.branchName ?? "");
}

/** Shared sector order for grids, shortage lists and filters; never an allocation priority. */
export function compareSectors(left: string, right: string): number {
  return portuguese.compare(left, right) || exact.compare(left, right);
}

type DisplayEmployee = Pick<EscalaEmployee, "id" | "name" | "registration" | "sector" | "role">;

function compareEmployeeIdentity(left: DisplayEmployee, right: DisplayEmployee): number {
  return portuguese.compare(left.name, right.name)
    || portuguese.compare(left.role, right.role)
    || portuguese.compare(left.registration, right.registration)
    || exact.compare(left.registration, right.registration)
    || exact.compare(left.id, right.id);
}

/** Compare complete clock sequences; missing clocks sort last, never as midnight. */
export function compareProposedSchedules(left: string, right: string): number {
  const minutes = (value: string) => [...value.matchAll(/(\d{2}):(\d{2})/g)].map(match => Number(match[1]) * 60 + Number(match[2]));
  const a = minutes(left), b = minutes(right);
  if (!a.length || !b.length) return Number(!a.length) - Number(!b.length) || portuguese.compare(left, right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) if (a[index] !== b[index]) return a[index] - b[index];
  return a.length - b.length || portuguese.compare(left, right);
}

/** Group equal schedules within each sector, then names A–Z before job and identity ties. */
export function sortScheduleEntries<T extends { employee: DisplayEmployee; schedule: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((left, right) => portuguese.compare(left.employee.sector, right.employee.sector)
    || exact.compare(left.employee.sector, right.employee.sector)
    || compareProposedSchedules(left.schedule, right.schedule)
    || compareEmployeeIdentity(left.employee, right.employee));
}

/** Screen order uses actual proposed shifts, not original imported references or shift IDs. */
export function sortHoursEmployees(input: EscalaInput): EscalaEmployee[] {
  const visible = new Set(visibleDates(input));
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const noClock = new Set(input.employees.filter(person => person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING").map(person => person.id));
  const schedules = new Map<string, Set<string>>();
  for (const assignment of input.assignments) {
    if (assignment.kind !== "WORK" || !visible.has(assignment.date) || noClock.has(assignment.employeeId)) continue;
    const shift = shifts.get(assignment.shiftId ?? "");
    if (!shift) continue;
    const schedule = shift.segments.filter(segment => segment.kind === "WORK")
      .map(segment => [segment.start, segment.end].map(value => String(Math.floor(value / 60)).padStart(2, "0") + ":" + String(value % 60).padStart(2, "0")).join("-")).join(" / ");
    const set = schedules.get(assignment.employeeId) ?? new Set<string>();
    set.add(schedule); schedules.set(assignment.employeeId, set);
  }
  return sortScheduleEntries(input.employees.map(employee => ({ employee,
    schedule: [...(schedules.get(employee.id) ?? [])].sort(compareProposedSchedules).join(" | ") }))).map(row => row.employee);
}

/** Canonical presentation order only; never use names as an allocation priority. */
export function sortEmployees<T extends Pick<EscalaEmployee, "id" | "name" | "registration" | "sector" | "role">>(employees: readonly T[]): T[] {
  return [...employees].sort((left, right) => portuguese.compare(left.sector, right.sector)
    || exact.compare(left.sector, right.sector)
    || compareEmployeeIdentity(left, right));
}
