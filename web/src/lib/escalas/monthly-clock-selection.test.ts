import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { prepareGeneration } from "./generation";
import { prepareRoster, preparedShiftSignature } from "./preparation";
import { selectMonthlyClockReferences, MONTHLY_CLOCK_WORK_LIMIT } from "./monthly-clock-selection";
import type { EscalaInput, EscalaShift } from "./types";

function fixture(): EscalaInput {
  const value = newInput("08", "Synthetic store", "2026-11", 42);
  value.startDate = "2026-11-02"; value.endDate = "2026-11-08";
  value.visibleMonth = undefined; value.policy.calendarMode = "MANUAL";
  value.generationMode = "DAYS_AND_HOURS";
  value.shifts = [{ id: "source", name: "Source", segments: [
    { start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 980, kind: "WORK" },
  ] }];
  value.employees = ["p1", "p2"].map(id => ({ ...newEmployee(42, "source"), id, registration: id,
    name: "Synthetic person", sector: "Service", role: "Operator", scheduleMode: "TIMED" as const,
    sourceSchedule: { report: "FPRE136" as const, code: "1", description: "Synthetic source", weekday: "07:00-11:00 / 13:00-16:20", saturday: "07:00-11:00" } }));
  value.assignments = value.employees.flatMap(person => [
    { employeeId: person.id, date: value.startDate, kind: "WORK" as const, shiftId: "source" },
    { employeeId: person.id, date: "2026-11-03", kind: "OFF" as const },
    { employeeId: person.id, date: "2026-11-04", kind: "ABSENCE" as const },
    { employeeId: person.id, date: "2026-11-05", kind: "HOLIDAY" as const },
  ]);
  value.demands = [
    { id: "opening", date: value.startDate, sector: "Service", role: "Operator", start: 356, end: 420, minimum: 1 },
    { id: "closing", date: value.startDate, sector: "Service", start: 980, end: 1044, minimum: 1 },
  ];
  return value;
}
function clocks(value: EscalaInput) { return value.employees.map(person => value.shifts.find(shift => shift.id === person.fixedImportedShiftId) as EscalaShift); }
const paid = (shift: EscalaShift) => shift.segments.reduce((total, part) => total + (part.kind === "BREAK" ? 0 : part.end - part.start), 0);

describe("bounded collective monthly automatic clocks", () => {
  it.each(["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const)("uses existing presence and a frozen ruler before discarding legal alternatives in %s", mode => {
    const input = fixture(); input.generationMode = mode;
    const before = structuredClone(input), prepared = prepareGeneration(input).input;
    expect(clocks(prepared).map(shift => shift.segments[0].start).sort((a, b) => a - b)).toEqual([356, 420]);
    expect(prepared.employees.every(person => person.shiftIds.length === 1)).toBe(true);
    expect(clocks(prepared).every(shift => paid(shift) === 504)).toBe(true);
    expect(prepared.demands.filter(demand => !demand.estimated)).toEqual(input.demands);
    expect(prepared.assignments.filter(day => day.kind !== "WORK")).toEqual(input.assignments.filter(day => day.kind !== "WORK"));
    expect(prepared.employees.map(person => person.sourceSchedule)).toEqual(input.employees.map(person => person.sourceSchedule));
    expect(prepareGeneration(prepared).input).toEqual(prepared);
    expect(input).toEqual(before);
  });
  it("selects collectively in prepareRoster and preserves explicit OFF without inventing attendance", () => {
    const input = fixture(), before = structuredClone(input);
    const prepared = prepareRoster(input, 42);
    expect(clocks(prepared).map(shift => shift.segments[0].start).sort((a, b) => a - b)).toEqual([356, 420]);
    expect(prepared.assignments).toEqual(input.assignments.filter(day => day.kind !== "WORK"));
    expect(clocks(prepareRoster(prepared, 42)).map(preparedShiftSignature)).toEqual(clocks(prepared).map(preparedShiftSignature));
    expect(input).toEqual(before);
  });
  it("keeps the nearest stable fallback when no alternative improves or presence is absent", () => {
    for (const absent of [false, true]) {
      const input = fixture(); input.demands = input.demands.filter(demand => demand.id === "closing");
      if (absent) input.assignments = [];
      const prepared = prepareGeneration(input).input;
      expect(clocks(prepared).every(shift => shift.segments[0].start === 420)).toBe(true);
      if (absent) expect(prepared.assignments).toEqual([]);
    }
  });
  it("does not reopen an imported clock already compatible with configured hours for a deficit", () => {
    const input = fixture();
    for (const person of input.employees) if (person.sourceSchedule) person.sourceSchedule.weekday = "07:00-11:00 / 13:00-17:24";
    input.shifts[0].segments[2].end = 1044;
    const prepared = prepareGeneration(input).input;
    expect(clocks(prepared).every(shift => shift.id === "source")).toBe(true);
    expect(prepared.assignments).toEqual(input.assignments);
  });
  it("does not trade confirmed coverage for an estimated gain or use another function as a substitute", () => {
    const input = fixture(); input.demands[0].estimated = true; input.demands[1].minimum = 2;
    expect(clocks(prepareGeneration(input).input).every(shift => shift.segments[0].start === 420)).toBe(true);
    input.demands[0].role = "Different function"; input.demands[1].minimum = 1;
    expect(clocks(prepareGeneration(input).input).every(shift => shift.segments[0].start === 420)).toBe(true);
  });
  it.each(["GENERAL", "ROLE"] as const)("protects the Operator evening band from a %s opening gain with equal total deficit", opening => {
    const input = fixture(); input.employees = input.employees.slice(0, 1);
    const baseline: EscalaShift = { id: "baseline", name: "Stable baseline", segments: [
      { start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" },
    ] };
    const alternative: EscalaShift = { id: "alternative", name: "Earlier alternative", segments: [
      { start: 356, end: 626, kind: "WORK" }, { start: 626, end: 746, kind: "BREAK" }, { start: 746, end: 980, kind: "WORK" },
    ] };
    input.shifts = [baseline];
    input.assignments = [{ employeeId: "p1", date: input.startDate, kind: "WORK", shiftId: baseline.id }];
    input.demands = [
      { id: "opening", date: input.startDate, sector: "Service", ...(opening === "ROLE" ? { role: "Operator" } : {}), start: 356, end: 420, minimum: 2, estimated: true },
      { id: "evening", date: input.startDate, sector: "Service", role: "Operator", start: 980, end: 1044, minimum: 1, estimated: true },
    ];
    const before = structuredClone(input);
    expect(paid(baseline)).toBe(504); expect(paid(alternative)).toBe(504);
    expect(alternative.segments.filter(part => part.kind === "WORK").every(part => part.end - part.start <= 270)).toBe(true);
    expect(alternative.segments[1].end - alternative.segments[1].start).toBe(120);
    const result = selectMonthlyClockReferences(input, [{ employeeId: "p1", baseline: [baseline], candidates: [baseline, alternative] }]);
    expect(result.changes).toBe(0);
    expect(result.references.get("p1")).toEqual([baseline]);
    expect(input).toEqual(before);
  });
  it("keeps locked work as actual fixed presence and excludes untimed or disabled people", () => {
    const input = fixture(); input.assignments[0].locked = true;
    input.employees[1].scheduleMode = "UNTIMED";
    const prepared = prepareGeneration(input).input;
    expect(prepared.assignments).toContainEqual(input.assignments[0]);
    expect(clocks(prepared)[0].segments[0].start).toBe(420);
    const disabled = fixture(); disabled.employees.forEach(person => { person.planningEnabled = false; });
    expect(prepareGeneration(disabled).input.employees.every(person => person.planningEnabled === false)).toBe(true);
  });
  it("applies collective selection when existing automatic alternatives already match the paid target", () => {
    const input = fixture();
    const first = prepareRoster({ ...input, assignments: [] }, 42, "EXCLUDE", "PRESERVE_START");
    const second = prepareRoster({ ...input, assignments: [] }, 42, "EXCLUDE", "PRESERVE_END");
    input.shifts.push(...first.shifts, ...second.shifts);
    input.employees.forEach(person => { person.shiftIds = [...new Set([...first.employees[0].shiftIds, ...second.employees[0].shiftIds])]; });
    const prepared = prepareGeneration(input).input;
    expect(clocks(prepared).map(shift => shift.segments[0].start).sort((a, b) => a - b)).toEqual([356, 420]);
  });
  it("never invents clock presence for a saved WORK whose shift definition is missing", () => {
    const input = fixture();
    const baseline = prepareRoster({ ...input, assignments: [] }, 42, "EXCLUDE", "PRESERVE_START").shifts[0];
    const alternative = prepareRoster({ ...input, assignments: [] }, 42, "EXCLUDE", "PRESERVE_END").shifts[0];
    input.assignments.forEach(record => { if (record.kind === "WORK") record.shiftId = "unknown"; });
    const before = structuredClone(input);
    const result = selectMonthlyClockReferences(input, [{ employeeId: "p1", baseline: [baseline], candidates: [baseline, alternative] }]);
    expect(result.changes).toBe(0); expect(result.references.get("p1")).toEqual([baseline]);
    expect(input).toEqual(before);
  });
  it("falls back as a whole when the input size exceeds the explicit budget", () => {
    const input = fixture(), baseline = input.shifts[0];
    input.demands = Array.from({ length: 12001 }, (_, index) => ({ ...input.demands[0], id: String(index) }));
    const result = selectMonthlyClockReferences(input, [{ employeeId: "p1", baseline: [baseline], candidates: [baseline] }]);
    expect(result.limited).toBe(true); expect(result.changes).toBe(0);
    expect(result.references.get("p1")).toEqual([baseline]);
  });
  it("bounds candidate displacement and work, with a small representative incremental cost", () => {
    const input = fixture(), person = input.employees[0];
    const baseline = prepareRoster({ ...input, assignments: [] }, 42, "EXCLUDE", "PRESERVE_START").shifts[0];
    const alternative = prepareRoster({ ...input, assignments: [] }, 42, "EXCLUDE", "PRESERVE_END").shifts[0];
    const distant = { ...alternative, id: "distant", segments: alternative.segments.map(part => ({ ...part, start: part.start - 120, end: part.end - 120 })) };
    const dates = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06"];
    input.employees = Array.from({ length: 24 }, (_, index) => ({ ...person, id: `synthetic-${String(index).padStart(2, "0")}` }));
    input.assignments = input.employees.flatMap(employee => dates.map(date => ({ employeeId: employee.id, date, kind: "WORK" as const, shiftId: "source" })));
    input.demands = dates.flatMap(date => fixture().demands.map(demand => ({ ...demand, id: demand.id + date, date, minimum: 12 })));
    const choices = input.employees.map(employee => ({ employeeId: employee.id, baseline: [baseline], candidates: [baseline, alternative, distant] }));
    const started = performance.now(); const result = selectMonthlyClockReferences(input, choices);
    expect(result.changes).toBe(12); expect(result.workUnits).toBeLessThanOrEqual(MONTHLY_CLOCK_WORK_LIMIT);
    expect([...result.references.values()].every(references => references[0].id !== "distant")).toBe(true);
    console.info(`MONTHLY_CLOCK_SYNTHETIC elapsedMs=${(performance.now() - started).toFixed(3)} workUnits=${result.workUnits} changes=${result.changes}`);
  });
});
