import { civilNightWorkMinutes } from "./preparation";
import { manualAssignmentIssues, manualShiftAt } from "./shift-catalog/manual-override";
import type { EscalaEmployee, EscalaInput, EscalaShift } from "./types";

/** Small, pure helpers shared by generation and independent output validation. */
export function paidMinutes(shift: EscalaShift): number {
  return shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}

export function mealMinutes(shift: EscalaShift): number {
  const first = shift.segments[0].start, last = shift.segments.at(-1)?.end ?? first;
  return Math.max(0, ...shift.segments.filter(segment => segment.kind === "BREAK" && segment.start > first && segment.end < last).map(segment => segment.end - segment.start));
}

/** Compare civil work minutes only; this neither calculates night credits nor approves night work. */
export function nightWorkMinutes(input: EscalaInput, targets: Set<number>): number {
  const person = input.employees[0];
  if (!person || person.planningEnabled === false || !person.shiftIds.length) return Infinity;
  const allowed = new Set(person.shiftIds);
  const shifts = input.shifts.filter(shift => allowed.has(shift.id));
  if ([...targets].some(target => !shifts.some(shift => paidMinutes(shift) === Math.min(target, person.simulationDailyMinutes ?? Infinity)))) return Infinity;
  return shifts.reduce((total, shift) => total + civilNightWorkMinutes(shift), 0);
}

/** Order references without deleting manual alternatives needed when the mode changes. */
export function restOnlyReferences(person: EscalaEmployee, shifts: Map<string, EscalaShift>): EscalaEmployee {
  if (person.planningEnabled === false || person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING") return person;
  const original = [...(person.sourceSchedule?.weekday ?? "").matchAll(/(\d{2}):(\d{2})\s*-\s*(\d{2}):(\d{2})/g)];
  const arrival = original.length ? Number(original[0][1]) * 60 + Number(original[0][2]) : null;
  const last = original.at(-1);
  const departure = last ? Number(last[3]) * 60 + Number(last[4]) : null;
  const distance = (shift: EscalaShift) => {
    const work = shift.segments.filter(segment => segment.kind !== "BREAK");
    return [arrival === null ? 0 : Math.abs((work[0]?.start ?? 0) - arrival),
      departure === null ? 0 : Math.abs((work.at(-1)?.end ?? 0) - departure)];
  };
  const references = new Map<number, string>();
  for (const id of person.shiftIds) {
    const candidate = shifts.get(id);
    if (!candidate) continue;
    const minutes = paidMinutes(candidate), previous = references.get(minutes);
    const existing = previous ? shifts.get(previous) : undefined;
    const a = distance(candidate), b = existing ? distance(existing) : null;
    if (!b || a[0] < b[0] || a[0] === b[0] && a[1] < b[1]) references.set(minutes, id);
  }
  return { ...person, shiftIds: [...new Set([...references.values(), ...person.shiftIds])] };
}

/** Independently reject free-day clock substitutions even if the transport returns a valid-shaped result. */
export function matchesRestOnlyReferences(input: EscalaInput, assignments: EscalaInput["assignments"]): boolean {
  if (manualAssignmentIssues({ ...input, assignments }, input.assignments).length) return false;
  const fixedReference = (person: EscalaEmployee) => person.fixedImportedShiftId && person.shiftIds.includes(person.fixedImportedShiftId) ? person.fixedImportedShiftId : undefined;
  if (input.generationMode !== "REST_ONLY" && !input.employees.some(fixedReference)) return true;
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const employees = new Map(input.employees.map(person => [person.id, person]));
  const locked = new Map(input.assignments.filter(day => day.locked && day.kind === "WORK")
    .map(day => [JSON.stringify([day.employeeId, day.date]), day.shiftId]));
  const references = new Map(input.employees.map(person => {
    const byDuration = new Map<number, string>();
    const fixed = fixedReference(person);
    for (const id of fixed ? [fixed] : person.shiftIds) {
      const shift = shifts.get(id);
      if (shift && !byDuration.has(paidMinutes(shift))) byDuration.set(paidMinutes(shift), id);
    }
    return [person.id, byDuration];
  }));
  return assignments.every(day => {
    if (day.kind !== "WORK") return true;
    const person = employees.get(day.employeeId);
    if (person?.planningEnabled === false) return true;
    const selected = person && manualShiftAt(person, day.date);
    if (selected) return day.shiftId === selected;
    if (person && input.generationMode !== "REST_ONLY" && !fixedReference(person)) return true;
    const shift = shifts.get(day.shiftId ?? "");
    return Boolean(shift && (locked.get(JSON.stringify([day.employeeId, day.date])) === day.shiftId
      || references.get(day.employeeId)?.get(paidMinutes(shift)) === day.shiftId));
  });
}

