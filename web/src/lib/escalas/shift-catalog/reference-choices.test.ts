import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { employeeReferenceShiftChoices } from "./reference-choices";
import { buildEscalaSchedule } from "../presentation";

function fixture() {
  const input = newInput("01", "Synthetic", "2026-12", 42);
  input.visibleMonth = "2026-12"; input.generationMode = "HOURS_ONLY";
  input.shifts = [
    { id: "base", name: "Base", segments: [{ start: 420, end: 660, kind: "WORK" }, { start: 660, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] },
    { id: "manual", name: "Manual", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] },
  ];
  input.employees = [{ ...newEmployee(42, "base"), id: "e", scheduleMode: "TIMED", manualShiftOverrides: [{ catalogCode: 1500, shiftId: "manual", markings: ["08:00", "12:00", "13:00", "17:24"], effectiveFrom: "2026-12-03", effectiveUntil: "2026-12-10" }] }];
  input.assignments = []; return input;
}
describe("shared effective clock choices", () => {
  it("keeps paid pauses visible and credited without calling them ordinary work", () => {
    const input = fixture(), person = input.employees[0]; person.manualShiftOverrides = undefined;
    input.shifts[0].segments = [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 750, kind: "PAID_BREAK" }, { start: 750, end: 990, kind: "WORK" }];
    expect(employeeReferenceShiftChoices(input, person)[0].label).toContain("pausa remunerada");
    const row = buildEscalaSchedule(input).hoursPeople[0];
    expect(row.proposedVariants[0].daily).toBe("08:30");
    expect(row.proposedVariants[0].interval).toContain("pausa remunerada");
    expect(row.cells).toEqual([]); expect(input.assignments).toEqual([]);
  });
  it("retains equal-duration manual and base references without attendance", () => {
    const input = fixture(), before = structuredClone(input), person = input.employees[0];
    const choices = employeeReferenceShiftChoices(input, person);
    expect(choices.map(c => [c.shiftId, c.source])).toEqual([["base", "BASE"], ["manual", "MANUAL"]]);
    expect(choices.find(c => c.source === "MANUAL")?.label).toMatch(/03\/12\/2026.*10\/12\/2026/);
    const model = buildEscalaSchedule(input);
    expect(model.hoursPeople[0].proposedVariants.map(v => v.shiftId)).toHaveLength(2);
    expect(model.hoursPeople[0].proposedSchedule).toContain("manual");
    expect(model.dates).toEqual([]); expect(model.hoursPeople[0].cells).toEqual([]);
    expect(input).toEqual(before);
  });
  it("clips month and employment and suppresses the base when fully replaced", () => {
    const input = fixture(), person = input.employees[0];
    person.activeFrom = "2026-12-04"; person.activeUntil = "2026-12-08";
    expect(employeeReferenceShiftChoices(input, person).map(c => c.shiftId)).toEqual(["manual"]);
    (person.manualShiftOverrides as NonNullable<typeof person.manualShiftOverrides>)[0].effectiveFrom = "2026-11-30"; (person.manualShiftOverrides as NonNullable<typeof person.manualShiftOverrides>)[0].effectiveUntil = "2026-11-30";
    expect(employeeReferenceShiftChoices(input, person).map(c => c.shiftId)).toEqual(["base"]);
  });
  it("uses only real WORK variants, including applied clocks outside the base", () => {
    const input = fixture(), person = input.employees[0];
    input.assignments = [{ employeeId: person.id, date: "2026-12-04", kind: "WORK", shiftId: "manual" }, { employeeId: person.id, date: "2026-11-30", kind: "WORK", shiftId: "base" }];
    expect(employeeReferenceShiftChoices(input, person).map(c => [c.shiftId, c.source])).toEqual([["manual", "WORK"]]);
  });
  it("keeps excluded TIMED clocks exportable and ENC/MISSING without clocks", () => {
    const input = fixture(), person = input.employees[0]; person.planningEnabled = false;
    expect(employeeReferenceShiftChoices(input, person)).toHaveLength(2);
    expect(buildEscalaSchedule(input).hoursPeople).toHaveLength(1);
    expect(buildEscalaSchedule(input).people).toHaveLength(0);
    for (const mode of ["MISSING", "UNTIMED"] as const) expect(employeeReferenceShiftChoices(input, { ...person, scheduleMode: mode })).toEqual([]);
  });
  it("does not return missing references or clocks of another employee", () => {
    const input = fixture(), person = input.employees[0];
    input.assignments = [{ employeeId: "other", date: "2026-12-04", kind: "WORK", shiftId: "manual" }];
    input.shifts = input.shifts.filter(s => s.id !== "manual");
    expect(employeeReferenceShiftChoices(input, person).map(c => c.shiftId)).toEqual(["base"]);
  });
});
