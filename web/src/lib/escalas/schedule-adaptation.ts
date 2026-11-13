import { importedShiftReference, preparedShiftSignature, prepareRoster } from "./preparation";
import type { EscalaInput } from "./types";

export type ScheduleStrategy = "PRESERVE_START" | "PRESERVE_END" | "BOTH";
export type ScheduleException = { employeeId: string; registration: string; name: string; reason: string };

/** Explicit draft action: compatible people are adjusted, never silently excluded. */
export function adaptCompatibleSchedules(input: EscalaInput, strategy: ScheduleStrategy) {
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const exceptions: ScheduleException[] = [];
  const employees = input.employees.map(person => {
    if (person.planningEnabled === false || person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED") return person;
    const prepared = prepareRoster({ ...input, employees: [person], assignments: [] }, input.defaultWeeklyHours, "EXCLUDE", strategy);
    const candidate = prepared.employees[0];
    const locked = input.assignments.filter(day => day.employeeId === person.id && day.locked).flatMap(day => day.shiftId ? [day.shiftId] : []);
    const allowed = [...new Set([...candidate.shiftIds, ...locked])];
    const source = importedShiftReference(person);
    const references = source ? [source] : (person.manualShiftBaseIds ?? person.originalShiftIds ?? person.shiftIds)
      .flatMap(id => { const shift = shifts.get(id); return shift ? [shift] : []; });
    const movedAnchor = strategy !== "BOTH" && candidate.shiftIds.some(id => {
      const proposed = prepared.shifts.find(shift => shift.id === id);
      return proposed && !references.some(reference => strategy === "PRESERVE_START"
        ? reference.segments[0].start === proposed.segments[0].start
        : reference.segments.at(-1)?.end === proposed.segments.at(-1)?.end);
    });
    if (candidate.planningEnabled === false || allowed.length > 12 || movedAnchor) {
      exceptions.push({ employeeId: person.id, registration: person.registration, name: person.name,
        reason: movedAnchor ? "O fechamento e os limites de jornada ou intervalo não permitem manter a entrada ou saída escolhida. O horário foi preservado; confira a referência ou escolha outra estratégia."
          : allowed.length > 12 ? "Os horários bloqueados e as alternativas excedem 12 opções. Confira os turnos permitidos."
          : candidate.planningExclusionReason || "Não foi possível preservar este horário. Experimente manter a saída ou confira o turno individual." });
      return person;
    }
    for (const shift of prepared.shifts) {
      const existing = shifts.get(shift.id);
      if (existing && preparedShiftSignature(existing) !== preparedShiftSignature(shift)) throw new Error("Há horários diferentes com o mesmo identificador. Nenhum ajuste foi aplicado.");
      shifts.set(shift.id, shift);
    }
    return { ...person, ...candidate, shiftIds: allowed };
  });
  const referenced = new Set([...employees.flatMap(person => [...person.shiftIds, ...(person.originalShiftIds ?? [])]), ...input.assignments.flatMap(day => day.shiftId ? [day.shiftId] : []),
    ...employees.flatMap(person => [...person.history, ...(person.planningHistory ?? []), ...(person.planningFuture ?? [])].flatMap(day => day.shiftId ? [day.shiftId] : []))]);
  const retained = [...shifts.values()].filter(shift => referenced.has(shift.id));
  if (retained.length > 120) throw new Error("As alternativas ultrapassam 120 horários. Reduza opções individuais antes de aplicar.");
  return { input: { ...input, employees, shifts: retained, needsRegeneration: input.needsRegeneration || input.assignments.length > 0 } as EscalaInput, exceptions };
}
