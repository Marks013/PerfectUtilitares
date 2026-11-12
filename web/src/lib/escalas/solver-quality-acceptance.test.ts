import { afterEach, describe, expect, it, vi } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { solveEscala } from "./solver-client";
import { requestSolver } from "./solver-transport";
import * as refinement from "./roster-refinement";
import { validateEscala } from "./validation";
import { restPairSummary } from "./rest-quality";
vi.mock("./solver-transport", () => ({ requestSolver: vi.fn() }));
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const input = newInput("06", "Teste", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; delete input.visibleMonth;
  input.simulation = true; input.restRulesVersion = 1;
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.employees = ["a", "b"].map(id => ({ ...newEmployee(42, "day"), id, name: id, registration: id, sector: "Loja", role: "Operador", activeFrom: "2020-01-01" }));
  input.assignments = input.employees.flatMap(person => Array.from({ length: 7 }, (_, day) => {
    const off = (person.id === "a" ? [1, 6] : [5, 6]).includes(day);
    return { employeeId: person.id, date: `2026-11-0${day + 2}`, kind: off ? "OFF" as const : "WORK" as const, ...(!off ? { shiftId: "day" } : {}) };
  }));
  input.demands = [{ id: "tue", date: "2026-11-03", sector: "Loja", start: 480, end: 720, minimum: 3, estimated: true },
    { id: "wed", date: "2026-11-04", sector: "Loja", start: 480, end: 540, minimum: 2, estimated: true }];
  return input;
}
describe("verified processor quality delivery", () => {
  it("accepts preserved HOURS_ONLY days without refining a baseline with improvable rest spacing", async () => {
    const input = fixture(); input.generationMode = "HOURS_ONLY";
    const changedDays = input.assignments.map(day => day.employeeId === "a" && day.date === "2026-11-03"
      ? { ...day, kind: "WORK" as const, shiftId: "day" }
      : day.employeeId === "a" && day.date === "2026-11-07" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" as const } : day);
    const refined = { ...input, assignments: changedDays };
    expect(validateEscala(input).valid).toBe(true);
    expect(restPairSummary(refined).totalPairs).toBeGreaterThan(restPairSummary(input).totalPairs);
    const refine = vi.spyOn(refinement, "refineRoster").mockReturnValue(refined);
    vi.mocked(requestSolver).mockResolvedValue({ status: "FEASIBLE", message: "Preserved days", assignments: input.assignments, wallTimeSeconds: 1 });
    const original = structuredClone(input), result = await solveEscala(input);
    expect(refine).not.toHaveBeenCalled();
    expect(requestSolver).toHaveBeenCalledWith(expect.objectContaining({ generationMode: "HOURS_ONLY", assignments: original.assignments }), expect.objectContaining({ initialAssignments: undefined }));
    expect(result.status).toBe("FEASIBLE");
    expect(result.assignments).toEqual(original.assignments);
    expect(result.restQuality?.search.retainedReference).toBe(false);
    expect(input).toEqual(original);
  });
  it("rejects an invalid v2 result when the old Saturday roster is also invalid", async () => {
    const input = fixture(); input.restRulesVersion = 2;
    expect(validateEscala(input).valid).toBe(false);
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    vi.mocked(requestSolver).mockResolvedValue({ status: "OPTIMAL", message: "Rejected claim", assignments: input.assignments, wallTimeSeconds: 1 });
    await expect(solveEscala(input)).rejects.toMatchObject({ code: "SOLVER_INVALID_RESPONSE" });
  });
  it("accepts a valid Saturday repair even when there is no valid old incumbent", async () => {
    const input = fixture(); input.restRulesVersion = 2;
    const assignments = input.assignments.map(day => day.employeeId === "b" && day.date === "2026-11-06"
      ? { employeeId: day.employeeId, date: day.date, kind: "OFF" as const }
      : day.employeeId === "b" && day.date === "2026-11-07" ? { ...day, kind: "WORK" as const, shiftId: "day" } : day);
    expect(validateEscala({ ...input, assignments }).valid).toBe(true);
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    vi.mocked(requestSolver).mockResolvedValue({ status: "FEASIBLE", message: "Repaired", assignments, wallTimeSeconds: 1 });
    const result = await solveEscala(input);
    expect(result.assignments).toEqual(assignments);
    expect(validateEscala({ ...input, assignments: result.assignments }).valid).toBe(true);
  });
  it("keeps the entire valid incumbent when the alternative has too few workdays", async () => {
    const input = fixture();
    const assignments = input.assignments.map(day => day.employeeId === "a" && day.date === "2026-11-04"
      ? { employeeId: day.employeeId, date: day.date, kind: "OFF" as const } : day);
    expect(validateEscala({ ...input, assignments }).valid).toBe(false);
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    vi.mocked(requestSolver).mockResolvedValue({ status: "OPTIMAL", message: "Invalid", assignments, wallTimeSeconds: 1,
      solverDiagnostics: [{ family: "REST", message: "Rejected attempt" }], optimization: { budgetSeconds: 1, phases: [] } });
    const result = await solveEscala(input);
    expect(result.status).toBe("FEASIBLE"); expect(result.assignments).toEqual(input.assignments);
    expect(result.optimization).toBeUndefined(); expect(result.solverDiagnostics).toBeUndefined();
  });
  it("retains a successful verified draft and removes optimality metadata from a rejected alternative", async () => {
    const input = fixture(); expect(validateEscala(input).valid).toBe(true);
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    const assignments = input.assignments.map(record => record.employeeId === "a" && record.date === "2026-11-03" ? { ...record, kind: "WORK" as const, shiftId: "day" }
      : record.employeeId === "a" && record.date === "2026-11-04" ? { employeeId: record.employeeId, date: record.date, kind: "OFF" as const } : record);
    vi.mocked(requestSolver).mockResolvedValue({ status: "OPTIMAL", message: "Model optimum", assignments, wallTimeSeconds: 1,
      optimization: { budgetSeconds: 12, phases: [{ objective: "REST_SPACING", status: "OPTIMAL", budgetSeconds: 1, wallTimeSeconds: 1, incumbentValue: 0 }] } });
    const result = await solveEscala(input);
    expect(result.status).toBe("FEASIBLE"); expect(result.assignments).toEqual(input.assignments);
    expect(result.optimization).toBeUndefined(); expect(result.restQuality?.search).toEqual({ attempted: true, retainedReference: true });
    expect(result.restQuality?.after).toEqual(result.restQuality?.before);
  });
  it("delivers successful unchanged quality with independently derived counts and elapsed preparation", async () => {
    const input = fixture(); vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    vi.mocked(requestSolver).mockResolvedValue({ status: "FEASIBLE", message: "Valid", assignments: input.assignments, wallTimeSeconds: 1,
      optimization: { budgetSeconds: 12, phases: [{ objective: "REST_SPACING", status: "OPTIMAL", budgetSeconds: 0, wallTimeSeconds: 0, incumbentValue: 0 }] } });
    const result = await solveEscala(input);
    expect(result.status).toBe("FEASIBLE"); expect(result.assignments).toEqual(input.assignments);
    expect(result.restQuality?.after.totalPairs).toBe(1);
    expect(result.restQuality?.preparationSeconds).toBeGreaterThanOrEqual(0);
    expect(result.restQuality?.requestSeconds).toBeGreaterThanOrEqual(result.restQuality?.preparationSeconds ?? 0);
    expect(result.restQuality?.search.retainedReference).toBe(false);
    expect(result.restQuality?.search.attempted).toBe(true);
  });
});
