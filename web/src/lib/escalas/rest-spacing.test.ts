import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { regularRestQuality } from "./rest-spacing";
import { validateEscala } from "./validation";

function fixture() {
  const input = newInput("11", "Teste", "2026-11", 42);
  input.restRulesVersion = 1;
  const person = { ...newEmployee(42), id: "one", registration: "one", name: "Pessoa", sector: "Loja", role: "Encarregado", scheduleMode: "UNTIMED" as const, activeFrom: "2020-01-01" };
  input.employees = [person];
  input.assignments = ["2026-11-08", "2026-11-09", "2026-11-10"].map(date => ({ employeeId: person.id, date, kind: "OFF" as const }));
  return { input, person };
}

describe("regular variable rest spacing", () => {
  it("finds Sunday/Monday/Tuesday across a weekly boundary", () => {
    const { input, person } = fixture();
    expect(regularRestQuality(input, person)).toEqual({ adjacentPairs: 2, longWindows: ["2026-11-08"] });
    expect(validateEscala(input).issues.some(issue => issue.code === "CONSECUTIVE_REST_LIMIT" && issue.severity === "ERROR")).toBe(true);
  });
  it.each(["ABSENCE", "HOLIDAY", "DUTY"] as const)("does not turn %s into an ordinary rest", kind => {
    const { input, person } = fixture();
    input.assignments = input.assignments.map(record => record.date === "2026-11-09" ? { ...record, kind } : record);
    expect(regularRestQuality(input, person)).toEqual({ adjacentPairs: 0, longWindows: [] });
  });
  it("preserves an entirely locked window but rejects an avoidable unlocked third day", () => {
    const { input, person } = fixture();
    input.assignments = input.assignments.map(record => ({ ...record, locked: true }));
    expect(regularRestQuality(input, person).longWindows).toEqual([]);
    input.assignments[2].locked = false;
    expect(regularRestQuality(input, person).longWindows).toEqual(["2026-11-08"]);
  });
  it("counts known published boundary rests, without rejecting pure historical runs", () => {
    const { input, person } = fixture();
    input.startDate = "2026-11-09";
    input.assignments = input.assignments.filter(record => record.date >= input.startDate);
    person.history = [{ employeeId: person.id, date: "2026-11-08", kind: "OFF" }];
    expect(regularRestQuality(input, person).longWindows).toEqual(["2026-11-08"]);
    input.startDate = "2026-11-11";
    person.history = ["2026-11-08", "2026-11-09", "2026-11-10"].map(date => ({ employeeId: person.id, date, kind: "OFF" }));
    input.assignments = [];
    expect(regularRestQuality(input, person).longWindows).toEqual([]);
  });
  it("does not rewrite an explicitly fixed rest arrangement", () => {
    const { input, person } = fixture();
    person.offMode = "MIXED"; person.fixedOffDays = [0];
    expect(regularRestQuality(input, person)).toEqual({ adjacentPairs: 0, longWindows: [] });
  });
  it("allows a requested pair but not three automatic rests", () => {
    const { input, person } = fixture(); person.offPattern = "CONSECUTIVE";
    expect(regularRestQuality(input, person).adjacentPairs).toBe(0);
    expect(regularRestQuality(input, person).longWindows).toEqual(["2026-11-08"]);
  });
  it("does not apply a new planning criterion to a published snapshot", () => {
    const { input } = fixture();
    expect(validateEscala(input, { publishedSnapshot: true }).issues.some(issue => issue.code === "CONSECUTIVE_REST_LIMIT")).toBe(false);
  });
});
