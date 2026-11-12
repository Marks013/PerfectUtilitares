import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { compareRestQuality, preservesRestDistribution, restPairSummary } from "./rest-quality";

function fixture() {
  const input = newInput("06", "Teste", "2026-11", 42);
  input.startDate = "2026-10-26"; input.endDate = "2026-12-06";
  input.employees = ["a", "b"].map(id => ({ ...newEmployee(42), id, name: id, registration: id, sector: "Loja", role: "Operador", activeFrom: "2020-01-01", scheduleMode: "UNTIMED" as const }));
  return input;
}

describe("monthly rest pair contract", () => {
  it("counts the pair once in the month of its second OFF, including known prior history", () => {
    const input = fixture();
    input.employees[0].history = [{ employeeId: "a", date: "2026-10-31", kind: "OFF" }];
    input.assignments = [{ employeeId: "a", date: "2026-11-01", kind: "OFF" }, { employeeId: "a", date: "2026-11-30", kind: "OFF" }, { employeeId: "a", date: "2026-12-01", kind: "OFF" }];
    expect(restPairSummary(input)).toMatchObject({ targetMonthlyPairs: 2, totalPairs: 1, imposedPairs: 0, adjustablePairs: 1 });
    input.employees[0].history = [];
    expect(restPairSummary(input).totalPairs).toBe(0);
  });
  it("separates imposed pairs and never turns absence or holiday into OFF", () => {
    const input = fixture();
    input.assignments = [{ employeeId: "a", date: "2026-11-02", kind: "OFF", locked: true }, { employeeId: "a", date: "2026-11-03", kind: "OFF", locked: true }, { employeeId: "a", date: "2026-11-04", kind: "ABSENCE" }, { employeeId: "a", date: "2026-11-05", kind: "HOLIDAY" }];
    expect(restPairSummary(input)).toMatchObject({ totalPairs: 1, imposedPairs: 1, adjustablePairs: 0, correctableExcess: 0 });
  });
  it("does not grant two additional adjustable pairs above imposed rests", () => {
    const input = fixture();
    input.assignments = [2, 9, 16].flatMap(day => [0, 1].map(offset => ({ employeeId: "a", date: `2026-11-${String(day + offset).padStart(2, "0")}`, kind: "OFF" as const, locked: day < 16 })));
    expect(restPairSummary(input)).toMatchObject({ totalPairs: 3, imposedPairs: 2, adjustablePairs: 1, correctableExcess: 1, peopleAboveTarget: 1 });
    input.employees[0].offPattern = "CONSECUTIVE";
    expect(restPairSummary(input)).toMatchObject({ totalPairs: 3, imposedPairs: 3, adjustablePairs: 0, correctableExcess: 0 });
  });
  it("continues preferring fewer adjustable pairs when everyone is below two", () => {
    const input = fixture();
    input.assignments = [{ employeeId: "a", date: "2026-11-02", kind: "OFF" }, { employeeId: "a", date: "2026-11-03", kind: "OFF" }];
    const next = { ...input, assignments: input.assignments.map(record => record.date === "2026-11-03" ? { ...record, kind: "DUTY" as const } : record) };
    expect(compareRestQuality(restPairSummary(input), restPairSummary(next))).toBeGreaterThan(0);
  });
  it("rejects merely concentrating two peers' pairs in the same person", () => {
    const input = fixture();
    input.assignments = ["a", "b"].flatMap(employeeId => [2, 3].map(day => ({ employeeId, date: `2026-11-0${day}`, kind: "OFF" as const })));
    const next = { ...input, assignments: input.assignments.filter(record => record.employeeId !== "b").concat([9, 10].map(day => ({ employeeId: "a", date: `2026-11-${String(day).padStart(2, "0")}`, kind: "OFF" as const }))) };
    expect(preservesRestDistribution(input, next)).toBe(false);
  });
  it("counts repeated adjacent weeks but not a pair repeated after a free week", () => {
    const input = fixture();
    input.assignments = [2, 9, 23].flatMap(day => [0, 1].map(offset => ({ employeeId: "a", date: `2026-11-${String(day + offset).padStart(2, "0")}`, kind: "OFF" as const })));
    expect(restPairSummary(input)).toMatchObject({ weeklyRepetitions: 1, concentration: 3 });
  });
  it("does not hide pairs by moving them into the technical padding", () => {
    const input = fixture();
    input.assignments = [2, 3].map(day => ({ employeeId: "a", date: `2026-11-0${day}`, kind: "OFF" as const }));
    const next = { ...input, assignments: [{ employeeId: "a", date: "2026-11-30", kind: "OFF" as const }, { employeeId: "a", date: "2026-12-01", kind: "OFF" as const }] };
    expect(preservesRestDistribution(input, next, true)).toBe(false);
  });
});
