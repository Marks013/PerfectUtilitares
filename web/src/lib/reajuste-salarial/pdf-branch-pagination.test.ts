import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument as LoadedPdf } from "pdf-lib";
import PDFDocument from "pdfkit";
import { parseCompetencyFileName } from "./competency";
import { consolidateSalaryAdvanceFiles } from "./consolidator";
import { buildEventAdjustmentReport } from "./event-adjustments";
import { generateSalaryAdvancePdf } from "./pdf";

afterEach(() => vi.restoreAllMocks());

describe("salary advance PDF branch pagination", () => {
  it.each([
    { kind: "summary" as const, includeEvents: true },
    { kind: "detailed" as const, includeEvents: true },
    { kind: "summary" as const, includeEvents: false },
    { kind: "detailed" as const, includeEvents: false },
  ])("starts every branch on its own page in $kind (events: $includeEvents)", async ({ kind, includeEvents }) => {
    const competency = parseCompetencyFileName("06-2026.xlsx");
    const rows = ["MATRIZ", "CASTELO BRANCO", "HIPER"].map((branchAlias, index) => ({
      competency, branchAlias, registration: String(index + 1), employeeName: `COLABORADOR TESTE ${index + 1}`,
      employmentStatus: "Trabalhando", role: "OPERADOR", baseCents: 100000n,
      sourceFile: "06-2026.xlsx", sourceSheet: "Plan1", sourceRow: index + 1,
    }));
    const advance = consolidateSalaryAdvanceFiles([{ competency, sourceFile: "06-2026.xlsx", sourceSheet: "Plan1", rows }], 108n);
    const events = buildEventAdjustmentReport([{ competency, sourceFile: "06-2026.xlsx", sourceSheet: "Plan1", company: "1 - EMPRESA TESTE", rows: rows.map(row => ({ ...row, events: { "565": [{ paidCents: "8000", reference: "1", sourceRow: 1 }], "901": [{ paidCents: "17000", reference: "", sourceRow: 2 }] } })) }], { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] });
    const printed: { value: string; page: unknown }[] = [];
    const originalText = PDFDocument.prototype.text;
    vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function(this: InstanceType<typeof PDFDocument>, value, ...args) {
      printed.push({ value: String(value), page: this.page });
      return originalText.apply(this, [value, ...args]);
    });
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, includeEvents ? events : undefined, kind));
    expect(pdf.getPageCount()).toBe(3);
    const branchPages = advance.groups.map(group => {
      const heading = printed.find(item => item.value === `Filial: ${group.branchAlias}` || item.value === group.branchAlias);
      expect(heading).toBeDefined();
      return heading?.page;
    });
    expect(new Set(branchPages).size).toBe(3);
    for (const [index, group] of advance.groups.entries()) {
      const name = group.employees[0].employeeName;
      const employee = printed.filter(item => item.value.includes(name));
      expect(employee).toHaveLength(1);
      expect(employee[0].page).toBe(branchPages[index]);
    }
    expect(printed.filter(item => /^Página \d+ de \d+ \|/.test(item.value))).toHaveLength(3);
    if (kind === "summary" || includeEvents) {
      const subtotals = printed.filter(item => item.value === (kind === "summary" ? "Subtotal da filial" : "Subtotal filial"));
      expect(subtotals.map(item => item.page)).toEqual(branchPages);
      expect(printed.some(item => item.value === (kind === "summary" ? includeEvents ? "R$ 92,40" : "R$ 32,40" : "92,40"))).toBe(true);
    }
  });
});
