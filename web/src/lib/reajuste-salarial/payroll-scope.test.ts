import { describe, expect, it } from "vitest";
import { isDriversForkliftRole, parseSalaryAdvanceScope, parseSalaryAdvanceScopeSettings } from "./payroll-scope";
import { consolidateSalaryAdvanceFiles } from "./consolidator";
import { buildEventAdjustmentReport } from "./event-adjustments";
import { parseCompetencyFileName } from "./competency";
import type { ParsedPayrollFile } from "./types";

function file(month: string, role: string | null, name = "ANA TESTE"): ParsedPayrollFile {
  const competency = parseCompetencyFileName(`${month}.xlsx`);
  return { competency, sourceFile: `${month}.xlsx`, sourceSheet: "Plan1", rows: [{ competency, sourceFile: `${month}.xlsx`, sourceSheet: "Plan1", sourceRow: 1, registration: "1", employeeName: name, branchAlias: month === "06-2026" ? "MATRIZ" : "BIG", baseCents: 200_000n, role, employmentStatus: "Ativo" }] };
}
const settings = { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] };

describe("salary union scope", () => {
  it.each(["MOTORISTA/ENTREGADOR", "MOTORISTA-ENTREGADOR", "MOTORISTA–ENTREGADOR", "MOTORISTA—ENTREGADOR", "OPERADOR DE EMPILHADEIRA/LOGISTICA"])("keeps delimiter variant %s in its own union across salary and events", (role) => {
    const source = file("06-2026", role);
    expect(isDriversForkliftRole(role)).toBe(true);
    expect(() => consolidateSalaryAdvanceFiles([source], 108n)).toThrow(/Nenhum colaborador/);
    const exclusive = consolidateSalaryAdvanceFiles([source], 0n, new Date(), 0n, { salaryScope: "drivers-forklift", driverPercentageHundredThousandths: 123456n });
    expect(exclusive.grandTotalCents).toBe(2469n);
    const eventFile = { ...source, company: "EMPRESA", rows: source.rows.map(row => ({ ...row, events: { "565": [{ paidCents: "8000", reference: "1", sourceRow: 1 }], "901": [{ paidCents: "17000", reference: "2", sourceRow: 2 }] } })) };
    expect(() => buildEventAdjustmentReport([eventFile], settings)).toThrow(/Nenhum colaborador/);
    expect(buildEventAdjustmentReport([eventFile], settings, new Date(), "drivers-forklift").grandTotalCents).toBe("2000");
  });
  it("rounds precise money per employee and month before consolidation", () => {
    const june = file("06-2026", "Operador"); const july = file("07-2026", "Operador");
    june.rows[0].baseCents = 5_000_000n; july.rows[0].baseCents = 5_000_000n;
    const report = consolidateSalaryAdvanceFiles([june, july], 0n, new Date(), 0n, { salaryScope: "standard", percentageHundredThousandths: 1n, packerPercentageHundredThousandths: 1n });
    expect(report.grandTotalCents).toBe(2n);
    expect(report.groups[0].employees[0].adjustmentsByCompetency.get("06-2026")).toBe(1n);
    for (const rate of [0n, -1n, 10_000_001n]) expect(() => consolidateSalaryAdvanceFiles([june], 0n, new Date(), 0n, { salaryScope: "standard", percentageHundredThousandths: rate })).toThrow();
  });
  it("requires an explicit packer rate and retains all five decimal places", () => {
    const form = new FormData(); form.set("percentage", "1,23456");
    expect(() => parseSalaryAdvanceScopeSettings(form)).toThrow();
    form.set("packerPercentage", "2,26555");
    expect(parseSalaryAdvanceScopeSettings(form)).toMatchObject({ percentageHundredThousandths: 123456n, packerPercentageHundredThousandths: 226555n });
    const report = consolidateSalaryAdvanceFiles([file("06-2026", "Operador")], 0n, new Date(), 0n, parseSalaryAdvanceScopeSettings(form));
    expect(report.grandTotalCents).toBe(2469n);
    expect(report.groups[0].employees[0].advanceRulesByCompetency?.get("06-2026")?.percentageHundredThousandths).toBe(123456n);
    form.set("salaryScope", "drivers-forklift"); form.set("driverPercentage", "0,00001");
    const exclusive = consolidateSalaryAdvanceFiles([file("06-2026", "Motorista")], 0n, new Date(), 0n, parseSalaryAdvanceScopeSettings(form));
    expect(exclusive.driverPercentageHundredThousandths).toBe(1n);
    expect(exclusive.employeeCount).toBe(1);
  });
  it.each(["Motorista em geral", "123 - MOTORISTA / ENTREGADOR", "Motorista de Truck", "Motorista Carreteiro", "44 - OPERADOR DE EMPILHADEIRA", "Operador Empilhadeira"])("matches role %s", (role) => expect(isDriversForkliftRole(role)).toBe(true));
  it.each(["Ajudante de Motorista", "Auxiliar Operador de Empilhadeira", "Departamento Motorista", "MOTORISTADO", "", null])("does not match %s", (role) => expect(isDriversForkliftRole(role)).toBe(false));
  it("requires own precise rate and ignores inactive rates", () => {
    const form = new FormData(); form.set("salaryScope", "drivers-forklift"); form.set("driverPercentage", "3,1234"); form.set("percentage", "");
    expect(parseSalaryAdvanceScopeSettings(form)).toMatchObject({ salaryScope: "drivers-forklift", percentageBasisPoints: 0n, driverPercentageTenThousandths: 31234n });
    form.delete("driverPercentage"); expect(() => parseSalaryAdvanceScopeSettings(form)).toThrow();
    form.set("driverPercentage", "100.0001"); expect(() => parseSalaryAdvanceScopeSettings(form)).toThrow();
  });
  it("rejects duplicate and binary scope or rates", () => {
    const form = new FormData(); expect(parseSalaryAdvanceScope(form)).toBe("standard");
    form.append("salaryScope", "standard"); form.append("salaryScope", "standard"); expect(() => parseSalaryAdvanceScope(form)).toThrow();
    form.delete("salaryScope"); form.set("salaryScope", new File(["x"], "scope")); expect(() => parseSalaryAdvanceScope(form)).toThrow();
    form.set("salaryScope", "drivers-forklift"); form.set("driverPercentage", new File(["x"], "rate")); expect(() => parseSalaryAdvanceScopeSettings(form)).toThrow();
    form.set("driverPercentage", "2"); form.append("driverPercentage", "2"); expect(() => parseSalaryAdvanceScopeSettings(form)).toThrow();
  });
  it("keeps monthly evidence and latest original filial through role changes", () => {
    const files = [file("06-2026", "Operador de caixa"), file("07-2026", "Motorista")];
    const standard = consolidateSalaryAdvanceFiles(files, 108n);
    const employee = standard.groups[0].employees[0];
    expect(employee.branchAlias).toBe("Big"); expect(employee.basesByCompetency.get("07-2026")).toBe(200_000n);
    expect(employee.adjustmentsByCompetency.get("06-2026")).toBe(2160n); expect(employee.adjustmentsByCompetency.get("07-2026")).toBe(0n);
    const exclusive = consolidateSalaryAdvanceFiles(files, 0n, new Date(), 0n, { salaryScope: "drivers-forklift", driverPercentageTenThousandths: 31234n });
    expect(exclusive.grandTotalCents).toBe(6247n); expect(exclusive.groups[0].employees[0].adjustmentsByCompetency.get("06-2026")).toBe(0n);
    const eventFiles = files.map((input) => ({ ...input, company: "EMPRESA", rows: input.rows.map((row) => ({ ...row, events: { "565": [{ paidCents: "8000", reference: "1", description: "Bonus", sourceRow: 1 }], "901": [{ paidCents: "17000", reference: "2", description: "Domingos", sourceRow: 2 }] } })) }));
    const events = buildEventAdjustmentReport(eventFiles, settings);
    expect(events.grandTotalCents).toBe("2000"); expect(events.employees[0].months[1].bonus565).toMatchObject({ paidCents: "8000", quantity: 1, differenceCents: "0" });
    expect(buildEventAdjustmentReport(eventFiles, settings, new Date(), "drivers-forklift").grandTotalCents).toBe("2000");
  });
  it("filters whole employees only after identity validation", () => {
    expect(() => consolidateSalaryAdvanceFiles([file("06-2026", "Motorista"), file("07-2026", "Motorista", "OUTRO NOME")], 108n)).toThrow(/nomes diferentes/);
    expect(() => consolidateSalaryAdvanceFiles([file("06-2026", "Motorista")], 108n)).toThrow(/Nenhum colaborador/);
    expect(consolidateSalaryAdvanceFiles([file("06-2026", null)], 108n).employeeCount).toBe(1);
    expect(() => consolidateSalaryAdvanceFiles([file("06-2026", null)], 0n, new Date(), 0n, { salaryScope: "drivers-forklift", driverPercentageTenThousandths: 10000n })).toThrow(/Nenhum colaborador/);
  });
});
