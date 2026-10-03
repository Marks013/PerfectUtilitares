import { describe, expect, it, vi, afterEach } from "vitest";
import { PDFDocument as LoadedPdf } from "pdf-lib";
import PDFDocument from "pdfkit";
import { generateSalaryAdvancePdf } from "./pdf";
import { consolidateSalaryAdvanceFiles } from "./consolidator";
import { buildEventAdjustmentReport } from "./event-adjustments";
import { parseCompetencyFileName } from "./competency";
import { buildSalaryAdvanceSummary } from "./advance-events";
import type { ParsedPayrollFile } from "./types";
import type { ParsedSalaryEventFile } from "./event-adjustment-types";

function reports(count = 1, monthCount = 3, blocked = false, absent = false) {
  const advanceFiles: ParsedPayrollFile[] = [];
  const eventFiles: ParsedSalaryEventFile[] = [];
  for (const [index, month] of ["06", "07", "08", "09"].slice(0, monthCount).entries()) {
    const competency = parseCompetencyFileName(`${month}-2026.xlsx`);
    const rows = absent && index === 1 ? [] : Array.from({ length: count }, (_, i) => ({ registration: String(i + 1), employeeName: `COLABORADOR FICTICIO ${i + 1}`, branchAlias: "MATRIZ", employmentStatus: blocked && index === 0 ? "Demitido" : "Trabalhando", role: "OPERADOR" }));
    advanceFiles.push({ competency, sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", rows: rows.map(row => ({ ...row, competency, sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", sourceRow: 1, baseCents: 100_000n })) });
    eventFiles.push({ competency, sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", company: "1 - EMPRESA FICTICIA", rows: rows.map(row => ({ ...row, events: { "565": [{ paidCents: "8000", reference: "1", sourceRow: 2 }], "901": [{ paidCents: ["17000", "8500", "25500", "8500"][index], reference: "", sourceRow: 3 }] } })) });
  }
  return {
    advance: consolidateSalaryAdvanceFiles(advanceFiles, 500n),
    events: buildEventAdjustmentReport(eventFiles, { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("optional events in the advance PDF", () => {
  it.each(["summary", "detailed"] as const)("identifies the exclusive union and only its own percentage in the %s PDF", async kind => {
    const { advance, events } = reports();
    advance.salaryScope = "drivers-forklift";
    advance.driverPercentageTenThousandths = 50000n;
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateSalaryAdvancePdf(advance, events, kind);
    const values = text.mock.calls.map(call => String(call[0])).join("\n");
    expect(values).toContain("Sindicato de Motoristas e Operadores de Empilhadeira — apuração exclusiva");
    expect(values).toContain("Percentual próprio: 5,00000%");
    expect(values).not.toContain("Geral:");
    expect(values).not.toContain("Embalador a mão:");
  });

  it("identifies exclusive scope without optional events in the legacy detail", async () => {
    const { advance } = reports();
    advance.salaryScope = "drivers-forklift";
    advance.driverPercentageTenThousandths = 50000n;
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateSalaryAdvancePdf(advance);
    const values = text.mock.calls.map(call => String(call[0])).join("\n");
    expect(values).toContain("apuração exclusiva");
    expect(values).toContain("Percentual próprio: 5,00000%");
    expect(values).not.toContain("Geral:");
    expect(values).not.toContain("Embalador a mão:");
  });

  it("states standard scope and both applicable percentage settings", async () => {
    const { advance } = reports();
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateSalaryAdvancePdf(advance, undefined, "summary");
    const values = text.mock.calls.map(call => String(call[0])).join("\n");
    expect(values).toContain("Sindicato padrão — exclui Motoristas e Operadores de Empilhadeira");
    expect(values).toContain("Geral: 5,00000% | Embalador a mão: 2,26550%");
  });

  it("prints cargo exclusion rather than an active employment status and retains paid event evidence", async () => {
    const { advance, events } = reports();
    const employee = advance.groups[0].employees[0];
    const key = advance.competencies[0].key;
    const reason = "Cargo fora do sindicato selecionado: MOTORISTA";
    const rule = employee.advanceRulesByCompetency?.get(key);
    if (!rule) throw new Error("Missing fixture rule");
    rule.scopeEligible = false;
    rule.exclusionReason = reason;
    employee.adjustmentsByCompetency.set(key, 0n);
    employee.totalAdjustmentCents = 10000n;
    advance.groups[0].subtotalCents = 10000n;
    advance.grandTotalCents = 10000n;
    const eventEmployee = events.employees[0];
    const month = eventEmployee.months[0];
    month.exclusionReason = reason;
    for (const event of [month.bonus565, month.indemnity901]) { event.exclusionReason = reason; event.differenceCents = "0"; }
    eventEmployee.bonusDifferenceCents = "2000";
    eventEmployee.sundayDifferenceCents = "2000";
    eventEmployee.totalDifferenceCents = "4000";
    events.bonusTotalCents = "2000";
    events.sundayTotalCents = "2000";
    events.grandTotalCents = "4000";
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateSalaryAdvancePdf(advance, events);
    const values = text.mock.calls.map(call => String(call[0]));
    expect(values.join(" ")).toContain(`Bloqueado: ${reason}`);
    expect(values).not.toContain("Bloqueado: Trabalhando");
    expect(values).toContain("170,00");
    expect(values).toContain("2");
    expect(values).toContain("140,00");
    expect(values).toContain("—");
    text.mockClear();
    await generateSalaryAdvancePdf(advance);
    expect(text.mock.calls.map(call => String(call[0])).join(" ")).toContain(`bloqueado por cargo: ${reason}`);
  });

  it("creates separate summary and detailed PDFs with the same total", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const { advance, events } = reports();
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, events));
    expect(pdf.getTitle()).toBe("Antecipação Salarial — Apuração Detalhada");
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    const values = text.mock.calls.map(call => String(call[0])).join("\n");
    for (const label of ["apuração detalhada", "170,00", "150,00", "30,00", "210,00"]) expect(values).toContain(label);
    expect(values).not.toContain("resumo consolidado");
    expect(text.mock.calls.filter(call => /^Página \d+ de \d+ \|/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
    text.mockClear();
    const summary = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, events, "summary"));
    expect(summary.getTitle()).toBe("Antecipação Salarial — Resumo Consolidado");
    const summaryValues = text.mock.calls.map(call => String(call[0])).join("\n");
    expect(summaryValues).toContain("resumo consolidado");
    expect(summaryValues).toContain("R$ 210,00");
    expect(summaryValues).not.toContain("apuração detalhada");
  });
  it("repeats summary headings and numbers all pages once for a larger payroll", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const { advance, events } = reports(35);
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, events, "summary"));
    expect(text.mock.calls.filter(call => String(call[0]).endsWith("resumo consolidado")).length).toBeGreaterThan(1);
    expect(text.mock.calls.filter(call => /^Página \d+ de \d+ \|/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
  });
  it("blocks pending optional events before generating a combined payment report", async () => {
    const { advance, events } = reports();
    events.issueCount = 1;
    for (const kind of ["summary", "detailed"] as const) await expect(generateSalaryAdvancePdf(advance, events, kind)).rejects.toThrow();
  });
  it("normalizes multiline identities without implicit pages or rectangles beyond the printable area", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const rect = vi.spyOn(PDFDocument.prototype, "rect");
    const { advance, events } = reports();
    const branch = `01 ${"A\n".repeat(200)}`;
    advance.groups[0].branchAlias = branch;
    advance.groups[0].employees[0].branchAlias = branch;
    events.employees[0].branchAlias = branch;
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, events));
    expect(pdf.getPageCount()).toBeLessThan(10);
    expect(text.mock.calls.filter(call => /^Página \d+ de \d+ \|/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
    expect(rect.mock.calls.filter(call => Number(call[1]) + Number(call[3]) > 549.28)).toEqual([]);
    const printed = text.mock.calls.map(call => String(call[0]));
    expect(printed.some(value => value.includes("A\nA"))).toBe(false);
    expect(printed.join(" ").replace(/\s+/g, " ")).toContain(branch.replace(/\s+/g, " ").trim());
  });
  it("preserves the original advance-only PDF when the option is disabled", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const { advance } = reports();
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance));
    expect(pdf.getTitle()).toBe("Antecipação Salarial — Apuração Detalhada");
    const values = text.mock.calls.map(call => String(call[0])).join("\n");
    expect(values).not.toContain("resumo consolidado");
    expect(values).not.toContain("Apuração de diferenças — eventos 565 e 901");
    expect(text.mock.calls.filter(call => /^Página \d+ de \d+ \|/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
  });

  it("uses advance branch and collaborator order even when the events are reversed", async () => {
    const { advance, events } = reports(3);
    const first = advance.groups[0].employees.shift();
    if (!first) throw new Error("Missing fixture employee");
    advance.groups[0].subtotalCents -= first.totalAdjustmentCents;
    advance.groups[0].employeeCount -= 1;
    advance.groups.unshift({ branchAlias: "FILIAL Z", employees: [{ ...first, branchAlias: "FILIAL Z" }], employeeCount: 1, subtotalCents: first.totalAdjustmentCents });
    events.employees.reverse();
    const summary = buildSalaryAdvanceSummary(advance, events);
    expect(summary.groups.map(group => group.branchAlias)).toEqual(["FILIAL Z", "Matriz"]);
    expect(summary.employees.map(employee => employee.registration)).toEqual(["1", "2", "3"]);
    expect(summary.groups.map(group => group.totalCents)).toEqual([21000n, 42000n]);
    expect(summary.grandTotalCents).toBe(63000n);
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateSalaryAdvancePdf(advance, events, "summary");
    const values = text.mock.calls.map(call => String(call[0]));
    expect(values.indexOf("Filial: FILIAL Z")).toBeLessThan(values.indexOf("Filial: Matriz"));
    expect(values.filter(value => value === "Subtotal da filial")).toHaveLength(2);
  });

  it("renders a summary without optional events and preserves totals", async () => {
    const { advance } = reports();
    const summary = buildSalaryAdvanceSummary(advance);
    expect(summary.grandTotalCents).toBe(15000n);
    expect(summary.bonusTotalCents).toBe(0n);
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, undefined, "summary"));
    expect(pdf.getTitle()).toContain("Resumo Consolidado");
  });

  it("distinguishes an absent event from an absent collaborator and applies historic unit values", async () => {
    const { advance, events } = reports();
    const employee = events.employees[0];
    employee.months[0].bonus565 = { received: false, paidCents: "0", quantity: 0, targetCents: "0", differenceCents: "0", quantitySource: "none", issue: null };
    employee.bonusDifferenceCents = "2000";
    employee.totalDifferenceCents = "5000";
    events.bonusTotalCents = "2000";
    events.grandTotalCents = "5000";
    events.settings.historicOverrides = [{ competencyKey: "06-2026", bonusOldValueCents: "7500", sundayOldValueCents: "8500" }];
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateSalaryAdvancePdf(advance, events);
    const values = text.mock.calls.map(call => String(call[0]));
    expect(values).toContain("Sem evento");
    expect(values).toContain("0");
    expect(values.join("\n")).toContain("Histórico 06/2026 — Bônus 565: R$ 75,00 para R$ 90,00");
    expect(values).not.toContain("Ausente na competência");
    expect(values).toContain("200,00");
  });

  it.each([1, 2, 3, 4])("renders %i competencies as monthly rows with readable event detail", async monthCount => {
    const { advance, events } = reports(1, monthCount);
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateSalaryAdvancePdf(advance, events, "detailed");
    const values = text.mock.calls.map(call => String(call[0]));
    for (const competency of advance.competencies) expect(values).toContain(competency.key.replace("-", "/"));
    expect(values.filter(value => value === "80,00")).toHaveLength(monthCount);
    expect(values.filter(value => value === "1").length).toBeGreaterThanOrEqual(monthCount);
    expect(values).toContain("Total geral");
  });

  it("keeps paid audit evidence but excludes blocked and absent months from both payment PDFs", async () => {
    const { advance, events } = reports(1, 3, true, true);
    const summary = buildSalaryAdvanceSummary(advance, events);
    expect(summary.grandTotalCents).toBe(7500n);
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateSalaryAdvancePdf(advance, events);
    const values = text.mock.calls.map(call => String(call[0])).join("\n");
    expect(values).toContain("Bloqueado: Situação impeditiva: Demitido");
    expect(values).toContain("Ausente na competência");
    expect(values).toContain("80,00");
    expect(values).toContain("75,00");
    text.mockClear();
    await generateSalaryAdvancePdf(advance, events, "summary");
    expect(text.mock.calls.map(call => String(call[0]))).toContain("R$ 75,00");
  });

  it("preserves 512-character names and continuation bands without smaller fonts or overflowing rows", async () => {
    const { advance, events } = reports(12);
    const name = "N".repeat(512);
    advance.groups[0].employees[0].employeeName = name;
    events.employees[0].employeeName = name;
    for (const kind of ["summary", "detailed"] as const) {
      const text = vi.spyOn(PDFDocument.prototype, "text");
      const rect = vi.spyOn(PDFDocument.prototype, "rect");
      const size = vi.spyOn(PDFDocument.prototype, "fontSize");
      const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, events, kind));
      const printedName = text.mock.calls.map(call => String(call[0])).filter(value => /^N+$/.test(value)).join("");
      if (kind === "summary") expect(printedName).toBe(name);
      else expect(text.mock.calls.map(call => String(call[0])).join("").replace(/\s+/g, "")).toContain(name);
      expect(rect.mock.calls.filter(call => Number(call[1]) + Number(call[3]) > 549.29)).toEqual([]);
      expect(size.mock.calls.every(call => Number(call[0]) >= 6.5)).toBe(true);
      expect(text.mock.calls.filter(call => /^Página \d+ de \d+ \|/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
      vi.restoreAllMocks();
    }
  });
});
