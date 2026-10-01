import { describe, expect, it } from "vitest";
import { parseCompetencyFileName } from "./competency";
import { buildEventAdjustmentReport } from "./event-adjustments";
import { MAX_UNIQUE_EMPLOYEES } from "./limits";
import type { EventAdjustmentSettings, ParsedSalaryEventFile, ParsedSalaryEvent } from "./event-adjustment-types";

const settings: EventAdjustmentSettings = { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] };
const event = (paidCents: string, reference = ""): ParsedSalaryEvent => ({ paidCents, reference, sourceRow: 5 });
function file(month: string, bonus: ParsedSalaryEvent[] = [], sunday: ParsedSalaryEvent[] = [], registration = "1"): ParsedSalaryEventFile {
  return { competency: parseCompetencyFileName(`${month}-2026.xlsx`), sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", company: "1 - TESTE", rows: [{ registration, employeeName: "ANA TESTE", branchAlias: "MATRIZ", events: { "565": bonus, "901": sunday } }] };
}

describe("event adjustment calculations", () => {
  it("limits the distinct employee union across files while allowing repeated monthly evidence", () => {
    const june = file("06");
    const july = file("07");
    const employee = june.rows[0];
    june.rows = Array.from({ length: MAX_UNIQUE_EMPLOYEES / 2 }, (_, index) => ({ ...employee, registration: String(index + 1) }));
    july.rows = Array.from({ length: MAX_UNIQUE_EMPLOYEES / 2 }, (_, index) => ({ ...employee, registration: String(index + MAX_UNIQUE_EMPLOYEES / 2 + 1) }));
    expect(buildEventAdjustmentReport([june, july], settings).employeeCount).toBe(MAX_UNIQUE_EMPLOYEES);
    const august = file("08");
    august.rows = june.rows;
    expect(buildEventAdjustmentReport([june, july, august], settings).employeeCount).toBe(MAX_UNIQUE_EMPLOYEES);
    july.rows.push({ ...employee, registration: String(MAX_UNIQUE_EMPLOYEES + 1) });
    expect(() => buildEventAdjustmentReport([june, july], settings)).toThrow(expect.objectContaining({ code: "REAJUSTE_ROW_LIMIT_EXCEEDED", status: 413 }));
  });
  it("validates competency keys and their numeric fields inside the domain", () => {
    const malformed = file("06");
    malformed.competency.month = 7;
    expect(() => buildEventAdjustmentReport([malformed], settings)).toThrow(/Competência inválida/);
    malformed.competency = { ...malformed.competency, key: "13-2026" };
    expect(() => buildEventAdjustmentReport([malformed], settings)).toThrow();
  });
  it("pays 30 reais for three 80-to-90 bonus months and keeps sorted evidence", () => {
    const report = buildEventAdjustmentReport([file("08", [event("8000", "1")]), file("06", [event("8000", "1,00")]), file("07", [event("8000", "1")])], settings);
    expect(report.grandTotalCents).toBe("3000");
    expect(report.employees[0].months.map(({ competency, bonus565 }) => [competency.key, bonus565.quantity, bonus565.differenceCents, bonus565.quantitySource])).toEqual([
      ["06-2026", 1, "1000", "reference"], ["07-2026", 1, "1000", "reference"], ["08-2026", 1, "1000", "reference"],
    ]);
    expect(report.suggestions.bonusOldValueCents).toBe("8000");
  });
  it.each([["17000", 2, "1000"], ["25500", 3, "1500"], ["34000", 4, "2000"], ["0", 0, "0"]])("infers Sundays for %s cents", (paid, quantity, difference) => {
    const report = buildEventAdjustmentReport([file("06", [], [event(paid)])], settings);
    expect(report.employees[0].months[0].indemnity901).toMatchObject({ quantity, differenceCents: difference, quantitySource: "amount", issue: null });
  });
  it("allows five Sundays only in a month containing five", () => {
    expect(buildEventAdjustmentReport([file("08", [], [event("42500")])], settings).issueCount).toBe(0);
    expect(buildEventAdjustmentReport([file("06", [], [event("42500")])], settings).issueCount).toBe(1);
  });
  it("treats the zero Sunday reference as the payroll placeholder and divides the exact amount", () => {
    const report = buildEventAdjustmentReport([file("06", [], [event("17000", "0")])], settings);
    expect(report.employees[0].months[0].indemnity901).toMatchObject({ quantity: 2, quantitySource: "amount", differenceCents: "1000", issue: null });
    expect(buildEventAdjustmentReport([file("06", [event("8000", "0")])], settings).issueCount).toBe(1);
  });
  it("distinguishes event absence from missing payroll months", () => {
    const report = buildEventAdjustmentReport([file("06"), file("07", [], [], "2")], settings);
    expect(report.employees[0].months[0]).toMatchObject({ inPayroll: true, bonus565: { received: false, quantity: 0, differenceCents: "0" } });
    expect(report.employees[0].months[1]).toMatchObject({ inPayroll: false, bonus565: { received: false, quantity: 0 } });
  });
  it.each([
    [event("17001")], [event("17000", "1")], [event("17000", "2,5")], [event("8500"), event("8500")], [event("0", "1")], [event("17000", "0,5")],
  ].map((events) => [events]))("flags ambiguous evidence without paying", (events) => {
    const report = buildEventAdjustmentReport([file("06", [], events)], settings);
    expect(report.issueCount).toBe(1);
    expect(report.employees[0].months[0].indemnity901).toMatchObject({ quantity: null, targetCents: null, differenceCents: "0" });
    expect(report.grandTotalCents).toBe("0");
  });
  it("supports verified bonus quantities greater than one", () => {
    expect(buildEventAdjustmentReport([file("06", [event("16000", "2")])], settings).bonusTotalCents).toBe("2000");
  });
  it("supports analysis without new values and reductions without deductions", () => {
    const inputs = [file("06", [event("8000", "1")], [event("17000")])];
    const analysis = buildEventAdjustmentReport(inputs, { ...settings, bonusNewValueCents: null, sundayNewValueCents: null });
    expect(analysis.employees[0].months[0].bonus565).toMatchObject({ quantity: 1, targetCents: null, differenceCents: "0" });
    const reduction = buildEventAdjustmentReport(inputs, { ...settings, bonusNewValueCents: "7000", sundayNewValueCents: "0" });
    expect(reduction.grandTotalCents).toBe("0");
    expect(reduction.issueCount).toBe(0);
  });
  it("uses explicit historical overrides", () => {
    const report = buildEventAdjustmentReport([file("06", [event("7500", "1")], [event("16000")])], { ...settings, historicOverrides: [{ competencyKey: "06-2026", bonusOldValueCents: "7500", sundayOldValueCents: "8000" }] });
    expect(report.grandTotalCents).toBe("3500");
  });
  it.each([
    { bonusOldValueCents: "0" }, { sundayOldValueCents: "-1" }, { bonusNewValueCents: "90.00" },
    { historicOverrides: [{ competencyKey: "07-2026", bonusOldValueCents: "8000", sundayOldValueCents: "8500" }] },
    { historicOverrides: Array(2).fill({ competencyKey: "06-2026", bonusOldValueCents: "8000", sundayOldValueCents: "8500" }) },
  ])("rejects invalid settings", (override) => {
    expect(() => buildEventAdjustmentReport([file("06")], { ...settings, ...override })).toThrow();
  });
  it("rejects company mixtures and conflicting registrations without merging by name", () => {
    const a = file("06"); const b = file("07"); b.company = "2 - OUTRA";
    expect(() => buildEventAdjustmentReport([a, b], settings)).toThrow(/empresas diferentes/);
    b.company = a.company; b.rows[0].employeeName = "OUTRO TESTE";
    expect(() => buildEventAdjustmentReport([a, b], settings)).toThrow(/nomes conflitantes/);
    b.rows[0].registration = "2"; b.rows[0].employeeName = a.rows[0].employeeName;
    expect(buildEventAdjustmentReport([a, b], settings).employeeCount).toBe(2);
    a.rows.push({ ...a.rows[0], registration: "0001" });
    expect(() => buildEventAdjustmentReport([a], settings)).toThrow(/mais de uma vez/);
  });
  it("keeps gcd only as an unconfirmed suggestion", () => {
    const report = buildEventAdjustmentReport([file("06", [], [event("17000")]), file("07", [], [event("25500")])], settings);
    expect(report.suggestions.sundayOldValueCents).toBe("8500");
    expect(report.suggestions.sundayEvidence).toMatch(/apenas sugestão/);
    expect(report.settings.sundayOldValueCents).toBe("8500");
  });
});
