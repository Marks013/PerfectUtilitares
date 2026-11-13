import { z } from "zod";
import { EscalaSolverError } from "./solver-errors";
import { requestSolver, type SolverOptions } from "./solver-transport";
export { EscalaSolverError } from "./solver-errors";
import { escalaInputSchema } from "./schema";
import { dateRange } from "./dates";
import type { EscalaInput, EscalaSolveResult } from "./types";
import { refineRoster } from "./roster-refinement";
import { restPairSummary } from "./rest-quality";
import { selectVerifiedRoster } from "./roster-quality";
import { validateEscala } from "./validation";
import { matchesHoursOnlyAssignments } from "./hours-reference";
import { logSolverRejection } from "./solver-diagnostics";
import { EscalaError } from "./errors";

import { manualAssignmentIssues } from "./shift-catalog/manual-override";
const objectiveName = z.enum(["COVERAGE", "MOVEMENT_COVERAGE", "SUNDAY_COVERAGE", "CLOSING_COVERAGE", "REST_DISTRIBUTION", "WEEKEND_BALANCE", "SUNDAY_BALANCE", "LEADERSHIP", "REST_SPACING", "UNTIMED_ROTATION", "SATURDAY_BALANCE", "REST_ROTATION", "PEOPLE_CHANGED", "STABILITY", "PREFERENCES", "TIE_BREAK", "SECONDARY_POLISH"]);

const resultSchema = z.strictObject({
  status: z.enum(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID"]),
  message: z.string().max(1000),
  wallTimeSeconds: z.number().finite().min(0).max(60),
  solverDiagnostics: z.array(z.strictObject({
    family: z.enum(["AVAILABILITY", "BLOCKS", "DAYS_WORKED", "WEEKLY_MINUTES", "COVERAGE", "REST"]), message: z.string().min(1).max(500),
    dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(42).optional(),
  })).max(12).optional(),
  optimization: z.strictObject({
    budgetSeconds: z.number().finite().min(0).max(60),
    constructionSeconds: z.number().finite().min(0).max(60).optional(),
    feasibilitySeconds: z.number().finite().min(0).max(60).optional(),
    refinementSeconds: z.number().finite().min(0).max(60).optional(),
    stopReason: z.string().max(100).optional(),
    leadership: z.strictObject({
      criticalSectorDays: z.number().int().min(0).max(10500),
      criticalSectorDaysWithoutLeader: z.number().int().min(0).max(10500),
      prioritizedSectorDays: z.number().int().min(0).max(10500),
      prioritizedSectorDaysWithoutLeader: z.number().int().min(0).max(10500),
      timedCoverageIncluded: z.literal(false),
    }).optional(),
    unattemptedObjectives: z.array(objectiveName).max(16).optional(),
    phases: z.array(z.strictObject({
      objective: objectiveName,
      status: z.enum(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID"]),
      wallTimeSeconds: z.number().finite().min(0).max(60),
      budgetSeconds: z.number().finite().min(0).max(60),
      incumbentValue: z.number().finite().int(),
      bestBound: z.number().finite().optional(),
      searchScope: z.enum(["GLOBAL", "SELECTED_PEOPLE", "ROLLING_WEEKS", "ROLLING_WEEK"]).optional(),
      initialValue: z.number().finite().int().optional(),
      workers: z.union([z.literal(1), z.literal(2)]).optional(),
      linearizationLevel: z.number().int().min(0).max(2).optional(),
      symmetryLevel: z.number().int().min(0).max(2).optional(),
      movableWeeks: z.number().int().min(1).max(6).optional(),
      movablePeople: z.number().int().min(1).max(250).optional(),
      members: z.array(z.strictObject({
        objective: objectiveName.exclude(["SECONDARY_POLISH"]),
        initialValue: z.number().finite().int(),
        incumbentValue: z.number().finite().int(),
      }).refine(member => member.incumbentValue <= member.initialValue, "O polimento não pode piorar um objetivo protegido")).min(1).max(10).optional(),
    }).superRefine((phase, context) => {
      if ((phase.objective === "SECONDARY_POLISH") !== Boolean(phase.members)) {
        context.addIssue({ code: "custom", path: ["members"], message: "Informe os objetivos somente para a fase conjunta" });
      }
      if (phase.members && new Set(phase.members.map(member => member.objective)).size !== phase.members.length) {
        context.addIssue({ code: "custom", path: ["members"], message: "Objetivos conjuntos duplicados" });
      }
    // Operational rest objectives and at most four bounded sector repairs.
    })).max(20),
  }).optional(),
  assignments: z.array(z.strictObject({
    employeeId: z.string().max(100), date: z.string().max(10),
    kind: z.enum(["WORK", "DUTY", "OFF", "ABSENCE", "HOLIDAY"]),
    shiftId: z.string().max(100).optional(), locked: z.boolean().optional(),
  })).max(10500),
});

/** Pending days are permitted in drafts, never in an incumbent used to replace a calculated roster. */
function verifiedCompleteRoster(input: EscalaInput): boolean {
  if (!input.assignments.length) return false;
  const assigned = new Set(input.assignments.map(day => `${day.employeeId}\0${day.date}`));
  const dates = dateRange(input.startDate, input.endDate);
  if (!input.employees.every(person => person.planningEnabled === false || dates.every(date =>
    date < person.activeFrom || Boolean(person.activeUntil && date > person.activeUntil) || assigned.has(`${person.id}\0${date}`)))) return false;
  const validation = validateEscala(input);
  return validation.valid && !validation.issues.some(issue => issue.code === "DAY_PENDING");
}

export async function solveEscala(
  input: EscalaInput,
  options?: SolverOptions,
): Promise<EscalaSolveResult> {
  const started = performance.now();
  const parsed = escalaInputSchema.parse(input);
  // Cheap verified day exchanges seed the bounded optimizer without changing its staffing target.
  if (options?.signal?.aborted) throw new EscalaSolverError("SOLVER_CANCELLED");
  let refined: EscalaInput;
  try {
    // Clock-only generation must compare against the original days, even if moving rest days could improve their spacing.
    refined = parsed.generationMode === "HOURS_ONLY" ? parsed : verifiedCompleteRoster(parsed)
      ? selectVerifiedRoster(parsed, refineRoster(parsed)).input : refineRoster(parsed);
  } catch {
    logSolverRejection("refinement", "REFINEMENT_FAILED");
    throw new EscalaSolverError("SOLVER_REFINEMENT_FAILED");
  }
  // Never discard an established roster merely because a new rest criterion needs local repair.
  // An unrestricted fallback from an invalid old seed can lose its protected staffing quality.
  const initialValidation = validateEscala(parsed);
  if (initialValidation.issues.some(issue => issue.code === "CONSECUTIVE_REST_LIMIT")
    && !initialValidation.issues.some(issue => issue.severity === "ERROR" && issue.code !== "CONSECUTIVE_REST_LIMIT")
    && !validateEscala(refined).valid) {
    throw new EscalaError(409, "ESCALA_REST_REPAIR_PENDING", "O cálculo não encontrou, no prazo disponível, uma redistribuição das folgas que preservasse a cobertura. A grade salva foi mantida; confira as folgas e os horários desse setor antes de aplicar outra proposta.");
  }
  const preparationSeconds = (performance.now() - started) / 1000;
  const payload = await requestSolver(parsed, {
    ...options,
    initialAssignments: refined === parsed || !verifiedCompleteRoster(refined) ? undefined : refined.assignments,
  });
  let stage = "result-schema", reason = "SCHEMA_INVALID";
  let details: Parameters<typeof logSolverRejection>[2];
  const retained = new Set(parsed.employees.filter(person => person.planningEnabled === false).map(person => person.id));
  const preserveExcluded = (day: EscalaInput["assignments"][number]) => retained.has(day.employeeId)
    && (parsed.generationMode === "HOURS_ONLY" || day.kind === "HOLIDAY");
  try {
    const result = resultSchema.parse(payload);
    if (result.status === "FEASIBLE" || result.status === "OPTIMAL") {
      const previous = new Map(parsed.assignments.map(day => [`${day.employeeId}\0${day.date}`, day]));
      const excluded = new Set(parsed.employees.filter(person => person.planningEnabled === false).map(person => person.id));
      result.assignments = result.assignments.map(day => {
        const old = previous.get(`${day.employeeId}\0${day.date}`);
        if (day.locked === true && !old?.locked) {
          stage = "preservation"; reason = "LOCK_CHANGED"; throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
        }
        if (excluded.has(day.employeeId) || ["ABSENCE", "HOLIDAY"].includes(day.kind) || old?.locked) {
          const same = old?.kind === day.kind && old.shiftId === day.shiftId
            && (day.locked === old.locked || day.locked === undefined && old.locked === false);
          return same ? (old as NonNullable<typeof old>) : day;
        }
        if (old && old.locked === undefined) {
          if (old.kind === day.kind && old.shiftId === day.shiftId) return old;
          const { locked: _locked, ...unmarked } = day; return unmarked;
        }
        return day.locked === undefined ? { ...day, locked: false } : day;
      });
    }
    if (["OPTIMAL", "FEASIBLE"].includes(result.status)) {
      // Revalidate references and dates, independently of the processor's contract.
      stage = "assignment-schema";
      escalaInputSchema.parse({ ...parsed, assignments: result.assignments });
      if (manualAssignmentIssues({ ...parsed, assignments: result.assignments }, parsed.assignments).length) throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
      const assignments = new Map(result.assignments.map((item) => [`${item.employeeId}\0${item.date}`, item]));
      let expected = parsed.assignments.filter(item => retained.has(item.employeeId)
        && (parsed.generationMode === "HOURS_ONLY" || item.locked || item.kind === "ABSENCE" || item.kind === "HOLIDAY")).length;
      for (const person of parsed.employees) {
        stage = "completeness"; reason = "MISSING_ACTIVE_DATE";
        details = { actual: result.assignments.length };
        if (person.planningEnabled === false) continue;
        for (const day of dateRange(parsed.startDate, parsed.endDate)) {
          if (day < person.activeFrom || (person.activeUntil && day > person.activeUntil)) continue;
          expected++;
          if (!assignments.has(`${person.id}\0${day}`)) throw new Error("Incomplete processor result");
        }
      }
      reason = "ASSIGNMENT_COUNT"; details = { expected, actual: result.assignments.length };
      if (expected !== result.assignments.length) throw new Error("Unexpected processor assignments");
      stage = "preservation"; details = undefined;
      for (const previous of parsed.assignments) {
        const proposed = assignments.get(`${previous.employeeId}\0${previous.date}`);
        reason = "ABSENCE_CHANGED";
        if (previous.kind === "ABSENCE" && (proposed?.kind !== "ABSENCE" || proposed.locked !== previous.locked)) throw new Error("Changed absence");
        if (previous.kind === "HOLIDAY" && (proposed?.kind !== "HOLIDAY" || proposed.locked !== previous.locked)) throw new Error("Changed closed holiday");
        reason = "PROTECTED_ASSIGNMENT_CHANGED";
        if (preserveExcluded(previous) && (proposed?.kind !== previous.kind || proposed.shiftId !== previous.shiftId || proposed.locked !== previous.locked)) throw new Error("Changed excluded record");
        reason = "LOCK_CHANGED";
        if (previous.locked && (proposed?.kind !== previous.kind || proposed.shiftId !== previous.shiftId || !proposed.locked)) throw new Error("Changed locked day");
      }
    } else if (result.assignments.length) {
      stage = "completeness"; reason = "UNEXPECTED_ASSIGNMENTS"; details = { actual: result.assignments.length, expected: 0 };
      throw new Error("Unexpected assignments on unsuccessful solve");
    }
    if (options?.signal?.aborted) throw new EscalaSolverError("SOLVER_CANCELLED");
    if (result.status === "FEASIBLE" || result.status === "OPTIMAL") {
      stage = "selection-recheck"; reason = "RECHECK_FAILED"; details = undefined;
      const candidate = { ...parsed, assignments: result.assignments };
      const selected = verifiedCompleteRoster(refined) ? selectVerifiedRoster(refined, candidate)
        : { input: candidate, retainedReference: false };
      // A selector without a valid incumbent can return the proposal unchanged. It is never proof of feasibility.
      stage = "assignment-schema"; reason = "SCHEMA_INVALID";
      const finalInput = escalaInputSchema.parse({ ...parsed, assignments: selected.input.assignments });
      if (manualAssignmentIssues(finalInput, parsed.assignments).length) throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
      const finalDays = new Map(finalInput.assignments.map(day => [`${day.employeeId}\0${day.date}`, day]));
      stage = "preservation"; reason = "PROTECTED_ASSIGNMENT_CHANGED";
      if (parsed.assignments.some(day => {
        const next = finalDays.get(`${day.employeeId}\0${day.date}`);
        return day.kind === "ABSENCE" && next?.kind !== "ABSENCE"
          || day.kind === "HOLIDAY" && next?.kind !== "HOLIDAY"
          || preserveExcluded(day) && (next?.kind !== day.kind || next.shiftId !== day.shiftId || next.locked !== day.locked)
          || day.locked && (next?.kind !== day.kind || next.shiftId !== day.shiftId || !next.locked);
      })) throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
      const finalValidation = validateEscala(finalInput);
      stage = "independent-validation"; reason = "RULES_INVALID";
      details = { issues: finalValidation.issues };
      if (!finalValidation.valid || finalValidation.issues.some(issue => issue.code === "DAY_PENDING")
        || !matchesHoursOnlyAssignments(parsed, finalInput)) {
        if (finalValidation.valid && !finalValidation.issues.some(issue => issue.code === "DAY_PENDING")) reason = "HOURS_ONLY_CHANGED";
        throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
      }
      if (options?.signal?.aborted) throw new EscalaSolverError("SOLVER_CANCELLED");
      stage = "result-recheck"; reason = "RECHECK_FAILED"; details = undefined;
      const restQuality = {
        before: restPairSummary(parsed), after: restPairSummary(selected.input),
        search: { attempted: refined.assignments !== parsed.assignments || (result.optimization?.phases.some(phase => phase.objective === "REST_SPACING") ?? false),
          retainedReference: selected.retainedReference },
        preparationSeconds: Math.round(preparationSeconds * 1000) / 1000,
        requestSeconds: Math.round((performance.now() - started)) / 1000,
      };
      if (selected.retainedReference) return {
        status: "FEASIBLE", assignments: selected.input.assignments, wallTimeSeconds: result.wallTimeSeconds, restQuality,
        message: "A alternativa calculada piorou uma condição protegida. Mantivemos a melhor grade verificada, sem alterar a cobertura, os bloqueios ou os afastamentos.",
      };
      return { ...result, assignments: finalInput.assignments, restQuality };
    }
    return result;
  } catch (error) {
    if (!(error instanceof EscalaSolverError) || error.code === "SOLVER_INVALID_RESPONSE") {
      logSolverRejection(stage, reason, { ...details, issues: error instanceof z.ZodError ? error.issues : details?.issues });
    }
    if (error instanceof EscalaSolverError) throw error;
    throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
  }
}
