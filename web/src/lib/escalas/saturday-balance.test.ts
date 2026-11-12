import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { keepsSaturdayBalance, saturdayBalance } from "./saturday-balance";

function fixture() {
  const input = newInput("06", "Teste", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-15"; delete input.visibleMonth;
  input.employees = ["a", "b"].map(id => ({ ...newEmployee(42), id, sector: "Loja", activeFrom: "2020-01-01", scheduleMode: "UNTIMED" as const }));
  input.assignments = input.employees.flatMap(person => ["2026-11-07", "2026-11-14"].map((date, index) => ({
    employeeId: person.id, date, kind: (person.id === "a" ? index === 0 : index === 1) ? "DUTY" as const : "OFF" as const,
  })));
  return input;
}

describe("comparable Saturday protection during local preparation", () => {
  it("rejects a Saturday transfer that worsens a previously balanced group", () => {
    const input = fixture();
    const next = input.assignments.map(record => record.employeeId === "a" && record.date === "2026-11-07" ? { ...record, kind: "OFF" as const } : record);
    expect([...saturdayBalance(input).values()]).toEqual([0]);
    expect(keepsSaturdayBalance(input, next)).toBe(false);
  });
  it("allows an actual balance improvement without changing the reference", () => {
    const input = fixture(); input.assignments[0].kind = "OFF";
    const original = structuredClone(input);
    const next = input.assignments.map((record, index) => index === 0 ? { ...record, kind: "DUTY" as const } : record);
    expect(keepsSaturdayBalance(input, next)).toBe(true);
    expect(input).toEqual(original);
  });
  it("does not count absence, forced rest or closed dates as rotation debt", () => {
    const input = fixture(); input.assignments[0].kind = "ABSENCE";
    input.assignments[1].locked = true;
    expect([...saturdayBalance(input).values()]).toEqual([0]);
    input.assignments[1].locked = false; input.policy.closedDates = ["2026-11-14"];
    expect([...saturdayBalance(input).values()]).toEqual([0]);
  });
  it("uses known history and the complete horizon, not a clipped visible month", () => {
    const input = fixture();
    input.employees[0].history = [{ employeeId: "a", date: "2026-10-31", kind: "DUTY" }];
    input.employees[1].history = [{ employeeId: "b", date: "2026-10-31", kind: "OFF" }];
    expect([...saturdayBalance(input).values()]).toEqual([3333]);
  });
  it("keeps presence-only and timed people in separate comparison groups", () => {
    const input = fixture(); input.employees[1].scheduleMode = "TIMED";
    expect([...saturdayBalance(input).values()]).toEqual([0, 0]);
  });
  it("detects Friday work crossing Saturday, even when Saturday assignments do not change", () => {
    const input = fixture(); input.employees.forEach(person => { person.scheduleMode = "TIMED"; });
    input.assignments.forEach(record => { record.kind = "OFF"; });
    input.shifts = [{ id: "night", name: "Night", segments: [{ start: 1380, end: 1500, kind: "WORK" }] }];
    input.assignments.push({ employeeId: "a", date: "2026-11-06", kind: "OFF" });
    const next = input.assignments.map(record => record.date === "2026-11-06" ? { ...record, kind: "WORK" as const, shiftId: "night" } : record);
    expect(keepsSaturdayBalance(input, next)).toBe(false);
    expect(keepsSaturdayBalance(input, [...input.assignments].reverse())).toBe(true);
    input.shifts[0].segments = [{ start: 1380, end: 1440, kind: "WORK" }, { start: 1440, end: 1455, kind: "PAID_BREAK" }];
    expect(keepsSaturdayBalance(input, next)).toBe(false);
  });
});
