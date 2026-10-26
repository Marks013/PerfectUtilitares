import type { EscalaInput, EscalaIssue, EscalaValidation } from "./types";
import { escalaInputSchema } from "./schema";
import { sortEmployees } from "./order";
import { fixedBoundaryReservations } from "./boundary";
import { validateEmployee } from "./validation-employee";
import { validateCoverage, validateJourney, workJourney, type WorkJourney } from "./validation-time";

/** Recalculates from assignments, without trusting optimizer totals or feasibility. */
export function validateEscala(rawInput: EscalaInput): EscalaValidation {
  const parsed = escalaInputSchema.safeParse(rawInput);
  if (!parsed.success) return {
    valid: false, readyToPublish: false, summaries: [], minimumCoverageMargin: null,
    issues: parsed.error.issues.slice(0, 50).map((entry) => ({ code: "INPUT_INVALID", severity: "ERROR", message: `${entry.path.join(".")}: ${entry.message}` })),
  };
  const input = parsed.data;
  const issues: EscalaIssue[] = [];
  if (!input.employees.length) issues.push({ code: "EMPLOYEES_PENDING", severity: "PENDING", message: "Cadastre os colaboradores da filial." });
  else if (!input.employees.some((person) => person.activeFrom <= input.endDate && (!person.activeUntil || person.activeUntil >= input.startDate))) issues.push({ code: "ACTIVE_EMPLOYEES_PENDING", severity: "PENDING", message: "Nenhum colaborador tem vínculo ativo neste período." });
  if (!input.shifts.length) issues.push({ code: "SHIFTS_PENDING", severity: "PENDING", message: "Cadastre os horários permitidos antes de gerar a escala." });
  if (!input.policy.reviewed || !input.policy.source || !input.policy.reviewedBy) issues.push({ code: "POLICY_PENDING", severity: "PENDING", message: "Confira a norma aplicável, sua fonte e o responsável pela validação antes da publicação." });
  if (input.policy.validFrom > input.startDate || input.policy.validUntil < input.endDate) issues.push({ code: "POLICY_VALIDITY", severity: "PENDING", message: "A vigência da norma não abrange todo o período da escala." });
  const shifts = new Map(input.shifts.map((shift) => [shift.id, shift]));
  const journeys: WorkJourney[] = [];
  const assignments = [...input.employees.flatMap((person) => person.history), ...input.assignments];
  for (const assignment of assignments) {
    if (assignment.kind !== "WORK") continue;
    const shift = shifts.get(assignment.shiftId ?? "");
    if (!shift) continue; // Schema reports every unresolved reference.
    try {
      const journey = workJourney(assignment, shift);
      journeys.push(journey);
      if (assignment.date >= input.startDate) issues.push(...validateJourney(input, journey));
      else if (journey.occupiedDates.some((day) => day >= input.startDate)) {
        issues.push(...validateJourney(input, journey).filter((issue) => (issue.code === "CLOSED_DATE" || issue.code === "HOLIDAY_WORK") && issue.date && issue.date >= input.startDate));
      }
    } catch {
      issues.push({ code: "CIVIL_TIME_INVALID", severity: "ERROR", employeeId: assignment.employeeId, date: assignment.date, message: "Horário inválido na transição do fuso; confira as datas e os horários reais." });
    }
  }
  const boundaryReservations = fixedBoundaryReservations(input);
  const results = sortEmployees(input.employees).map((person) => validateEmployee(input, person, journeys, boundaryReservations));
  issues.push(...results.flatMap((result) => result.issues));
  const coverage = validateCoverage(input, journeys);
  issues.push(...coverage.issues);
  return {
    valid: !issues.some((issue) => issue.severity === "ERROR"), readyToPublish: issues.length === 0,
    issues, summaries: results.map((result) => result.summary), minimumCoverageMargin: coverage.minimumCoverageMargin, boundaryReservations,
  };
}
