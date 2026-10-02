import { describe, expect, it, vi, afterEach } from "vitest";
import { PDFDocument as LoadedPdf } from "pdf-lib";
import PDFDocument from "pdfkit";
import { generateSalaryAdvancePdf } from "./pdf";
import { consolidateSalaryAdvanceFiles } from "./consolidator";
import { buildEventAdjustmentReport } from "./event-adjustments";
import { parseCompetencyFileName } from "./competency";
import type { ParsedPayrollFile } from "./types";
import type { ParsedSalaryEventFile } from "./event-adjustment-types";

function reports(count = 1) {
  const advanceFiles: ParsedPayrollFile[] = [];
  const eventFiles: ParsedSalaryEventFile[] = [];
  for (const [index, month] of ["06", "07", "08"].entries()) {
    const competency = parseCompetencyFileName(`${month}-2026.xlsx`);
    const rows = Array.from({ length: count }, (_, i) => ({ registration: String(i + 1), employeeName: `COLABORADOR FICTICIO ${i + 1}`, branchAlias: "MATRIZ" }));
    advanceFiles.push({ competency, sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", rows: rows.map(row => ({ ...row, competency, sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", sourceRow: 1, baseCents: 100_000n })) });
    eventFiles.push({ competency, sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", company: "1 - EMPRESA FICTICIA", rows: rows.map(row => ({ ...row, events: { "565": [{ paidCents: "8000", reference: "1", sourceRow: 2 }], "901": [{ paidCents: ["17000", "8500", "25500"][index], reference: "", sourceRow: 3 }] } })) });
  }
  return {
    advance: consolidateSalaryAdvanceFiles(advanceFiles, 500n),
    events: buildEventAdjustmentReport(eventFiles, { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] }),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("optional events in the advance PDF", () => {
  it("creates one PDF with a combined total and separately audited calculations", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const { advance, events } = reports();
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, events));
    expect(pdf.getTitle()).toBe("Antecipação Salarial com diferenças de bônus e domingos");
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);
    const values = text.mock.calls.map(call => String(call[0])).join("\n");
    for (const label of ["resumo consolidado", "Antecipação Salarial", "Apuração de diferenças — eventos 565 e 901", "R$ 150,00", "R$ 30,00", "R$ 210,00", "não são somados novamente"]) expect(values).toContain(label);
    expect(text.mock.calls.filter(call => /^Página \d+ de \d+$/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
    expect(values).toContain(`Página ${pdf.getPageCount()} de ${pdf.getPageCount()}`);
  });
  it("repeats summary headings and numbers all pages once for a larger payroll", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const { advance, events } = reports(35);
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, events));
    expect(text.mock.calls.filter(call => String(call[0]).endsWith("resumo consolidado")).length).toBeGreaterThan(1);
    expect(text.mock.calls.filter(call => /^Página \d+ de \d+$/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
    expect(text.mock.calls.filter(call => /^Página \d+ de \d+ \|/.test(String(call[0])))).toHaveLength(0);
  });
  it("blocks pending optional events before generating a combined payment report", async () => {
    const { advance, events } = reports();
    events.issueCount = 1;
    await expect(generateSalaryAdvancePdf(advance, events)).rejects.toThrow();
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
    expect(text.mock.calls.filter(call => /^Página \d+ de \d+$/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
    expect(rect.mock.calls.filter(call => Number(call[1]) + Number(call[3]) > 549.28)).toEqual([]);
    const printed = text.mock.calls.map(call => String(call[0]));
    expect(printed.some(value => value.includes("A\nA"))).toBe(false);
    expect(printed.some(value => value.includes(branch.replace(/\s+/g, " ").trim()))).toBe(true);
  });
  it("preserves the original advance-only PDF when the option is disabled", async () => {
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const { advance } = reports();
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance));
    expect(pdf.getTitle()).toBe("Antecipação Salarial");
    const values = text.mock.calls.map(call => String(call[0])).join("\n");
    expect(values).not.toContain("resumo consolidado");
    expect(values).not.toContain("Apuração de diferenças — eventos 565 e 901");
    expect(text.mock.calls.filter(call => /^Página \d+ de \d+ \|/.test(String(call[0])))).toHaveLength(pdf.getPageCount());
  });
});
