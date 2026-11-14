import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { prepareGeneration } from "./generation";
import type { EscalaInput } from "./types";

function fixture(): EscalaInput {
  const input = newInput("02", "Teste", "2026-11", 42);
  input.shifts = [{ id: "source", name: "Importado", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1020, kind: "WORK" }] }];
  input.employees = [{ ...newEmployee(42, "source"), id: "person", name: "Pessoa", registration: "1", sector: "Loja", role: "Operador", weeklyHoursMode: "BRANCH", scheduleMode: "TIMED", sourceSchedule: {
    report: "FPRE136", code: "1", description: "Referência", weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00 / 00:00-00:00",
  } }];
  return input;
}

describe("stable endpoint selection in clock generation", () => {
  it("selects the nearest endpoint geometry without changing imported reference text or meal duration", () => {
    const input = fixture(), original = structuredClone(input), result = prepareGeneration(input).input;
    const shifts = result.employees[0].shiftIds.map(id => result.shifts.find(shift => shift.id === id));
    expect(shifts).toHaveLength(1);
    expect(shifts[0]?.segments[0].start).toBe(480);
    expect(shifts[0]?.segments.at(-1)?.end).toBe(1044);
    expect(shifts.every(shift => shift?.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0) === 504)).toBe(true);
    expect(shifts.every(shift => shift?.segments.filter(segment => segment.kind === "BREAK").every(segment => segment.end - segment.start === 60))).toBe(true);
    expect(result.employees[0].sourceSchedule).toEqual(input.employees[0].sourceSchedule);
    expect(input).toEqual(original);
  });
  it("keeps every existing assignment kind in HOURS_ONLY while selecting one compatible adjusted clock", () => {
    const input = fixture(); input.generationMode = "HOURS_ONLY";
    input.assignments = [{ employeeId: "person", date: "2026-11-02", kind: "WORK", shiftId: "source" },
      { employeeId: "person", date: "2026-11-03", kind: "OFF" },
      { employeeId: "person", date: "2026-11-04", kind: "ABSENCE", locked: true }];
    const original = structuredClone(input), result = prepareGeneration(input).input;
    expect(result.assignments).toEqual(input.assignments);
    expect(result.employees[0].shiftIds).toHaveLength(1);
    expect(result.shifts.find(shift => shift.id === "source")).toEqual(input.shifts[0]);
    expect(input).toEqual(original);
  });
  it("still pins an already compatible imported 42h reference instead of shifting it", () => {
    const input = fixture(); input.generationMode = "HOURS_ONLY";
    input.shifts[0].segments[2].end = 1044;
    const source = input.employees[0].sourceSchedule;
    if (!source) throw new Error("Missing fixture source"); source.weekday = "08:00-12:00 / 13:00-17:24";
    const result = prepareGeneration(input).input;
    expect(result.employees[0].fixedImportedShiftId).toBeTruthy();
    expect(result.shifts.find(shift => shift.id === result.employees[0].fixedImportedShiftId)?.segments).toEqual(input.shifts[0].segments);
  });
});
