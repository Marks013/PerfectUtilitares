import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { matchesRestOnlyReferences, prepareGeneration } from "./generation";
import { matchesHoursOnlyAssignments } from "./hours-reference";
import { automaticShiftAlternatives, preparedShiftSignature, prepareRoster, stableShiftReferences } from "./preparation";
import { adaptCompatibleSchedules } from "./schedule-adaptation";
import { materializeManualShiftOverrides, withManualShiftOverride } from "./shift-catalog/manual-override";
import type { EscalaInput, EscalaShift } from "./types";

const paid = (shift: EscalaShift) => shift.segments.reduce((total, segment) => total + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0);
function fixture(daily = 440): EscalaInput {
  const input = newInput("08", "Synthetic", "2026-11", 42);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-08"; delete input.visibleMonth;
  input.policy.compensationAuthorized = true; input.policy.limitContinuousWorkBlocks = false;
  const end = 720 + daily - 240, clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
  input.shifts = [{ id: "original", name: "Imported weekday", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 720, kind: "BREAK" }, { start: 720, end, kind: "WORK" }] }];
  input.employees = [{ ...newEmployee(42, "original"), id: "one", registration: "S1", name: "Synthetic", role: "Operador", sector: "Loja", weeklyHoursMode: "BRANCH", scheduleMode: "TIMED",
    sourceSchedule: { report: "FPRE136", code: "S", description: "Original", weekday: `07:00-11:00 / 12:00-${clock(end)}`, saturday: "08:00-12:00 / 13:00-16:20" } }];
  input.assignments = []; input.demands = []; return input;
}
function auto(shift: EscalaShift, prefix = "prep-") {
  let hash = 2166136261;
  for (const c of preparedShiftSignature(shift)) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return { ...shift, id: `${prefix}${(hash >>> 0).toString(16)}` };
}
function choices(input: EscalaInput) {
  return input.employees[0].shiftIds.flatMap(id => { const shift = input.shifts.find(s => s.id === id); return shift ? [shift] : []; });
}
describe("stable automatic imported clock references", () => {
  it.each(["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const)("preserves every imported clock boundary at the same paid duration in %s", generationMode => {
    const input = fixture(504); input.generationMode = generationMode;
    const before = structuredClone(input), result = prepareGeneration(input).input;
    expect(choices(result)).toHaveLength(1); expect(choices(result)[0].segments).toEqual(input.shifts[0].segments);
    expect(result.employees[0].fixedImportedShiftId).toBe(choices(result)[0].id);
    expect(result.employees[0].sourceSchedule).toEqual(before.employees[0].sourceSchedule); expect(input).toEqual(before);
  });
  it.each(["REST_ONLY", "HOURS_ONLY", "DAYS_AND_HOURS"] as const)("adapts the load to one nearby stable geometry in %s", generationMode => {
    const input = fixture(); input.generationMode = generationMode;
    const before = structuredClone(input), result = prepareGeneration(input).input, selected = choices(result);
    expect(selected).toHaveLength(1); expect(paid(selected[0])).toBe(504);
    expect(selected[0].segments[0].start).toBe(420);
    expect(selected[0].segments.filter(s => s.kind === "BREAK")).toEqual(input.shifts[0].segments.filter(s => s.kind === "BREAK"));
    expect(result.employees[0].fixedImportedShiftId).toBe(selected[0].id);
    expect(choices(prepareGeneration(result).input).map(preparedShiftSignature)).toEqual(selected.map(preparedShiftSignature));
    expect(result.employees[0].sourceSchedule).toEqual(before.employees[0].sourceSchedule); expect(input).toEqual(before);
  });
  it("distinguishes a changed meal from an identical clock even with the same entry, exit and paid duration", () => {
    const input = fixture(504), reference = input.shifts[0], moved = structuredClone(reference);
    moved.id = "meal-shifted"; moved.segments[0].end += 30; moved.segments[1].start += 30; moved.segments[1].end += 30; moved.segments[2].start += 30;
    expect(paid(moved)).toBe(paid(reference));
    expect(stableShiftReferences(reference, [moved, reference])).toEqual([reference]);
    expect(automaticShiftAlternatives(input.employees[0], auto(reference), false, 1200, 120)).toHaveLength(1);
  });
  it("collapses legacy automatic alternatives and rejects a free-day switch, preserving the locked exception", () => {
    const input = fixture(), base = auto({ ...input.shifts[0], segments: input.shifts[0].segments.map((s, i) => i === 2 ? { ...s, end: s.end + 64 } : s) });
    const later = auto({ ...base, segments: base.segments.map(s => ({ ...s, start: s.start + 180, end: s.end + 180 })) }, "flex-");
    input.shifts.push(base, later); input.employees[0].shiftIds = [later.id, base.id];
    input.assignments = [{ employeeId: "one", date: input.startDate, kind: "WORK", shiftId: later.id, locked: true }];
    const before = structuredClone(input), result = prepareGeneration(input).input, fixed = result.employees[0].fixedImportedShiftId;
    expect(fixed).toBe(base.id); expect(result.assignments).toEqual(input.assignments);
    expect(matchesRestOnlyReferences(result, [...input.assignments, { employeeId: "one", date: "2026-11-03", kind: "WORK", shiftId: later.id }])).toBe(false);
    expect(matchesRestOnlyReferences(result, [...input.assignments, { employeeId: "one", date: "2026-11-03", kind: "WORK", shiftId: fixed }])).toBe(true);
    expect(input).toEqual(before);
  });
  it("preserves HOURS_ONLY day classifications while its final clock must match the stable reference", () => {
    const input = fixture(); input.generationMode = "HOURS_ONLY";
    input.assignments = [{ employeeId: "one", date: input.startDate, kind: "WORK", shiftId: "original" }, { employeeId: "one", date: "2026-11-03", kind: "OFF" }, { employeeId: "one", date: "2026-11-04", kind: "ABSENCE", locked: true }];
    const prepared = prepareGeneration(input).input, result = structuredClone(prepared);
    expect(prepared.assignments).toEqual(input.assignments);
    result.assignments[0].shiftId = result.employees[0].fixedImportedShiftId;
    expect(matchesHoursOnlyAssignments(prepared, result)).toBe(true);
    result.assignments[0].shiftId = "original"; expect(matchesHoursOnlyAssignments(prepared, result)).toBe(false);
  });
  it("keeps an explicit manual clock only within its real date interval", () => {
    const input = fixture(); input.generationMode = "DAYS_AND_HOURS";
    input.employees[0] = withManualShiftOverride(input.employees[0], { catalogCode: 1500, shiftId: "manual", markings: ["09:00", "13:00", "14:00", "18:24"], effectiveFrom: "2026-11-03", effectiveUntil: "2026-11-05" });
    const materialized = materializeManualShiftOverrides(input), before = structuredClone(materialized), result = prepareGeneration(materialized).input;
    expect(result.employees[0].manualShiftByDate?.["2026-11-04"]).toBe("manual");
    expect(result.employees[0].manualShiftByDate?.["2026-11-06"]).toBeUndefined();
    expect(matchesRestOnlyReferences(result, [{ employeeId: "one", date: "2026-11-04", kind: "WORK", shiftId: "manual" }])).toBe(true);
    expect(matchesRestOnlyReferences(result, [{ employeeId: "one", date: "2026-11-06", kind: "WORK", shiftId: "manual" }])).toBe(false);
    expect(materialized).toEqual(before);
  });
  it("retains only the opted-in 8h and 9h geometries near the same imported turn", () => {
    const input = fixture(); input.mixed42Sectors = ["Loja"];
    const result = prepareGeneration(input).input, selected = choices(result);
    expect(selected).toHaveLength(2); expect(new Set(selected.map(paid))).toEqual(new Set([480, 540]));
    expect(selected.map(s => s.segments[0].start)).toEqual([420, 420]);
    expect(result.employees[0].fixedImportedShiftId).toBeUndefined();
    expect(choices(prepareGeneration({ ...result, mixed42Sectors: [] }).input)).toHaveLength(1);
  });
  it("keeps the distinct Saturday source as provenance instead of authorizing its clock on arbitrary weekdays", () => {
    const input = fixture(504);
    if (!input.employees[0].sourceSchedule) throw new Error("Synthetic source missing");
    input.employees[0].sourceSchedule.saturday = "08:00-12:00 / 13:00-17:24";
    const before = structuredClone(input);
    const result = prepareGeneration(input).input;
    expect(result.employees[0].sourceSchedule).toEqual(before.employees[0].sourceSchedule);
    expect(choices(result)).toHaveLength(1); expect(choices(result)[0].segments[0].start).toBe(420);
    expect(result.employees[0].sourceSchedule?.saturday).toBe("08:00-12:00 / 13:00-17:24");
  });
  it("selects one stable explicit adaptation while retaining the requested entry anchor", () => {
    const input = fixture(), before = structuredClone(input);
    const result = adaptCompatibleSchedules(input, "PRESERVE_START");
    expect(result.exceptions).toEqual([]); expect(choices(result.input)).toHaveLength(1);
    expect(choices(result.input)[0].segments[0].start).toBe(420); expect(input).toEqual(before);
    expect(choices(prepareRoster(input, 42))).toHaveLength(1);
  });
});
