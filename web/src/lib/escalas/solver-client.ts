import { z } from "zod";
import { escalaInputSchema } from "./schema";
import { addDays, dateRange, dayOfWeek, isDate } from "./dates";
import type { EscalaInput, EscalaSolveResult } from "./types";

const resultSchema = z.strictObject({
  status: z.enum(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID"]),
  message: z.string().max(1000),
  wallTimeSeconds: z.number().finite().min(0).max(60),
  assignments: z.array(z.strictObject({
    employeeId: z.string().max(100), date: z.string().max(10),
    kind: z.enum(["WORK", "OFF", "ABSENCE"]),
    shiftId: z.string().max(100).optional(), locked: z.boolean().optional(),
  })).max(6300),
});

export class EscalaSolverError extends Error {
  constructor(public readonly code: "SOLVER_BUSY" | "SOLVER_UNAVAILABLE" | "SOLVER_INVALID_RESPONSE") {
    super(code === "SOLVER_BUSY"
      ? "Há uma análise de escalas em andamento. Aguarde alguns segundos e tente novamente."
      : "O serviço de escalas está indisponível. Sua proposta foi preservada; tente novamente.");
    this.name = "EscalaSolverError";
  }
}

export async function solveEscala(
  input: EscalaInput,
  force: { employeeId?: string; offDates?: string[]; weekStart?: string; excludedOffPairs?: string[][] } = {},
): Promise<EscalaSolveResult> {
  const parsed = escalaInputSchema.parse(input);
  if (force.employeeId && !parsed.employees.some((person) => person.id === force.employeeId)) {
    throw new Error("Colaborador da sugestão não pertence à escala.");
  }
  if (force.offDates?.some((day) => !isDate(day) || day < input.startDate || day > input.endDate)
    || (force.offDates?.length ?? 0) > 2 || new Set(force.offDates).size !== (force.offDates?.length ?? 0)
    || ((force.offDates?.length || force.weekStart || force.excludedOffPairs?.length) && !force.employeeId)) {
    throw new Error("Selecione até duas folgas dentro do período.");
  }
  if (force.weekStart && (!isDate(force.weekStart) || dayOfWeek(force.weekStart) !== 0
    || force.weekStart < input.startDate || addDays(force.weekStart, 6) > input.endDate)) {
    throw new Error("A semana da sugestão deve estar inteiramente na escala.");
  }
  if ((force.excludedOffPairs?.length ?? 0) > 2 || force.excludedOffPairs?.some((pair) => pair.length !== 2
    || pair[0] === pair[1] || pair.some((day) => !isDate(day) || !force.weekStart || day < force.weekStart || day > addDays(force.weekStart, 6)))) {
    throw new Error("Alternativas anteriores da sugestão são inválidas.");
  }
  const base = process.env.ESCALAS_SOLVER_URL;
  if (!base) throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  let response: Response;
  try {
    response = await fetch(new URL("/solve", base), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: parsed, force }),
      signal: AbortSignal.timeout(20_000), cache: "no-store",
    });
  } catch {
    throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  }
  if (response.status === 429) throw new EscalaSolverError("SOLVER_BUSY");
  if (!response.ok) throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  try {
    const result = resultSchema.parse(await response.json());
    if (["OPTIMAL", "FEASIBLE"].includes(result.status)) {
      // Revalidate references and dates, independently of the processor's contract.
      escalaInputSchema.parse({ ...parsed, assignments: result.assignments });
      const assignments = new Map(result.assignments.map((item) => [`${item.employeeId}\0${item.date}`, item]));
      let expected = 0;
      for (const person of parsed.employees) {
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
      for (const day of force.offDates ?? []) {
        if (assignments.get(`${force.employeeId}\0${day}`)?.kind !== "OFF") throw new Error("Missing requested rest");
      }
    } else if (result.assignments.length) {
      throw new Error("Unexpected assignments on unsuccessful solve");
    }
    return result;
  } catch {
    throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
  }
}
