import { describe, expect, it } from "vitest";
import { newInput } from "@/components/escalas/workspace-model";
import type { EscalaEmployee, EscalaInput } from "./types";
import { buildCoveragePresence, coverageAt, coverageTimeline, sectorCoverageGaps } from "./coverage-presence";

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
});
