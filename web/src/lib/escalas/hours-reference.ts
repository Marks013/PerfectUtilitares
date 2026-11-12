import { dateRange } from "./dates";
import { usesMixed42Week } from "./labor-rules";
import { referenceNotices } from "./reference-notices";
import { fitsStoreClosing, storeClosingLabel, storeClosingMinutes } from "./store-hours";
import type { EscalaInput, EscalaIssue, EscalaValidation } from "./types";
import { validateJourney, workJourney } from "./validation-time";

/** Stable calculation inputs only: display labels and trusted published context do not invalidate proposals. */
export function generationScenarioBasis(input: EscalaInput): string {
  const policy = Object.fromEntries(Object.entries(input.policy).filter(([key]) => !["source", "reviewedBy", "reviewed"].includes(key)));
  const scenario = {
    mode: input.generationMode ?? "DAYS_AND_HOURS", hours: input.defaultWeeklyHours,
    restRulesVersion: input.restRulesVersion, startDate: input.startDate, endDate: input.endDate,
    closing: storeClosingMinutes(input), policy,
    mixed42Sectors: input.defaultWeeklyHours === 42 ? [...(input.mixed42Sectors ?? [])].sort() : [],
    movementPriorities: input.movementPriorities,
    employees: input.employees.map(person => Object.fromEntries(Object.entries(person).filter(([key]) =>
      !["name", "planningHistory", "planningFuture", "fixedImportedShiftId", "originalShiftIds", "planningExclusionReason"].includes(key))))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    shifts: input.shifts.map(shift => ({ id: shift.id, segments: shift.segments })).sort((a, b) => a.id.localeCompare(b.id)),
    demands: input.demands.filter(demand => !demand.estimated).map(demand =>
      Object.fromEntries(Object.entries(demand).filter(([key]) => key !== "id"))),
  };
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)])) : value;
  let first = 2166136261, second = 5381;
  for (const character of JSON.stringify(canonical(scenario))) {
    first = Math.imul(first ^ character.charCodeAt(0), 16777619) >>> 0;
    second = (Math.imul(second, 33) ^ character.charCodeAt(0)) >>> 0;
  }
  return `generation-v1:${first.toString(16).padStart(8, "0")}${second.toString(16).padStart(8, "0")}`;
}

/** HOURS_ONLY can change only the clock of an unlocked WORK cell, never its existence or classification. */
export function matchesHoursOnlyAssignments(previous: EscalaInput, next: EscalaInput): boolean {
  if (previous.generationMode !== "HOURS_ONLY") return true;
  if (previous.assignments.length !== next.assignments.length) return false;
  const records = new Map(next.assignments.map(day => [`${day.employeeId}\0${day.date}`, day]));
  return previous.assignments.every(day => {
    const proposed = records.get(`${day.employeeId}\0${day.date}`);
    return proposed?.kind === day.kind && proposed.locked === day.locked
      && (day.kind === "WORK" && !day.locked || proposed.shiftId === day.shiftId);
  });
}

/** References are not attendance: absence-only inputs must not acquire fictitious workdays. */
export function isHoursReferenceOnly(input: EscalaInput): boolean {
  if (input.generationMode !== "HOURS_ONLY") return false;
  const included = new Set(input.employees.filter(person => person.planningEnabled !== false).map(person => person.id));
  return !input.assignments.some(day => included.has(day.employeeId) && ["WORK", "DUTY", "OFF"].includes(day.kind));
}

/** Validate permitted clocks, without claiming daily presence or a published monthly roster. */
export function validateHoursReferences(input: EscalaInput): EscalaValidation {
  const issues: EscalaIssue[] = [], shifts = new Map(input.shifts.map(shift => [shift.id, shift]));
  const dates = dateRange(input.startDate, input.endDate).filter((_, index) => index % 7 === 0);
  const calendarCodes = new Set(["CLOSED_DATE", "HOLIDAY_WORK", "CCT_SUNDAY_CERTIFICATE", "CCT_HOLIDAY_CERTIFICATE", "CCT_NIGHT_CERTIFICATE"]);
  const included = input.employees.filter(person => person.planningEnabled !== false && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate));
  if (input.needsRegeneration || input.generationBasis !== generationScenarioBasis(input)) issues.push({ code: "SCENARIO_OUTDATED", severity: "ERROR", message: "Prepare novamente as referências após alterar modo, jornada ou equipe antes de exportar." });
  if (!included.some(person => person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING" && person.shiftIds.some(id => shifts.has(id)))) {
    issues.push({ code: "HOURS_REFERENCE_PENDING", severity: "ERROR", message: "Não há horários reais preparados para exportar. Informe uma referência para a equipe com jornada controlada." });
  }
  if (!included.length) issues.push({ code: "ACTIVE_EMPLOYEES_PENDING", severity: "ERROR", message: "Inclua colaboradores com horário para preparar as referências." });
  for (const person of included) {
    if (person.scheduleMode === "MISSING") issues.push({ code: "EMPLOYEE_SHIFT_PENDING", severity: "WARNING", employeeId: person.id, message: "Este colaborador está sem horário informado e não tem referência para exportar. As referências reais dos demais permanecem disponíveis." });
    if (person.scheduleMode === "UNTIMED" || person.scheduleMode === "MISSING") continue;
    if (!person.shiftIds.length) issues.push({ code: "EMPLOYEE_SHIFT_PENDING", severity: "ERROR", employeeId: person.id, message: "Informe um horário de referência para este colaborador." });
    for (const id of person.shiftIds) {
      const shift = shifts.get(id);
      if (!shift) continue; // Input schema reports missing references before this branch.
      if (!fitsStoreClosing(shift, storeClosingMinutes(input))) issues.push({ code: "STORE_CLOSING_EXCEEDED", severity: "ERROR", employeeId: person.id, message: `A referência termina após o fechamento (${storeClosingLabel(input)}). Confira o horário antes de exportar.` });
      for (const date of dates) {
        try {
          const journey = workJourney({ employeeId: person.id, date, kind: "WORK", shiftId: id }, shift);
          issues.push(...validateJourney(input, journey, undefined, usesMixed42Week(input, person, date)).filter(issue => !calendarCodes.has(issue.code)));
        } catch {
          issues.push({ code: "CIVIL_TIME_INVALID", severity: "ERROR", employeeId: person.id, message: "O horário de referência não pôde ser conferido. Revise entrada, intervalo e saída." });
        }
      }
    }
  }
  issues.push({ code: "HOURS_REFERENCES_ONLY", severity: "WARNING", message: "Somente referências de horários. Nenhuma folga, presença diária ou cobertura foi gerada; o arquivo não é uma escala mensal completa." });
  const unique = [...new Map(issues.map(issue => [JSON.stringify([issue.code, issue.employeeId, issue.message]), issue])).values()];
  const reviewed = referenceNotices(unique);
  return { valid: !reviewed.some(issue => issue.severity === "ERROR"), readyToPublish: false, minimumCoverageMargin: null,
    summaries: [], issues: reviewed };
}
