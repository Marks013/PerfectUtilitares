import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { validateCoverage as validateJourneyFacade } from "./validation-time";
import { validateCoverage as validateCoverageDirectly } from "./validation-coverage";

function input(estimated: boolean) {
  const current = newInput("08", "Loja sintética", "2026-11", 42);
  current.shifts = [{ id: "ref", name: "Horário sintético", segments: [
    { start: 480, end: 720, kind: "WORK" },
    { start: 720, end: 780, kind: "BREAK" },
    { start: 780, end: 1044, kind: "WORK" },
  ] }];
  current.employees = [{ ...newEmployee(42, "ref"), id: "p", name: "Pessoa sintética",
    registration: "0001", sector: "Frente", role: "Caixa", activeFrom: "2024-01-01" }];
  current.assignments = [{ employeeId: "p", date: "2026-11-04", kind: "OFF" }];
  current.demands = [{ id: "target", date: "2026-11-04", sector: "Frente",
    minimum: 1, start: 480, end: 720, estimated }];
  current.policy.closedDates = [];
  return current;
}

describe("coverage validator extraction preserves the public contract", () => {
  it.each([true, false])("facade and implementation agree for estimated=%s", estimated => {
    const plan = input(estimated);
    const copy = structuredClone(plan);
    const direct = validateCoverageDirectly(plan);
    expect(validateJourneyFacade(plan)).toEqual(direct);
    expect(plan).toEqual(copy);
    expect(direct.issues).toContainEqual(expect.objectContaining({
      code: estimated ? "ESTIMATED_COVERAGE_GAP" : "COVERAGE_DEFICIT",
      severity: estimated ? "WARNING" : "ERROR",
      date: "2026-11-04",
    }));
  });

  it("continues to distinguish a sector without timed service from a mandatory minimum", () => {
    const issues = validateCoverageDirectly(input(true)).issues;
    expect(issues).toContainEqual(expect.objectContaining({
      code: "ESTIMATED_SECTOR_EMPTY", severity: "WARNING",
    }));
    expect(issues.some(issue => issue.code === "COVERAGE_DEFICIT")).toBe(false);
  });
});
