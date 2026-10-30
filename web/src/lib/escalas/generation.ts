import { EscalaError } from "./access";
import { applyRestEligibility, isRestPlanningExcludedRole } from "./eligibility";
import { addDays, dateRange } from "./dates";
import { effectiveWeeklyHours, effectiveWorkDayLimit } from "./labor-rules";
import { planningWeeklyHours, prepareRoster, proposeCoverage, refreshProposedWorkBlocks } from "./preparation";
import type { EscalaGenerationPreparation, EscalaInput, EscalaShift } from "./types";

function paidMinutes(shift: EscalaShift): number {
  return shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}

/** Prepare a preview, without approving documents, inventing attendance or overwriting branch decisions. */
export function prepareGeneration(rawInput: EscalaInput): { input: EscalaInput; preparation: EscalaGenerationPreparation } {
  const input: EscalaInput = { ...rawInput, simulation: true, policy: { ...rawInput.policy, maxConsecutiveWorkDays: effectiveWorkDayLimit(rawInput.policy) } };
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const adjustedEmployeeIds: string[] = [];
  const excludedEmployeeIds: string[] = [];
  const employees = input.employees.map((original) => {
    const person = applyRestEligibility(original);
    if (isRestPlanningExcludedRole(person.role)) excludedEmployeeIds.push(person.id);
    if (person.planningEnabled === false || person.activeFrom > input.endDate || (person.activeUntil && person.activeUntil < input.startDate)
      || (person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING")) return person;
    const reference = planningWeeklyHours(person, input.defaultWeeklyHours, input.defaultWeeklyHours);
    const hours = reference.weeklyHours;
    const targets = new Set(dateRange(input.startDate, input.endDate).filter((_, index) => index % 7 === 0
      && person.activeFrom <= addDays(input.startDate, index + 6) && (!person.activeUntil || person.activeUntil >= addDays(input.startDate, index)))
      .map((date) => effectiveWeeklyHours({ weeklyHours: hours }, date) * 12));
    const allowed = person.shiftIds.map((id) => shifts.get(id)).filter((shift): shift is EscalaShift => Boolean(shift));
    // Preserve custom distributions. Imported references require adaptation from 6x1 to the requested 5x2 target.
    const refreshed = allowed.map(shift => refreshProposedWorkBlocks(person, shift, input.policy.limitContinuousWorkBlocks === true));
    const needsBlockBalance = refreshed.some((shift, index) => shift.id !== allowed[index].id);
    const needsHoursAdjustment = hours !== person.weeklyHours || ((person.sourceSchedule || person.weeklyHoursMode === "BRANCH") && [...targets].some((target) => !allowed.some((shift) => paidMinutes(shift) === target)));
    const needsAdjustment = needsBlockBalance || needsHoursAdjustment;
    if (!needsAdjustment) return person;
    // Start from the existing arrival; a narrower search also produces more stable previews.
    // Keep an explicitly selected set of shifts above, and try departure only when arrival is unsafe.
    const rosterReference = { ...input, employees: [person], assignments: [] };
    let prepared = needsBlockBalance && !needsHoursAdjustment
      ? { ...rosterReference, shifts: refreshed, employees: [{ ...person, shiftIds: refreshed.map(shift => shift.id) }] }
      : prepareRoster({ ...rosterReference, simulation: false }, hours, "EXCLUDE", "PRESERVE_START");
    if (prepared.employees[0].planningEnabled === false) prepared = prepareRoster({ ...rosterReference, simulation: false }, hours, "EXCLUDE", "PRESERVE_END");
    // Prefer a daytime adaptation. Retain short/night references as a bounded civil-minute simulation when needed.
    if (prepared.employees[0].planningEnabled === false) prepared = prepareRoster(rosterReference, hours, "EXCLUDE", "PRESERVE_START");
    if (prepared.employees[0].planningEnabled === false) prepared = prepareRoster(rosterReference, hours, "EXCLUDE", "PRESERVE_END");
    const candidate = prepared.employees[0];
    const commitments = input.assignments.filter((item) => item.employeeId === person.id && (item.locked || item.kind === "ABSENCE"));
    if (candidate.planningEnabled === false) {
      if (commitments.length) throw new EscalaError(422, "ESCALA_REFERENCE_REVIEW_REQUIRED", "Há um horário importado incompatível com a jornada 5×2 e dias bloqueados ou ausências já registrados. Confira as exceções da equipe antes de gerar; os registros foram preservados.");
      throw new EscalaError(422, "ESCALA_REFERENCE_REVIEW_REQUIRED", `Não foi possível adaptar o horário de ${person.registration} · ${person.name} (${person.sector}) para a jornada escolhida. Ninguém foi excluído. Use Ajustar horários para manter a saída ou confira o horário individual; bloqueios e afastamentos permanecem preservados.`);
    }
    for (const shift of prepared.shifts) {
      const existing = shifts.get(shift.id);
      if (existing && JSON.stringify(existing.segments) !== JSON.stringify(shift.segments)) {
        throw new EscalaError(422, "ESCALA_SHIFT_CONFLICT", "Dois horários têm o mesmo identificador e períodos diferentes. Confira os horários da filial antes de gerar.");
      }
      if (!existing) shifts.set(shift.id, shift);
    }
    adjustedEmployeeIds.push(person.id);
    const lockedShiftIds = commitments.flatMap((item) => item.shiftId ? [item.shiftId] : []);
    const shiftIds = [...new Set([...candidate.shiftIds, ...lockedShiftIds])];
    if (shiftIds.length > 12) throw new EscalaError(422, "ESCALA_SHIFT_OPTIONS_LIMIT", "Os horários propostos e os dias bloqueados excedem 12 alternativas por pessoa. Confira os bloqueios antes de gerar.");
    return { ...person, ...reference, planningEnabled: true, simulationDailyMinutes: candidate.simulationDailyMinutes, shiftIds };
  });
  const adjusted = new Set(adjustedEmployeeIds);
  const excluded = new Set(excludedEmployeeIds);
  // An incompatible unlocked workday is replaced by the solve. Absences, OFF choices and locks remain available.
  const assignments = input.assignments.filter((item) => (!excluded.has(item.employeeId) || item.locked || item.kind === "ABSENCE")
    && !(adjusted.has(item.employeeId) && item.kind === "WORK" && !item.locked));
  const used = new Set([...employees.flatMap((person) => person.shiftIds), ...assignments.flatMap((item) => item.shiftId ? [item.shiftId] : []),
    ...employees.flatMap((person) => [...person.history, ...(person.planningHistory ?? []), ...(person.planningFuture ?? [])].flatMap((item) => item.shiftId ? [item.shiftId] : []))]);
  const retained = [...shifts.values()].filter((shift) => used.has(shift.id));
  if (retained.length > 120) throw new EscalaError(422, "ESCALA_SHIFT_LIMIT", "A adaptação exige mais de 120 horários. Reduza o período ou as alternativas da filial antes de gerar.");
  const prepared: EscalaInput = { ...input, employees, shifts: retained, assignments };
  const covered = proposeCoverage(prepared);
  const generatedCoverageSlots = covered.demands.filter((demand) => demand.estimated === true).length;
  const proposal = covered;
  const included = employees.filter((person) => person.planningEnabled !== false && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate));
  return { input: proposal, preparation: { adjustedEmployeeIds, excludedEmployeeIds, generatedCoverageSlots,
    includedEmployees: included.length, untimedEmployees: included.filter((person) => (person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING")).length } };
}
