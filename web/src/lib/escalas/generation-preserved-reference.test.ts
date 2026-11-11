import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { matchesRestOnlyReferences, prepareGeneration } from "./generation";
import { usesMixed42 } from "./labor-rules";
import { preparedShiftSignature, prepareRoster } from "./preparation";
import { escalaInputSchema } from "./schema";
import type { EscalaInput, EscalaShift, WeeklyHours } from "./types";

const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const paid = (shift: EscalaShift) => shift.segments.reduce((total, part) => total + (part.kind === "BREAK" ? 0 : part.end - part.start), 0);

function fixture(imported: WeeklyHours = 42, requested: WeeklyHours = imported): EscalaInput {
  const input = newInput("08", "Loja", "2026-11", requested);
  input.startDate = "2026-11-02"; input.endDate = "2026-11-15";
  delete input.visibleMonth;
  input.generationMode = "DAYS_AND_HOURS";
  input.shifts = [{ id: "imported", name: "Original do arquivo", segments: [
    { start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" },
    { start: 780, end: 780 + imported * 12 - 240, kind: "WORK" },
  ] }];
  input.employees = [{ ...newEmployee(imported, "imported"), id: "p1", registration: "001", name: "Pessoa", sector: "Caixa",
    role: "Operador", weeklyHoursMode: "BRANCH", scheduleMode: "TIMED", sourceSchedule: {
      report: "FPRE136", code: "001", description: "Referência importada",
      weekday: `08:00-12:00 / 13:00-${clock(780 + imported * 12 - 240)}`, saturday: "08:00-12:00",
    } }];
  input.assignments = []; input.demands = [];
  return input;
}

describe("imported clocks already compatible with the chosen 5x2 journey", () => {
  it.each([40, 42, 44] as const)("keeps the exact imported %ih reference in both generation modes", hours => {
    for (const generationMode of ["REST_ONLY", "DAYS_AND_HOURS"] as const) {
      const input = { ...fixture(hours), generationMode }, before = structuredClone(input);
      const first = prepareGeneration(input).input, person = first.employees[0];
      expect(person.fixedImportedShiftId).toEqual(expect.any(String));
      const reference = first.shifts.find(shift => shift.id === person.fixedImportedShiftId);
      expect(reference?.segments).toEqual(input.shifts[0].segments);
      expect(person.sourceSchedule).toEqual(input.employees[0].sourceSchedule);
      expect(person.weeklyHours).toBe(hours);
      expect(escalaInputSchema.safeParse(first).success).toBe(true);
      const second = prepareGeneration(first).input;
      expect(second.employees[0].fixedImportedShiftId).toBe(person.fixedImportedShiftId);
      expect(second.shifts.find(shift => shift.id === person.fixedImportedShiftId)?.segments).toEqual(reference?.segments);
      expect(input).toEqual(before);
    }
  });

  it.each([[44, 42], [44, 40], [42, 40]] as const)("still adapts %ih references to a requested %ih journey", (imported, requested) => {
    const input = fixture(imported, requested), before = structuredClone(input);
    const result = prepareGeneration(input).input, person = result.employees[0];
    expect(person.fixedImportedShiftId).toBeUndefined();
    expect(person.weeklyHours).toBe(requested);
    const options = person.shiftIds.map(id => result.shifts.find(shift => shift.id === id) as EscalaShift);
    expect(options.length).toBeGreaterThan(1);
    expect(options.every(shift => paid(shift) === requested * 12)).toBe(true);
    expect(person.sourceSchedule).toEqual(input.employees[0].sourceSchedule);
    expect(input).toEqual(before);
  });

  it("does not treat a branch default of 42h as evidence that a 7h20 imported day is compatible", () => {
    const input = fixture();
    input.shifts[0].segments[2].end = 980;
    if (!input.employees[0].sourceSchedule) throw new Error("Missing source fixture");
    input.employees[0].sourceSchedule.weekday = "08:00-12:00 / 13:00-16:20";
    const result = prepareGeneration(input).input, person = result.employees[0];
    expect(person.weeklyHours).toBe(42);
    expect(person.fixedImportedShiftId).toBeUndefined();
    expect(person.shiftIds.every(id => paid(result.shifts.find(shift => shift.id === id) as EscalaShift) === 504)).toBe(true);
  });

  it("preserves a compatible imported meal rather than moving it because of the automatic block preference", () => {
    const input = fixture(); input.policy.limitContinuousWorkBlocks = true;
    input.shifts[0].segments = [{ start: 480, end: 780, kind: "WORK" }, { start: 780, end: 840, kind: "BREAK" },
      { start: 840, end: 1044, kind: "WORK" }];
    if (!input.employees[0].sourceSchedule) throw new Error("Missing source fixture");
    input.employees[0].sourceSchedule.weekday = "08:00-13:00 / 14:00-17:24";
    const result = prepareGeneration(input).input, id = result.employees[0].fixedImportedShiftId;
    expect(id).toEqual(expect.any(String));
    expect(result.shifts.find(shift => shift.id === id)?.segments).toEqual(input.shifts[0].segments);
  });

  it("restores an unchanged imported reference from saved automatic proposals instead of retaining a displaced meal", () => {
    const input = fixture(); input.policy.limitContinuousWorkBlocks = true;
    input.shifts[0].segments = [{ start: 480, end: 780, kind: "WORK" }, { start: 780, end: 840, kind: "BREAK" },
      { start: 840, end: 1044, kind: "WORK" }];
    if (!input.employees[0].sourceSchedule) throw new Error("Missing source fixture");
    input.employees[0].sourceSchedule.weekday = "08:00-13:00 / 14:00-17:24";
    const saved = prepareRoster({ ...input, simulation: true }, 42), before = structuredClone(saved);
    const result = prepareGeneration(saved).input, id = result.employees[0].fixedImportedShiftId;
    expect(id).toEqual(expect.any(String));
    expect(preparedShiftSignature(result.shifts.find(shift => shift.id === id) as EscalaShift)).toBe(preparedShiftSignature(input.shifts[0]));
    expect(saved).toEqual(before);
  });

  it("rejects free-day clock substitutions while retaining a different clock only on its locked date", () => {
    const input = fixture(), later = structuredClone(input.shifts[0]); later.id = "later";
    later.segments = later.segments.map(part => ({ ...part, start: part.start + 30, end: part.end + 30 }));
    input.shifts.push(later); input.employees[0].shiftIds.unshift(later.id);
    input.assignments = [{ employeeId: "p1", date: "2026-11-02", kind: "WORK", shiftId: "later", locked: true },
      { employeeId: "p1", date: "2026-11-03", kind: "ABSENCE", locked: true }];
    const result = prepareGeneration(input).input, id = result.employees[0].fixedImportedShiftId;
    expect(result.assignments).toEqual(input.assignments);
    expect(matchesRestOnlyReferences(result, [...input.assignments,
      { employeeId: "p1", date: "2026-11-04", kind: "WORK", shiftId: id }])).toBe(true);
    expect(matchesRestOnlyReferences(result, [{ employeeId: "p1", date: "2026-11-04", kind: "WORK", shiftId: "later" }])).toBe(false);
  });

  it("keeps explicitly selected mixed 42h distribution available instead of pinning the uniform imported reference", () => {
    const input = fixture(); input.mixed42Sectors = ["Caixa"];
    const result = prepareGeneration(input).input, person = result.employees[0];
    expect(person.fixedImportedShiftId).toBeUndefined();
    expect(new Set(person.shiftIds.map(id => paid(result.shifts.find(shift => shift.id === id) as EscalaShift)))).toEqual(new Set([480, 540]));
  });

  it("normalizes a legacy short-day marker before applying explicitly selected mixed 42h", () => {
    const input = fixture(); input.mixed42Sectors = ["Caixa"];
    input.employees[0].simulationDailyMinutes = 350;
    const before = structuredClone(input), result = prepareGeneration(input).input, person = result.employees[0];
    expect(person.simulationDailyMinutes).toBeUndefined();
    expect(usesMixed42(result, person)).toBe(true);
    expect(person.fixedImportedShiftId).toBeUndefined();
    expect(new Set(person.shiftIds.map(id => paid(result.shifts.find(shift => shift.id === id) as EscalaShift)))).toEqual(new Set([480, 540]));
    expect(person.sourceSchedule).toEqual(before.employees[0].sourceSchedule);
    expect(input).toEqual(before);
  });

  it("does not restore an old imported clock over an explicitly edited manual reference", () => {
    const input = fixture(), manual = input.shifts[0];
    manual.id = "manual-selected";
    manual.segments = manual.segments.map(part => ({ ...part, start: part.start + 15, end: part.end + 15 }));
    input.employees[0].shiftIds = [manual.id];
    const before = structuredClone(input), result = prepareGeneration(input).input;
    expect(result.employees[0].fixedImportedShiftId).toBeUndefined();
    expect(result.shifts).toEqual(before.shifts);
    expect(input).toEqual(before);
  });

  it("discards a stale imported-clock restriction when the requested journey changes", () => {
    const input = fixture(44, 42);
    input.employees[0].fixedImportedShiftId = "imported";
    const result = prepareGeneration(input).input, person = result.employees[0];
    expect(person.fixedImportedShiftId).toBeUndefined();
    expect(person.shiftIds.every(id => paid(result.shifts.find(shift => shift.id === id) as EscalaShift) === 504)).toBe(true);
  });

  it("requires an explicit correction when an unchanged compatible import exceeds the store closing", () => {
    const input = fixture(); input.storeClosingMinutes = 1020;
    expect(() => prepareGeneration(input)).toThrow(/importado.*fechamento|fechamento.*importado/i);
  });
});
