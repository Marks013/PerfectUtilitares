import { z } from "zod";
import { EscalaSolverError } from "./solver-errors";
import { requestSolver, type SolverOptions } from "./solver-transport";
export { EscalaSolverError } from "./solver-errors";
import { escalaInputSchema } from "./schema";
import { dateRange } from "./dates";
import type { EscalaInput, EscalaSolveResult } from "./types";
import { refineRoster } from "./roster-refinement";

const objectiveName = z.enum(["COVERAGE", "SUNDAY_COVERAGE", "CLOSING_COVERAGE", "REST_DISTRIBUTION", "WEEKEND_BALANCE", "SUNDAY_BALANCE", "SATURDAY_BALANCE", "REST_ROTATION", "PEOPLE_CHANGED", "STABILITY", "PREFERENCES", "TIE_BREAK", "SECONDARY_POLISH"]);

const resultSchema = z.strictObject({
  status: z.enum(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID"]),
  message: z.string().max(1000),
  wallTimeSeconds: z.number().finite().min(0).max(60),
  optimization: z.strictObject({
    budgetSeconds: z.number().finite().min(0).max(60),
    unattemptedObjectives: z.array(objectiveName).max(11).optional(),
    phases: z.array(z.strictObject({
      objective: objectiveName,
      status: z.enum(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID"]),
      wallTimeSeconds: z.number().finite().min(0).max(60),
      budgetSeconds: z.number().finite().min(0).max(60),
      incumbentValue: z.number().finite().int(),
      bestBound: z.number().finite().optional(),
      searchScope: z.enum(["GLOBAL", "SELECTED_PEOPLE", "ROLLING_WEEKS", "ROLLING_WEEK"]).optional(),
      initialValue: z.number().finite().int().optional(),
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
    // Eleven ordered objectives plus at most four bounded sector repairs.
    })).max(15),
  }).optional(),
  assignments: z.array(z.strictObject({
    employeeId: z.string().max(100), date: z.string().max(10),
    kind: z.enum(["WORK", "DUTY", "OFF", "ABSENCE"]),
    shiftId: z.string().max(100).optional(), locked: z.boolean().optional(),
  })).max(10500),
});

export async function solveEscala(
  input: EscalaInput,
  options?: SolverOptions,
): Promise<EscalaSolveResult> {
  const parsed = escalaInputSchema.parse(input);
  // Cheap verified day exchanges seed the bounded optimizer without changing its staffing target.
  if (options?.signal?.aborted) throw new EscalaSolverError("SOLVER_CANCELLED");
  let refined: EscalaInput;
  try {
    refined = refineRoster(parsed);
  } catch (error) {
    console.error({ event: "escala_refinement_failed", errorType: error instanceof Error ? error.name : "Unknown" });
    throw new EscalaSolverError("SOLVER_REFINEMENT_FAILED");
  }
  const payload = await requestSolver(parsed, {
    ...options,
    initialAssignments: refined === parsed ? undefined : refined.assignments,
  });
  try {
    const result = resultSchema.parse(payload);
    if (["OPTIMAL", "FEASIBLE"].includes(result.status)) {
      // Revalidate references and dates, independently of the processor's contract.
      escalaInputSchema.parse({ ...parsed, assignments: result.assignments });
      const assignments = new Map(result.assignments.map((item) => [`${item.employeeId}\0${item.date}`, item]));
      const retained = new Set(parsed.employees.filter(person => person.planningEnabled === false).map(person => person.id));
      let expected = parsed.assignments.filter(item => retained.has(item.employeeId) && (item.locked || item.kind === "ABSENCE")).length;
      for (const person of parsed.employees) {
        if (person.planningEnabled === false) continue;
        for (const day of dateRange(parsed.startDate, parsed.endDate)) {
          if (day < person.activeFrom || (person.activeUntil && day > person.activeUntil)) continue;
          expected++;
          if (!assignments.has(`${person.id}\0${day}`)) throw new Error("Incomplete processor result");
        }
      }
      if (expected !== result.assignments.length) throw new Error("Unexpected processor assignments");
      for (const previous of parsed.assignments) {
        const proposed = assignments.get(`${previous.employeeId}\0${previous.date}`);
        if (previous.kind === "ABSENCE" && proposed?.kind !== "ABSENCE") throw new Error("Changed absence");
        if (previous.locked && (proposed?.kind !== previous.kind || proposed.shiftId !== previous.shiftId || !proposed.locked)) throw new Error("Changed locked day");
      }
    } else if (result.assignments.length) {
      throw new Error("Unexpected assignments on unsuccessful solve");
    }
    if (options?.signal?.aborted) throw new EscalaSolverError("SOLVER_CANCELLED");
    return result;
  } catch (error) {
    if (error instanceof EscalaSolverError) throw error;
    throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
  }
}
