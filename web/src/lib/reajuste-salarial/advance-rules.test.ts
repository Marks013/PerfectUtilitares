import { describe, expect, it } from "vitest";
import { parseCompetencyFileName } from "./competency";
import { parsePayrollSheetRows } from "./parser";
import { consolidateSalaryAdvanceFiles } from "./consolidator";
import { buildEventAdjustmentReport } from "./event-adjustments";
import { isHandPacker, payrollExclusionReason } from "./advance-rules";
import { calculatePreciseAdjustmentCents, formatPercentageTenThousandths, parsePercentageTenThousandths } from "./money";

function file(name: string, status: string, role = "Embalador a mão") {
  const competency = parseCompetencyFileName(name);
  const context = { competency, sourceFile: name, sourceSheet: "Plan1" };
  return { ...context, rows: parsePayrollSheetRows([
    ["FOLHA DE PAGAMENTO"], ["Local:", "01 MATRIZ"],
    ["Colaborador:", "1 - COLABORADOR TESTE", "Sit:", status],
    ["Cargo:", `000021 - ${role}`], ["INSS Proc:", "1.822,86"],
  ], context) };
}

describe("monthly payroll eligibility and precise packer percentage", () => {
  it.each(["Lic. s/ Remuneraçäo", "Demitido", "Aposent. Invalidez", "Detenção", "  DEMITIDO  "])("blocks only the affected month for %s and preserves its base", (status) => {
    const report = consolidateSalaryAdvanceFiles([file("06-2026.xlsx", "Trabalhando"), file("07-2026.xlsx", status), file("08-2026.xlsx", "Trabalhando", "OPERADOR")], 108n);
    const employee = report.groups[0].employees[0];
    expect(employee.basesByCompetency.get("07-2026")).toBe(182286n);
    expect([...employee.adjustmentsByCompetency.values()]).toEqual([4130n, 0n, 1969n]);
    expect(employee.totalAdjustmentCents).toBe(6099n);
    expect(employee.advanceRulesByCompetency?.get("07-2026")?.exclusionReason).toContain("Situação impeditiva");
    expect(employee.advanceRulesByCompetency?.get("06-2026")?.percentageTenThousandths).toBe(22655n);
  });

  it("matches only the exact role and never infers the exception from the base", () => {
    expect(isHandPacker("000123 - EMBALADOR À MÃO")).toBe(true);
    expect(isHandPacker("EMBALADOR À MÃO / PADARIA")).toBe(false);
    expect(payrollExclusionReason("Lic. Maternidade")).toBeNull();
    const report = consolidateSalaryAdvanceFiles([file("06-2026.xlsx", "Trabalhando", "EMBALADOR À MÃO / PADARIA")], 108n);
    expect(report.grandTotalCents).toBe(1969n);
  });

  it("supports a future four-decimal role rate with integer half-up rounding", () => {
    expect(parsePercentageTenThousandths("2,2655")).toBe(22655n);
    expect(formatPercentageTenThousandths(22655n)).toBe("2,2655%");
    expect(calculatePreciseAdjustmentCents(182286n, 22655n)).toBe(4130n);
    expect(calculatePreciseAdjustmentCents(500000n, 1n)).toBe(1n);
    const report = consolidateSalaryAdvanceFiles([file("06-2026.xlsx", "Trabalhando")], 108n, new Date(), parsePercentageTenThousandths("3.1234"));
    expect(report.grandTotalCents).toBe(5694n);
  });

  it.each(["0", "-1", "100.0001", "2.26555", "", "2e1", "NaN"])("rejects ambiguous or out-of-range role percentage %s", (value) => {
    expect(() => parsePercentageTenThousandths(value)).toThrow();
  });

  it("marks legacy metadata as unknown while retaining the general rate", () => {
    const source = file("06-2026.xlsx", "Trabalhando");
    delete source.rows[0].employmentStatus;
    delete source.rows[0].role;
    const report = consolidateSalaryAdvanceFiles([source], 108n);
    expect(report.grandTotalCents).toBe(1969n);
    expect(report.groups[0].employees[0].advanceRulesByCompetency?.get("06-2026")?.metadataKnown).toBe(false);
  });

  it("blocks bonus and Sundays in the excluded month, preserving paid evidence and other months", () => {
    const files = ["06-2026.xlsx", "07-2026.xlsx"].map((name, index) => ({
      competency: parseCompetencyFileName(name), sourceFile: name, sourceSheet: "Plan1", company: "EMPRESA TESTE",
      rows: [{ registration: "1", employeeName: "COLABORADOR TESTE", branchAlias: "MATRIZ", employmentStatus: index ? "Demitido" : "Trabalhando",
        events: { "565": [{ paidCents: "8000", reference: "1", sourceRow: 5 }], "901": [{ paidCents: "17000", reference: "0,00", sourceRow: 6 }] } }],
    }));
    const report = buildEventAdjustmentReport(files, { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] });
    expect(report.grandTotalCents).toBe("2000");
    expect(report.employees[0].months[1].bonus565).toMatchObject({ paidCents: "8000", quantity: 1, differenceCents: "0" });
    expect(report.employees[0].months[1].indemnity901).toMatchObject({ paidCents: "17000", quantity: 2, differenceCents: "0", issue: null });
    expect(report.employees[0].months[1].exclusionReason).toContain("Demitido");
    files[1].rows[0].events["901"][0].paidCents = "17001";
    const excludedInvalid = buildEventAdjustmentReport(files, report.settings);
    expect(excludedInvalid.issueCount).toBe(0);
    expect(excludedInvalid.employees[0].months[1].indemnity901.paidCents).toBe("17001");
  });
});
