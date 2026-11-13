import type { EscalaInput, EscalaIssue, EscalaValidation } from "./types";
import { isHoursReferenceOnly, validateHoursReferences } from "./hours-reference";
import { absoluteMinute, dateRange, visibleDates } from "./dates";
import { escalaInputSchema } from "./schema";
import { sortEmployees } from "./order";
import { fixedBoundaryReservations } from "./boundary";
import { validateEmployee } from "./validation-employee";
import { validateCoverage, validateJourney, validateUntimedDuty, workJourney, type WorkJourney } from "./validation-time";
import { CCT_FROM, CCT_UNTIL, SUPERMARKET_CCT, transitionWeeks, usesMixed42, usesMixed42Week } from "./labor-rules";
import { storeClosingLabel, workAfterStoreClosing } from "./store-hours";
import { referenceExpiryNotice, referenceNotices } from "./reference-notices";

function addEmployeeEntry<T>(index: Map<string, T[]>, employeeId: string, value: T) {
  const entries = index.get(employeeId);
  if (entries) entries.push(value);
  else index.set(employeeId, [value]);
}

/** Recalculates from assignments, without trusting optimizer totals or feasibility. */
export function validateEscala(rawInput: EscalaInput, options: { publishedSnapshot?: boolean } = {}): EscalaValidation {
  const parsed = escalaInputSchema.safeParse(rawInput);
  if (!parsed.success) return {
    valid: false, readyToPublish: false, summaries: [], minimumCoverageMargin: null,
    issues: parsed.error.issues.slice(0, 50).map((entry) => ({ code: "INPUT_INVALID", severity: "ERROR", message: `${entry.path.join(".")}: ${entry.message}` })),
  };
  const input = parsed.data;
  if (isHoursReferenceOnly(input)) return validateHoursReferences(input);
  const issues: EscalaIssue[] = [];
  if (!options.publishedSnapshot) for (const day of workAfterStoreClosing(input)) issues.push({
    code: "STORE_CLOSING_EXCEEDED", severity: "ERROR", employeeId: day.employeeId, date: day.date,
    message: `Este dia termina após o fechamento da loja (${storeClosingLabel(input)}). Ajuste a saída ou gere uma nova proposta; se o dia estiver bloqueado, desbloqueie-o antes. O horário importado foi preservado.`,
  });
  const mixedPeople = new Map(input.employees.filter(person => usesMixed42(input, person)).map(person => [person.id, person]));
  if (input.defaultWeeklyHours === 42 && input.mixed42Sectors?.length) issues.push({
    code: "MIXED_42_SIMULATION", severity: "PENDING",
    message: "Jornada mista para negociação: 3 dias de 8h e 2 de 9h com intervalo de 3h nos dias longos. Use como rascunho; esta opção não confirma o acordo nem libera a publicação.",
  });
  if (input.policy.maxConsecutiveWorkDays > 5) issues.push({ code: "FIVE_BY_TWO_POLICY_OUTDATED", severity: "PENDING", message: "Este planejamento usa o limite antigo de 6 dias consecutivos. O modelo 5×2 agora permite no máximo 5, inclusive entre semanas e meses. Gere e aplique uma nova proposta para atualizar a grade; os dias salvos não foram alterados." });
  if (input.needsRegeneration) issues.push({ code: "SCENARIO_OUTDATED", severity: "PENDING", message: "O cenário foi alterado após a geração da grade. Gere e aplique uma nova proposta antes de exportar ou aprovar." });
  if (!input.employees.length) issues.push({ code: "EMPLOYEES_PENDING", severity: "PENDING", message: "Cadastre os colaboradores da filial." });
  else if (!input.employees.some((person) => person.planningEnabled !== false && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate))) issues.push({ code: "ACTIVE_EMPLOYEES_PENDING", severity: "PENDING", message: "Nenhum colaborador está incluído na geração neste período." });
  if (!input.shifts.length && input.employees.some((person) => person.planningEnabled !== false && (person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING"))) issues.push({ code: "SHIFTS_PENDING", severity: "PENDING", message: "Cadastre os horários permitidos antes de gerar a escala." });
  if (!input.policy.reviewed || !input.policy.source || !input.policy.reviewedBy) issues.push({ code: "POLICY_PENDING", severity: "PENDING", message: "Confira a norma aplicável, sua fonte e o responsável pela validação antes da publicação." });
  if (input.policy.validFrom > input.startDate || input.policy.validUntil < input.endDate) issues.push({ code: "POLICY_VALIDITY", severity: "PENDING", message: "A vigência da norma não abrange todo o período da escala." });
  if (input.policy.coverageReview === "SUGGESTED") issues.push({ code: "COVERAGE_REVIEW_PENDING", severity: "WARNING", message: "Cobertura sugerida, inclusive faixas com mínimo zero: confira a necessidade real da filial. A estimativa da equipe não comprova demanda operacional e não bloqueia, sozinha, a publicação interna; mínimos obrigatórios e restrições operacionais continuam valendo." });
  for (const date of transitionWeeks(input)) {
    if (!input.policy.transitionWeekAccepted) issues.push({ code: "TRANSITION_WEEK_PENDING", severity: "PENDING", date,
      message: "Esta semana atravessa uma redução legal da carga. Confirme a adoção antecipada do menor limite para a semana completa; não foi inventado rateio diário." });
  }
  if (input.policy.normativeProfile === SUPERMARKET_CCT) {
    if (input.startDate < CCT_FROM || input.endDate > CCT_UNTIL) issues.push({ code: "CCT_VALIDITY", severity: "PENDING", message: "A CCT PR003084/2026 vale de 01/06/2026 a 31/05/2027. Cadastre o instrumento sucessor antes de publicar fora dessa vigência." });
    if (input.policy.holidayRestAllowed) issues.push({ code: "CCT_HOLIDAY_REST", severity: "ERROR", message: "A cláusula 29 da CCT de supermercados veda compensar o DSR em feriado." });
  }
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  // Employees sharing a shift on the same date use the same timezone conversions.
  const civilMinutes = new Map<string, number>();
  const toAbsoluteMinute: typeof absoluteMinute = (date, minute) => {
    const key = `${date}:${minute}`;
    const cached = civilMinutes.get(key);
    if (cached !== undefined) return cached;
    const instant = absoluteMinute(date, minute);
    civilMinutes.set(key, instant);
    return instant;
  };
  const journeysByEmployee = new Map<string, WorkJourney[]>();
  const prior = input.employees.flatMap((person) => {
    const records = new Map([...(person.planningHistory ?? []), ...person.history, ...(person.planningFuture ?? [])].map((item) => [item.date, item]));
    return [...records.values()];
  });
  const assignments = [...prior, ...input.assignments];
  for (const assignment of assignments) {
    if (assignment.kind === "DUTY" && assignment.date >= input.startDate && assignment.date <= input.endDate) issues.push(...validateUntimedDuty(input, assignment));
    if (assignment.kind !== "WORK") continue;
    const shift = shifts.get(assignment.shiftId ?? "");
    if (!shift) continue; // Schema reports every unresolved reference.
    try {
      const journey = workJourney(assignment, shift, toAbsoluteMinute);
      addEmployeeEntry(journeysByEmployee, assignment.employeeId, journey);
      if (assignment.date >= input.startDate && assignment.date <= input.endDate) {
        const mixed = mixedPeople.get(assignment.employeeId);
        issues.push(...validateJourney(input, journey, toAbsoluteMinute, Boolean(mixed && usesMixed42Week(input, mixed, assignment.date))));
      }
      else if (assignment.date < input.startDate && journey.occupiedDates.some((day) => day >= input.startDate && day <= input.endDate)) {
        issues.push(...validateJourney(input, journey, toAbsoluteMinute).filter((issue) => (issue.code === "CLOSED_DATE" || issue.code === "HOLIDAY_WORK") && issue.date && issue.date >= input.startDate && issue.date <= input.endDate));
      }
    } catch {
      issues.push({ code: "CIVIL_TIME_INVALID", severity: "ERROR", employeeId: assignment.employeeId, date: assignment.date, message: "Horário inválido na transição do fuso; confira as datas e os horários reais." });
    }
  }
  const boundaryReservations = fixedBoundaryReservations(input);
  const assignmentsByEmployee = new Map<string, EscalaInput["assignments"]>();
  const reservationsByEmployee = new Map<string, EscalaInput["assignments"]>();
  for (const assignment of input.assignments) addEmployeeEntry(assignmentsByEmployee, assignment.employeeId, assignment);
  for (const reservation of boundaryReservations) addEmployeeEntry(reservationsByEmployee, reservation.employeeId, reservation);
  const days = dateRange(input.startDate, input.endDate);
  const visible = new Set(visibleDates(input));
  const weekByDate = new Map(days.map((day, index) => [day, days[index - index % 7]]));
  const results = sortEmployees(input.employees).map((person) => validateEmployee(input, person, {
    current: assignmentsByEmployee.get(person.id) ?? [],
    journeys: journeysByEmployee.get(person.id) ?? [],
    reservations: reservationsByEmployee.get(person.id) ?? [],
    days, visible, weekByDate,
    enforceRestSpacing: !options.publishedSnapshot,
  }));
  issues.push(...results.flatMap((result) => result.issues));
  if (input.simulation) {
    const evidencePending = new Set(["COMPENSATION_REQUIRED", "COLLECTIVE_AGREEMENT_REQUIRED", "HOLIDAY_WORK", "CCT_SUNDAY_CERTIFICATE", "CCT_HOLIDAY_CERTIFICATE", "CCT_NIGHT_CERTIFICATE"]);
    for (const issue of issues) if (evidencePending.has(issue.code) && issue.severity === "ERROR") issue.severity = "PENDING";
  }
  for (const person of input.employees) if (person.planningEnabled !== false && person.simulationDailyMinutes !== undefined) issues.push({
    code: "SHORT_REFERENCE_PRESERVED", severity: "PENDING", employeeId: person.id,
    message: "Referência curta preservada na simulação, sem ampliação automática. A carga contratual individual não consta no arquivo e precisa de conferência antes da aplicação.",
  });
  const coverage = validateCoverage(input);
  issues.push(...coverage.issues);
  issues.push(...referenceExpiryNotice(input));
  const reviewedIssues = referenceNotices(issues);
  return {
    valid: !reviewedIssues.some((issue) => issue.severity === "ERROR"), readyToPublish: !reviewedIssues.some((issue) => issue.severity !== "WARNING"),
    issues: reviewedIssues, summaries: results.map((result) => result.summary), minimumCoverageMargin: coverage.minimumCoverageMargin, boundaryReservations,
  };
}
