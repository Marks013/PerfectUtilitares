import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import type { EscalaEmployee, EscalaInput } from "./types";
import { buildCoveragePresence, coverageAt, coverageTimeline, sectorCoverageGaps, sectorPresenceGaps } from "./coverage-presence";

function fixture(): EscalaInput {
  const input = newInput("01", "Filial", "2026-11", 42);
  const person = (id: string, role = "Repositor"): EscalaEmployee => ({ id, registration: id, name: id, role, sector: "Reposição", weeklyHours: 42,
    shiftIds: ["a"], activeFrom: "", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false, history: [], scheduleMode: "TIMED" });
  input.employees = [person("a"), person("b"), person("manager", "Gerente"), { ...person("x"), planningEnabled: false }, { ...person("missing"), scheduleMode: "MISSING" }, { ...person("untimed"), scheduleMode: "UNTIMED" }, { ...person("late"), activeFrom: "2026-11-03" }];
  input.shifts = [{ id: "a", name: "Referência", segments: [{ start: 576, end: 840, kind: "WORK" }, { start: 840, end: 960, kind: "BREAK" }, { start: 960, end: 1200, kind: "WORK" }] },
    { id: "b", name: "Outro", segments: [{ start: 580, end: 810, kind: "WORK" }, { start: 810, end: 930, kind: "PAID_BREAK" }, { start: 930, end: 1204, kind: "WORK" }] }];
  input.assignments = input.employees.map(person => ({ employeeId: person.id, date: "2026-11-02", kind: "WORK" as const, shiftId: person.id === "b" ? "b" : "a" }));
  input.demands = [];
  return input;
}

describe("exact civil-minute coverage", () => {
  it("shows whole dates without timed presence even when the estimate is zero, without inventing staffing requirements", () => {
    const input = fixture(); input.visibleMonth = undefined; input.startDate = "2026-11-02"; input.endDate = "2026-11-05";
    input.policy.closedDates = ["2026-11-05"];
    input.assignments.push({ employeeId: "missing", date: "2026-11-03", kind: "DUTY" },
      { employeeId: "untimed", date: "2026-11-03", kind: "DUTY" },
      { employeeId: "a", date: "2026-11-04", kind: "ABSENCE" });
    input.demands = [
      { id: "zero", date: "2026-11-03", sector: "Reposição", minimum: 0, start: 480, end: 1020, estimated: true },
      { id: "positive", date: "2026-11-04", sector: "Reposição", minimum: 1, start: 480, end: 1020, estimated: true },
    ];
    for (const person of input.employees.filter(employee => employee.planningEnabled !== false && employee.scheduleMode === "TIMED")) {
      for (const date of ["2026-11-03", "2026-11-04"]) if (!input.assignments.some(record => record.employeeId === person.id && record.date === date))
        input.assignments.push({ employeeId: person.id, date, kind: "OFF" });
    }
    const before = structuredClone(input);
    expect(sectorPresenceGaps(input)).toEqual([{ sector: "Reposição", dates: ["2026-11-03", "2026-11-04"], withoutPositiveReferenceDates: ["2026-11-03"] }]);
    expect(input).toEqual(before);
  });
  it("does not mark sectors outside employment, disabled people or only administrative presence as empty timed teams", () => {
    const input = fixture(); input.visibleMonth = undefined; input.startDate = "2026-11-02"; input.endDate = "2026-11-03";
    input.employees = [
      { ...input.employees[0], activeFrom: "2026-11-03" },
      { ...input.employees[3], sector: "Excluídos" },
      { ...input.employees[4], sector: "Sem horário" },
      { ...input.employees[5], sector: "Sem horário" },
    ];
    input.assignments = [{ employeeId: input.employees[0].id, date: "2026-11-03", kind: "OFF" }];
    expect(sectorPresenceGaps(input)).toEqual([{ sector: "Reposição", dates: ["2026-11-03"], withoutPositiveReferenceDates: ["2026-11-03"] }]);
  });
  it("counts actual overnight presence on the civil date, without treating a meal break as service", () => {
    const input = fixture(); input.visibleMonth = undefined; input.startDate = "2026-11-02"; input.endDate = "2026-11-02";
    input.employees = [input.employees[0]];
    input.shifts = [{ id: "night", name: "Noite", segments: [{ start: 1320, end: 1500, kind: "WORK" }] }];
    input.employees[0].history = [{ employeeId: "a", date: "2026-11-01", kind: "WORK", shiftId: "night" }];
    input.assignments = [];
    expect(sectorPresenceGaps(input)).toEqual([]);
    input.shifts[0].segments = [{ start: 1320, end: 1440, kind: "WORK" }, { start: 1440, end: 1500, kind: "BREAK" }];
    input.assignments = [{ employeeId: "a", date: "2026-11-02", kind: "OFF" }];
    expect(sectorPresenceGaps(input)).toEqual([{ sector: "Reposição", dates: ["2026-11-02"], withoutPositiveReferenceDates: ["2026-11-02"] }]);
  });
  it("does not call an unassigned draft date a whole planned day without timed coverage", () => {
    const input = fixture();
    input.assignments = [];
    expect(sectorPresenceGaps(input)).toEqual([]);
  });

  it("uses real endpoints, not rounded buckets; never counts pauses, excluded, missing, untimed or outside employment", () => {
    const input = fixture(), before = structuredClone(input), index = buildCoveragePresence(input);
    expect(coverageAt(index, "2026-11-02", "Reposição", 575)).toEqual([]);
    expect(coverageAt(index, "2026-11-02", "Reposição", 576).map(p => p.id).sort()).toEqual(["a", "manager"]);
    expect(coverageAt(index, "2026-11-02", "Reposição", 580)).toHaveLength(3);
    expect(coverageAt(index, "2026-11-02", "Reposição", 840)).toEqual([]);
    expect(coverageAt(index, "2026-11-02", "Reposição", 930).map(p => p.id)).toEqual(["b"]);
    expect(coverageAt(index, "2026-11-02", "Reposição", 1200).map(p => p.id)).toEqual(["b"]);
    expect(coverageAt(index, "2026-11-02", "Reposição", 1204)).toEqual([]);
    expect(coverageTimeline(input, "2026-11-02", "Reposição", index).map(s => s.start)).toEqual([576, 580, 810, 840, 930, 960, 1200]);
    expect(input).toEqual(before);
  });
  it("excludes full absence, off and outside employment; respects overrides over known overnight context and counts each person once", () => {
    const input = fixture(); input.employees = [input.employees[0]];
    input.shifts = [{ id: "night", name: "Noite", segments: [{ start: 1320, end: 1500, kind: "WORK" }] }];
    const previous = { employeeId: "a", date: "2026-11-01", kind: "WORK" as const, shiftId: "night" };
    input.employees[0].history = [previous]; input.employees[0].planningHistory = [previous]; input.assignments = [previous];
    expect(coverageAt(buildCoveragePresence(input), "2026-11-02", "Reposição", 0)).toHaveLength(1);
    expect(coverageAt(buildCoveragePresence(input), "2026-11-02", "Reposição", 60)).toEqual([]);
    input.assignments.push({ employeeId: "a", date: "2026-11-02", kind: "ABSENCE" });
    expect(coverageAt(buildCoveragePresence(input), "2026-11-02", "Reposição", 0)).toEqual([]);
  });
  it("does not let a manager satisfy an absent function and consolidates equivalent contiguous intervals", () => {
    const input = fixture(); input.assignments = input.assignments.filter(a => a.employeeId === "manager");
    input.demands = [{ id: "x", date: "2026-11-02", sector: "Reposição", role: "Repositor", start: 576, end: 600, minimum: 1 },
      { id: "y", date: "2026-11-02", sector: "Reposição", role: "Repositor", start: 600, end: 660, minimum: 1 },
      { id: "z", date: "2026-11-02", sector: "Reposição", start: 576, end: 660, minimum: 1 }];
    const gaps = sectorCoverageGaps(input);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ start: 576, end: 660, present: 1, minimum: 1, estimated: false, kind: "minimum", roles: [{ role: "Repositor", present: 0, minimum: 1, estimated: false }] });
  });
  it("keeps soft estimates distinct from real minimums, avoids double-counting overlapping role and sector references", () => {
    const input = fixture();
    input.demands = [{ id: "a", date: "2026-11-02", sector: "Reposição", start: 580, end: 600, minimum: 3 },
      { id: "b", date: "2026-11-02", sector: "Reposição", role: "Repositor", start: 580, end: 600, minimum: 2 },
      { id: "c", date: "2026-11-02", sector: "Reposição", role: "Repositor", start: 580, end: 600, minimum: 4, estimated: true }];
    expect(sectorCoverageGaps(input)).toMatchObject([{ present: 3, minimum: 4, estimated: true, kind: "estimate", roles: [{ role: "Repositor", present: 2, minimum: 4, estimated: true }] }]);
  });
  it("does not call a difference from an estimate a proven operational shortage", () => {
    const input = fixture(); input.assignments = [];
    input.demands = [{ id: "e", date: "2026-11-02", sector: "Reposição", start: 580, end: 600, minimum: 1, estimated: true }];
    expect(sectorCoverageGaps(input)[0]).toMatchObject({ present: 0, estimated: true, kind: "no-service" });
    expect(sectorCoverageGaps(input)[0].suggestion).toContain("estimativa");
  });
  it("preserves zero-demand boundaries without adding or moving gaps across dates and sectors", () => {
    const input = fixture();
    input.assignments = input.assignments.filter((assignment) => assignment.employeeId === "manager");
    input.demands = [
      { id: "zero-inside", date: "2026-11-02", sector: "Reposição", start: 610, end: 620, minimum: 0 },
      { id: "estimate", date: "2026-11-03", sector: "Caixa", role: "Operador", start: 580, end: 600, minimum: 2, estimated: true },
      { id: "role", date: "2026-11-02", sector: "Reposição", role: "Repositor", start: 580, end: 650, minimum: 1 },
      { id: "zero-only", date: "2026-11-02", sector: "Zero", start: 580, end: 600, minimum: 0 },
      { id: "hard", date: "2026-11-03", sector: "Caixa", start: 560, end: 580, minimum: 1 },
      { id: "outside", date: "2026-10-31", sector: "Reposição", start: 580, end: 650, minimum: 5 },
    ];

    expect(coverageTimeline(input, "2026-11-02", "Reposição")).toEqual(expect.arrayContaining([
      expect.objectContaining({ start: 580, end: 610, minimum: 1, hasReference: true }),
      expect.objectContaining({ start: 610, end: 620, minimum: 1, hasReference: true }),
      expect.objectContaining({ start: 620, end: 650, minimum: 1, hasReference: true }),
    ]));
    expect(coverageTimeline(input, "2026-11-02", "Zero")).toMatchObject([
      { start: 580, end: 600, minimum: 0, hasReference: true },
    ]);
    expect(sectorCoverageGaps(input)).toMatchObject([
      { date: "2026-11-03", sector: "Caixa", start: 560, end: 580, present: 0, minimum: 1, estimated: false, roles: [] },
      { date: "2026-11-02", sector: "Reposição", start: 580, end: 650, present: 1, minimum: 1, estimated: false,
        roles: [{ role: "Repositor", present: 0, minimum: 1, estimated: false }] },
      { date: "2026-11-03", sector: "Caixa", start: 580, end: 600, present: 0, minimum: 2, estimated: true,
        roles: [{ role: "Operador", present: 0, minimum: 2, estimated: true }] },
    ]);
  });
});
