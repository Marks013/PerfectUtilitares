import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { frozenCoverageService } from "./coverage-protection";
import { dateRange } from "./dates";
import { compareRosterCoverage, frozenCoverageComparison } from "./roster-quality";
import type { EscalaInput } from "./types";

function fixture(): EscalaInput {
  const input = newInput("07", "Teste", "2026-12", 42);
  input.storeClosingMinutes = 1200;
  input.employees = [
    { ...newEmployee(42, "day"), id: "timed", registration: "1", sector: "Loja", role: "Caixa", scheduleMode: "TIMED" },
    { ...newEmployee(42), id: "untimed", registration: "2", sector: "Loja", role: "Caixa", scheduleMode: "UNTIMED" },
    { ...newEmployee(42, "day"), id: "admin", registration: "3", sector: "Afastados", role: "Caixa", scheduleMode: "TIMED" },
  ];
  input.shifts = [{ id: "day", name: "Teste", segments: [{ start: 660, end: 900, kind: "WORK" },
    { start: 900, end: 936, kind: "BREAK" }, { start: 936, end: 1200, kind: "WORK" }] }];
  const date = "2026-12-01";
  input.assignments = [{ employeeId: "timed", date, kind: "WORK", shiftId: "day" },
    { employeeId: "untimed", date, kind: "DUTY" }, { employeeId: "admin", date, kind: "WORK", shiftId: "day" }];
  input.demands = [
    { id: "role", date, sector: "Loja", role: "Caixa", start: 840, end: 960, minimum: 3, estimated: true },
    { id: "general", date, sector: "Loja", start: 660, end: 1200, minimum: 2, estimated: true },
    { id: "explicit", date, sector: "Loja", role: "Caixa", start: 960, end: 1020, minimum: 1 },
    { id: "admin", date, sector: "Afastados", role: "Caixa", start: 840, end: 1200, minimum: 1, estimated: true },
    { id: "other", date, sector: "Loja", role: "Repositor", start: 840, end: 1200, minimum: 1, estimated: true },
  ];
  return input;
}

describe("frozen coverage service", () => {
  it("counts only actual operational WORK spans, not a meal, DUTY or administrative attendance", () => {
    const input = fixture(), date = "2026-12-01", original = structuredClone(input);
    const guard = frozenCoverageService(input);
    expect(guard?.days).toEqual([{ date, sector: "Loja" }]);
    expect(guard?.bands).toHaveLength(4);
    for (const scope of ["HORIZON", "MONTH"]) {
      expect(guard?.bands).toContainEqual({ sector: "Loja", role: "Caixa", start: 660, end: 900, scope, minimum: 1 });
      expect(guard?.bands).toContainEqual({ sector: "Loja", role: "Caixa", start: 936, end: 1200, scope, minimum: 1 });
    }
    expect(input).toEqual(original);
  });

  it.each([false, true])("keeps presence protections in December with estimated demand=%s", withDemand => {
    const original = fixture();
    original.demands = [];
    original.employees = [original.employees[0], { ...original.employees[0], id: "second", registration: "4", role: "Repositor" }];
    const sunday = "2026-12-06", weekday = "2026-12-09", receiver = "2026-12-10";
    if (withDemand) original.demands = [{ id: "sunday", date: sunday, sector: "Loja", role: "Repositor",
      start: 936, end: 1200, minimum: 1, estimated: true }];
    original.assignments = original.employees.flatMap(person => dateRange(original.startDate, original.endDate).map(date =>
      date === sunday || date === weekday && person.id === "timed"
        ? { employeeId: person.id, date, kind: "WORK" as const, shiftId: "day" }
        : { employeeId: person.id, date, kind: "OFF" as const }));
    const guard = frozenCoverageService(original);
    expect(guard?.days).toContainEqual({ date: weekday, sector: "Loja" });
    expect(guard?.bands).toContainEqual({ sector: "Loja", role: "Caixa", start: 936, end: 1200, scope: "MONTH_SUNDAYS", minimum: 1 });
    expect(guard?.bands).not.toEqual(expect.arrayContaining([expect.objectContaining({ start: 900, end: 936 })]));

    const move = (from: string): EscalaInput => ({ ...original, assignments: original.assignments.map(row =>
      row.employeeId !== "timed" ? row
        : row.date === from ? { employeeId: row.employeeId, date: row.date, kind: "OFF" }
        : row.date === receiver ? { ...row, kind: "WORK", shiftId: "day" } : row) });
    expect(compareRosterCoverage(original, move(weekday))).toMatchObject({ regressed: true, reason: "DAILY_PRESENCE" });
    expect(compareRosterCoverage(original, move(sunday))).toMatchObject({ regressed: true, reason: "ROLE_TIME_PRESENCE" });
    expect(frozenCoverageComparison(move(sunday), "DECEMBER_DEMAND")).toEqual(frozenCoverageComparison(original, "DECEMBER_DEMAND"));
    expect(compareRosterCoverage(original, move(weekday), original, "DECEMBER_DEMAND"))
      .toMatchObject({ regressed: true, reason: "DAILY_PRESENCE" });
    expect(compareRosterCoverage(original, move(sunday), original, "DECEMBER_DEMAND"))
      .toMatchObject({ regressed: true, reason: "ROLE_TIME_PRESENCE", regression: { role: "Caixa" } });
  });

  it("does not protect fictitious coverage during an absence, including on a closed date", () => {
    const input = fixture();
    input.assignments[0] = { employeeId: "timed", date: "2026-12-01", kind: "ABSENCE", locked: true };
    expect(frozenCoverageService(input)).toEqual({ days: [], bands: [] });
    input.policy.closedDates.push("2026-12-01");
    expect(frozenCoverageService(input)).toEqual({ days: [], bands: [] });
  });
});
