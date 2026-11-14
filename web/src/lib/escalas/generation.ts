import { EscalaError } from "./errors";
import { applyLocalHolidayCalendar, assertHolidayLocks } from "./calendar";
import { isHoursReferenceOnly } from "./hours-reference";
import { retainCoverageReference } from "./automatic-coverage";
import { applyRestEligibility, isRestPlanningExcludedRole, isShortFpre136Schedule } from "./eligibility";
import { addDays, dateRange } from "./dates";
import { effectiveWeeklyHours, effectiveWorkDayLimit, isMixed42LongShift, maximumMealMinutes, minimumMealMinutes, usesMixed42 } from "./labor-rules";
import { automaticShiftAlternatives, civilNightWorkMinutes, importedShiftReference, isAutomaticPreparedShift, isGeneratedMixed42Shift, planningWeeklyHours, preparedShiftSignature, prepareRoster, proposeCoverage, refreshProposedWorkBlocks, stableShiftReferences } from "./preparation";
import { fitsStoreClosing, storeClosingLabel, storeClosingMinutes } from "./store-hours";
import type { EscalaEmployee, EscalaGenerationPreparation, EscalaInput, EscalaShift } from "./types";
import { selectMonthlyClockReferences, type MonthlyClockChoice } from "./monthly-clock-selection";

import { manualAssignmentIssues, manualShiftAt, manualShiftIssues, materializeManualShiftOverrides } from "./shift-catalog/manual-override";
function paidMinutes(shift: EscalaShift): number {
  return shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
}

function mealMinutes(shift: EscalaShift): number {
  const first = shift.segments[0].start, last = shift.segments.at(-1)?.end ?? first;
  return Math.max(0, ...shift.segments.filter(segment => segment.kind === "BREAK" && segment.start > first && segment.end < last).map(segment => segment.end - segment.start));
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

/** Prepare a preview, without approving documents, inventing attendance or overwriting branch decisions. */
export function prepareGeneration(rawInput: EscalaInput): { input: EscalaInput; preparation: EscalaGenerationPreparation } {
  const input: EscalaInput = applyLocalHolidayCalendar({ ...rawInput, restRulesVersion: 2, simulation: true, policy: { ...rawInput.policy, maxConsecutiveWorkDays: effectiveWorkDayLimit(rawInput.policy) } });
  const holidayLock = assertHolidayLocks(input);
  if (holidayLock) throw new EscalaError(422, "ESCALA_HOLIDAY_LOCK_CONFLICT", `Há um dia bloqueado em ${holidayLock}, quando a loja fecha por feriado. Confira e desbloqueie esse dia antes de gerar; nenhum bloqueio ou afastamento foi alterado.`);
  const closing = storeClosingMinutes(input);
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const adjustedEmployeeIds: string[] = [];
  const excludedEmployeeIds: string[] = [];
  const adaptedOptions = new Map<string, Set<string>>();
  const monthlyChoices: MonthlyClockChoice[] = [];
  const rememberChoice = (choice: MonthlyClockChoice) => {
    for (const shift of choice.candidates) {
      const existing = shifts.get(shift.id);
      if (existing && preparedShiftSignature(existing) !== preparedShiftSignature(shift)) {
        throw new EscalaError(422, "ESCALA_SHIFT_CONFLICT", "Dois horários têm o mesmo identificador e períodos diferentes. Confira os horários da filial antes de gerar.");
      }
      if (!existing) shifts.set(shift.id, shift);
    }
    monthlyChoices.push(choice);
  };
  let adjustedEmployees = input.employees.map((original) => {
    const person: EscalaEmployee = { ...applyRestEligibility(original), fixedImportedShiftId: undefined,
      shiftIds: original.manualShiftBaseIds ?? original.shiftIds };
    if (isRestPlanningExcludedRole(person.role) || isShortFpre136Schedule(person)) excludedEmployeeIds.push(person.id);
    if (person.planningEnabled === false || person.activeFrom > input.endDate || (person.activeUntil && person.activeUntil < input.startDate)
      || (person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING")) return person;
    const reference = planningWeeklyHours(person, input.defaultWeeklyHours, input.defaultWeeklyHours);
    const hours = reference.weeklyHours;
    const weekHours = dateRange(input.startDate, input.endDate).filter((_, index) => index % 7 === 0
      && person.activeFrom <= addDays(input.startDate, index + 6) && (!person.activeUntil || person.activeUntil >= addDays(input.startDate, index)))
      .map(date => effectiveWeeklyHours({ weeklyHours: hours }, date));
    const imported = importedShiftReference(person);
    const compatibleImport = Boolean(imported && weekHours.length && weekHours.every(week => paidMinutes(imported) === week * 12));
    // A legacy short-clock marker must not activate mixed hours only after the clock choice is frozen.
    if (compatibleImport) person.simulationDailyMinutes = undefined;
    const mixedWeeks = usesMixed42(input, { ...person, ...reference }) && weekHours.includes(42);
    const targets = new Set(weekHours.map(hours => mixedWeeks ? 480 : Math.min(hours * 12, person.simulationDailyMinutes ?? Infinity)));
    const allowed = person.shiftIds.map((id) => shifts.get(id)).filter((shift): shift is EscalaShift => Boolean(shift));
    const explicitReferences = allowed.filter(shift => !isAutomaticPreparedShift(shift) && !isGeneratedMixed42Shift(shift.id)
      && (targets.has(paidMinutes(shift)) || mixedWeeks && isMixed42LongShift(shift))).map(shift => shift.id);
    // Explicit normal options stay registered; the fixed reference still prevents free daily clock rotation.
    const needsClosingAdjustment = allowed.some(shift => !fitsStoreClosing(shift, closing));
    const invalidAutomaticMeal = (shift: EscalaShift) => isAutomaticPreparedShift(shift)
      && (mealMinutes(shift) < minimumMealMinutes(input.policy, paidMinutes(shift), input.simulation)
        || mealMinutes(shift) > maximumMealMinutes(input.policy, input.startDate));
    const needsMealRepair = allowed.some(invalidAutomaticMeal);
    if (input.assignments.some(day => {
      const shift = shifts.get(day.shiftId ?? "");
      return day.employeeId === person.id && day.locked && day.kind === "WORK" && shift && invalidAutomaticMeal(shift);
    })) throw new EscalaError(422, "ESCALA_MEAL_LOCK_CONFLICT", "Há um horário automático bloqueado com intervalo fora dos limites configurados. Confira o registro e seu bloqueio antes de gerar; os dados foram preservados.");
    if (input.assignments.some(day => {
      const lockedShift = shifts.get(day.shiftId ?? "");
      return day.employeeId === person.id && day.locked && day.kind === "WORK"
        && lockedShift && !fitsStoreClosing(lockedShift, closing);
    })) {
      throw new EscalaError(422, "ESCALA_CLOSING_LOCK_CONFLICT", `Há um dia bloqueado com saída após ${storeClosingLabel(input)}. Ajuste esse horário ou desbloqueie o dia antes de gerar. O registro foi preservado.`);
    }
    // Five matching workdays prove compatibility with this scenario, not the original employment contract.
    const usesBaseReference = !person.manualShiftOverrides?.length || dateRange(input.startDate, input.endDate).some(date =>
      date >= person.activeFrom && (!person.activeUntil || date <= person.activeUntil) && !manualShiftAt(person, date));
    if (imported && compatibleImport && !mixedWeeks && usesBaseReference
      && mealMinutes(imported) > maximumMealMinutes(input.policy, input.startDate)
      && allowed.some(shift => preparedShiftSignature(shift) === preparedShiftSignature(imported) || isAutomaticPreparedShift(shift))) {
      throw new EscalaError(422, "ESCALA_IMPORTED_MEAL_CONFLICT", "O horário importado já corresponde à jornada escolhida, mas o intervalo excede o máximo configurado. Ele não foi alterado. Confira o horário individual ou a configuração documentada do intervalo antes de gerar.");
    }
    if (imported && compatibleImport && !mixedWeeks
      && mealMinutes(imported) >= minimumMealMinutes(input.policy, paidMinutes(imported), input.simulation)
      && allowed.some(shift => preparedShiftSignature(shift) === preparedShiftSignature(imported) || isAutomaticPreparedShift(shift))) {
      if (!fitsStoreClosing(imported, closing)) throw new EscalaError(422, "ESCALA_IMPORTED_CLOSING_CONFLICT", `O horário importado já corresponde à jornada escolhida, mas termina após ${storeClosingLabel(input)}. Ele não foi alterado. Corrija o horário na equipe ou ajuste o fechamento da loja antes de gerar.`);
      const fixed = allowed.find(shift => preparedShiftSignature(shift) === preparedShiftSignature(imported)) ?? imported;
      const existing = shifts.get(fixed.id);
      if (existing && preparedShiftSignature(existing) !== preparedShiftSignature(fixed)) throw new EscalaError(422, "ESCALA_SHIFT_CONFLICT", "Dois horários têm o mesmo identificador e períodos diferentes. Confira os horários da filial antes de gerar.");
      if (!existing) shifts.set(fixed.id, fixed);
      const lockedIds = input.assignments.filter(day => day.employeeId === person.id && day.locked && day.kind === "WORK")
        .flatMap(day => day.shiftId ? [day.shiftId] : []);
      const shiftIds = [...new Set([fixed.id, ...explicitReferences, ...(person.manualShiftOverrides?.length ? [] : lockedIds)])];
      if (shiftIds.length > 12) throw new EscalaError(422, "ESCALA_SHIFT_OPTIONS_LIMIT", "O horário importado e os dias bloqueados excedem 12 alternativas por pessoa. Confira os horários antes de gerar.");
      adaptedOptions.set(person.id, new Set([fixed.id]));
      return { ...person, ...reference, simulationDailyMinutes: undefined, shiftIds, fixedImportedShiftId: fixed.id };
    }
    // Preserve custom distributions. Imported references require adaptation from 6x1 to the requested 5x2 target.
    const refreshed = allowed.map(shift => refreshProposedWorkBlocks(person, shift, input.policy.limitContinuousWorkBlocks === true, closing,
      minimumMealMinutes(input.policy, paidMinutes(shift), input.simulation), maximumMealMinutes(input.policy, input.startDate)));
    const needsBlockBalance = refreshed.some((shift, index) => shift.id !== allowed[index].id);
    const needsMixedAdjustment = mixedWeeks && (Boolean(imported) || !allowed.some(isMixed42LongShift) || !allowed.some(shift => paidMinutes(shift) === 480));
    const removingMixed = !mixedWeeks && allowed.some(shift => isGeneratedMixed42Shift(shift.id));
    const needsHoursAdjustment = needsClosingAdjustment || needsMixedAdjustment || removingMixed || hours !== person.weeklyHours
      || ((person.sourceSchedule || person.weeklyHoursMode === "BRANCH") && [...targets].some(target => !allowed.some(shift => paidMinutes(shift) === target)));
    if (needsMealRepair && !needsHoursAdjustment && refreshed.some(invalidAutomaticMeal)) {
      throw new EscalaError(422, "ESCALA_MEAL_REFERENCE_CONFLICT", "Não foi possível encaixar o intervalo nos limites configurados e antes do fechamento. Confira entrada, saída e intervalo da equipe; nenhum dado foi alterado.");
    }
    const needsAdjustment = needsBlockBalance || needsHoursAdjustment;
    if (!needsAdjustment) {
      const source = imported ?? allowed[0];
      if (!source || !imported && !allowed.some(shift => isAutomaticPreparedShift(shift) || isGeneratedMixed42Shift(shift.id))) return person;
      const lockedIds = input.assignments.filter(day => day.employeeId === person.id && day.locked && day.kind === "WORK").flatMap(day => day.shiftId ? [day.shiftId] : []);
      const compatible = allowed.filter(shift => targets.has(paidMinutes(shift)) || mixedWeeks && isMixed42LongShift(shift));
      const normal = compatible.filter(shift => !lockedIds.includes(shift.id));
      const saved = compatible.find(shift => shift.id === original.fixedImportedShiftId);
      const candidates = saved ? [saved] : normal.length ? normal : compatible;
      const stable = stableShiftReferences(source, candidates);
      if (stable.every(isAutomaticPreparedShift)) rememberChoice({ employeeId: person.id, baseline: stable,
        candidates: candidates.filter(isAutomaticPreparedShift) });
      const stableIds = stable.map(shift => shift.id);
      adaptedOptions.set(person.id, new Set(stableIds));
      return { ...person, ...reference, shiftIds: [...new Set([...stableIds, ...explicitReferences, ...(person.manualShiftOverrides?.length ? [] : lockedIds)])],
        originalShiftIds: person.originalShiftIds ?? (imported && allowed.some(shift => !isAutomaticPreparedShift(shift) && !isGeneratedMixed42Shift(shift.id))
          ? [...person.shiftIds] : undefined),
        fixedImportedShiftId: !mixedWeeks && stableIds.length === 1 ? stableIds[0] : undefined };
    }
    // Keep both bounded anchors until the collective monthly selection; no daily alternatives reach the processor.
    const rosterReference = { ...input, employees: [person], assignments: [] };
    const strategy = "BOTH";
    let prepared = needsBlockBalance && !needsHoursAdjustment
      ? { ...rosterReference, shifts: refreshed, employees: [{ ...person, shiftIds: refreshed.map(shift => shift.id) }] }
      : mixedWeeks ? prepareRoster(rosterReference, hours, "EXCLUDE", "BOTH", true)
        : prepareRoster({ ...rosterReference, simulation: false }, hours, "EXCLUDE", strategy, true);
    if (!mixedWeeks && prepared.employees[0].planningEnabled === false) prepared = prepareRoster({ ...rosterReference, simulation: false }, hours, "EXCLUDE", "PRESERVE_END", true);
    // Prefer a daytime adaptation. Retain short/night references as a bounded civil-minute simulation when needed.
    if (!mixedWeeks && prepared.employees[0].planningEnabled === false) {
      const arrival = prepareRoster(rosterReference, hours, "EXCLUDE", "PRESERVE_START", true);
      const departure = prepareRoster(rosterReference, hours, "EXCLUDE", "PRESERVE_END", true);
      prepared = nightWorkMinutes(departure, targets) < nightWorkMinutes(arrival, targets) ? departure : arrival;
    }
    const preparedPerson = prepared.employees[0].manualShiftOverrides?.length
      ? { ...prepared.employees[0], shiftIds: prepared.employees[0].manualShiftBaseIds ?? prepared.employees[0].shiftIds }
      : prepared.employees[0];
    const candidateShifts = prepared.shifts.filter(shift => preparedPerson.shiftIds.includes(shift.id));
    const stableCandidates = imported ? stableShiftReferences(imported, candidateShifts) : candidateShifts;
    if (imported && stableCandidates.every(isAutomaticPreparedShift)) rememberChoice({ employeeId: person.id,
      baseline: stableCandidates, candidates: candidateShifts.filter(isAutomaticPreparedShift) });
    const candidate = imported && candidateShifts.length ? { ...preparedPerson,
      shiftIds: stableCandidates.map(shift => shift.id),
      fixedImportedShiftId: !mixedWeeks && stableCandidates.length === 1
        ? stableCandidates[0].id : undefined } : preparedPerson;
    const commitments = input.assignments.filter((item) => item.employeeId === person.id && (item.locked || item.kind === "ABSENCE" || item.kind === "HOLIDAY"));
    if (candidate.planningEnabled === false) {
      if (needsMealRepair) throw new EscalaError(422, "ESCALA_MEAL_REFERENCE_CONFLICT", "Não foi possível encaixar o intervalo nos limites configurados e antes do fechamento. Confira entrada, saída e intervalo da equipe; nenhum dado foi alterado.");
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
      return { ...person, ...reference, fixedImportedShiftId: candidate.fixedImportedShiftId };
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
    const shiftIds = [...new Set([...candidate.shiftIds, ...explicitReferences, ...(person.manualShiftOverrides?.length ? [] : lockedShiftIds)])];
    if (shiftIds.length > 12) throw new EscalaError(422, "ESCALA_SHIFT_OPTIONS_LIMIT", "Os horários propostos e os dias bloqueados excedem 12 alternativas por pessoa. Confira os bloqueios antes de gerar.");
    return { ...person, ...reference, planningEnabled: true, simulationDailyMinutes: candidate.simulationDailyMinutes, originalShiftIds: candidate.originalShiftIds, fixedImportedShiftId: candidate.fixedImportedShiftId, shiftIds };
  });
  const selected = selectMonthlyClockReferences({ ...input, employees: adjustedEmployees }, monthlyChoices).references;
  adjustedEmployees = adjustedEmployees.map(person => {
    const references = selected.get(person.id), choice = monthlyChoices.find(item => item.employeeId === person.id);
    if (!references || !choice) return person;
    const baseline = new Set(choice.baseline.map(shift => shift.id));
    const shiftIds = [...new Set([...references.map(shift => shift.id), ...person.shiftIds.filter(id => !baseline.has(id))])];
    const adapted = adaptedOptions.get(person.id);
    if (adapted) {
      for (const id of baseline) adapted.delete(id);
      for (const shift of references) adapted.add(shift.id);
    }
    return { ...person, shiftIds, fixedImportedShiftId: person.fixedImportedShiftId && baseline.has(person.fixedImportedShiftId)
      ? references[0]?.id : person.fixedImportedShiftId };
  });
  const excluded = new Set([...excludedEmployeeIds, ...adjustedEmployees.filter(person => person.planningEnabled === false).map(person => person.id)]);
  // Existing work also reserves space until the final allowed clocks are known.
  const eligibleAssignments = input.generationMode === "HOURS_ONLY" ? input.assignments
    : input.assignments.filter((item) => !excluded.has(item.employeeId) || item.locked || item.kind === "ABSENCE" || item.kind === "HOLIDAY");
  // Reserve mandatory references before spending the shared limit on optional clocks.
  const used = new Set([...adjustedEmployees.flatMap((person) => [...person.shiftIds, ...(person.originalShiftIds ?? [])]), ...eligibleAssignments.flatMap((item) => item.shiftId ? [item.shiftId] : []),
    ...adjustedEmployees.flatMap((person) => [...person.history, ...(person.planningHistory ?? []), ...(person.planningFuture ?? [])].flatMap((item) => item.shiftId ? [item.shiftId] : []))]);
  // Keep the selected automatic reference through the compatibility pass.
  // Capacity optimization does not authorize extra arrival, departure or meal variants.
  const alternatives = adjustedEmployees.map(person => {
    const automaticClockMode = input.generationMode === "DAYS_AND_HOURS" || input.generationMode === "HOURS_ONLY" || adaptedOptions.has(person.id);
    if (!automaticClockMode || input.generationMode === "REST_ONLY" || person.planningEnabled === false || person.fixedImportedShiftId
      || person.scheduleMode === "MISSING" || person.scheduleMode === "UNTIMED" || usesMixed42(input, person)) return person;
    const proposed = new Map(person.shiftIds.map(id => [id, shifts.get(id)]).filter((entry): entry is [string, EscalaShift] => Boolean(entry[1])));
    const durations = new Set<number>();
    for (const id of person.shiftIds) {
      const reference = shifts.get(id);
      if (!reference || durations.has(paidMinutes(reference))) continue;
      durations.add(paidMinutes(reference));
      for (const candidate of automaticShiftAlternatives(person, reference, input.policy.limitContinuousWorkBlocks === true, closing,
        maximumMealMinutes(input.policy, input.startDate))) {
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
  const employees = (input.generationMode === "REST_ONLY"
    ? alternatives.map(person => restOnlyReferences(person, shifts)) : alternatives).map(person => person.manualShiftOverrides?.length
      ? { ...person, manualShiftBaseIds: [...person.shiftIds] } : person);
  // A changed option does not invalidate work that still uses an unchanged permitted clock.
  // HOURS_ONLY keeps the saved work/rest cells; the processor may replace only their clocks.
  const assignments = input.generationMode === "HOURS_ONLY" ? eligibleAssignments
    : eligibleAssignments.filter(item => item.kind !== "WORK" || item.locked
    || !adaptedOptions.has(item.employeeId) || adaptedOptions.get(item.employeeId)?.has(item.shiftId ?? ""));
  const retainedIds = new Set([...employees.flatMap(person => [...person.shiftIds, ...(person.originalShiftIds ?? [])]), ...assignments.flatMap(item => item.shiftId ? [item.shiftId] : []),
    ...employees.flatMap(person => [...person.history, ...(person.planningHistory ?? []), ...(person.planningFuture ?? [])].flatMap(item => item.shiftId ? [item.shiftId] : []))]);
  const retained = [...shifts.values()].filter((shift) => retainedIds.has(shift.id));
  if (retained.length > 120) throw new EscalaError(422, "ESCALA_SHIFT_LIMIT", "A adaptação exige mais de 120 horários. Reduza o período ou as alternativas da filial antes de gerar.");
  const prepared = materializeManualShiftOverrides({ ...input, employees, shifts: retained, assignments });
  const manualIssue = manualShiftIssues(prepared, true)[0];
  if (manualIssue) throw new EscalaError(422, manualIssue.code, manualIssue.message);
  const covered = isHoursReferenceOnly(prepared)
    ? { ...prepared, coverageBasis: undefined, demands: prepared.demands.filter(demand => !demand.estimated) }
    : retainCoverageReference(rawInput, prepared, true) ?? proposeCoverage(prepared);
  const generatedCoverageSlots = covered.demands.filter((demand) => demand.estimated === true).length;
  const proposal = covered;
  const included = employees.filter((person) => person.planningEnabled !== false && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate));
  return { input: proposal, preparation: { adjustedEmployeeIds, excludedEmployeeIds, generatedCoverageSlots,
    includedEmployees: included.length, untimedEmployees: included.filter((person) => (person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING")).length } };
}
