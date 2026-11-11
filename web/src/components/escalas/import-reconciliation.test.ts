import { describe, expect, it } from "vitest";
import { mergeImport, newEmployee, newInput } from "./workspace-model";
import { previewImportReconciliation } from "./import-reconciliation";

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
