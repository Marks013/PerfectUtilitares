import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { generationScenarioBasis, matchesHoursOnlyAssignments, validateHoursReferences } from "./hours-reference";
import { prepareGeneration } from "./generation";

function fixture() {
  const value = newInput("02", "Teste", "2026-11", 42);
  value.generationMode = "HOURS_ONLY"; value.startDate = "2026-11-02"; value.endDate = "2026-11-08";
  value.shifts = [{ id: "day", name: "Referência", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  value.employees = [{ ...newEmployee(42, "day"), id: "person", name: "Pessoa de teste", registration: "1", sector: "Loja", role: "Operador", activeFrom: "2020-01-01", scheduleMode: "TIMED" }];
  return value;
}
describe("reference-only and fixed-day contracts", () => {
  it.each([true, false])("warns about missing individual clocks and requires at least one real timed reference: %s", hasTimed => {
    const value = fixture(); value.simulation = true; value.needsRegeneration = false;
    value.policy.compensationAuthorized = true;
    if (!hasTimed) { value.employees[0].scheduleMode = "MISSING"; value.employees[0].shiftIds = []; }
    value.employees.push({ ...value.employees[0], id: "missing", registration: "2", scheduleMode: "MISSING", shiftIds: [] });
    value.generationBasis = generationScenarioBasis(value);
    const original = structuredClone(value), result = validateHoursReferences(value);
    expect(result.valid).toBe(hasTimed);
    expect(result.readyToPublish).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "EMPLOYEE_SHIFT_PENDING", employeeId: "missing", severity: "WARNING" }));
    expect(result.issues.some(issue => issue.code === "HOURS_REFERENCE_PENDING" && issue.severity === "ERROR")).toBe(!hasTimed);
    expect(value).toEqual(original);
    expect(value.employees[1].scheduleMode).toBe("MISSING");
    expect(value.employees[1].shiftIds).toEqual([]);
  });
  it("still blocks an invalid selected timed clock when another person is missing a reference", () => {
    const value = fixture(); value.simulation = true; value.needsRegeneration = false;
    value.policy.compensationAuthorized = true;
    value.employees.push({ ...value.employees[0], id: "missing", registration: "2", scheduleMode: "MISSING", shiftIds: [] });
    value.shifts[0].segments[2].end = 1300;
    value.generationBasis = generationScenarioBasis(value);
    const result = validateHoursReferences(value);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "STORE_CLOSING_EXCEEDED", employeeId: "person", severity: "ERROR" }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "EMPLOYEE_SHIFT_PENDING", employeeId: "missing", severity: "WARNING" }));
  });
  it.each([40, 44] as const)("ignores the hidden mixed-42 sector selection at %s hours", hours => {
    const value = fixture(); value.defaultWeeklyHours = hours;
    expect(generationScenarioBasis({ ...value, mixed42Sectors: ["Loja"] })).toBe(generationScenarioBasis({ ...value, mixed42Sectors: [] }));
  });
  it("does not claim readiness from untimed or missing clocks", () => {
    const value = fixture(); value.shifts = []; value.employees[0].shiftIds = []; value.employees[0].scheduleMode = "UNTIMED";
    value.generationBasis = generationScenarioBasis(value);
    const result = validateHoursReferences(value);
    expect(result.valid).toBe(false); expect(result.readyToPublish).toBe(false);
    expect(result.issues.some(issue => issue.code === "HOURS_REFERENCE_PENDING")).toBe(true);
  });
  it("marks changed clocks stale even with no assignments", () => {
    const value = fixture(); value.generationBasis = generationScenarioBasis(value);
    value.shifts[0].segments[2].end = 1020;
    expect(validateHoursReferences(value).issues.some(issue => issue.code === "SCENARIO_OUTDATED")).toBe(true);
  });
  it("keeps every excluded employee cell in clock-only preparation", () => {
    const value = fixture(); value.employees[0].role = "Jovem Aprendiz";
    value.assignments = [{ employeeId: "person", date: "2026-11-02", kind: "WORK", shiftId: "day" },
      { employeeId: "person", date: "2026-11-03", kind: "OFF" },
      { employeeId: "person", date: "2026-11-04", kind: "ABSENCE", locked: true },
      { employeeId: "person", date: "2026-11-05", kind: "HOLIDAY" }];
    expect(prepareGeneration(value).input.assignments).toEqual(value.assignments);
  });
  it("allows an unlocked work clock change but rejects dropped dates, reclassification and lock changes", () => {
    const value = fixture(); value.assignments = [{ employeeId: "person", date: "2026-11-02", kind: "WORK", shiftId: "day" },
      { employeeId: "person", date: "2026-11-03", kind: "ABSENCE", locked: true }];
    const next = structuredClone(value); next.assignments[0].shiftId = "other";
    expect(matchesHoursOnlyAssignments(value, next)).toBe(true);
    next.assignments[1].locked = false;
    expect(matchesHoursOnlyAssignments(value, next)).toBe(false);
    next.assignments.pop(); expect(matchesHoursOnlyAssignments(value, next)).toBe(false);
    next.assignments = [{ ...value.assignments[0], kind: "OFF" }, value.assignments[1]];
    expect(matchesHoursOnlyAssignments(value, next)).toBe(false);
  });
});
