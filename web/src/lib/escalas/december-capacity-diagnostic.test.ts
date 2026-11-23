import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { dateRange } from "./dates";
import { decemberCapacityConflicts } from "./december-capacity-diagnostic";
import type { EscalaInput } from "./types";

function fixture(workers: number): EscalaInput {
  const input = newInput("02", "Filial", "2026-12", 42);
  input.startDate = "2026-12-01";
  input.endDate = "2026-12-31";
  input.planningWeekStartsOn = "SUNDAY";
  input.generationMode = "DAYS_AND_HOURS";
  input.employees = Array.from({ length: 12 }, (_, index) => ({
    ...newEmployee(42, "day"), id: String(index), activeFrom: input.startDate, sector: "Frente de Caixa",
    role: "Caixa", scheduleMode: "TIMED",
  }));
  input.shifts = [{ id: "day", name: "Teste", segments: [{ start: 536, end: 670, kind: "WORK" }] }];
  const dates = dateRange(input.startDate, "2026-12-05");
  input.assignments = dates.flatMap(date => input.employees.map((person, index) => index < workers
    ? { employeeId: person.id, date, kind: "WORK" as const, shiftId: "day" }
    : { employeeId: person.id, date, kind: "OFF" as const }));
  input.demands = dates.flatMap(date => [0, 1].map(copy => ({
    id: `${date}-${copy}`, date, sector: "Frente de Caixa", role: "Caixa", start: 536,
    end: 670, minimum: 10, estimated: true,
  })));
  return input;
}

describe("diagnóstico de capacidade na virada de dezembro", () => {
  it("proves 50 protected person-days exceed an optimistic ceiling of 36 without counting overlapping estimates twice", () => {
    const origin = fixture(10);
    const [conflict, ...others] = decemberCapacityConflicts(origin, origin);
    expect(others).toEqual([]);
    expect(conflict).toMatchObject({ target: "coverage", date: "2026-12-01", sector: "Frente de Caixa", role: "Caixa" });
    expect(conflict?.message).toContain("08h56–11h10");
    expect(conflict?.message).toContain("50 presenças");
    expect(conflict?.message).toContain("no máximo 36");
    expect(conflict?.message).toContain("14 pessoas-dia");
  });

  it("does not treat an estimate above actual saved attendance as protected, or assume a ceiling with night carry", () => {
    const origin = fixture(5);
    expect(decemberCapacityConflicts(origin, origin)).toEqual([]);
    const covered = fixture(10);
    expect(decemberCapacityConflicts({ ...covered, storeClosingMinutes: 1500 }, covered)).toEqual([]);
    expect(decemberCapacityConflicts(covered)).toEqual([]);
  });

  it("does not impose the three-day ceiling on people with absences", () => {
    const origin = fixture(10);
    const absent = new Set(origin.employees.slice(0, 7).map(person => person.id));
    const context: EscalaInput = { ...origin, assignments: origin.assignments.map(row =>
      absent.has(row.employeeId) && row.date === "2026-12-01"
        ? { employeeId: row.employeeId, date: row.date, kind: "ABSENCE" }
        : row) };
    expect(decemberCapacityConflicts(context, origin)).toEqual([]);
  });
});
