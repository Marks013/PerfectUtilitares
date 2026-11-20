import { describe, expect, it } from "vitest";
import { newEmployee } from "./workspace-model";
import { validateEmployeeForm } from "./employee-form";
const person = () => ({ ...newEmployee(42, "day"), id: "person", registration: "001", name: "Pessoa sintética", sector: "Loja", role: "Função", activeFrom: "2020-01-01" });

describe("employee form uses the canonical schema before applying", () => {
  it("normalizes editable labels without inventing an admission date, dropping disabled rests or changing textual registration", () => {
    const draft = { ...person(), name: "  Pessoa sintética  ", activeFrom: "", fixedRestSlots: [{ enabled: false, weekday: 1 }, { enabled: false, weekday: 6 }] as [{ enabled: boolean; weekday: number }, { enabled: boolean; weekday: number }] };
    const original = structuredClone(draft), result = validateEmployeeForm(draft, [draft]);
    expect(result.errors).toEqual({});
    expect(result.employee).toMatchObject({ registration: "001", name: "Pessoa sintética", activeFrom: "", fixedRestSlots: draft.fixedRestSlots });
    expect(draft).toEqual(original);
  });
  it.each(["1899-12-31", "2100-01-01", "2026-02-30", "not-a-date"])("keeps invalid admission %s in the form", activeFrom => {
    const result = validateEmployeeForm({ ...person(), activeFrom }, []);
    expect(result.employee).toBeNull(); expect(result.errors.activeFrom).toBeTruthy();
  });
  it("rejects a reversed employment period with a field-specific error", () => {
    const result = validateEmployeeForm({ ...person(), activeUntil: "2019-12-31" }, []);
    expect(result.employee).toBeNull(); expect(result.errors.activeUntil).toBe("Desligamento anterior à admissão");
  });
  it.each(["registration", "name", "sector", "role"] as const)("rejects whitespace in %s", field => {
    const result = validateEmployeeForm({ ...person(), [field]: "   " }, []);
    expect(result.employee).toBeNull(); expect(result.errors[field]).toMatch(/^Informe/);
  });
  it("rejects another person's trimmed registration without turning 001 into 1", () => {
    expect(validateEmployeeForm(person(), [{ ...person(), id: "other", registration: " 001 " }]).errors.registration).toBeTruthy();
    expect(validateEmployeeForm(person(), [{ ...person(), id: "other", registration: "1" }]).employee).not.toBeNull();
  });
  it("requires an actual timed reference but permits excluded and untimed people without fictitious shifts", () => {
    expect(validateEmployeeForm({ ...person(), shiftIds: [] }, []).errors.shiftIds).toBeTruthy();
    expect(validateEmployeeForm({ ...person(), shiftIds: [], planningEnabled: false }, []).employee).not.toBeNull();
    expect(validateEmployeeForm({ ...person(), shiftIds: [], scheduleMode: "UNTIMED" }, []).employee).not.toBeNull();
  });
  it("keeps malformed fixed rest and history errors visible rather than applying them", () => {
    expect(validateEmployeeForm({ ...person(), offMode: "FIXED", fixedOffDays: [] }, []).errors.fixedOffDays).toBeTruthy();
    const result = validateEmployeeForm({ ...person(), history: [{ employeeId: "person", date: "2026-11-01", kind: "WORK" }] }, []);
    expect(result.employee).toBeNull(); expect(result.errors.history).toBeTruthy();
  });
});
