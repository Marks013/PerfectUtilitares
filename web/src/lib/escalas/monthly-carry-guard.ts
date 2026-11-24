import { assignmentKey } from "./manual-absence";
import { EscalaError } from "./errors";
import type { EscalaInput, EscalaAssignment } from "./types";

const geometry = (shift: EscalaInput["shifts"][number]) =>
  JSON.stringify(shift.segments.map(({ start, end, kind }) => [start, end, kind]));

/** Flags are written by creation, never trusted from a manual request. Changed days become ordinary edits. */
export function retainMonthlyCarry(previous: EscalaInput | undefined, next: EscalaInput): EscalaInput {
  const old = new Map(previous?.assignments.filter(day => day.monthlyCarry).map(day => [assignmentKey(day), day]));
  if (!old.size && !next.assignments.some(day => day.monthlyCarry || day.carriedHolidayRest)) return next;
  const beforeShifts = new Map(previous?.shifts.map(shift => [shift.id, geometry(shift)]));
  const afterShifts = new Map(next.shifts.map(shift => [shift.id, geometry(shift)]));
  const restRule = (person: EscalaInput["employees"][number]) =>
    JSON.stringify([person.offMode, person.fixedOffDays, person.fixedRestSlots, person.offPattern]);
  const oldRosterRules = new Map(previous?.employees.map(person => [person.id, restRule(person)]));
  const revised = new Set(next.employees.filter(person => oldRosterRules.get(person.id) !== restRule(person)).map(person => person.id));
  return { ...next, assignments: next.assignments.map((day): EscalaAssignment => {
    const { monthlyCarry: _monthly, carriedHolidayRest: _holiday, ...rest } = day;
    const prior = old.get(assignmentKey(day));
    if (prior?.kind !== day.kind || prior.shiftId !== day.shiftId || day.locked === false && revised.has(day.employeeId)
      || (day.kind === "WORK" && beforeShifts.get(day.shiftId ?? "") !== afterShifts.get(day.shiftId ?? ""))) return rest;
    return { ...rest, monthlyCarry: true, ...(prior.carriedHolidayRest ? { carriedHolidayRest: true } : {}) };
  }) };
}

/** Prepare against the inherited geometry without turning it into a permanent user lock. */
export function prepareWithMonthlyCarry<T extends { input: EscalaInput }>(input: EscalaInput, prepare: (input: EscalaInput) => T): T {
  const pinned = new Map(input.assignments.filter(day => day.monthlyCarry && day.kind !== "HOLIDAY").map(day => [assignmentKey(day), day]));
  if (!pinned.size) return prepare(input);
  const result = prepare({ ...input, assignments: input.assignments.map(day => pinned.has(assignmentKey(day)) ? { ...day, locked: true } : day) });
  const restored = new Set<string>();
  const assignments = result.input.assignments.map(day => {
    const key = assignmentKey(day), old = pinned.get(key);
    if (!old || day.kind !== old.kind || day.shiftId !== old.shiftId) return day;
    restored.add(key);
    return old;
  });
  if (restored.size !== pinned.size) throw new EscalaError(422, "ESCALA_MONTHLY_CARRY_CONFLICT",
    "As folgas ou horários herdados conflitam com as regras atuais. Ajuste o rascunho antes de gerar; nada foi alterado.");
  return { ...result, input: { ...result.input, assignments } };
}
