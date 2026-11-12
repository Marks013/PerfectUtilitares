import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { repairUntimedRests } from "./untimed-rest-repair";
import { refineRoster } from "./roster-refinement";
import { regularRestQuality } from "./rest-spacing";
import { validateEscala } from "./validation";

function fixture(mode: "MISSING" | "UNTIMED") {
  const input = newInput("06", "Teste", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; delete input.visibleMonth;
  input.restRulesVersion = 1; input.simulation = true;
  const person = { ...newEmployee(42), id: "presence", registration: "1", name: "Pessoa", sector: "Loja",
    role: "Encarregado", scheduleMode: mode, shiftIds: [], activeFrom: "2020-01-01" };
  person.history = ["2026-10-31", "2026-11-01"].map(date => ({ employeeId: person.id, date, kind: "OFF" }));
  input.employees = [person];
  input.assignments = Array.from({ length: 7 }, (_, index) => ({ employeeId: person.id,
    date: `2026-11-0${index + 2}`, kind: [0, 6].includes(index) ? "OFF" as const : "DUTY" as const }));
  return input;
}

describe("presence-only safe rest repair", () => {
  it.each(["MISSING", "UNTIMED"] as const)("repairs %s without shifts, changing neither Sunday nor hourly coverage", mode => {
    const input = fixture(mode), original = structuredClone(input);
    expect(validateEscala(input).valid).toBe(false);
    const result = repairUntimedRests(input, validateEscala(input), performance.now() + 1000);
    expect(result).not.toBe(input);
    expect(validateEscala(result).valid).toBe(true);
    expect(regularRestQuality(result, result.employees[0]).longWindows).toEqual([]);
    expect(result.assignments.filter(record => record.kind === "DUTY")).toHaveLength(5);
    expect(result.assignments.every(record => record.kind !== "WORK" && !record.shiftId)).toBe(true);
    expect(result.assignments.find(record => record.date === "2026-11-08")).toEqual(input.assignments.at(-1));
    expect(result.demands).toBe(input.demands); expect(input).toEqual(original);
  });
  it("integrates the presence repair even without hourly demand", () => {
    const result = refineRoster(fixture("UNTIMED"));
    expect(validateEscala(result).valid).toBe(true);
  });
  it("does not leave a declared peak without its only responsible leader during a local repair", () => {
    const input = fixture("UNTIMED");
    input.movementPriorities = input.assignments.filter(record => record.kind === "DUTY")
      .map(record => ({ startDate: record.date, endDate: record.date, sector: "Loja", level: "HIGH" }));
    expect(repairUntimedRests(input, validateEscala(input), performance.now() + 1000)).toBe(input);
    input.movementPriorities = [];
    expect(repairUntimedRests(input, validateEscala(input), performance.now() + 1000)).not.toBe(input);
  });
  it("preserves an imposed boundary and an expired search", () => {
    const input = fixture("UNTIMED"); input.assignments[0].locked = true;
    expect(repairUntimedRests(input, validateEscala(input), performance.now() + 1000)).toBe(input);
    const editable = fixture("UNTIMED");
    expect(repairUntimedRests(editable, validateEscala(editable), performance.now() - 1)).toBe(editable);
  });
});
