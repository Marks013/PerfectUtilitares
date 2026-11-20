import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import { validateCoverage } from "./validation-time";

function scenario(estimated = true, minimum = 1) {
  const input = newInput("08", "Filial sintética", "2026-11", 42);
  input.shifts = [{ id: "s", name: "Turno", segments: [
    { start: 480, end: 720, kind: "WORK" },
    { start: 720, end: 780, kind: "BREAK" },
    { start: 780, end: 1044, kind: "WORK" },
  ] }];
  input.employees = [{
    id: "p", registration: "0001", name: "Pessoa sintética", role: "Repositor", sector: "Setor A",
    weeklyHours: 42, shiftIds: ["s"], activeFrom: "2025-01-01", offMode: "VARIABLE",
    fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1,
    preferredOffDays: [], historyKnown: false, history: [], scheduleMode: "TIMED",
  }];
  input.assignments = [{ employeeId: "p", date: "2026-11-04", kind: "OFF" }];
  input.demands = [{ id: "estimated", date: "2026-11-04", sector: "Setor A",
    minimum, start: 480, end: 1020, estimated }];
  input.policy.closedDates = [];
  return input;
}

describe("estimated zero-presence warning is distinct from mandatory coverage", () => {
  it("reports an empty timed sector in a positive estimate without changing the data or imposing a minimum", () => {
    const input = scenario();
    const before = structuredClone(input);
    const issues = validateCoverage(input).issues;
    expect(issues).toContainEqual(expect.objectContaining({
      code: "ESTIMATED_SECTOR_EMPTY", severity: "WARNING", date: "2026-11-04",
    }));
    expect(issues.some(issue => issue.code === "COVERAGE_DEFICIT")).toBe(false);
    expect(input).toEqual(before);
  });

  it("does not emit an empty-estimate warning for zero estimates, closed dates or a confirmed minimum", () => {
    const zero = scenario(true, 0);
    expect(validateCoverage(zero).issues.some(issue => issue.code === "ESTIMATED_SECTOR_EMPTY")).toBe(false);
    const closed = scenario();
    closed.policy.closedDates = ["2026-11-04"];
    expect(validateCoverage(closed).issues.some(issue => issue.code === "ESTIMATED_SECTOR_EMPTY")).toBe(false);
    const required = scenario(false);
    expect(validateCoverage(required).issues).toContainEqual(expect.objectContaining({
      code: "COVERAGE_DEFICIT", severity: "ERROR",
    }));
    expect(validateCoverage(required).issues.some(issue => issue.code === "ESTIMATED_SECTOR_EMPTY")).toBe(false);
  });

  it("does not count an UNTIMED collaborator as known hourly coverage", () => {
    const input = scenario();
    input.employees[0].scheduleMode = "UNTIMED";
    input.assignments = [{ employeeId: "p", date: "2026-11-04", kind: "DUTY" }];
    expect(validateCoverage(input).issues.some(issue => issue.code === "ESTIMATED_SECTOR_EMPTY")).toBe(true);
  });

  it("does not warn when an eligible worker covers the estimated interval", () => {
    const input = scenario();
    input.assignments = [{ employeeId: "p", date: "2026-11-04", kind: "WORK", shiftId: "s" }];
    input.demands[0].end = 720;
    expect(validateCoverage(input).issues.some(issue => issue.code === "ESTIMATED_SECTOR_EMPTY")).toBe(false);
  });
});
