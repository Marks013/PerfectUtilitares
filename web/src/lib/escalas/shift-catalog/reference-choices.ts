import { addDays, visibleDates } from "../dates";
import type { EscalaEmployee, EscalaInput, EscalaShift } from "../types";

export type EmployeeReferenceShiftChoice = { shiftId: string; label: string; source: "BASE" | "MANUAL" | "WORK" };
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const dateLabel = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
function periods(dates: readonly string[]): string {
  const ordered = [...new Set(dates)].sort(), ranges: string[] = [];
  let first = ordered[0], last = first;
  for (const date of ordered.slice(1)) {
    if (date === addDays(last, 1)) last = date;
    else { ranges.push(first === last ? dateLabel(first) : `${dateLabel(first)} a ${dateLabel(last)}`); first = last = date; }
  }
  if (first) ranges.push(first === last ? dateLabel(first) : `${dateLabel(first)} a ${dateLabel(last)}`);
  return ranges.join("; ");
}
function clocks(shift: EscalaShift): string {
  return shift.segments.filter(segment => segment.kind !== "BREAK").map(segment =>
    `${clock(segment.start)}-${clock(segment.end)}${segment.kind === "PAID_BREAK" ? " (pausa remunerada)" : ""}`).join(" / ");
}

/** Effective clock references only. Dates in labels never create daily attendance. */
export function employeeReferenceShiftChoices(input: EscalaInput, employee: EscalaEmployee): EmployeeReferenceShiftChoice[] {
  if (employee.scheduleMode === "UNTIMED" || employee.scheduleMode === "MISSING") return [];
  const dates = visibleDates(input).filter(date => date >= employee.activeFrom && (!employee.activeUntil || date <= employee.activeUntil));
  const visible = new Set(dates), shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const work = input.assignments.filter(day => day.employeeId === employee.id && day.kind === "WORK" && visible.has(day.date));
  if (work.length) {
    const applied = new Map<string, string[]>();
    for (const day of work) if (day.shiftId && shifts.has(day.shiftId)) applied.set(day.shiftId, [...(applied.get(day.shiftId) ?? []), day.date]);
    return [...applied].map(([shiftId, days]) => ({ shiftId, source: "WORK" as const,
      label: `${clocks((shifts.get(shiftId) as NonNullable<ReturnType<typeof shifts.get>>))} — Aplicado: ${periods(days)}${days.some(date => employee.manualShiftOverrides?.some(choice => choice.shiftId === shiftId && date >= choice.effectiveFrom && date <= choice.effectiveUntil)) ? " (escolha manual)" : ""}` })).sort((a, b) => a.label.localeCompare(b.label) || a.shiftId.localeCompare(b.shiftId));
  }
  const effective = new Map<string, { base: string[]; manual: string[] }>();
  const include = (id: string, date: string, manual: boolean) => {
    if (!shifts.has(id)) return;
    const entry = effective.get(id) ?? { base: [], manual: [] };
    (manual ? entry.manual : entry.base).push(date); effective.set(id, entry);
  };
  const normal = employee.fixedImportedShiftId && employee.shiftIds.includes(employee.fixedImportedShiftId)
    ? [employee.fixedImportedShiftId] : employee.shiftIds;
  for (const date of dates) {
    const choice = employee.manualShiftOverrides?.find(entry => date >= entry.effectiveFrom && date <= entry.effectiveUntil);
    if (choice) include(choice.shiftId, date, true);
    else for (const id of normal) include(id, date, false);
  }
  return [...effective].map(([shiftId, entry]) => ({ shiftId, source: entry.manual.length ? "MANUAL" as const : "BASE" as const,
    label: `${clocks((shifts.get(shiftId) as NonNullable<ReturnType<typeof shifts.get>>))} — ${[entry.manual.length ? `Referência manual: ${periods(entry.manual)}` : "", entry.base.length ? `Referência base: ${periods(entry.base)}` : ""].filter(Boolean).join(" | ")}`,
  })).sort((a, b) => Number(a.source === "MANUAL") - Number(b.source === "MANUAL") || a.label.localeCompare(b.label));
}
