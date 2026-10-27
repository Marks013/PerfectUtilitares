import { z } from "zod";
import { escalaInputSchema } from "./schema";
import { dateRange } from "./dates";
import type { EscalaInput, EscalaSolveResult } from "./types";

const resultSchema = z.strictObject({
  status: z.enum(["OPTIMAL", "FEASIBLE", "INFEASIBLE", "UNKNOWN", "MODEL_INVALID"]),
  message: z.string().max(1000),
  wallTimeSeconds: z.number().finite().min(0).max(60),
  assignments: z.array(z.strictObject({
    employeeId: z.string().max(100), date: z.string().max(10),
    kind: z.enum(["WORK", "DUTY", "OFF", "ABSENCE"]),
    shiftId: z.string().max(100).optional(), locked: z.boolean().optional(),
  })).max(10500),
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
): Promise<EscalaSolveResult> {
  const parsed = escalaInputSchema.parse(input);
  const base = process.env.ESCALAS_SOLVER_URL;
  if (!base) throw new EscalaSolverError("SOLVER_UNAVAILABLE");
  let response: Response;
  try {
    response = await fetch(new URL("/solve", base), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: parsed }),
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
    return result;
  } catch {
    throw new EscalaSolverError("SOLVER_INVALID_RESPONSE");
  }
}
