import { afterEach, describe, expect, it, vi } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { solveEscala } from "./solver-client";
import { requestSolver } from "./solver-transport";
import * as refinement from "./roster-refinement";
import { validateEscala } from "./validation";
import { compareRosterCoverage, isReusableRoster } from "./roster-quality";
import { matchesRestOnlyReferences } from "./generation";
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
  it("retains a verified draft and removes optimality metadata when the alternative worsens the protected peak", async () => {
    const input = fixture();
    input.demands[1].minimum = 5;
    expect(validateEscala(input).valid).toBe(true);
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    const assignments = input.assignments.map(record => record.employeeId === "a" && record.date === "2026-11-03" ? { ...record, kind: "WORK" as const, shiftId: "day" }
      : record.employeeId === "a" && record.date === "2026-11-04" ? { employeeId: record.employeeId, date: record.date, kind: "OFF" as const } : record);
    vi.mocked(requestSolver).mockResolvedValue({ status: "OPTIMAL", message: "Model optimum", assignments, wallTimeSeconds: 1,
      optimization: { budgetSeconds: 12, phases: [{ objective: "REST_SPACING", status: "OPTIMAL", budgetSeconds: 1, wallTimeSeconds: 1, incumbentValue: 0 }] } });
    const result = await solveEscala(input);
    expect(result.status).toBe("FEASIBLE"); expect(result.assignments).toEqual(input.assignments);
    expect(result.optimization).toBeUndefined(); expect(result.restQuality?.search).toEqual({ attempted: true, retainedReference: true, retentionReason: "SECTOR_PEAK" });
    expect(result.restQuality?.after).toEqual(result.restQuality?.before);
  });
  it("delivers a feasible sector improvement without inventing optimality or retaining the old draft", async () => {
    const input = fixture(), original = structuredClone(input);
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    const assignments = input.assignments.map(record => record.employeeId === "a" && record.date === "2026-11-03" ? { ...record, kind: "WORK" as const, shiftId: "day" }
      : record.employeeId === "a" && record.date === "2026-11-04" ? { employeeId: record.employeeId, date: record.date, kind: "OFF" as const } : record);
    const optimization = { budgetSeconds: 12, phases: [{ objective: "REST_SPACING" as const, status: "FEASIBLE" as const, budgetSeconds: 1, wallTimeSeconds: 1, incumbentValue: 0 }] };
    vi.mocked(requestSolver).mockResolvedValue({ status: "FEASIBLE", message: "Verified improvement", assignments, wallTimeSeconds: 1, optimization });
    const result = await solveEscala(input);
    expect(result.status).toBe("FEASIBLE");
    expect(result.assignments).toEqual(assignments);
    expect(validateEscala({ ...input, assignments: result.assignments }).valid).toBe(true);
    expect(result.optimization).toEqual(optimization);
    expect(result.restQuality?.search).toEqual({ attempted: true, retainedReference: false, retentionReason: "OPERATIONAL_IMPROVEMENT" });
    expect(input).toEqual(original);
  });
  it("compares against frozen original demand without sending or rewriting that ruler", async () => {
    const input = fixture(), qualityReference = structuredClone(input);
    qualityReference.demands[1].minimum = 5;
    input.demands = input.demands.map(demand => ({ ...demand, minimum: 0 }));
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    const assignments = input.assignments.map(day => day.employeeId === "a" && day.date === "2026-11-03" ? { ...day, kind: "WORK" as const, shiftId: "day" }
      : day.employeeId === "a" && day.date === "2026-11-04" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" as const } : day);
    vi.mocked(requestSolver).mockResolvedValue({ status: "OPTIMAL", message: "Different ruler", assignments, wallTimeSeconds: 1 });
    const before = structuredClone(qualityReference), result = await solveEscala(input, { qualityReference });
    expect(result.assignments).toEqual(input.assignments);
    expect(result.status).toBe("FEASIBLE");
    expect(result.restQuality?.search.retentionReason).toBe("SECTOR_PEAK");
    expect(requestSolver).toHaveBeenCalledWith(expect.objectContaining({ demands: input.demands }), expect.not.objectContaining({ qualityReference: expect.anything() }));
    expect(qualityReference).toEqual(before);
  });
  it("keeps a valid repair and exposes the original-ruler tradeoff instead of restoring invalid pauses", async () => {
    const input = fixture(), qualityReference = structuredClone(input);
    input.demands = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map(date =>
      ({ id: date, date, sector: "Loja", start: 1080, end: 1140, minimum: 1, estimated: true }));
    qualityReference.demands = structuredClone(input.demands);
    qualityReference.shifts[0].segments[1].end = 900;
    qualityReference.shifts[0].segments[2].start = 900;
    qualityReference.shifts[0].segments[2].end = 1164;
    const originalValidation = validateEscala(qualityReference);
    expect(originalValidation.valid).toBe(true);
    expect(originalValidation.readyToPublish).toBe(false);
    expect(originalValidation.issues).toContainEqual(expect.objectContaining({ code: "MEAL_INTERVAL_EXCESSIVE", severity: "PENDING" }));
    expect(isReusableRoster(qualityReference)).toBe(false);
    expect(validateEscala(input).valid).toBe(true);
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    vi.mocked(requestSolver).mockResolvedValue({ status: "OPTIMAL", message: "Repaired", assignments: input.assignments, wallTimeSeconds: 1,
      optimization: { budgetSeconds: 1, phases: [] } });
    const original = structuredClone(qualityReference), result = await solveEscala(input, { qualityReference });
    expect(validateEscala({ ...input, assignments: result.assignments }).valid).toBe(true);
    expect(result.assignments).toEqual(input.assignments);
    expect(result.status).toBe("FEASIBLE");
    expect(result.optimization).toEqual({ budgetSeconds: 1, phases: [] });
    expect(result.restQuality?.search.retentionReason).toBe("REPAIR_TRADEOFF:SECTOR_COVERAGE");
    expect(result.restQuality?.search.retainedReference).toBe(false);
    expect(result.message).toContain("referência original congelada");
    expect(qualityReference).toEqual(original);
  });
  it("labels a changed workload non-comparable without restoring the old contract", async () => {
    const input = fixture(), qualityReference = structuredClone(input);
    input.defaultWeeklyHours = 40; input.employees.forEach(person => { person.weeklyHours = 40; });
    input.shifts[0].segments[2].end = 1020;
    expect(validateEscala(input).valid).toBe(true);
    const optimization = { budgetSeconds: 1, phases: [{ objective: "REST_SPACING" as const, status: "OPTIMAL" as const, budgetSeconds: 1, wallTimeSeconds: 1, incumbentValue: 0, bestBound: 0 }] };
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    vi.mocked(requestSolver).mockResolvedValue({ status: "OPTIMAL", message: "New workload", assignments: input.assignments, wallTimeSeconds: 1, optimization });
    const result = await solveEscala(input, { qualityReference });
    expect(result.status).toBe("OPTIMAL");
    expect(result.optimization).toEqual(optimization);
    expect(result.restQuality?.search.retainedReference).toBe(false);
    expect(result.restQuality?.search.retentionReason).toBe("REFERENCE_NOT_COMPARABLE");
    expect(result.message).toContain("não é comparável");
    expect(validateEscala({ ...input, assignments: result.assignments }).valid).toBe(true);
  });

  it("retains the valid current 40h leader while keeping the old 42h ruler explicitly non-comparable", async () => {
    const input = fixture();
    input.employees[0].role = "Encarregado";
    input.movementPriorities = [{ startDate: "2026-11-04", endDate: "2026-11-04", sector: "Loja", level: "HIGH" }];
    const qualityReference = structuredClone(input), original = structuredClone(qualityReference);
    input.defaultWeeklyHours = 40; input.employees.forEach(person => { person.weeklyHours = 40; });
    input.shifts[0].segments[2].end = 1020;
    const assignments = input.assignments.map(day => day.employeeId === "a" && day.date === "2026-11-03"
      ? { ...day, kind: "WORK" as const, shiftId: "day" }
      : day.employeeId === "a" && day.date === "2026-11-04" ? { employeeId: day.employeeId, date: day.date, kind: "OFF" as const } : day);
    expect(validateEscala(input).valid).toBe(true);
    expect(validateEscala({ ...input, assignments }).valid).toBe(true);
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    vi.mocked(requestSolver).mockResolvedValue({ status: "OPTIMAL", message: "Lost current leader", assignments, wallTimeSeconds: 1, optimization: { budgetSeconds: 1, phases: [] }, solverDiagnostics: [{ family: "REST", message: "Rejected alternative" }] });
    const result = await solveEscala(input, { qualityReference });
    expect(result.assignments).toEqual(input.assignments);
    expect(result.status).toBe("FEASIBLE");
    expect(result.restQuality?.search).toMatchObject({ retainedReference: true, retentionReason: "REFERENCE_NOT_COMPARABLE" });
    expect(result.message).toContain("não é comparável");
    expect(result.optimization).toBeUndefined();
    expect(result.solverDiagnostics).toBeUndefined();
    expect(validateEscala({ ...input, assignments: result.assignments }).valid).toBe(true);
    expect(input.employees.every(person => person.weeklyHours === 40)).toBe(true);
    expect(qualityReference).toEqual(original);
  });

  it.each(["DAYS_AND_HOURS", "REST_ONLY"] as const)("does not retain a late baseline over the current fixed early clock for coverage in %s", async mode => {
    const input = fixture(); input.generationMode = mode;
    input.shifts = [{ ...input.shifts[0], id: "early" }, { id: "late", name: "Tarde", segments: [
      { start: 600, end: 840, kind: "WORK" }, { start: 840, end: 900, kind: "BREAK" }, { start: 900, end: 1164, kind: "WORK" },
    ] }];
    input.employees.forEach(person => { person.shiftIds = ["early", "late"]; person.fixedImportedShiftId = "early"; });
    input.assignments = input.assignments.map(day => day.kind === "WORK" ? { ...day, shiftId: "late" } : day);
    input.demands = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"].map(date =>
      ({ id: date, date, sector: "Loja", start: 1080, end: 1140, minimum: 1, estimated: true }));
    const assignments = input.assignments.map(day => day.kind === "WORK" ? { ...day, shiftId: "early" } : day);
    const original = structuredClone(input), optimization = { budgetSeconds: 1, phases: [] };
    expect(validateEscala(input).valid).toBe(true);
    expect(validateEscala({ ...input, assignments }).valid).toBe(true);
    expect(matchesRestOnlyReferences(input, input.assignments)).toBe(false);
    expect(matchesRestOnlyReferences(input, assignments)).toBe(true);
    expect(compareRosterCoverage(input, { ...input, assignments })).toMatchObject({ comparable: true, regressed: true, reason: "SECTOR_COVERAGE" });
    vi.spyOn(refinement, "refineRoster").mockImplementation(value => value);
    vi.mocked(requestSolver).mockResolvedValue({ status: "FEASIBLE", message: "Current fixed clock", assignments, wallTimeSeconds: 1, optimization });
    const result = await solveEscala(input, { qualityReference: original });
    expect(result.assignments).toEqual(assignments);
    expect(result.assignments.filter(day => day.kind === "WORK").every(day => day.shiftId === "early")).toBe(true);
    expect(result.restQuality?.search.retainedReference).toBe(false);
    expect(result.message).toContain("referência original congelada");
    expect(result.optimization).toEqual(optimization);
    expect(input).toEqual(original);
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
