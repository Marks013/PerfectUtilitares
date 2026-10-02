import { PDFDocument } from "pdf-lib";
import PDFDocumentKit from "pdfkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseCompetencyFileName } from "./competency";
import { consolidateSalaryAdvanceFiles } from "./consolidator";
import { generateSalaryAdvancePdf } from "./pdf";
afterEach(() => vi.restoreAllMocks());

describe("salary adjustment PDF", () => {
  it("prints the exact monthly percentage and exclusion reason beside the calculated amounts", async () => {
    const text = vi.spyOn(PDFDocumentKit.prototype, "text");
    const files = ["06", "07", "08"].map((month, index) => {
      const competency = parseCompetencyFileName(`${month}-2026.xlsx`);
      return { competency, sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", rows: [{ competency,
        sourceFile: `${month}-2026.xlsx`, sourceSheet: "Plan1", sourceRow: 5, branchAlias: "MATRIZ",
        registration: "1", employeeName: "COLABORADOR TESTE", baseCents: 182286n,
        employmentStatus: index === 1 ? "Demitido" : "Trabalhando", role: index === 2 ? "OPERADOR" : "Embalador a mão" }] };
    });
    const report = consolidateSalaryAdvanceFiles(files, 108n);
    const pdf = await PDFDocument.load(await generateSalaryAdvancePdf(report));
    expect(pdf.getPageCount()).toBe(1);
    const values = text.mock.calls.map(call => String(call[0]));
    expect(values).toContain("R$ 41,30\n2,2655%");
    expect(values).toContain("R$ 0,00\nBloqueado");
    expect(values).toContain("R$ 19,69\n1,0800%");
    expect(values).toContain("07-2026: bloqueado por situação Demitido");
    expect(text.mock.calls.every(call => typeof call[2] !== "number" || call[2] < 570)).toBe(true);
  });
  it("generates A4 landscape pages with a valid PDF structure", async () => {
    const competency = parseCompetencyFileName("06-2026.xlsx");
    const report = consolidateSalaryAdvanceFiles(
      [{
        competency,
        sourceFile: "06-2026.xlsx",
        sourceSheet: "Plan1",
        rows: Array.from({ length: 80 }, (_, index) => ({
          competency,
          sourceFile: "06-2026.xlsx",
          sourceSheet: "Plan1",
          sourceRow: index + 1,
          branchAlias: index < 40 ? "MATRIZ" : "LOJA B",
          registration: String(index + 1).padStart(9, "0"),
          employeeName: `COLABORADOR DE TESTE ${String(index + 1).padStart(3, "0")}`,
          baseCents: 456_084n,
        })),
      }],
      442n,
      new Date("2026-08-22T12:00:00.000Z"),
    );
    const bytes = await generateSalaryAdvancePdf(report);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(841.89, 1);
      expect(page.getHeight()).toBeCloseTo(595.28, 1);
    }
  });

  it("renders the maximum of four competencies without overflowing A4", async () => {
    const files = ["06", "07", "08", "09"].map((month, fileIndex) => {
      const competency = parseCompetencyFileName(`${month}-2026.xlsx`);
      return {
        competency,
        sourceFile: `${month}-2026.xlsx`,
        sourceSheet: "Plan1",
        rows: Array.from({ length: 20 }, (_, index) => ({
          competency,
          sourceFile: `${month}-2026.xlsx`,
          sourceSheet: "Plan1",
          sourceRow: index + 1,
          branchAlias: "MATRIZ",
          registration: String(index + 1).padStart(9, "0"),
          employeeName: `COLABORADOR COM NOME EXTENSO ${String(index + 1).padStart(3, "0")}`,
          baseCents: 456_084n + BigInt(fileIndex * 10_000),
        })),
      };
    });
    const bytes = await generateSalaryAdvancePdf(
      consolidateSalaryAdvanceFiles(files, 442n, new Date("2026-08-24T12:00:00.000Z")),
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(0);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(841.89, 1);
      expect(page.getHeight()).toBeCloseTo(595.28, 1);
    }
  });
});
