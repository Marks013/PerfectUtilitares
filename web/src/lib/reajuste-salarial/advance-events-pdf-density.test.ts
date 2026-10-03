import { describe, expect, it, vi, afterEach } from "vitest";
import { PDFDocument as LoadedPdf } from "pdf-lib";
import PDFDocument from "pdfkit";
import { generateSalaryAdvancePdf } from "./pdf";
import { consolidateSalaryAdvanceFiles } from "./consolidator";
import { buildEventAdjustmentReport } from "./event-adjustments";
import { parseCompetencyFileName } from "./competency";

function reports(monthCount = 4) {
  const months = ["06", "07", "08", "09"].slice(0, monthCount);
  const rows = Array.from({ length: 120 }, (_, index) => ({ registration: String(index + 1), employeeName: `COLABORADOR FICTICIO ${index + 1}`, branchAlias: "MATRIZ", employmentStatus: "Trabalhando", role: "OPERADOR" }));
  const advance = consolidateSalaryAdvanceFiles(months.map(month => {
    const competency = parseCompetencyFileName(`${month}-2026.xlsx`);
    return { competency, sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", rows: rows.map(row => ({ ...row, competency, sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", sourceRow: 1, baseCents: 100_000n })) };
  }), 108n);
  const events = buildEventAdjustmentReport(months.map(month => ({ competency: parseCompetencyFileName(`${month}-2026.xlsx`), sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", company: "1 - EMPRESA FICTICIA", rows: rows.map(row => ({ ...row, events: { "565": [{ paidCents: "8000", reference: "1", sourceRow: 2 }], "901": [{ paidCents: "17000", reference: "", sourceRow: 3 }] } })) })), { bonusOldValueCents: "8000", bonusNewValueCents: "9000", sundayOldValueCents: "8500", sundayNewValueCents: "9000", historicOverrides: [] });
  return { advance, events };
}

afterEach(() => vi.restoreAllMocks());

describe("compact salary advance PDFs", () => {
  it.each(["summary", "detailed"] as const)("uses the available page height without reducing body type in %s", async kind => {
    const { advance, events } = reports();
    const text = vi.spyOn(PDFDocument.prototype, "text");
    const size = vi.spyOn(PDFDocument.prototype, "fontSize");
    const pdf = await LoadedPdf.load(await generateSalaryAdvancePdf(advance, events, kind));
    expect(pdf.getPageCount()).toBeLessThanOrEqual(kind === "summary" ? 5 : 27);
    expect(text.mock.calls.map(call => String(call[0])).join("\n")).not.toMatch(/Alvo\s/);
    expect(size.mock.calls.every(call => Number(call[0]) >= 6.5)).toBe(true);
    expect(size.mock.calls.filter(call => Number(call[0]) === 7.5).length).toBeGreaterThan(120);
  });

  it("keeps regular monthly rows intact, all competencies and employee totals", async () => {
    const { advance, events } = reports();
    const text = vi.spyOn(PDFDocument.prototype, "text");
    await generateSalaryAdvancePdf(advance, events);
    const values = text.mock.calls.map(call => String(call[0]));
    for (const competency of advance.competencies) expect(values.filter(value => value === competency.key.replace("-", "/"))).toHaveLength(120);
    expect(values.filter(value => value === "Subtotal colaborador")).toHaveLength(120);
    expect(values.filter(value => /Cadastro.*continuação/.test(value))).toHaveLength(0);
    expect(values.filter(value => /^(Unitário|Alvo)/.test(value))).toHaveLength(0);
    expect(values).toContain("Pago (R$)");
    expect(values).toContain("Dif. (R$)");
  });
});
