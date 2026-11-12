import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "../../components/escalas/workspace-model";
import { applyRestEligibility } from "./eligibility";
import { prepareGeneration } from "./generation";
import { previewEscalaRows } from "./import";
import { prepareRoster } from "./preparation";

function fixture(weekday: string) {
  const input = newInput("02", "Teste", "2026-11", 42);
  input.simulation = true;
  input.employees = [{ ...newEmployee(42, input.shifts[0].id), id: "person", name: "Pessoa", registration: "1", sector: "Loja", role: "Operador", activeFrom: "2020-01-01", scheduleMode: "TIMED", sourceSchedule: {
    report: "FPRE136", code: "1", description: "Referência", weekday, saturday: "08:00-12:00 / 00:00-00:00",
  } }];
  input.assignments = [{ employeeId: "person", date: input.startDate, kind: "ABSENCE", locked: true },
    { employeeId: "person", date: "2026-11-03", kind: "WORK", shiftId: input.shifts[0].id, locked: true }];
  return input;
}
function report(weekday: string[]) {
  return [["0001", "-", "Empresa sintética", "Pág.:", "1"], ["Quadro de Horários"], ["", "Nome", "Cargo", "Horário"],
    ["02.01 , ICARAIMA, CAIXA"], ["Horário:", "001", "-", "Referência"],
    ["001", "-", "Pessoa", "OPERADOR", weekday[0], "-", weekday[1], weekday[2], "-", weekday[3]],
    ["Sábado:", "08:00", "-", "12:00", "00:00", "-", "00:00"]];
}

describe("short principal imported journeys stay outside generation", () => {
  it.each(["07:00-10:00 / 12:00-14:50", "07:00-11:00 / 00:00-00:00"])("excludes %s without extending clocks or deleting protected records", weekday => {
    const input = fixture(weekday), original = structuredClone(input), result = prepareGeneration(input);
    expect(result.input.employees[0]).toMatchObject({ planningEnabled: false, weeklyHours: 42, sourceSchedule: input.employees[0].sourceSchedule });
    expect(result.input.employees[0].planningExclusionReason).toContain("principal");
    expect(result.preparation.excludedEmployeeIds).toEqual(["person"]);
    expect(result.preparation.includedEmployees).toBe(0);
    expect(result.input.assignments).toEqual(input.assignments);
    expect(result.input.shifts).toEqual(input.shifts);
    expect(input).toEqual(original);
  });
  it("keeps a 4h Saturday separate from an 8h weekday reference (40h + 4h)", () => {
    const rows = report(["08:00", "12:00", "13:00", "17:00"]);
    const preview = previewEscalaRows(rows, { branchCode: "02", startDate: "2026-11-02", defaultWeeklyHours: 42 });
    expect(preview.issues).toEqual([]);
    const person = preview.employees[0];
    expect(person).toMatchObject({ planningEnabled: true, scheduleMode: "TIMED", sourceSchedule: { weekday: "08:00-12:00 / 13:00-17:00", saturday: "08:00-12:00 / 00:00-00:00" } });
    const weekdayMinutes = preview.shifts[0].segments.filter(segment => segment.kind === "WORK").reduce((sum, segment) => sum + segment.end - segment.start, 0);
    expect(weekdayMinutes * 5 + 240).toBe(44 * 60);
    const input = fixture(person.sourceSchedule?.weekday ?? ""); input.assignments = [];
    input.employees = preview.employees; input.shifts = preview.shifts;
    const generated = prepareGeneration(input).input;
    expect(generated.employees[0].planningEnabled).toBe(true);
    expect(generated.employees[0].shiftIds.every(id => generated.shifts.find(shift => shift.id === id)?.segments.reduce((sum, segment) => sum + (segment.kind === "BREAK" ? 0 : segment.end - segment.start), 0) === 504)).toBe(true);
    expect(generated.employees[0].sourceSchedule).toEqual(person.sourceSchedule);
  });
  it.each(["UNTIMED", "MISSING"] as const)("does not exclude %s or turn it into a timed short journey", mode => {
    const input = fixture("07:00-11:00"); input.employees[0].scheduleMode = mode;
    input.employees[0].shiftIds = [];
    expect(applyRestEligibility(input.employees[0]).planningEnabled).not.toBe(false);
  });
  it("preserves a manual exclusion reason", () => {
    const input = fixture("07:00-11:00"), person = input.employees[0];
    person.planningEnabled = false; person.planningExclusionReason = "Exclusão manual";
    expect(applyRestEligibility(person)).toEqual(person);
  });
  it("excludes the short reference in preview and explicit bulk setup too", () => {
    const preview = previewEscalaRows(report(["07:00", "11:00", "00:00", "00:00"]), { branchCode: "02", startDate: "2026-11-02", defaultWeeklyHours: 42 });
    expect(preview.employees[0].planningEnabled).toBe(false);
    const input = fixture("07:00-11:00"); input.assignments = [];
    expect(prepareRoster(input, 42, "BRANCH_DEFAULT").employees[0].planningEnabled).toBe(false);
  });
  it("does not exclude an exactly six-hour principal reference or a compatible 42h clock", () => {
    for (const weekday of ["07:00-10:00 / 11:00-14:00", "08:00-12:00 / 13:00-17:24"]) {
      expect(applyRestEligibility(fixture(weekday).employees[0]).planningEnabled).not.toBe(false);
    }
  });
});
