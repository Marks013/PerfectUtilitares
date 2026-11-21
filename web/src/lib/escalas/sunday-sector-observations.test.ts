import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { sundaySectorObservations, sundaySectorVariation } from "./sunday-sector-observations";

function sample() {
  const input = newInput("08", "Filial sintética", "2026-11", 42);
  input.policy.closedDates = [];
  input.policy.holidayDates = [];
  input.policy.authorizedHolidayDates = [];
  input.shifts = [{ id: "day", name: "Dia", segments: [
    { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" },
    { start: 780, end: 1044, kind: "WORK" },
  ] }];
  input.employees = ["a", "b"].map(id => ({
    ...newEmployee(42, "day"), id, registration: id, name: "Pessoa " + id,
    sector: "Caixas", role: "Operador", activeFrom: "2025-01-01", scheduleMode: "TIMED" as const,
  }));
  input.assignments = [];
  return input;
}

describe("observed Sunday staffing is independent of staffing requirements", () => {
  it("reports a whole sector on OFF, distinguishing one locked rest without creating an error or target", () => {
    const input = sample();
    input.assignments = [
      { employeeId: "a", date: "2026-11-08", kind: "OFF", locked: true },
      { employeeId: "b", date: "2026-11-08", kind: "OFF" },
    ];
    const original = structuredClone(input);
    const row = sundaySectorObservations(input).find(item => item.date === "2026-11-08");
    expect(row).toMatchObject({ sector: "Caixas", active: 2, off: 2, lockedOff: 1,
      timed: 0, duty: 0, absent: 0, unverified: 0, allOff: true });
    expect(input).toEqual(original);
  });

  it("never counts a break, a DUTY or a missing schedule as timed presence", () => {
    const input = sample();
    input.assignments = [
      { employeeId: "a", date: "2026-11-08", kind: "WORK", shiftId: "day" },
      { employeeId: "b", date: "2026-11-08", kind: "DUTY" },
    ];
    let row = sundaySectorObservations(input).find(item => item.date === "2026-11-08");
    expect(row).toMatchObject({ active: 2, timed: 1, duty: 1, off: 0, unverified: 0 });
    input.assignments = [
      { employeeId: "a", date: "2026-11-08", kind: "WORK", shiftId: "unknown" },
      { employeeId: "b", date: "2026-11-08", kind: "OFF" },
    ];
    row = sundaySectorObservations(input).find(item => item.date === "2026-11-08");
    expect(row).toMatchObject({ active: 2, timed: 0, duty: 0, off: 1, unverified: 1, allOff: false });
  });

  it("counts known Saturday overnight hourly work on Sunday without inventing a Sunday assignment", () => {
    const input = sample();
    input.shifts = [{ id: "overnight", name: "Noite sintética", segments: [
      { start: 1380, end: 1560, kind: "WORK" },
    ] }];
    input.employees = [{ ...input.employees[0], shiftIds: ["overnight"] }];
    input.assignments = [{ employeeId: "a", date: "2026-11-07", kind: "WORK", shiftId: "overnight" }];
    const row = sundaySectorObservations(input).find(item => item.date === "2026-11-08");
    expect(row).toMatchObject({ active: 1, timed: 1, duty: 0, off: 0, unverified: 0 });
  });

  it("excludes closed Sundays, excluded people and unauthorized holidays from open-Sunday comparisons", () => {
    const input = sample();
    input.policy.closedDates = ["2026-11-08"];
    input.policy.holidayDates = ["2026-11-15"];
    input.employees[1].planningEnabled = false;
    expect(sundaySectorObservations(input).map(row => row.date)).not.toContain("2026-11-08");
    expect(sundaySectorObservations(input).map(row => row.date)).not.toContain("2026-11-15");
    expect(sundaySectorObservations(input).every(row => row.active === 1)).toBe(true);
    input.policy.closedDates = [];
    input.restRulesVersion = 3;
    input.branchCode = "02";
    expect(sundaySectorObservations(input)).toEqual([]);
  });

  it("separates absences from off-days and refuses to call an unknown day an all-off sector", () => {
    const input = sample();
    input.assignments = [{ employeeId: "a", date: "2026-11-08", kind: "ABSENCE" }];
    const row = sundaySectorObservations(input).find(item => item.date === "2026-11-08");
    expect(row).toMatchObject({ active: 2, off: 0, absent: 1, timed: 0, unverified: 1, allOff: false });
    expect(sundaySectorVariation(row ? [row] : []).sectorDaysWithoutKnownService).toBe(1);
  });

  it("compares only equally available sector Sundays, without claiming a minimum requirement", () => {
    const input = sample();
    input.assignments = [
      { employeeId: "a", date: "2026-11-08", kind: "OFF" },
      { employeeId: "b", date: "2026-11-08", kind: "OFF" },
      { employeeId: "a", date: "2026-11-22", kind: "OFF" },
      { employeeId: "b", date: "2026-11-22", kind: "WORK", shiftId: "day" },
    ];
    const rows = sundaySectorObservations(input);
    expect(sundaySectorVariation(rows)).toMatchObject({
      comparableOffSpread: 2, sectorDaysAllOff: 1, sectorDaysWithUnverifiedPresence: 3,
    });
    const reduced = rows.filter(row => row.date !== "2026-11-08");
    expect(sundaySectorVariation(reduced).sectorDaysAllOff).toBe(0);
  });

  it("detects synchronized Sunday rests across singleton roles without inventing staffing minimums", () => {
    const input = sample();
    input.startDate = "2026-11-01";
    input.endDate = "2026-11-14";
    delete input.visibleMonth;
    const roles = ["Gerente", "Encarregado", "Operador", "Repositor"] as const;
    input.employees = roles.map((role, index) => ({
      ...newEmployee(42, index < 2 ? undefined : "day"),
      id: `synthetic-${index}`, registration: String(index),
      name: `Pessoa sintética ${index}`, sector: "Caixas", role,
      activeFrom: "2025-01-01",
      scheduleMode: index < 2 ? "UNTIMED" as const : "TIMED" as const,
    }));
    const sundays = ["2026-11-01", "2026-11-08"];
    const candidate = (firstSundayOff: readonly number[]) => ({
      ...input,
      assignments: sundays.flatMap((date, sundayIndex) => input.employees.map((person, index) => {
        const off = sundayIndex === 0 ? firstSundayOff.includes(index) : !firstSundayOff.includes(index);
        if (off) return { employeeId: person.id, date, kind: "OFF" as const };
        if (person.scheduleMode === "UNTIMED") return { employeeId: person.id, date, kind: "DUTY" as const };
        return { employeeId: person.id, date, kind: "WORK" as const, shiftId: "day" };
      })),
    });
    const concentrated = candidate([0, 1, 2, 3]);
    const staggered = candidate([0, 2]);
    for (const proposal of [concentrated, staggered]) {
      expect(proposal.assignments.filter(record => record.kind === "OFF")).toHaveLength(4);
      for (const person of proposal.employees) {
        expect(proposal.assignments.filter(record => record.employeeId === person.id && record.kind === "OFF")).toHaveLength(1);
      }
    }
    const concentratedRows = sundaySectorObservations(concentrated);
    const staggeredRows = sundaySectorObservations(staggered);
    expect(concentratedRows.map(row => row.off)).toEqual([4, 0]);
    expect(staggeredRows.map(row => row.off)).toEqual([2, 2]);
    expect(sundaySectorVariation(concentratedRows)).toMatchObject({
      comparableOffSpread: 4, sectorDaysAllOff: 1, sectorDaysWithoutKnownService: 1,
    });
    expect(sundaySectorVariation(staggeredRows)).toMatchObject({
      comparableOffSpread: 0, sectorDaysAllOff: 0, sectorDaysWithoutKnownService: 0,
    });
    expect(staggeredRows.every(row => row.timed === 1 && row.duty === 1 && row.unverified === 0)).toBe(true);
  });

});
