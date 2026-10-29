import type { EscalaInput, EscalaIssue, EscalaValidation } from "./types";
import { escalaInputSchema } from "./schema";
import { sortEmployees } from "./order";
import { fixedBoundaryReservations } from "./boundary";
import { validateEmployee } from "./validation-employee";
import { validateCoverage, validateJourney, validateUntimedDuty, workJourney, type WorkJourney } from "./validation-time";
import { CCT_FROM, CCT_UNTIL, SUPERMARKET_CCT, transitionWeeks } from "./labor-rules";

/** Recalculates from assignments, without trusting optimizer totals or feasibility. */
export function validateEscala(rawInput: EscalaInput): EscalaValidation {
  const parsed = escalaInputSchema.safeParse(rawInput);
  if (!parsed.success) return {
    valid: false, readyToPublish: false, summaries: [], minimumCoverageMargin: null,
    issues: parsed.error.issues.slice(0, 50).map((entry) => ({ code: "INPUT_INVALID", severity: "ERROR", message: `${entry.path.join(".")}: ${entry.message}` })),
  };
  const input = parsed.data;
  const issues: EscalaIssue[] = [];
  if (input.needsRegeneration) issues.push({ code: "SCENARIO_OUTDATED", severity: "PENDING", message: "O cenário foi alterado após a geração da grade. Gere e aplique uma nova proposta antes de exportar ou aprovar." });
  if (!input.employees.length) issues.push({ code: "EMPLOYEES_PENDING", severity: "PENDING", message: "Cadastre os colaboradores da filial." });
  else if (!input.employees.some((person) => person.planningEnabled !== false && person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate))) issues.push({ code: "ACTIVE_EMPLOYEES_PENDING", severity: "PENDING", message: "Nenhum colaborador está incluído na geração neste período." });
  if (!input.shifts.length && input.employees.some((person) => person.planningEnabled !== false && (person.scheduleMode !== "UNTIMED" && person.scheduleMode !== "MISSING"))) issues.push({ code: "SHIFTS_PENDING", severity: "PENDING", message: "Cadastre os horários permitidos antes de gerar a escala." });
  if (!input.policy.reviewed || !input.policy.source || !input.policy.reviewedBy) issues.push({ code: "POLICY_PENDING", severity: "PENDING", message: "Confira a norma aplicável, sua fonte e o responsável pela validação antes da publicação." });
  if (input.policy.validFrom > input.startDate || input.policy.validUntil < input.endDate) issues.push({ code: "POLICY_VALIDITY", severity: "PENDING", message: "A vigência da norma não abrange todo o período da escala." });
  if (input.policy.coverageReview === "SUGGESTED") issues.push({ code: "COVERAGE_REVIEW_PENDING", severity: "PENDING", message: "Confira a cobertura sugerida para a filial, inclusive faixas com mínimo zero. A estimativa da equipe não comprova a demanda operacional." });
  for (const date of transitionWeeks(input)) {
    if (!input.policy.transitionWeekAccepted) issues.push({ code: "TRANSITION_WEEK_PENDING", severity: "PENDING", date,
      message: "Esta semana atravessa uma redução legal da carga. Confirme a adoção antecipada do menor limite para a semana completa; não foi inventado rateio diário." });
  }
  if (input.policy.normativeProfile === SUPERMARKET_CCT) {
    if (input.startDate < CCT_FROM || input.endDate > CCT_UNTIL) issues.push({ code: "CCT_VALIDITY", severity: "PENDING", message: "A CCT PR003084/2026 vale de 01/06/2026 a 31/05/2027. Cadastre o instrumento sucessor antes de publicar fora dessa vigência." });
    if (input.policy.holidayRestAllowed) issues.push({ code: "CCT_HOLIDAY_REST", severity: "ERROR", message: "A cláusula 29 da CCT de supermercados veda compensar o DSR em feriado." });
  }
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const journeys: WorkJourney[] = [];
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
      const journey = workJourney(assignment, shift);
      journeys.push(journey);
      if (assignment.date >= input.startDate && assignment.date <= input.endDate) issues.push(...validateJourney(input, journey));
      else if (assignment.date < input.startDate && journey.occupiedDates.some((day) => day >= input.startDate && day <= input.endDate)) {
        issues.push(...validateJourney(input, journey).filter((issue) => (issue.code === "CLOSED_DATE" || issue.code === "HOLIDAY_WORK") && issue.date && issue.date >= input.startDate && issue.date <= input.endDate));
      }
    } catch {
      issues.push({ code: "CIVIL_TIME_INVALID", severity: "ERROR", employeeId: assignment.employeeId, date: assignment.date, message: "Horário inválido na transição do fuso; confira as datas e os horários reais." });
    }
  }
  const boundaryReservations = fixedBoundaryReservations(input);
  const results = sortEmployees(input.employees).map((person) => validateEmployee(input, person, journeys, boundaryReservations));
  issues.push(...results.flatMap((result) => result.issues));
  if (input.simulation) {
    const evidencePending = new Set(["COMPENSATION_REQUIRED", "COLLECTIVE_AGREEMENT_REQUIRED", "HOLIDAY_WORK", "CCT_SUNDAY_CERTIFICATE", "CCT_HOLIDAY_CERTIFICATE", "CCT_NIGHT_CERTIFICATE"]);
    for (const issue of issues) if (evidencePending.has(issue.code) && issue.severity === "ERROR") issue.severity = "PENDING";
  }
  for (const person of input.employees) if (person.planningEnabled !== false && person.simulationDailyMinutes !== undefined) issues.push({
    code: "SHORT_REFERENCE_PRESERVED", severity: "PENDING", employeeId: person.id,
    message: "Referência curta preservada na simulação, sem ampliação automática. A carga contratual individual não consta no arquivo e precisa de conferência antes da aplicação.",
  });
  const coverage = validateCoverage(input, journeys);
  issues.push(...coverage.issues);
  return {
    valid: !issues.some((issue) => issue.severity === "ERROR"), readyToPublish: !issues.some((issue) => issue.severity !== "WARNING"),
    issues, summaries: results.map((result) => result.summary), minimumCoverageMargin: coverage.minimumCoverageMargin, boundaryReservations,
  };
}
