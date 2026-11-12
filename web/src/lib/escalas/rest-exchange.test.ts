import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { exchangeRestRepair } from "./rest-exchange";
import { regularRestQuality } from "./rest-spacing";
import { validateEscala } from "./validation";

describe("coverage-neutral partnered rest repair", () => {
  it("repairs a boundary triple by exchanging two people's weekday duties, keeping both weekly hours", () => {
    const input = newInput("11", "Teste", "2026-11", 42);
    input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; delete input.visibleMonth;
    input.restRulesVersion = 1; input.simulation = true;
    input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
    input.employees = ["one", "peer"].map(id => ({ ...newEmployee(42, "day"), id, registration: id, name: "Pessoa", sector: "Loja", role: "Operador", activeFrom: "2020-01-01" }));
    input.employees[0].history = ["2026-10-31", "2026-11-01"].map(date => ({ employeeId: "one", date, kind: "OFF" }));
    input.assignments = input.employees.flatMap(person => Array.from({ length: 7 }, (_, index) => {
      const off = person.id === "one" ? [0, 6].includes(index) : [3, 6].includes(index);
      return { employeeId: person.id, date: `2026-11-0${index + 2}`, kind: off ? "OFF" as const : "WORK" as const, ...(!off ? { shiftId: "day" } : {}) };
    }));
    input.demands = ["2026-11-02", "2026-11-05"].map(date => ({ id: date, date, sector: "Loja", start: 480, end: 1044, minimum: 1, estimated: true }));
    const original = structuredClone(input), before = validateEscala(input);
    expect(before.issues.some(issue => issue.code === "CONSECUTIVE_REST_LIMIT")).toBe(true);
    const repaired = exchangeRestRepair(input, before, performance.now() + 1000);
    expect(repaired).not.toBe(input);
    expect(regularRestQuality(repaired, repaired.employees[0]).longWindows).toEqual([]);
    expect(validateEscala(repaired).valid).toBe(true);
    expect(repaired.assignments.filter((record, index) => record !== input.assignments[index])).toHaveLength(4);
    expect(repaired.demands).toBe(input.demands); expect(repaired.shifts).toBe(input.shifts);
    expect(repaired.employees).toBe(input.employees); expect(input).toEqual(original);
  });
});
