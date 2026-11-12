import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { exchangeRestImprovement } from "./rest-exchange";
import { restPairSummary } from "./rest-quality";
import { refineRoster } from "./roster-refinement";
import { validateEscala } from "./validation";
import { weekStart } from "./dates";
import { workJourney } from "./validation-time";
import type { EscalaInput } from "./types";

function weeklyTotals(input: EscalaInput) {
  const totals = new Map<string, { days: number; minutes: number }>();
  for (const record of input.assignments) {
    if (record.kind !== "WORK" && record.kind !== "DUTY") continue;
    const key = `${record.employeeId}\0${weekStart(record.date)}`;
    const total = totals.get(key) ?? { days: 0, minutes: 0 };
    total.days++;
    if (record.kind === "WORK") {
      const shift = input.shifts.find(candidate => candidate.id === record.shiftId);
      if (!shift) throw new Error("Missing fixture shift");
      total.minutes += workJourney(record, shift).minutes;
    }
    totals.set(key, total);
  }
  return totals;
}

function fixture(untimed = false) {
  const input = newInput("11", "Teste", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; delete input.visibleMonth;
  input.restRulesVersion = 1; input.simulation = true;
  input.shifts = [{ id: "day", name: "Dia", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }];
  input.employees = ["one", "peer"].map(id => ({ ...newEmployee(42, untimed ? undefined : "day"), id, registration: id, name: id, sector: "Loja", role: "Operador", activeFrom: "2020-01-01", scheduleMode: untimed ? "UNTIMED" as const : "TIMED" as const }));
  input.assignments = input.employees.flatMap(person => Array.from({ length: 7 }, (_, index) => {
    const off = (person.id === "one" ? [4, 5] : [1, 6]).includes(index);
    return { employeeId: person.id, date: `2026-11-0${index + 2}`, kind: off ? "OFF" as const : untimed ? "DUTY" as const : "WORK" as const,
      ...(!off && !untimed ? { shiftId: "day" } : {}), locked: ![1, 4].includes(index) };
  }));
  input.demands = untimed ? [] : Array.from({ length: 7 }, (_, index) => ({ id: String(index), date: `2026-11-0${index + 2}`, sector: "Loja", start: 480, end: 1044, minimum: 1, estimated: true }));
  return input;
}

describe("paired improvement without a triple-rest error", () => {
  it.each([false, true])("reduces an avoidable pair through a complete %s presence exchange", untimed => {
    const input = fixture(untimed), original = structuredClone(input), validation = validateEscala(input);
    expect(validation.valid).toBe(true);
    expect(restPairSummary(input).adjustablePairs).toBe(1);
    const result = exchangeRestImprovement(input, validation, performance.now() + 1000);
    expect(result).not.toBe(input);
    expect(restPairSummary(result).adjustablePairs).toBe(0);
    expect(validateEscala(result).valid).toBe(true);
    expect(result.assignments.filter((record, index) => record !== input.assignments[index])).toHaveLength(4);
    expect(weeklyTotals(result)).toEqual(weeklyTotals(input));
    expect(result.assignments.filter(record => record.date === "2026-11-08")).toEqual(input.assignments.filter(record => record.date === "2026-11-08"));
    expect(result.demands).toBe(input.demands); expect(result.employees).toBe(input.employees); expect(result.shifts).toBe(input.shifts);
    if (untimed) expect(result.assignments.every(record => record.kind !== "WORK" && !record.shiftId)).toBe(true);
    else expect(result.assignments.filter(record => record.kind === "WORK").every(record => record.shiftId === "day")).toBe(true);
    expect(input).toEqual(original);
  });
  it.each([false, true])("integrates into the bounded preparation for untimed=%s", untimed => {
    const input = fixture(untimed);
    const result = refineRoster(input);
    expect(restPairSummary(result).adjustablePairs).toBe(0);
    expect(validateEscala(result).valid).toBe(true);
  });
  it.each(["Depósito", "Loja"])("checks the replacement leader's declared sector (%s) on a HIGH day", sector => {
    const input = fixture(true);
    input.employees.forEach(person => { person.role = "Encarregado"; });
    input.employees[0].leadership = { role: "SECTOR", source: "MANUAL", sectors: ["Loja"] };
    input.employees[1].leadership = { role: "SECTOR", source: "MANUAL", sectors: [sector] };
    input.movementPriorities = [{ startDate: "2026-11-03", endDate: "2026-11-03", sector: "Loja", level: "HIGH" }];
    const validation = validateEscala(input);
    expect(validation.valid).toBe(true);
    const result = exchangeRestImprovement(input, validation, performance.now() + 1000);
    if (sector === "Loja") {
      expect(result).not.toBe(input);
      expect(result.assignments.find(record => record.employeeId === "peer" && record.date === "2026-11-03")?.kind).toBe("DUTY");
      expect(validateEscala(result).valid).toBe(true);
    } else {
      expect(result).toBe(input);
    }
  });
  it("preserves a locked partner rest and an exhausted shared check budget", () => {
    const input = fixture();
    const off = input.assignments.find(record => record.employeeId === "peer" && record.date === "2026-11-03");
    if (!off) throw new Error("Missing fixture record"); off.locked = true;
    expect(exchangeRestImprovement(input, validateEscala(input), performance.now() + 1000)).toBe(input);
    const other = fixture();
    expect(exchangeRestImprovement(other, validateEscala(other), performance.now() + 1000, { checked: 32 })).toBe(other);
    expect(exchangeRestImprovement(other, validateEscala(other), performance.now() - 1)).toBe(other);
  });
  it("does not treat equal work duration as equal coverage", () => {
    const input = fixture();
    input.shifts.push({ id: "late", name: "Tarde", segments: [{ start: 540, end: 780, kind: "WORK" }, { start: 780, end: 840, kind: "BREAK" }, { start: 840, end: 1104, kind: "WORK" }] });
    input.employees[1].shiftIds = ["late"];
    input.assignments.forEach(record => { if (record.employeeId === "peer" && record.kind === "WORK") record.shiftId = "late"; });
    expect(exchangeRestImprovement(input, validateEscala(input), performance.now() + 1000)).toBe(input);
  });
});
