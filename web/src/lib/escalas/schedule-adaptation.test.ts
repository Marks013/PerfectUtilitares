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
  it("adapts the operating team without changing an administrative record or pruning its referenced clocks", () => {
    const input = sample();
    const original = input.shifts[0];
    const lockedShift = { ...original, id: "s2", name: "Horário legado bloqueado" };
    const manualBase = { ...original, id: "legacy-base", name: "Referência manual" };
    input.shifts.push(lockedShift, manualBase);
    const administrative = {
      ...newEmployee(42, original.id), id: "administrative", registration: "2", name: "Afastado", sector: "Afastados",
      scheduleMode: "TIMED" as const, planningEnabled: true, activeFrom: input.startDate,
      manualShiftBaseIds: [manualBase.id],
      manualShiftOverrides: [{ catalogCode: 1500, shiftId: lockedShift.id, markings: ["07:00", "11:00", "13:00", "16:20"] as const,
        effectiveFrom: "2026-11-03", effectiveUntil: "2026-11-03" }],
      manualShiftByDate: { "2026-11-03": lockedShift.id },
      history: [{ employeeId: "administrative", date: "2026-10-25", kind: "WORK" as const, shiftId: lockedShift.id, locked: true }],
    };
    input.employees.push(administrative);
    input.assignments.push({ employeeId: administrative.id, date: "2026-11-02", kind: "WORK", shiftId: lockedShift.id, locked: true });

    const result = adaptCompatibleSchedules(input, "PRESERVE_START");
    const [operating, preserved] = result.input.employees;
    const adaptedShift = result.input.shifts.find(shift => shift.id === operating.shiftIds[0]);
    expect(adaptedShift?.segments.at(-1)?.end).toBe(1044);
    expect(preserved).toBe(administrative);
    expect(preserved.shiftIds).toEqual([original.id]);
    expect(result.input.assignments).toEqual(input.assignments);
    expect(result.input.shifts).toEqual(expect.arrayContaining([original, lockedShift, manualBase]));
    expect(result.exceptions).toEqual([]);
  });
  it("keeps an incompatible person included and identifies them instead of silently removing them", () => {
    // A real incompatibility: the exact paid target and minimum meal cannot fit before closing.
    const input = sample(); input.simulation = false; input.storeClosingMinutes = 540;
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
