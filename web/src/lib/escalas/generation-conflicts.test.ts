import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import { addDays, dateRange } from "./dates";
import { findGenerationConflicts } from "./generation-conflicts";
import type { EscalaInput } from "./types";

function fixture(): EscalaInput {
  const input = newInput("01", "Loja", "2026-11", 40);
  input.employees = [{ id: "p1", registration: "001", name: "Pessoa sintética", sector: "Loja", role: "Repositor", weeklyHours: 40, shiftIds: [input.shifts[0].id], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 2, preferredOffDays: [], historyKnown: false, history: [] }];
  input.demands = dateRange(input.startDate, addDays(input.startDate, 6)).flatMap(date => input.shifts[0].segments.filter(segment => segment.kind === "WORK").map((segment, index) => ({ id: date + "-" + index, date, sector: "Loja", role: "Repositor", start: segment.start, end: segment.end, minimum: 1, estimated: false })));
  return input;
}
describe("necessary generation conflicts", () => {
  it("proves required coverage above the available weekly hours without blaming locks", () => {
    const input = fixture(), before = JSON.stringify(input);
    expect(findGenerationConflicts(input)).toEqual([expect.objectContaining({ code: "COVERAGE_WEEKLY_CAPACITY", target: "coverage", sector: "Loja", role: "Repositor", message: expect.stringContaining("56h00") })]);
    expect(findGenerationConflicts(input)[0].message).toContain("40h00");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("uses the maximum concurrent minimum, not the sum of overlapping rows", () => {
    const input = fixture();
    input.demands = input.demands.filter(demand => demand.date <= addDays(input.startDate, 4));
    input.demands.push(...input.demands.map(demand => ({ ...demand, id: demand.id + "-duplicate" })));
    expect(findGenerationConflicts(input)).toEqual([]);
  });
  it("never promotes estimates, zeros or a global legacy confirmation into a hard requirement", () => {
    const input = fixture();
    input.policy.coverageReview = "CONFIRMED";
    input.demands = input.demands.map((demand, index) => index % 2 ? { ...demand, minimum: 0 } : { ...demand, estimated: true });
    expect(findGenerationConflicts(input)).toEqual([]);
  });
  it.each(["MISSING", "UNTIMED"] as const)("does not invent hourly coverage for %s", mode => {
    const input = fixture();
    input.employees[0].scheduleMode = mode;
    expect(findGenerationConflicts(input)[0].message).toContain("0h00");
  });
  it("does not count excluded workers or unavailable absence days", () => {
    const input = fixture();
    input.employees.push({ ...input.employees[0], id: "excluded", planningEnabled: false });
    input.assignments = dateRange(input.startDate, addDays(input.startDate, 6)).map(date => ({ employeeId: "p1", date, kind: "ABSENCE" }));
    expect(findGenerationConflicts(input)[0].message).toContain("0h00");
  });
  it("does not count paid breaks as service capacity", () => {
    const input = fixture();
    input.shifts[0].segments = [{ start: 480, end: 900, kind: "WORK" }, { start: 900, end: 960, kind: "PAID_BREAK" }];
    expect(findGenerationConflicts(input)[0].message).toContain("35h00");
  });
  it("allows possible overnight coverage carried into the civil week", () => {
    const input = fixture();
    input.shifts[0].segments = [{ start: 1320, end: 1800, kind: "WORK" }];
    input.demands = dateRange(input.startDate, addDays(input.startDate, 4)).map(date => ({ id: date, date, sector: "Loja", role: "Repositor", start: 0, end: 528, minimum: 1 }));
    expect(findGenerationConflicts(input)).toEqual([]);
  });
  it("consolidates repeating weeks and selects a visible-month date for recovery", () => {
    const input = fixture();
    input.demands = dateRange(input.startDate, input.endDate).flatMap(date => input.shifts[0].segments.filter(segment => segment.kind === "WORK").map((segment, index) => ({ id: date + "-" + index, date, sector: "Loja", role: "Repositor", start: segment.start, end: segment.end, minimum: 1 })));
    const conflicts = findGenerationConflicts(input);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].date).toBe("2026-11-02");
    expect(conflicts[0].message).toContain("6 semanas");
  });
  it("identifies a locked workday that contradicts an approved fixed rest day, but ignores repairable unlocked work", () => {
    const input = fixture();
    input.demands = [];
    input.employees[0].offMode = "FIXED";
    input.employees[0].fixedOffDays = [5, 6];
    input.assignments = [{ employeeId: "p1", date: "2026-10-31", kind: "WORK", shiftId: input.shifts[0].id, locked: true }];
    expect(findGenerationConflicts(input)).toEqual([expect.objectContaining({ code: "LOCKED_WORK_ON_FIXED_REST", target: "team", employeeId: "p1", date: "2026-10-31" })]);
    input.assignments[0].locked = false;
    expect(findGenerationConflicts(input)).toEqual([]);
  });

});
