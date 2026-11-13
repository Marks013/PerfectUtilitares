import { describe, expect, it } from "vitest";
import { mergeImport, newEmployee, newInput } from "./workspace-model";
import { previewImportReconciliation } from "./import-reconciliation";
import { reconcileImport } from "./import-reconciliation";
import { materializeManualShiftOverrides, withManualShiftOverride } from "@/lib/escalas/shift-catalog/manual-override";
import type { EscalaInput } from "@/lib/escalas/types";

describe("manual catalog references across explicit CSV reconciliation", () => {
  it.each([false, true])("retains intervals, markings and records when replaceClock=%s", replaceClock => {
    const person: EscalaInput["employees"][number] = {
      id: "e", registration: "001", name: "Synthetic", sector: "A", role: "Repositor", weeklyHours: 42, weeklyHoursMode: "BRANCH", shiftIds: ["source"],
      activeFrom: "", scheduleMode: "TIMED", offMode: "VARIABLE", fixedOffDays: [], offPattern: "ANY", maxConsecutiveSundays: 1, preferredOffDays: [], historyKnown: false,
      history: [], sourceSchedule: { report: "FPRE136", code: "X", description: "Original", weekday: "08:00-12:00 / 13:00-17:24", saturday: "08:00-12:00" },
    };
    const value: EscalaInput = {
      schemaVersion: 1, branchCode: "01", branchName: "Synthetic", startDate: "2026-11-02", endDate: "2026-11-08", defaultWeeklyHours: 42, timeZone: "America/Sao_Paulo",
      policy: { source: "", validFrom: "2026-01-01", validUntil: "2027-12-31", reviewed: false, reviewedBy: "", weeklyLimit: 44, dailyLimitMinutes: 528, compensationAuthorized: false,
        minMealMinutes: 60, minInterShiftMinutes: 660, minWeeklyRestMinutes: 2100, maxConsecutiveWorkDays: 5, closedDates: [], holidayDates: [], authorizedHolidayDates: [], holidayRestAllowed: false, nightWorkReviewed: false },
      employees: [withManualShiftOverride(person, { catalogCode: 1500, shiftId: "catalog-1500", markings: ["07:00", "11:00", "12:00", "16:24"], effectiveFrom: "2026-11-03", effectiveUntil: "2026-11-05" })],
      shifts: [{ id: "source", name: "Source", segments: [{ start: 480, end: 720, kind: "WORK" }, { start: 720, end: 780, kind: "BREAK" }, { start: 780, end: 1044, kind: "WORK" }] }], demands: [],
      assignments: [{ employeeId: "e", date: "2026-11-03", kind: "ABSENCE" }, { employeeId: "e", date: "2026-11-04", kind: "OFF", locked: true }],
    };
    const prepared = materializeManualShiftOverrides(value);
    const incoming = { ...person, id: "csv-new-id", name: "Updated synthetic", shiftIds: ["csv-new-shift"], sourceSchedule: { ...(person.sourceSchedule as NonNullable<typeof person.sourceSchedule>), description: "Updated reference", weekday: "09:00-13:00 / 14:00-18:00" } };
    const shift = { ...structuredClone(value.shifts[0]), id: "csv-new-shift" };
    const next = reconcileImport(prepared, [incoming], [shift], { updateRegistrations: ["001"], scheduleRegistrations: replaceClock ? ["001"] : [] });
    expect(next.employees[0].id).toBe("e");
    expect(next.employees[0].manualShiftOverrides).toEqual(prepared.employees[0].manualShiftOverrides);
    expect(next.employees[0].manualShiftByDate).toEqual(prepared.employees[0].manualShiftByDate);
    expect(next.employees[0].manualShiftBaseIds).toEqual(replaceClock ? ["csv-new-shift"] : ["source"]);
    expect(next.shifts.find(s => s.id === "catalog-1500")).toEqual(prepared.shifts.find(s => s.id === "catalog-1500"));
    expect(next.assignments).toEqual(prepared.assignments);
    expect(next.employees[0].history).toEqual(person.history);
    for (const scheduleMode of ["UNTIMED", "MISSING"] as const) {
      expect(() => reconcileImport(prepared, [{ ...incoming, scheduleMode, shiftIds: [] }], [], {
        updateRegistrations: ["001"], scheduleRegistrations: ["001"],
      })).toThrow(/seleção manual/);
    }
  });
});

describe("confirmed import reconciliation", () => {
  it("updates approved source fields and preserves identity, decisions and absences", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    const current = { ...newEmployee(40, input.shifts[0].id), id: "existing", registration: "001", name: "Nome anterior", sector: "Caixa", role: "Operador",
      weeklyHoursMode: "INDIVIDUAL" as const, offMode: "MIXED" as const, fixedOffDays: [2], historyKnown: true,
      history: [{ employeeId: "existing", date: "2026-10-25", kind: "OFF" as const }] };
    input.employees = [current];
    input.assignments = [{ employeeId: current.id, date: "2026-11-02", kind: "ABSENCE", locked: true }];
    const incoming = { ...newEmployee(42, input.shifts[0].id), id: "imported", registration: "001", name: "Nome atualizado", sector: "Balcão", role: "Atendente" };
    const result = mergeImport(input, [incoming], [], { updateRegistrations: ["001"] });
    expect(result.employees[0]).toMatchObject({ id: current.id, name: "Nome atualizado", sector: "Balcão", role: "Atendente", weeklyHours: 40, fixedOffDays: [2], history: current.history });
    expect(result.assignments).toEqual(input.assignments);
    expect(result.needsRegeneration).toBe(true);
    expect(input.employees[0].name).toBe("Nome anterior");
  });
  it("keeps employees absent from the new file and does not duplicate known registrations", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    const current = { ...newEmployee(42), id: "existing", registration: "001", name: "Pessoa", sector: "Caixa", role: "Operador" };
    input.employees = [current];
    const result = mergeImport(input, [{ ...current, id: "incoming" }], [], { updateRegistrations: [] });
    expect(result.employees).toEqual([current]);
    expect(mergeImport(input, [], [], { updateRegistrations: [] }).employees).toEqual([current]);
  });
  it("does not replace manual clocks or add declined unused shifts", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    const current = { ...newEmployee(42, input.shifts[0].id), id: "one", registration: "001", name: "Pessoa", sector: "Caixa", role: "Operador" };
    input.employees = [current];
    const changedShift = { ...input.shifts[0], id: "incoming-clock" };
    const source = { ...current, name: "Pessoa atualizada", shiftIds: [changedShift.id] };
    const metadataOnly = mergeImport(input, [source], [changedShift], { updateRegistrations: ["001"] });
    expect(metadataOnly.employees[0].name).toBe(source.name);
    expect(metadataOnly.employees[0].shiftIds).toEqual(current.shiftIds);
    expect(metadataOnly.shifts).toEqual(input.shifts);
    const withClock = mergeImport(input, [source], [changedShift], { updateRegistrations: ["001"], scheduleRegistrations: ["001"] });
    expect(withClock.employees[0].shiftIds).toEqual([changedShift.id]);
    expect(withClock.shifts).toContainEqual(input.shifts[0]);
  });
  it("preserves explicit leadership even when the source cargo changes", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    const current = { ...newEmployee(42), id: "one", registration: "001", name: "Pessoa", sector: "Caixa", role: "Operador",
      leadership: { role: "NONE" as const, source: "MANUAL" as const, sectors: [] } };
    input.employees = [current];
    const result = mergeImport(input, [{ ...current, role: "GERENTE" }], [], { updateRegistrations: ["001"] });
    expect(result.employees[0].leadership).toEqual(current.leadership);
  });
  it("does not classify generated alternatives as changes in the imported source", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    const current = { ...newEmployee(42, "generated-clock"), id: "one", registration: "001", name: "Pessoa", sector: "Caixa", role: "Operador",
      sourceSchedule: { report: "FPRE136" as const, code: "01", description: "Referência", weekday: "07:00-11:00 / 13:00-17:24", saturday: "00:00-00:00 / 00:00-00:00" } };
    input.employees = [current];
    expect(previewImportReconciliation(input, [{ ...current, shiftIds: ["original-clock"] }], [])[0].status).toBe("UNCHANGED");
  });
  it("rejects branch mismatches and clock changes that contradict locked work", () => {
    const input = newInput("02", "Centro", "2026-11", 42);
    const current = { ...newEmployee(42, input.shifts[0].id), id: "one", registration: "001", name: "Pessoa", sector: "Caixa", role: "Operador" };
    input.employees = [current];
    input.assignments = [{ employeeId: current.id, date: input.startDate, kind: "WORK", shiftId: input.shifts[0].id, locked: true }];
    const source = { ...current, scheduleMode: "UNTIMED" as const, shiftIds: [] };
    expect(() => mergeImport(input, [source], [], { updateRegistrations: [], branchCode: "11" })).toThrow("outra filial");
    expect(() => mergeImport(input, [source], [], { updateRegistrations: ["001"], scheduleRegistrations: ["001"] })).toThrow("trabalho bloqueado");
    expect(input.assignments[0].kind).toBe("WORK");
  });
});
