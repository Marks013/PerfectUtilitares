import { describe, expect, it } from "vitest";
import { newEmployee, newInput } from "@/components/escalas/workspace-model";
import { adaptCompatibleSchedules } from "./schedule-adaptation";

function sample() {
  const input = newInput("02", "Loja", "2026-11", 42);
  input.shifts = [{ id: "original", name: "Original", segments: [{ kind: "WORK", start: 420, end: 660 }, { kind: "BREAK", start: 660, end: 780 }, { kind: "WORK", start: 780, end: 980 }] }];
  input.employees = [{ ...newEmployee(42, "original"), id: "one", registration: "1", name: "Pessoa", sector: "Loja", role: "Repositor" }];
  return input;
}
describe("explicit compatible schedule adaptation", () => {
  it("preserves actual entry and meal while adjusting the exact exit to 42h/5", () => {
    const input = sample(), before = structuredClone(input);
    const result = adaptCompatibleSchedules(input, "PRESERVE_START");
    const shift = result.input.shifts.find(row => row.id === result.input.employees[0].shiftIds[0]);
    expect(shift?.segments).toEqual([{ kind: "WORK", start: 420, end: 660 }, { kind: "BREAK", start: 660, end: 780 }, { kind: "WORK", start: 780, end: 1044 }]);
    expect(result.exceptions).toEqual([]); expect(input).toEqual(before);
  });
  it("retains every locked workday, absence and off decision while keeping its referenced old shift", () => {
    const input = sample(); input.assignments = [{ employeeId: "one", date: "2026-11-02", kind: "WORK", shiftId: "original", locked: true }, { employeeId: "one", date: "2026-11-03", kind: "ABSENCE" }, { employeeId: "one", date: "2026-11-04", kind: "OFF" }];
    const result = adaptCompatibleSchedules(input, "BOTH");
    expect(result.input.assignments).toEqual(input.assignments); expect(result.input.employees[0].shiftIds).toContain("original");
    expect(result.input.shifts).toContainEqual(input.shifts[0]); expect(result.input.needsRegeneration).toBe(true); expect(result.input.employees[0].planningEnabled).not.toBe(false);
  });
  it("keeps an incompatible person included and identifies them instead of silently removing them", () => {
    const input = sample(); input.simulation = false; input.shifts[0].segments = [{ start: 1380, end: 1620, kind: "WORK" }, { start: 1620, end: 1680, kind: "BREAK" }, { start: 1680, end: 1880, kind: "WORK" }];
    const result = adaptCompatibleSchedules(input, "PRESERVE_START");
    expect(result.input.employees).toEqual(input.employees); expect(result.exceptions).toEqual([expect.objectContaining({ employeeId: "one", registration: "1" })]);
  });
  it("never invents clocks for missing/untimed people or modifies explicit exclusions and individual references", () => {
    const input = sample(); input.employees.push({ ...newEmployee(40), id: "missing", name: "Sem horário", registration: "2", scheduleMode: "MISSING" });
    input.employees[0] = { ...input.employees[0], weeklyHours: 40, weeklyHoursMode: "INDIVIDUAL", fixedOffDays: [0], offMode: "MIXED" };
    const result = adaptCompatibleSchedules(input, "BOTH");
    expect(result.input.employees[0].weeklyHours).toBe(40); expect(result.input.employees[0].fixedOffDays).toEqual([0]);
    expect(result.input.employees[1]).toEqual(input.employees[1]);
  });
});
