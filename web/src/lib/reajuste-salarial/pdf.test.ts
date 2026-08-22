import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { parseCompetencyFileName } from "./competency";
import { consolidatePayrollFiles } from "./consolidator";
import { generateSalaryAdjustmentPdf } from "./pdf";

describe("salary adjustment PDF", () => {
  it("generates A4 landscape pages with a valid PDF structure", async () => {
    const competency = parseCompetencyFileName("06-2026.xlsx");
    const report = consolidatePayrollFiles(
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
    const bytes = await generateSalaryAdjustmentPdf(report);
    expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    for (const page of pdf.getPages()) {
      expect(page.getWidth()).toBeCloseTo(841.89, 1);
      expect(page.getHeight()).toBeCloseTo(595.28, 1);
    }
  });
});
