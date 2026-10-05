import { describe, expect, it, vi } from "vitest";
import { PDFDocument as LoadedPdf } from "pdf-lib";
import PDFDocument from "pdfkit";
import { buildIntegratedAdvanceSummary } from "./advance-events";
import { parseCompetencyFileName } from "./competency";
import { consolidateSalaryAdvanceFiles } from "./consolidator";
import { buildEventAdjustmentReport } from "./event-adjustments";
import { parseExcludeAbsentLatest } from "./payroll-scope";
import { generateSalaryAdvancePdf } from "./pdf";
import type { ParsedPayrollFile, SalaryAdvanceScope } from "./types";
import type { EventAdjustmentSettings, ParsedSalaryEventFile } from "./event-adjustment-types";

const settings: EventAdjustmentSettings = { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] };
function fixture(scope: SalaryAdvanceScope = "standard") {
  const role = scope === "standard" ? "OPERADOR" : "Motorista de Truck";
  const file = (name: string, records: Array<[string, bigint, string?]>): ParsedPayrollFile => {
    const competency = parseCompetencyFileName(name);
    return { competency, sourceFile: name, sourceSheet: "Plan1", rows: records.map(([registration, baseCents, employmentStatus = "Trabalhando"], index) => ({ competency, sourceFile: name, sourceSheet: "Plan1", sourceRow: index + 1, registration, employeeName: `COLABORADOR ${registration}`, branchAlias: registration === "1" ? "Filial 09" : "Matriz", role, employmentStatus, baseCents })) };
  };
  // Deliberately reversed across a year boundary; latest has a zero and a dismissed record.
  const salary = [file("01-2027.xlsx", [["2", 0n], ["3", 200_000n, "Demitido"], ["4", 200_000n]]), file("12-2026.xlsx", [["1", 200_000n], ["2", 200_000n], ["3", 200_000n]])];
  const events: ParsedSalaryEventFile[] = salary.map(({ competency, sourceFile, sourceSheet, rows }) => ({ competency, sourceFile, sourceSheet, company: "EMPRESA TESTE", rows: rows.map(row => ({ ...row, events: { "565": [{ paidCents: "8000", reference: "1", sourceRow: row.sourceRow }], "901": [{ paidCents: "17000", reference: "2", sourceRow: row.sourceRow }] } })) }));
  return { salary, events };
}
function calculate(excludeAbsentLatest?: boolean, scope: SalaryAdvanceScope = "standard") {
  const files = fixture(scope);
  const advance = consolidateSalaryAdvanceFiles(files.salary, 108n, new Date(), 22655n, { salaryScope: scope, driverPercentageHundredThousandths: 108000n, excludeAbsentLatest });
  const events = buildEventAdjustmentReport(files.events, settings, advance.generatedAt, scope, excludeAbsentLatest);
  return { advance, events, integrated: buildIntegratedAdvanceSummary(advance, events) };
}
describe("latest-competency presence filter", () => {
  it.each([
    { kind: "summary" as const, includeEvents: true },
    { kind: "detailed" as const, includeEvents: true },
    { kind: "summary" as const, includeEvents: false },
    { kind: "detailed" as const, includeEvents: false },
  ])("prints only retained employees and discloses the filter in $kind (events: $includeEvents)", async ({ kind, includeEvents }) => {
    const { advance, events } = calculate(true);
    const printed: string[] = [];
    const original = PDFDocument.prototype.text;
    const spy = vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function(this: InstanceType<typeof PDFDocument>, value, ...args) {
      printed.push(String(value));
      return original.apply(this, [value, ...args]);
    });
    try {
      const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, includeEvents ? events : undefined, kind));
      expect(pdf.getPageCount()).toBeGreaterThan(0);
      expect(printed.some(value => value.includes("somente colaboradores com base em 01/2027"))).toBe(true);
      expect(printed.some(value => value.includes("COLABORADOR 1"))).toBe(false);
      for (const registration of ["2", "3", "4"]) expect(printed.some(value => value.includes(`COLABORADOR ${registration}`))).toBe(true);
    } finally { spy.mockRestore(); }
  });
  it.each([undefined, false])("preserves the complete historical cohort by default (%s)", (option) => {
    const { advance, events, integrated } = calculate(option);
    expect(advance.employeeCount).toBe(4);
    expect(events.employeeCount).toBe(4);
    expect(advance.grandTotalCents).toBe(8640n);
    expect(events.grandTotalCents).toBe("10000");
    expect(integrated.grandTotalCents).toBe(18640n);
  });
  it.each(["standard", "drivers-forklift"] as const)("filters the entire employee in %s without treating zero or dismissal as absence", (scope) => {
    const { advance, events, integrated } = calculate(true, scope);
    expect(advance.competencies.map(item => item.key)).toEqual(["12-2026", "01-2027"]);
    expect(advance.groups.flatMap(group => group.employees.map(employee => employee.registration)).sort()).toEqual(["2", "3", "4"]);
    expect(events.employees.map(employee => employee.registration).sort()).toEqual(["2", "3", "4"]);
    expect(advance.groups).toHaveLength(1);
    expect(events.branchCount).toBe(1);
    expect(advance.grandTotalCents).toBe(6480n);
    expect(events).toMatchObject({ employeeCount: 3, bonusTotalCents: "4000", sundayTotalCents: "4000", grandTotalCents: "8000", issueCount: 0 });
    expect(integrated.grandTotalCents).toBe(14480n);
    expect(events.employees.find(employee => employee.registration === "3")?.months[1].exclusionReason).toContain("Demitido");
    expect(advance.groups[0].employees.find(employee => employee.registration === "2")?.basesByCompetency.get("01-2027")).toBe(0n);
  });
  it("does not let a removed employee change quantity issues or historical suggestions", () => {
    const { events } = fixture();
    const removed = events[1].rows[0];
    removed.registration = "0001";
    removed.events["565"][0].paidCents = "8001";
    removed.events["901"][0].paidCents = "17001";
    const filtered = buildEventAdjustmentReport(events, settings, new Date(), "standard", true);
    expect(filtered.issueCount).toBe(0);
    expect(filtered.suggestions).toMatchObject({ bonusOldValueCents: "8000", sundayOldValueCents: "17000" });
    expect(buildEventAdjustmentReport(events, settings).issueCount).toBe(2);
  });
  it("validates conflicting identities before filtering, so absence cannot hide invalid imports", () => {
    const { salary, events } = fixture();
    const previous = { ...salary[1].rows[0], employeeName: "NOME DIVERGENTE" };
    const old = { ...salary[1], competency: parseCompetencyFileName("11-2026.xlsx"), rows: [previous] };
    expect(() => consolidateSalaryAdvanceFiles([...salary, old], 108n, new Date(), 22655n, { salaryScope: "standard", excludeAbsentLatest: true })).toThrow("nomes diferentes");
    expect(() => buildEventAdjustmentReport([...events, { ...events[1], competency: old.competency, rows: [{ ...events[1].rows[0], employeeName: previous.employeeName }] }], settings, new Date(), "standard", true)).toThrow("nomes conflitantes");
  });
  it("returns an actionable error when latest contains no employee from the selected union", () => {
    const { salary, events } = fixture();
    for (const row of salary[0].rows) row.role = "Motorista";
    for (const row of events[0].rows) row.role = "Motorista";
    // Historical union membership keeps records eligible; present records still remain.
    expect(consolidateSalaryAdvanceFiles(salary, 108n, new Date(), 22655n, { salaryScope: "standard", excludeAbsentLatest: true }).employeeCount).toBe(2);
    salary[0].rows = [salary[0].rows[2]];
    events[0].rows = [events[0].rows[2]];
    expect(() => consolidateSalaryAdvanceFiles(salary, 108n, new Date(), 22655n, { salaryScope: "standard", excludeAbsentLatest: true })).toThrow("desative o filtro");
    expect(() => buildEventAdjustmentReport(events, settings, new Date(), "standard", true)).toThrow("desative o filtro");
  });
  it.each([undefined, "false", "true"])("accepts only explicit optional boolean %s", (value) => {
    const form = new FormData();
    if (value !== undefined) form.set("excludeAbsentLatest", value);
    expect(parseExcludeAbsentLatest(form)).toBe(value === "true");
  });
  it.each(["yes", "1", "TRUE", "", " false "])("rejects ambiguous boolean %s", (value) => {
    const form = new FormData(); form.set("excludeAbsentLatest", value);
    expect(() => parseExcludeAbsentLatest(form)).toThrow("única opção válida");
  });
  it("rejects duplicate or binary boolean fields", () => {
    const duplicate = new FormData(); duplicate.append("excludeAbsentLatest", "false"); duplicate.append("excludeAbsentLatest", "true");
    expect(() => parseExcludeAbsentLatest(duplicate)).toThrow();
    const binary = new FormData(); binary.set("excludeAbsentLatest", new Blob(["true"]));
    expect(() => parseExcludeAbsentLatest(binary)).toThrow();
  });
});
