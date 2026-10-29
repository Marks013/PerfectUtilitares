import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { addDays, dateRange, dayOfWeek } from "./dates";
import { prepareGeneration } from "./generation";
import { escalaInputSchema } from "./schema";
import type { EscalaInput } from "./types";
import { validateEscala } from "./validation";
import { validateJourney, workJourney } from "./validation-time";

function fixture(weeks = 1): EscalaInput {
  const input = newInput("TEST", "Modelo supermercado", "2026-11", 42);
  input.startDate = "2026-11-02";
  input.endDate = addDays(input.startDate, weeks * 7 - 1);
  delete input.visibleMonth;
  input.policy = { ...input.policy, maxConsecutiveWorkDays: 5, reviewed: true, source: "Referência de teste", reviewedBy: "Teste", compensationAuthorized: true };
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "p1", registration: "1", name: "Pessoa de teste", sector: "Reposição", role: "Repositor", activeFrom: "2020-01-01" }];
  input.assignments = dateRange(input.startDate, input.endDate).map(date => ({ employeeId: "p1", date, kind: dayOfWeek(date) < 5 ? "WORK" : "OFF", ...(dayOfWeek(date) < 5 ? { shiftId: input.shifts[0].id } : {}) }));
  input.demands = dateRange(input.startDate, input.endDate).map(date => ({ id: "d-" + date, date, sector: "Reposição", start: 480, end: 720, minimum: 0 }));
  return input;
}

describe("supermarket 5x2 model invariants", () => {
  it("starts with a five-day cap and never expands it during generation", () => {
    expect(newInput("A", "Filial A", "2026-11", 42).policy.maxConsecutiveWorkDays).toBe(5);
    const input = fixture();
    input.policy.maxConsecutiveWorkDays = 6;
    const result = prepareGeneration(input);
    expect(result.input.policy.maxConsecutiveWorkDays).toBe(5);
    expect(input.policy.maxConsecutiveWorkDays).toBe(6);
  });

  it("keeps legacy six-day inputs readable but identifies the need to recalculate", () => {
    const input = fixture(); input.policy.maxConsecutiveWorkDays = 6;
    expect(escalaInputSchema.safeParse(input).success).toBe(true);
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "FIVE_BY_TWO_POLICY_OUTDATED", severity: "PENDING" }));
    expect(validateEscala(input).readyToPublish).toBe(false);
  });

  it("rejects a sixth day across weeks even when the saved cap is six", () => {
    const input = fixture(2); input.policy.maxConsecutiveWorkDays = 6;
    const rests = new Set(["2026-11-02", "2026-11-04", "2026-11-11", "2026-11-15"]);
    input.assignments = dateRange(input.startDate, input.endDate).map(date => ({ employeeId: "p1", date, kind: rests.has(date) ? "OFF" : "WORK", ...(!rests.has(date) ? { shiftId: input.shifts[0].id } : {}) }));
    const result = validateEscala(input);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "WORK_STREAK", date: "2026-11-10" }));
  });

  it("checks the sixth day against known previous-month work", () => {
    const input = fixture();
    input.employees[0].history = dateRange("2026-10-28", "2026-11-01").map(date => ({ employeeId: "p1", date, kind: "WORK", shiftId: input.shifts[0].id }));
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "WORK_STREAK", date: "2026-11-02" }));
  });

  it("explains real absence dates once without requiring full weekly hours or a new rule", () => {
    const input = fixture(5);
    input.assignments = input.assignments.map(entry => entry.date >= "2026-11-03" && entry.date <= "2026-12-02" ? { employeeId: entry.employeeId, date: entry.date, kind: "ABSENCE" } : entry);
    const before = JSON.stringify(input);
    const result = validateEscala(input);
    expect(result.issues.filter(issue => issue.code === "ABSENCE_AVAILABILITY")).toHaveLength(1);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "ABSENCE_AVAILABILITY", severity: "WARNING", date: "2026-11-03", periodEnd: "2026-12-02", message: expect.stringContaining("03/11/2026 a 02/12/2026") }));
    expect(result.issues.some(issue => ["PARTIAL_WEEK_PENDING", "WEEKLY_MINUTES", "FIVE_BY_TWO", "EMPLOYMENT_AVAILABILITY"].includes(issue.code))).toBe(false);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.summaries[0].workedMinutes).toBe(3 * 504);
  });

  it.each(["admission", "termination"])("distinguishes a midweek %s from absence and reduced contractual hours", kind => {
    const input = fixture();
    const person = input.employees[0];
    if (kind === "admission") person.activeFrom = "2026-11-04";
    else person.activeUntil = "2026-11-04";
    input.assignments = input.assignments.filter(entry => entry.date >= person.activeFrom && (!person.activeUntil || entry.date <= person.activeUntil));
    const result = validateEscala(input);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "EMPLOYMENT_AVAILABILITY", severity: "WARNING" }));
    expect(result.issues.some(issue => ["PARTIAL_WEEK_PENDING", "WEEKLY_MINUTES", "FIVE_BY_TWO", "ABSENCE_AVAILABILITY"].includes(issue.code))).toBe(false);
  });

  it("does not label a technical month boundary or unknown admission as partial employment", () => {
    const input = fixture(5); input.employees[0].activeFrom = "";
    const codes = validateEscala(input).issues.map(issue => issue.code);
    expect(codes).not.toContain("PARTIAL_WEEK_PENDING");
    expect(codes).not.toContain("EMPLOYMENT_AVAILABILITY");
    expect(codes).not.toContain("ABSENCE_AVAILABILITY");
  });

  it("does not permit six workdays in an absence week even when they are not consecutive", () => {
    const input = fixture();
    input.assignments = input.assignments.map(entry => entry.date === "2026-11-04" ? { employeeId: "p1", date: entry.date, kind: "ABSENCE" } : { employeeId: "p1", date: entry.date, kind: "WORK", shiftId: input.shifts[0].id });
    expect(validateEscala(input).issues).toContainEqual(expect.objectContaining({ code: "FIVE_BY_TWO" }));
  });

  it("treats four hours as a pause threshold, not a daily or segment cap", () => {
    const input = fixture();
    const assignment = input.assignments[0];
    const shift = { id: "short", name: "Cinco horas", segments: [{ start: 480, end: 780, kind: "WORK" as const }] };
    expect(validateJourney(input, workJourney(assignment, shift)).some(issue => issue.code === "MEAL_INTERVAL")).toBe(true);
    input.simulation = true;
    Object.assign(input.policy, { allowShortMealSimulation: true });
    const relaxed = validateJourney(input, workJourney(assignment, shift));
    expect(relaxed.some(issue => issue.code === "MEAL_INTERVAL")).toBe(false);
    expect(relaxed).toContainEqual(expect.objectContaining({ code: "SIMULATION_SHORT_MEAL_FLEX", severity: "PENDING", employeeId: "p1", date: input.startDate }));
    input.simulation = false;
    expect(validateJourney(input, workJourney(assignment, shift)).some(issue => issue.code === "MEAL_INTERVAL")).toBe(true);
    input.simulation = true;
    shift.segments[0].end = 900;
    expect(validateJourney(input, workJourney(assignment, shift)).some(issue => issue.code === "MEAL_INTERVAL")).toBe(true);
  });

  it("never mistakes a work segment over four hours with a valid meal for a daily overrun", () => {
    const input = fixture();
    const shift = { id: "split", name: "8h24", segments: [{ start: 480, end: 750, kind: "WORK" as const }, { start: 750, end: 810, kind: "BREAK" as const }, { start: 810, end: 1044, kind: "WORK" as const }] };
    expect(validateJourney(input, workJourney(input.assignments[0], shift)).some(issue => issue.code === "MEAL_INTERVAL")).toBe(false);
  });
});
