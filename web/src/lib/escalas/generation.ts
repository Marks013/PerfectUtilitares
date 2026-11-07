import { EscalaError } from "./access";
import { retainCoverageReference } from "./automatic-coverage";
import { applyRestEligibility, isRestPlanningExcludedRole } from "./eligibility";
import { addDays, dateRange } from "./dates";
import { effectiveWeeklyHours, effectiveWorkDayLimit, isMixed42LongShift, usesMixed42 } from "./labor-rules";
import { automaticShiftAlternatives, civilNightWorkMinutes, isGeneratedMixed42Shift, planningWeeklyHours, preparedShiftSignature, prepareRoster, proposeCoverage, refreshProposedWorkBlocks } from "./preparation";
import type { EscalaEmployee, EscalaGenerationPreparation, EscalaInput, EscalaShift } from "./types";

function paidMinutes(shift: EscalaShift): number {
  return shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}

/** Compare civil work minutes only; this neither calculates night credits nor approves night work. */
function nightWorkMinutes(input: EscalaInput, targets: Set<number>): number {
  const person = input.employees[0];
  if (!person || person.planningEnabled === false || !person.shiftIds.length) return Infinity;
  const allowed = new Set(person.shiftIds);
  const shifts = input.shifts.filter(shift => allowed.has(shift.id));
  if ([...targets].some(target => !shifts.some(shift => paidMinutes(shift) === Math.min(target, person.simulationDailyMinutes ?? Infinity)))) return Infinity;
  return shifts.reduce((total, shift) => total + civilNightWorkMinutes(shift), 0);
}

/** Order references without deleting manual alternatives needed when the mode changes. */
function restOnlyReferences(person: EscalaEmployee, shifts: Map<string, EscalaShift>): EscalaEmployee {
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
  if (input.generationMode !== "REST_ONLY") return true;
  const shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const employees = new Map(input.employees.map(person => [person.id, person]));
  const locked = new Map(input.assignments.filter(day => day.locked && day.kind === "WORK")
    .map(day => [JSON.stringify([day.employeeId, day.date]), day.shiftId]));
  const references = new Map(input.employees.map(person => {
    const byDuration = new Map<number, string>();
    for (const id of person.shiftIds) {
      const shift = shifts.get(id);
      if (shift && !byDuration.has(paidMinutes(shift))) byDuration.set(paidMinutes(shift), id);
    }
    return [person.id, byDuration];
  }));
  return assignments.every(day => {
    if (day.kind !== "WORK") return true;
    const person = employees.get(day.employeeId);
    if (person?.planningEnabled === false) return true;
    const shift = shifts.get(day.shiftId ?? "");
    return Boolean(shift && (locked.get(JSON.stringify([day.employeeId, day.date])) === day.shiftId
      || references.get(day.employeeId)?.get(paidMinutes(shift)) === day.shiftId));
  });
}

/** Prepare a preview, without approving documents, inventing attendance or overwriting branch decisions. */
export function prepareGeneration(rawInput: EscalaInput): { input: EscalaInput; preparation: EscalaGenerationPreparation } {
  const input: EscalaInput = { ...rawInput, simulation: true, policy: { ...rawInput.policy, maxConsecutiveWorkDays: effectiveWorkDayLimit(rawInput.policy) } };
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const adjustedEmployeeIds: string[] = [];
  const excludedEmployeeIds: string[] = [];
  const adaptedOptions = new Map<string, Set<string>>();
  const adjustedEmployees = input.employees.map((original) => {
    const person = applyRestEligibility(original);
    if (isRestPlanningExcludedRole(person.role)) excludedEmployeeIds.push(person.id);
    if (person.planningEnabled === false || person.activeFrom > input.endDate || (person.activeUntil && person.activeUntil < input.startDate)
      || (person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING")) return person;
    const reference = planningWeeklyHours(person, input.defaultWeeklyHours, input.defaultWeeklyHours);
    const hours = reference.weeklyHours;
    const mixed = usesMixed42(input, { ...person, ...reference });
    const weekHours = dateRange(input.startDate, input.endDate).filter((_, index) => index % 7 === 0
      && person.activeFrom <= addDays(input.startDate, index + 6) && (!person.activeUntil || person.activeUntil >= addDays(input.startDate, index)))
      .map(date => effectiveWeeklyHours({ weeklyHours: hours }, date));
    const mixedWeeks = mixed && weekHours.includes(42);
    const targets = new Set(weekHours.map(hours => mixedWeeks ? 480 : Math.min(hours * 12, person.simulationDailyMinutes ?? Infinity)));
    const allowed = person.shiftIds.map((id) => shifts.get(id)).filter((shift): shift is EscalaShift => Boolean(shift));
    // Preserve custom distributions. Imported references require adaptation from 6x1 to the requested 5x2 target.
    const refreshed = allowed.map(shift => refreshProposedWorkBlocks(person, shift, input.policy.limitContinuousWorkBlocks === true));
    const needsBlockBalance = refreshed.some((shift, index) => shift.id !== allowed[index].id);
    const needsMixedAdjustment = mixedWeeks && (!allowed.some(isMixed42LongShift) || !allowed.some(shift => paidMinutes(shift) === 480));
    const removingMixed = !mixedWeeks && allowed.some(shift => isGeneratedMixed42Shift(shift.id));
    const needsHoursAdjustment = needsMixedAdjustment || removingMixed || hours !== person.weeklyHours
      || ((person.sourceSchedule || person.weeklyHoursMode === "BRANCH") && [...targets].some(target => !allowed.some(shift => paidMinutes(shift) === target)));
    const needsAdjustment = needsBlockBalance || needsHoursAdjustment;
    if (!needsAdjustment) return person;
    // Start from the existing arrival; a narrower search also produces more stable previews.
    // Keep an explicitly selected set of shifts above, and try departure only when arrival is unsafe.
    const rosterReference = { ...input, employees: [person], assignments: [] };
    let prepared = needsBlockBalance && !needsHoursAdjustment
      ? { ...rosterReference, shifts: refreshed, employees: [{ ...person, shiftIds: refreshed.map(shift => shift.id) }] }
      : mixedWeeks ? prepareRoster(rosterReference, hours, "EXCLUDE", "BOTH")
        : prepareRoster({ ...rosterReference, simulation: false }, hours, "EXCLUDE", "PRESERVE_START");
    if (!mixedWeeks && prepared.employees[0].planningEnabled === false) prepared = prepareRoster({ ...rosterReference, simulation: false }, hours, "EXCLUDE", "PRESERVE_END");
    // Prefer a daytime adaptation. Retain short/night references as a bounded civil-minute simulation when needed.
    if (!mixedWeeks && prepared.employees[0].planningEnabled === false) {
      const arrival = prepareRoster(rosterReference, hours, "EXCLUDE", "PRESERVE_START");
      const departure = prepareRoster(rosterReference, hours, "EXCLUDE", "PRESERVE_END");
      prepared = nightWorkMinutes(departure, targets) < nightWorkMinutes(arrival, targets) ? departure : arrival;
    }
    const candidate = prepared.employees[0];
    const commitments = input.assignments.filter((item) => item.employeeId === person.id && (item.locked || item.kind === "ABSENCE"));
    if (candidate.planningEnabled === false) {
      if (mixedWeeks) throw new EscalaError(422, "ESCALA_MIXED_42_SHIFT_REQUIRED", `Não há horário diurno compatível com 9h de trabalho e 3h de intervalo para ${person.registration} · ${person.name} (${person.sector}). Confira a entrada ou a saída de referência, ou retire o setor da jornada mista. Nenhum registro foi alterado.`);
      if (commitments.length) throw new EscalaError(422, "ESCALA_REFERENCE_REVIEW_REQUIRED", "Há um horário importado incompatível com a jornada 5×2 e dias bloqueados ou ausências já registrados. Confira as exceções da equipe antes de gerar; os registros foram preservados.");
      throw new EscalaError(422, "ESCALA_REFERENCE_REVIEW_REQUIRED", `Não foi possível adaptar o horário de ${person.registration} · ${person.name} (${person.sector}) para a jornada escolhida. Ninguém foi excluído. Use Ajustar horários para manter a saída ou confira o horário individual; bloqueios e afastamentos permanecem preservados.`);
    }
    const proposedIds = new Set(candidate.shiftIds);
    const proposedSchedules = prepared.shifts.filter(shift => proposedIds.has(shift.id)).map(preparedShiftSignature).sort();
    const currentSchedules = allowed.map(preparedShiftSignature).sort();
    const unchangedSchedules = JSON.stringify(proposedSchedules) === JSON.stringify(currentSchedules);
    // Rechecking a preserved short reference must not discard an unchanged saved roster.
    // A real journey, clock-reference or permitted-shift change still invalidates its workdays.
    if (hours === person.weeklyHours && candidate.simulationDailyMinutes === person.simulationDailyMinutes && unchangedSchedules) {
      return { ...person, ...reference };
    }
    for (const shift of prepared.shifts) {
      const existing = shifts.get(shift.id);
      if (existing && preparedShiftSignature(existing) !== preparedShiftSignature(shift)) {
        throw new EscalaError(422, "ESCALA_SHIFT_CONFLICT", "Dois horários têm o mesmo identificador e períodos diferentes. Confira os horários da filial antes de gerar.");
      }
      if (!existing) shifts.set(shift.id, shift);
    }
    adjustedEmployeeIds.push(person.id);
    adaptedOptions.set(person.id, new Set(candidate.shiftIds));
    const lockedShiftIds = commitments.flatMap((item) => item.shiftId ? [item.shiftId] : []);
    const shiftIds = [...new Set([...candidate.shiftIds, ...lockedShiftIds])];
    if (shiftIds.length > 12) throw new EscalaError(422, "ESCALA_SHIFT_OPTIONS_LIMIT", "Os horários propostos e os dias bloqueados excedem 12 alternativas por pessoa. Confira os bloqueios antes de gerar.");
    return { ...person, ...reference, planningEnabled: true, simulationDailyMinutes: candidate.simulationDailyMinutes, originalShiftIds: candidate.originalShiftIds, shiftIds };
  });
  const excluded = new Set(excludedEmployeeIds);
  // Existing work also reserves space until the final allowed clocks are known.
  const eligibleAssignments = input.assignments.filter((item) => !excluded.has(item.employeeId) || item.locked || item.kind === "ABSENCE");
  // Reserve mandatory references before spending the shared limit on optional clocks.
  const used = new Set([...adjustedEmployees.flatMap((person) => [...person.shiftIds, ...(person.originalShiftIds ?? [])]), ...eligibleAssignments.flatMap((item) => item.shiftId ? [item.shiftId] : []),
    ...adjustedEmployees.flatMap((person) => [...person.history, ...(person.planningHistory ?? []), ...(person.planningFuture ?? [])].flatMap((item) => item.shiftId ? [item.shiftId] : []))]);
  // Expand only identified automatic references in the explicitly selected full mode.
  // Extra choices do not invalidate a saved roster or replace its clock reference.
  const alternatives = adjustedEmployees.map(person => {
    if (input.generationMode !== "DAYS_AND_HOURS" || person.planningEnabled === false
      || person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED" || usesMixed42(input, person)) return person;
    const proposed = new Map(person.shiftIds.map(id => [id, shifts.get(id)]).filter((entry): entry is [string, EscalaShift] => Boolean(entry[1])));
    const durations = new Set<number>();
    for (const id of person.shiftIds) {
      const reference = shifts.get(id);
      if (!reference || durations.has(paidMinutes(reference))) continue;
      durations.add(paidMinutes(reference));
      for (const candidate of automaticShiftAlternatives(person, reference, input.policy.limitContinuousWorkBlocks === true)) {
        if (!proposed.has(candidate.id) && (proposed.size >= 12 || !used.has(candidate.id) && used.size >= 120)) continue;
        used.add(candidate.id);
        const existing = shifts.get(candidate.id);
        if (existing && preparedShiftSignature(existing) !== preparedShiftSignature(candidate)) throw new EscalaError(422, "ESCALA_SHIFT_CONFLICT", "Dois horários têm o mesmo identificador e períodos diferentes. Confira os horários da filial antes de gerar.");
        if (!existing) shifts.set(candidate.id, candidate);
        if (!proposed.has(candidate.id)) {
          proposed.set(candidate.id, candidate);
          adaptedOptions.get(person.id)?.add(candidate.id);
        }
      }
    }
    if (proposed.size > 12) throw new EscalaError(422, "ESCALA_SHIFT_OPTIONS_LIMIT", "Os horários propostos e os dias bloqueados excedem 12 alternativas por pessoa. Confira os bloqueios antes de gerar.");
    return { ...person, shiftIds: [...proposed.keys()] };
  });
  const employees = input.generationMode === "REST_ONLY"
    ? alternatives.map(person => restOnlyReferences(person, shifts)) : alternatives;
  // A changed option does not invalidate work that still uses an unchanged permitted clock.
  const assignments = eligibleAssignments.filter(item => item.kind !== "WORK" || item.locked
    || !adaptedOptions.has(item.employeeId) || adaptedOptions.get(item.employeeId)?.has(item.shiftId ?? ""));
  const retainedIds = new Set([...employees.flatMap(person => [...person.shiftIds, ...(person.originalShiftIds ?? [])]), ...assignments.flatMap(item => item.shiftId ? [item.shiftId] : []),
    ...employees.flatMap(person => [...person.history, ...(person.planningHistory ?? []), ...(person.planningFuture ?? [])].flatMap(item => item.shiftId ? [item.shiftId] : []))]);
  const retained = [...shifts.values()].filter((shift) => retainedIds.has(shift.id));
  if (retained.length > 120) throw new EscalaError(422, "ESCALA_SHIFT_LIMIT", "A adaptação exige mais de 120 horários. Reduza o período ou as alternativas da filial antes de gerar.");
  const prepared: EscalaInput = { ...input, employees, shifts: retained, assignments };
  const covered = retainCoverageReference(rawInput, prepared, true) ?? proposeCoverage(prepared);
  const generatedCoverageSlots = covered.demands.filter((demand) => demand.estimated === true).length;
  const proposal = covered;
  const included = employees.filter((person) => person.planningEnabled !== false && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate));
  return { input: proposal, preparation: { adjustedEmployeeIds, excludedEmployeeIds, generatedCoverageSlots,
    includedEmployees: included.length, untimedEmployees: included.filter((person) => (person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING")).length } };
}
